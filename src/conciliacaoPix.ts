import type { App } from './app.ts';
import { baixarPixNativoConciliado } from './cobrancas.ts';
import { carregarTokenMp, janelaConciliacaoPix, marcarConciliacaoPix } from './configuracao.ts';
import { consultar } from './db.ts';
import { casarPixNativos, type EntradaPixRecebida, type PixPendenteConciliacao } from './domain/conciliacao.ts';
import { partesNoFuso } from './domain/calendar.ts';
import { txidCobranca } from './domain/pix.ts';
import type { PixRecebidoMp } from './gateways.ts';
import { mensagemErro } from './texto.ts';

export type ResultadoConciliacaoNativa = {
  consultadas: number;
  pendentes: number;
  conciliadas: number;
  confirmacoes: number;
  falhas: string[];
};

function entradaRecebida(entrada: PixRecebidoMp): EntradaPixRecebida {
  return {
    mpPaymentId: entrada.id,
    valorCentavos: entrada.valorCentavos,
    txid: entrada.txid,
    aprovadoEm: entrada.dateApproved,
  };
}

async function pendentesNativos(app: App): Promise<PixPendenteConciliacao[]> {
  const linhas = await consultar<{
    pix_id: string;
    cobranca_id: string;
    pessoa_id: string;
    valor_centavos: number;
    competencia_ano: number;
    competencia_mes: number;
    txid: string | null;
    nome: string;
  }>(
    app.pool,
    `SELECT px.id AS pix_id, c.id AS cobranca_id, c.pessoa_id, px.valor_centavos,
            c.competencia_ano, c.competencia_mes, px.txid, p.nome
     FROM pix px
     JOIN cobranca c ON c.id = px.cobranca_id
     JOIN pessoa p ON p.id = c.pessoa_id
     WHERE px.provedor = 'nativo'
       AND px.status_local IN ('pendente', 'falha_cancelamento')
       AND c.status = 'aberta'`,
  );
  return linhas.map((linha) => ({
    pixId: linha.pix_id,
    cobrancaId: linha.cobranca_id,
    pessoaId: linha.pessoa_id,
    valorCentavos: linha.valor_centavos,
    competenciaAno: linha.competencia_ano,
    competenciaMes: linha.competencia_mes,
    txid: linha.txid ?? txidCobranca(linha.nome, linha.competencia_ano, linha.competencia_mes),
  }));
}

async function filtrarEntradasNovas(app: App, entradas: PixRecebidoMp[]): Promise<PixRecebidoMp[]> {
  if (!entradas.length) return [];
  const ids = entradas.map((item) => item.id);
  const usados = await consultar<{ mp_payment_id: string }>(
    app.pool,
    'SELECT mp_payment_id FROM evento_pagamento WHERE mp_payment_id = ANY($1::text[])',
    [ids],
  );
  const vistos = new Set(usados.map((item) => item.mp_payment_id));
  return entradas.filter((item) => !vistos.has(item.id));
}

export async function conciliarPixNativos(app: App, agora = app.clock()): Promise<ResultadoConciliacaoNativa> {
  const resultado: ResultadoConciliacaoNativa = {
    consultadas: 0,
    pendentes: 0,
    conciliadas: 0,
    confirmacoes: 0,
    falhas: [],
  };
  const pendentes = await pendentesNativos(app);
  resultado.pendentes = pendentes.length;
  if (!pendentes.length) return resultado;

  const token = await carregarTokenMp(app.pool);
  if (!token) return resultado;

  const { inicio, fim } = await janelaConciliacaoPix(app.pool, agora);
  const busca = await app.mp.buscarPixRecebidos(token, inicio, fim);
  if (!busca.ok) {
    resultado.falhas.push(busca.motivo);
    return resultado;
  }

  const entradas = await filtrarEntradasNovas(app, busca.entradas);
  resultado.consultadas = entradas.length;
  const pares = casarPixNativos(
    pendentes,
    entradas.map(entradaRecebida),
    (data) => {
      const partes = partesNoFuso(data);
      return { ano: partes.year, mes: partes.month };
    },
  );

  for (const par of pares) {
    try {
      const efeito = await baixarPixNativoConciliado(app, par.pendente.pixId, par.pendente.pessoaId, par.entrada, agora);
      if (efeito.tipo === 'baixa') {
        resultado.conciliadas += 1;
        if (efeito.confirmacao === 'enviada') resultado.confirmacoes += 1;
        if (efeito.confirmacao === 'falha') {
          resultado.falhas.push(`Confirmação não enviada: ${efeito.motivo ?? 'falha'}`);
        }
      } else if (efeito.tipo === 'divergencia') {
        resultado.falhas.push('Valor recebido não bate com o PIX pendente.');
      }
    } catch (erro) {
      resultado.falhas.push(mensagemErro(erro));
    }
  }

  await marcarConciliacaoPix(app.pool, fim);
  return resultado;
}
