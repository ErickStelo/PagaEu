import { randomUUID } from 'node:crypto';
import type { App } from './app.ts';
import { carregarEvolution, carregarSmtp } from './configuracao.ts';
import { comTravaPessoa, consultar, transacao, type Cliente } from './db.ts';
import { formatarCompetencia, formatarDataHora, diasInteirosDesde } from './domain/calendar.ts';
import { formatarCentavos } from './domain/money.ts';
import { preencherTemplate, type Canal, type TipoMensagem } from './domain/template.ts';
import { reenvioPermitido, type StatusCobranca } from './domain/acoes.ts';
import { listaPortugues, redigir } from './texto.ts';

type LinhaMsg = {
  descricao: string;
  competencia_origem_ano: number;
  competencia_origem_mes: number;
  valor_centavos: number;
};

type ContextoMsg = {
  cobrancaId: string;
  status: StatusCobranca;
  pessoaNome: string;
  email: string;
  whatsapp: string;
  canalEmail: boolean;
  canalWhatsapp: boolean;
  competencia: string;
  linhas: LinhaMsg[];
  total: number;
  copiaCola: string | null;
  validadeDias: number | null;
  venceEm: Date | null;
  pagoEm: Date | null;
  competenciasQuitadas: string[];
  temPixAtivo: boolean;
};

async function carregar(cliente: Cliente, cobrancaId: string): Promise<ContextoMsg | null> {
  const cobrancas = await consultar<{
    id: string;
    status: StatusCobranca;
    competencia_ano: number;
    competencia_mes: number;
    paga_em: Date | null;
    canal_email_selecionado: boolean;
    canal_whatsapp_selecionado: boolean;
    nome: string;
    email: string;
    whatsapp: string;
  }>(
    cliente,
    `SELECT c.id, c.status, c.competencia_ano, c.competencia_mes, c.paga_em,
            c.canal_email_selecionado, c.canal_whatsapp_selecionado,
            p.nome, p.email, p.whatsapp
     FROM cobranca c
     JOIN pessoa p ON p.id = c.pessoa_id
     WHERE c.id = $1`,
    [cobrancaId],
  );
  const cobranca = cobrancas[0];
  if (!cobranca) return null;
  const linhas = await consultar<LinhaMsg>(
    cliente,
    `SELECT descricao, competencia_origem_ano, competencia_origem_mes, valor_centavos
     FROM linha_cobranca
     WHERE cobranca_id = $1
     ORDER BY competencia_origem_ano, competencia_origem_mes, descricao, id`,
    [cobrancaId],
  );
  const pixes = await consultar<{
    status_local: string;
    copia_e_cola: string | null;
    validade_dias: number;
    vence_em: Date;
  }>(
    cliente,
    `SELECT status_local, copia_e_cola, validade_dias, vence_em
     FROM pix WHERE cobranca_id = $1
     ORDER BY criado_em DESC`,
    [cobrancaId],
  );
  const ativo = pixes.find((pix) => pix.status_local === 'pendente' || pix.status_local === 'falha_cancelamento') ?? null;
  const ultimo = pixes[0] ?? null;
  const quitadas = await consultar<{ competencia_ano: number; competencia_mes: number }>(
    cliente,
    `SELECT competencia_ano, competencia_mes FROM cobranca
     WHERE id = $1 OR quitada_por_id = $1
     ORDER BY competencia_ano, competencia_mes`,
    [cobrancaId],
  );
  return {
    cobrancaId,
    status: cobranca.status,
    pessoaNome: cobranca.nome,
    email: cobranca.email,
    whatsapp: cobranca.whatsapp,
    canalEmail: cobranca.canal_email_selecionado,
    canalWhatsapp: cobranca.canal_whatsapp_selecionado,
    competencia: formatarCompetencia(cobranca.competencia_ano, cobranca.competencia_mes),
    linhas,
    total: linhas.reduce((soma, linha) => soma + linha.valor_centavos, 0),
    copiaCola: ativo?.copia_e_cola ?? null,
    validadeDias: ativo?.validade_dias ?? ultimo?.validade_dias ?? null,
    venceEm: ativo?.vence_em ?? ultimo?.vence_em ?? null,
    pagoEm: cobranca.paga_em,
    competenciasQuitadas: quitadas.map((item) => formatarCompetencia(item.competencia_ano, item.competencia_mes)),
    temPixAtivo: Boolean(ativo),
  };
}

