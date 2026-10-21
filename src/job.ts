import type { App } from './app.ts';
import { carregarIntervaloConciliacaoMinutos } from './configuracao.ts';
import {
  aplicarDiasPendentes,
  consultarCobrancasAbertas,
  enviarInadimplenciasDevidas,
  gerarDoDia,
} from './cobrancas.ts';
import { chaveDiaria, chaveHoraria } from './domain/calendar.ts';
import { comTravaManutencao, consultar, type Cliente } from './db.ts';
import { mensagemErro } from './texto.ts';

export async function executarJobDiario(app: App, agora = app.clock()): Promise<void> {
  await gerarDoDia(app, agora);
  await enviarInadimplenciasDevidas(app, agora);
  await aplicarDiasPendentes(app, agora);
}

export async function executarVerificacaoHoraria(app: App, agora = app.clock()): Promise<void> {
  await enviarInadimplenciasDevidas(app, agora);
}

async function deveRodarConciliacao(cliente: Cliente, agora: Date, intervaloMinutos: number): Promise<boolean> {
  const linhas = await consultar<{ atualizado_em: Date }>(
    cliente,
    `SELECT atualizado_em FROM agendamento WHERE nome = 'conciliacao'`,
  );
  const ultima = linhas[0]?.atualizado_em;
  if (!ultima) return true;
  return agora.getTime() - ultima.getTime() >= intervaloMinutos * 60_000;
}

export async function executarConciliacaoAutomatica(app: App, agora = app.clock()): Promise<void> {
  const intervalo = await carregarIntervaloConciliacaoMinutos(app.pool);
  if (intervalo <= 0) return;
  const podeRodar = await comTravaManutencao(app.pool, async (cliente) => {
    if (!(await deveRodarConciliacao(cliente, agora, intervalo))) return false;
    return true;
  });
  if (!podeRodar) return;
  await consultarCobrancasAbertas(app, agora);
  await comTravaManutencao(app.pool, async (cliente) => {
    await marcar(cliente, 'conciliacao', String(agora.getTime()), agora);
  });
}

async function jaRodou(cliente: Cliente, nome: string, chave: string): Promise<boolean> {
  const linhas = await consultar<{ ultima_chave: string }>(cliente, 'SELECT ultima_chave FROM agendamento WHERE nome = $1', [nome]);
  return linhas[0]?.ultima_chave === chave;
}

async function marcar(cliente: Cliente, nome: string, chave: string, agora: Date): Promise<void> {
  await cliente.query(
    `INSERT INTO agendamento (nome, ultima_chave, atualizado_em) VALUES ($1, $2, $3)
     ON CONFLICT (nome) DO UPDATE SET ultima_chave = EXCLUDED.ultima_chave, atualizado_em = EXCLUDED.atualizado_em`,
    [nome, chave, agora],
  );
}

async function pulso(app: App): Promise<void> {
  await executarConciliacaoAutomatica(app);
  const agora = app.clock();
  const diaria = chaveDiaria(agora);
  const horaria = chaveHoraria(agora);
  if (!diaria && !horaria) return;
  await comTravaManutencao(app.pool, async (cliente) => {
    if (diaria) {
      if (await jaRodou(cliente, 'diario', diaria)) return;
      await executarJobDiario(app, agora);
      await marcar(cliente, 'diario', diaria, agora);
      return;
    }
    if (!horaria) return;
    if (await jaRodou(cliente, 'horario', horaria)) return;
    await executarVerificacaoHoraria(app, agora);
    await marcar(cliente, 'horario', horaria, agora);
  });
}

export async function executarAgendado(app: App): Promise<void> {
  await pulso(app);
}

export function agendar(app: App): void {
  const timer = setInterval(() => {
    void pulso(app).catch((erro) => {
      console.error(`Falha no agendador: ${mensagemErro(erro)}`);
    });
  }, 10_000);
  timer.unref();
}