function textoItens(linhas: LinhaMsg[]): string {
  return linhas
    .map((linha) => {
      const competencia = formatarCompetencia(linha.competencia_origem_ano, linha.competencia_origem_mes);
      return `${linha.descricao} (${competencia}) — R$ ${formatarCentavos(linha.valor_centavos)}`;
    })
    .join('\n');
}

function variaveis(ctx: ContextoMsg, tipo: TipoMensagem, agora: Date): Record<string, string> {
  const base: Record<string, string> = {
    nome: ctx.pessoaNome,
    competencia: ctx.competencia,
    itens: textoItens(ctx.linhas),
    total: formatarCentavos(ctx.total),
  };
  if (tipo === 'cobranca') {
    base.copia_e_cola = ctx.copiaCola ?? '';
    base.validade_dias = ctx.validadeDias === null ? '' : String(ctx.validadeDias);
    base.vence_em = ctx.venceEm ? formatarDataHora(ctx.venceEm) : '';
  }
  if (tipo === 'confirmacao') {
    base.pago_em = ctx.pagoEm ? formatarDataHora(ctx.pagoEm) : '';
    base.competencias_quitadas = listaPortugues(ctx.competenciasQuitadas);
  }
  if (tipo === 'inadimplencia') {
    base.vence_em = ctx.venceEm ? formatarDataHora(ctx.venceEm) : '';
    base.dias_vencido = ctx.venceEm ? String(Math.max(0, diasInteirosDesde(ctx.venceEm, agora))) : '';
  }
  return base;
}

async function registrar(
  cliente: Cliente,
  cobrancaId: string,
  tipo: TipoMensagem,
  canal: Canal,
  agora: Date,
  ok: boolean,
  motivo: string | null,
): Promise<void> {
  await transacao(cliente, async () => {
    await cliente.query(
      `INSERT INTO envio (id, cobranca_id, tipo, canal, tentado_em, resultado, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), cobrancaId, tipo, canal, agora, ok ? 'enviado' : 'falha', motivo],
    );
  });
}

export async function enviarMensagem(
  app: App,
  cliente: Cliente,
  cobrancaId: string,
  tipo: TipoMensagem,
  agora: Date,
  somenteCanal?: Canal,
): Promise<{ ok: boolean; motivo: string | null } | null> {
  const ctx = await carregar(cliente, cobrancaId);
  if (!ctx) return null;
  if ((tipo === 'cobranca' || tipo === 'inadimplencia') && ctx.status !== 'aberta') return null;
  if (tipo === 'confirmacao' && ctx.status !== 'paga') return null;
  if (tipo === 'cobranca' && !ctx.temPixAtivo) return null;
  const modelos = await consultar<{ canal: Canal; assunto: string | null; corpo: string }>(
    cliente,
    'SELECT canal, assunto, corpo FROM template WHERE tipo = $1',
    [tipo],
  );
  const smtp = await carregarSmtp(cliente);
  const evolutionCred = await carregarEvolution(cliente);
  const vars = variaveis(ctx, tipo, agora);
  const canais: Canal[] = ['email', 'whatsapp'];
  let ultimo: { ok: boolean; motivo: string | null } | null = null;
  for (const canal of canais) {
    if (somenteCanal && canal !== somenteCanal) continue;
    const ligado = canal === 'email' ? ctx.canalEmail : ctx.canalWhatsapp;
    if (!ligado) continue;
    const modelo = modelos.find((item) => item.canal === canal);
    if (!modelo) continue;
    const corpo = preencherTemplate(modelo.corpo, vars);
    const assunto = preencherTemplate(modelo.assunto ?? `Cobrança de ${ctx.competencia}`, vars);
    try {
      if (canal === 'email') {
        const resultado = await app.correio.enviar(smtp, { to: ctx.email, subject: assunto, text: corpo });
        const motivo = resultado.ok ? null : redigir(resultado.motivo, [smtp?.senha]);
        await registrar(cliente, cobrancaId, tipo, canal, agora, resultado.ok, motivo);
        ultimo = { ok: resultado.ok, motivo };
      } else {
        const resultado = await app.evolution.enviarTexto(ctx.whatsapp, corpo);
        if (!resultado.ok) {
          const motivo = redigir(resultado.motivo, [evolutionCred?.apiKey]);
          await registrar(cliente, cobrancaId, tipo, canal, agora, false, motivo);
          ultimo = { ok: false, motivo };
          continue;
        }
        if (tipo === 'cobranca' && ctx.copiaCola) {
          const chave = await app.evolution.enviarTexto(ctx.whatsapp, ctx.copiaCola);
          if (!chave.ok) {
            const motivo = redigir(chave.motivo, [evolutionCred?.apiKey]);
            await registrar(cliente, cobrancaId, tipo, canal, agora, false, motivo);
            ultimo = { ok: false, motivo };
            continue;
          }
        }
        await registrar(cliente, cobrancaId, tipo, canal, agora, true, null);
        ultimo = { ok: true, motivo: null };
      }
    } catch (erro) {
      const motivo = redigir(erro instanceof Error ? erro.message : 'Falha no envio', [smtp?.senha, evolutionCred?.apiKey]);
      await registrar(cliente, cobrancaId, tipo, canal, agora, false, motivo);
      ultimo = { ok: false, motivo };
    }
  }
  return ultimo;
}

export async function reenviar(
  app: App,
  cobrancaId: string,
  tipo: TipoMensagem,
  canal: Canal,
  agora = app.clock(),
): Promise<{ ok: true; aviso: string } | { ok: false; aviso: string }> {
  const resultado = await reenviarCanais(app, cobrancaId, tipo, [canal], agora);
  return resultado;
}

export async function reenviarCanais(
  app: App,
  cobrancaId: string,
  tipo: TipoMensagem,
  canais: Canal[],
  agora = app.clock(),
): Promise<{ ok: true; aviso: string } | { ok: false; aviso: string }> {
  const unicos = [...new Set(canais)];
  if (!unicos.length) return { ok: false, aviso: 'Escolha pelo menos um canal.' };
  const pessoa = await consultar<{ pessoa_id: string }>(app.pool, 'SELECT pessoa_id FROM cobranca WHERE id = $1', [cobrancaId]);
  const pessoaId = pessoa[0]?.pessoa_id;
  if (!pessoaId) return { ok: false, aviso: 'Cobrança não encontrada.' };
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const ctx = await carregar(cliente, cobrancaId);
    if (!ctx) return { ok: false, aviso: 'Cobrança não encontrada.' };
    let enviados = 0;
    const falhas: string[] = [];
    for (const canal of unicos) {
      const permitido = reenvioPermitido({
        status: ctx.status,
        tipo,
        canalSelecionado: canal === 'email' ? ctx.canalEmail : ctx.canalWhatsapp,
        temPixAtivo: ctx.temPixAtivo,
      });
      if (!permitido) {
        falhas.push(`${canal === 'email' ? 'E-mail' : 'WhatsApp'} não está disponível.`);
        continue;
      }
      const envio = await enviarMensagem(app, cliente, cobrancaId, tipo, agora, canal);
      if (!envio?.ok) {
        falhas.push(envio?.motivo || `Falha no ${canal === 'email' ? 'e-mail' : 'WhatsApp'}.`);
        continue;
      }
      enviados += 1;
    }
    if (enviados === 0) return { ok: false, aviso: falhas[0] ?? 'Não foi possível enviar.' };
    if (falhas.length) {
      return { ok: true, aviso: `Enviado em ${enviados} canal(is). ${falhas[0]}` };
    }
    if (enviados === 1) {
      return { ok: true, aviso: unicos[0] === 'email' ? 'E-mail enviado.' : 'WhatsApp enviado.' };
    }
    return { ok: true, aviso: 'Mensagens enviadas nos canais escolhidos.' };
  });
}
