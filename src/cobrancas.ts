import { randomUUID } from 'node:crypto';
import type { App } from './app.ts';
import { carregarTokenMp } from './configuracao.ts';
import { comTravaPessoa, consultar, transacao, type Cliente, type Consultavel } from './db.ts';
import { acoesDisponiveis, mpPermiteCancelar, type StatusCobranca, type StatusPix } from './domain/acoes.ts';
import {
  diaEfetivo,
  formatarCompetencia,
  formatarExpiracaoMp,
  partesNoFuso,
  somarDias,
} from './domain/calendar.ts';
import { comporLinhas, type LinhaRascunho } from './domain/composicao.ts';
import { centavosParaReais } from './domain/money.ts';
import { urlNotificacao } from './env.ts';
import type { PagamentoRemoto } from './gateways.ts';
import { enviarMensagem } from './mensagens.ts';
import { mensagemErro, primeiroNome, redigir } from './texto.ts';

export type OrigemGeracao = 'job' | 'manual' | 'lote';

export type Cobranca = {
  id: string;
  pessoa_id: string;
  competencia_ano: number;
  competencia_mes: number;
  anterior_id: string | null;
  origem_geracao: OrigemGeracao;
  status: StatusCobranca;
  paga_em: Date | null;
  origem_baixa: 'pagamento' | 'manual' | 'cascata' | null;
  quitada_por_id: string | null;
  canal_email_selecionado: boolean;
  canal_whatsapp_selecionado: boolean;
  alerta_itens_ja_pagos: boolean;
  cancelada_em: Date | null;
  motivo_cancelamento: string | null;
};

type Pix = {
  id: string;
  cobranca_id: string;
  mp_payment_id: string | null;
  idempotency_key: string;
  valor_centavos: number;
  validade_dias: number;
  vence_em: Date;
  copia_e_cola: string | null;
  ticket_url: string | null;
  status_local: StatusPix;
  mp_status: string | null;
  mp_status_detail: string | null;
  aviso_inadimplencia_em: Date | null;
  motivo: string | null;
};

type PessoaCobranca = {
  id: string;
  nome: string;
  email: string;
  cpf: string | null;
  whatsapp: string;
  dia_cobranca: number;
  validade_pix_dias: number;
  dias_aviso_inadimplencia: number;
  canal_email: boolean;
  canal_whatsapp: boolean;
  ativa: boolean;
};

type Efeito = {
  tipo: 'baixa' | 'excedente' | 'divergencia' | 'encerrado' | 'inalterado' | 'repetido';
  confirmacaoId: string | null;
  ancestrais: string[];
};

export type ResultadoGeracao = { ok: true; cobrancaId: string; pixOk: boolean } | { ok: false; aviso: string };

export type ResultadoLote = {
  recusado: string | null;
  geradas: number;
  pixFalhos: number;
  puladas: { nome: string; motivo: string }[];
  falhas: { nome: string; motivo: string }[];
};

function codigoPg(erro: unknown): string | null {
  if (erro && typeof erro === 'object' && 'code' in erro && typeof (erro as { code: unknown }).code === 'string') {
    return (erro as { code: string }).code;
  }
  return null;
}

async function pessoaPorId(cliente: Consultavel, id: string): Promise<PessoaCobranca | null> {
  const linhas = await consultar<PessoaCobranca>(
    cliente,
    `SELECT id, nome, email, cpf, whatsapp, dia_cobranca, validade_pix_dias, dias_aviso_inadimplencia,
            canal_email, canal_whatsapp, ativa
     FROM pessoa WHERE id = $1`,
    [id],
  );
  return linhas[0] ?? null;
}

async function cobrancaPorId(cliente: Consultavel, id: string): Promise<Cobranca | null> {
  const linhas = await consultar<Cobranca>(cliente, 'SELECT * FROM cobranca WHERE id = $1', [id]);
  return linhas[0] ?? null;
}

async function pixPorId(cliente: Consultavel, id: string): Promise<Pix | null> {
  const linhas = await consultar<Pix>(cliente, 'SELECT * FROM pix WHERE id = $1', [id]);
  return linhas[0] ?? null;
}

async function pixAtivo(cliente: Consultavel, cobrancaId: string): Promise<Pix | null> {
  const linhas = await consultar<Pix>(
    cliente,
    `SELECT * FROM pix WHERE cobranca_id = $1 AND status_local IN ('pendente', 'falha_cancelamento') LIMIT 1`,
    [cobrancaId],
  );
  return linhas[0] ?? null;
}

async function ultimoPix(cliente: Consultavel, cobrancaId: string): Promise<Pix | null> {
  const linhas = await consultar<Pix>(
    cliente,
    'SELECT * FROM pix WHERE cobranca_id = $1 ORDER BY criado_em DESC LIMIT 1',
    [cobrancaId],
  );
  return linhas[0] ?? null;
}

export async function vigenteDaPessoa(cliente: Consultavel, pessoaId: string): Promise<Cobranca | null> {
  const linhas = await consultar<Cobranca>(
    cliente,
    `SELECT * FROM cobranca c
     WHERE c.pessoa_id = $1 AND c.status = 'aberta'
       AND NOT EXISTS (
         SELECT 1 FROM cobranca posterior
         WHERE posterior.pessoa_id = c.pessoa_id
           AND posterior.status IN ('aberta', 'paga')
           AND (posterior.competencia_ano, posterior.competencia_mes) > (c.competencia_ano, c.competencia_mes)
       )
     ORDER BY c.competencia_ano DESC, c.competencia_mes DESC
     LIMIT 1`,
    [pessoaId],
  );
  return linhas[0] ?? null;
}

async function ativaNaCompetencia(cliente: Consultavel, pessoaId: string, ano: number, mes: number): Promise<Cobranca | null> {
  const linhas = await consultar<Cobranca>(
    cliente,
    `SELECT * FROM cobranca
     WHERE pessoa_id = $1 AND competencia_ano = $2 AND competencia_mes = $3 AND status IN ('aberta', 'paga')
     LIMIT 1`,
    [pessoaId, ano, mes],
  );
  return linhas[0] ?? null;
}

async function existeNoMes(cliente: Consultavel, pessoaId: string, ano: number, mes: number): Promise<boolean> {
  const linhas = await consultar<{ id: string }>(
    cliente,
    'SELECT id FROM cobranca WHERE pessoa_id = $1 AND competencia_ano = $2 AND competencia_mes = $3 LIMIT 1',
    [pessoaId, ano, mes],
  );
  return linhas.length > 0;
}

async function ativaPosterior(cliente: Consultavel, pessoaId: string, ano: number, mes: number): Promise<Cobranca | null> {
  const linhas = await consultar<Cobranca>(
    cliente,
    `SELECT * FROM cobranca
     WHERE pessoa_id = $1 AND status IN ('aberta', 'paga')
       AND (competencia_ano, competencia_mes) > ($2, $3)
     ORDER BY competencia_ano, competencia_mes
     LIMIT 1`,
    [pessoaId, ano, mes],
  );
  return linhas[0] ?? null;
}

async function anteriorAtiva(cliente: Consultavel, pessoaId: string, ano: number, mes: number): Promise<Cobranca | null> {
  const linhas = await consultar<Cobranca>(
    cliente,
    `SELECT * FROM cobranca
     WHERE pessoa_id = $1 AND status IN ('aberta', 'paga')
       AND (competencia_ano, competencia_mes) < ($2, $3)
     ORDER BY competencia_ano DESC, competencia_mes DESC
     LIMIT 1`,
    [pessoaId, ano, mes],
  );
  return linhas[0] ?? null;
}

async function linhasDa(cliente: Consultavel, cobrancaId: string): Promise<LinhaRascunho[]> {
  const linhas = await consultar<{
    item_id: string;
    origem_cobranca_id: string;
    competencia_origem_ano: number;
    competencia_origem_mes: number;
    descricao: string;
    valor_centavos: number;
  }>(
    cliente,
    `SELECT item_id, origem_cobranca_id, competencia_origem_ano, competencia_origem_mes, descricao, valor_centavos
     FROM linha_cobranca
     WHERE cobranca_id = $1
     ORDER BY competencia_origem_ano, competencia_origem_mes, descricao, id`,
    [cobrancaId],
  );
  return linhas.map((linha) => ({
    itemId: linha.item_id,
    origemCobrancaId: linha.origem_cobranca_id,
    competenciaOrigemAno: linha.competencia_origem_ano,
    competenciaOrigemMes: linha.competencia_origem_mes,
    descricao: linha.descricao,
    valorCentavos: linha.valor_centavos,
  }));
}

async function consultarRemoto(app: App, cliente: Consultavel, mpId: string): Promise<{ ok: true; pagamento: PagamentoRemoto } | { ok: false; motivo: string }> {
  const token = await carregarTokenMp(cliente);
  if (!token) return { ok: false, motivo: 'Mercado Pago não configurado' };
  return app.mp.consultar(token, mpId);
}

async function marcarAlertas(cliente: Consultavel, pessoaId: string): Promise<void> {
  await cliente.query(
    `UPDATE cobranca c
     SET alerta_itens_ja_pagos = true
     WHERE c.pessoa_id = $1
       AND c.status = 'aberta'
       AND EXISTS (
         SELECT 1
         FROM linha_cobranca l
         JOIN linha_cobranca lp
           ON lp.item_id = l.item_id
          AND lp.competencia_origem_ano = l.competencia_origem_ano
          AND lp.competencia_origem_mes = l.competencia_origem_mes
         JOIN cobranca cp ON cp.id = lp.cobranca_id
         WHERE l.cobranca_id = c.id
           AND cp.pessoa_id = c.pessoa_id
           AND cp.status = 'paga'
           AND (cp.competencia_ano, cp.competencia_mes) < (c.competencia_ano, c.competencia_mes)
       )`,
    [pessoaId],
  );
}

async function eventoExiste(cliente: Consultavel, mpId: string, efeito: string): Promise<boolean> {
  const linhas = await consultar<{ id: string }>(
    cliente,
    'SELECT id FROM evento_pagamento WHERE mp_payment_id = $1 AND efeito = $2',
    [mpId, efeito],
  );
  return linhas.length > 0;
}

async function registrarEvento(
  cliente: Consultavel,
  mpId: string,
  efeito: 'baixa' | 'excedente' | 'divergencia_valor',
  cobrancaId: string,
  valor: number,
  quando: Date,
): Promise<void> {
  await cliente.query(
    `INSERT INTO evento_pagamento (id, mp_payment_id, efeito, cobranca_id, valor_centavos, recebido_em)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mp_payment_id, efeito) DO NOTHING`,
    [randomUUID(), mpId, efeito, cobrancaId, valor, quando],
  );
}

async function quitarCadeia(cliente: Consultavel, cabeca: Cobranca, quando: Date, origem: 'pagamento' | 'manual'): Promise<void> {
  await cliente.query(
    `UPDATE cobranca
     SET status = 'paga', paga_em = $2, origem_baixa = $3, quitada_por_id = NULL
     WHERE id = $1 AND status = 'aberta'`,
    [cabeca.id, quando, origem],
  );
  const vistos = new Set<string>([cabeca.id]);
  let anteriorId = cabeca.anterior_id;
  while (anteriorId && !vistos.has(anteriorId)) {
    vistos.add(anteriorId);
    const anterior = await cobrancaPorId(cliente, anteriorId);
    if (!anterior || anterior.status !== 'aberta') break;
    await cliente.query(
      `UPDATE cobranca
       SET status = 'paga', paga_em = $2, origem_baixa = 'cascata', quitada_por_id = $3
       WHERE id = $1 AND status = 'aberta'`,
      [anterior.id, quando, cabeca.id],
    );
    anteriorId = anterior.anterior_id;
  }
}

async function pixAtivosAnteriores(cliente: Consultavel, cabecaId: string): Promise<string[]> {
  const ids: string[] = [];
  const vistos = new Set<string>();
  let atual = await cobrancaPorId(cliente, cabecaId);
  while (atual?.anterior_id && !vistos.has(atual.anterior_id)) {
    vistos.add(atual.anterior_id);
    const pix = await pixAtivo(cliente, atual.anterior_id);
    if (pix) ids.push(pix.id);
    atual = await cobrancaPorId(cliente, atual.anterior_id);
  }
  return ids;
}

async function aplicarRemoto(cliente: Cliente, pix: Pix, remoto: PagamentoRemoto, agora: Date): Promise<Efeito> {
  await cliente.query(
    `UPDATE pix SET mp_status = $2, mp_status_detail = $3, verificado_em = $4 WHERE id = $1`,
    [pix.id, remoto.status, remoto.statusDetail, agora],
  );
  const vazio: Efeito = { tipo: 'inalterado', confirmacaoId: null, ancestrais: [] };
  if (remoto.status === 'approved') {
    const cobranca = await cobrancaPorId(cliente, pix.cobranca_id);
    if (!cobranca || !pix.mp_payment_id) return vazio;
    if (remoto.valorCentavos !== pix.valor_centavos) {
      await registrarEvento(cliente, pix.mp_payment_id, 'divergencia_valor', cobranca.id, remoto.valorCentavos, remoto.dateApproved ?? agora);
      return { tipo: 'divergencia', confirmacaoId: null, ancestrais: [] };
    }
    if (cobranca.status === 'paga') {
      if (await eventoExiste(cliente, pix.mp_payment_id, 'baixa')) return { tipo: 'repetido', confirmacaoId: null, ancestrais: [] };
      await registrarEvento(cliente, pix.mp_payment_id, 'excedente', cobranca.id, remoto.valorCentavos, remoto.dateApproved ?? agora);
      await cliente.query(`UPDATE pix SET status_local = 'aprovado' WHERE id = $1`, [pix.id]);
      return { tipo: 'excedente', confirmacaoId: null, ancestrais: [] };
    }
    if (cobranca.status === 'cancelada') {
      await cliente.query(`UPDATE pix SET status_local = 'aprovado' WHERE id = $1`, [pix.id]);
      await registrarEvento(cliente, pix.mp_payment_id, 'excedente', cobranca.id, remoto.valorCentavos, remoto.dateApproved ?? agora);
      return { tipo: 'excedente', confirmacaoId: null, ancestrais: [] };
    }
    const vigente = await vigenteDaPessoa(cliente, cobranca.pessoa_id);
    const quando = remoto.dateApproved ?? agora;
    await quitarCadeia(cliente, cobranca, quando, 'pagamento');
    await cliente.query(`UPDATE pix SET status_local = 'aprovado', motivo = NULL WHERE id = $1`, [pix.id]);
    await registrarEvento(cliente, pix.mp_payment_id, 'baixa', cobranca.id, pix.valor_centavos, quando);
    const quitouVigente = vigente?.id === cobranca.id;
    if (!quitouVigente) await marcarAlertas(cliente, cobranca.pessoa_id);
    return {
      tipo: 'baixa',
      confirmacaoId: cobranca.id,
      ancestrais: quitouVigente ? await pixAtivosAnteriores(cliente, cobranca.id) : [],
    };
  }
  if (remoto.status === 'cancelled' || remoto.status === 'expired') {
    const expirado = remoto.status === 'expired' || remoto.statusDetail === 'expired';
    await cliente.query(
      `UPDATE pix SET status_local = $2
       WHERE id = $1 AND status_local IN ('pendente', 'falha_cancelamento', 'emitindo')`,
      [pix.id, expirado ? 'expirado' : 'cancelado'],
    );
    return { tipo: 'encerrado', confirmacaoId: null, ancestrais: [] };
  }
  return vazio;
}

async function concluirEfeito(app: App, cliente: Cliente, efeito: Efeito, agora: Date, emCurso: Set<string>): Promise<void> {
  if (efeito.confirmacaoId) await enviarMensagem(app, cliente, efeito.confirmacaoId, 'confirmacao', agora);
  if (efeito.ancestrais.length > 0) await invalidarVarios(app, cliente, efeito.ancestrais, agora, emCurso);
}

async function sincronizarNaTrava(app: App, cliente: Cliente, mpId: string, agora: Date, emCurso = new Set<string>()): Promise<void> {
  const pixes = await consultar<Pix>(cliente, 'SELECT * FROM pix WHERE mp_payment_id = $1', [mpId]);
  const pix = pixes[0];
  if (!pix) return;
  const remoto = await consultarRemoto(app, cliente, mpId);
  if (!remoto.ok) throw new Error(remoto.motivo);
  const efeito = await transacao(cliente, () => aplicarRemoto(cliente, pix, remoto.pagamento, agora));
  await concluirEfeito(app, cliente, efeito, agora, emCurso);
}

export async function sincronizarPagamento(app: App, mpId: string, agora = app.clock()): Promise<void> {
  const locais = await consultar<{ pessoa_id: string }>(
    app.pool,
    `SELECT c.pessoa_id FROM pix px JOIN cobranca c ON c.id = px.cobranca_id WHERE px.mp_payment_id = $1`,
    [mpId],
  );
  const pessoaId = locais[0]?.pessoa_id;
  if (!pessoaId) return;
  await comTravaPessoa(app.pool, pessoaId, (cliente) => sincronizarNaTrava(app, cliente, mpId, agora));
}

async function invalidarUmPix(app: App, cliente: Cliente, pixId: string, agora: Date, emCurso: Set<string>): Promise<'cancelado' | 'ja_encerrado' | 'pago' | 'falha'> {
  if (emCurso.has(pixId)) return 'falha';
  emCurso.add(pixId);
  const pix = await pixPorId(cliente, pixId);
  if (!pix) return 'falha';
  if (pix.status_local === 'aprovado') return 'pago';
  if (pix.status_local === 'cancelado' || pix.status_local === 'expirado') {
    await transacao(cliente, async () => {
      await cliente.query(`UPDATE pix SET motivo = COALESCE(motivo, 'já encerrado') WHERE id = $1`, [pix.id]);
    });
    return 'ja_encerrado';
  }
  if ((pix.status_local !== 'pendente' && pix.status_local !== 'falha_cancelamento') || !pix.mp_payment_id) {
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE pix SET status_local = 'falha_cancelamento', motivo = $2, verificado_em = $3 WHERE id = $1`,
        [pix.id, 'PIX sem identificador no Mercado Pago.', agora],
      );
    });
    return 'falha';
  }
  const remoto = await consultarRemoto(app, cliente, pix.mp_payment_id);
  if (!remoto.ok) {
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE pix SET status_local = 'falha_cancelamento', motivo = $2, verificado_em = $3 WHERE id = $1`,
        [pix.id, remoto.motivo, agora],
      );
    });
    return 'falha';
  }
  if (remoto.pagamento.status === 'approved') {
    const efeito = await transacao(cliente, () => aplicarRemoto(cliente, pix, remoto.pagamento, agora));
    await concluirEfeito(app, cliente, efeito, agora, emCurso);
    return 'pago';
  }
  if (remoto.pagamento.status === 'cancelled' || remoto.pagamento.status === 'expired') {
    const expirado = remoto.pagamento.status === 'expired' || remoto.pagamento.statusDetail === 'expired';
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE pix SET status_local = $2, motivo = 'já encerrado', mp_status = $3, mp_status_detail = $4, verificado_em = $5 WHERE id = $1`,
        [pix.id, expirado ? 'expirado' : 'cancelado', remoto.pagamento.status, remoto.pagamento.statusDetail, agora],
      );
    });
    return 'ja_encerrado';
  }
  if (!mpPermiteCancelar(remoto.pagamento.status)) {
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE pix SET status_local = 'falha_cancelamento', mp_status = $2, mp_status_detail = $3, motivo = $4, verificado_em = $5 WHERE id = $1`,
        [pix.id, remoto.pagamento.status, remoto.pagamento.statusDetail, `Status ${remoto.pagamento.status} não pode ser cancelado.`, agora],
      );
    });
    return 'falha';
  }
  const token = await carregarTokenMp(cliente);
  if (!token) return 'falha';
  const cancelamento = await app.mp.cancelar(token, pix.mp_payment_id);
  if (cancelamento.ok) {
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE pix SET status_local = 'cancelado', mp_status = $2, mp_status_detail = $3, motivo = NULL, verificado_em = $4 WHERE id = $1`,
        [pix.id, cancelamento.status, cancelamento.statusDetail, agora],
      );
    });
    return 'cancelado';
  }
  if (cancelamento.errorCode === 2018) {
    const deNovo = await consultarRemoto(app, cliente, pix.mp_payment_id);
    if (deNovo.ok && deNovo.pagamento.status === 'approved') {
      const efeito = await transacao(cliente, () => aplicarRemoto(cliente, pix, deNovo.pagamento, agora));
      await concluirEfeito(app, cliente, efeito, agora, emCurso);
      return 'pago';
    }
    if (deNovo.ok && (deNovo.pagamento.status === 'cancelled' || deNovo.pagamento.status === 'expired')) {
      const expirado = deNovo.pagamento.status === 'expired' || deNovo.pagamento.statusDetail === 'expired';
      await transacao(cliente, async () => {
        await cliente.query(
          `UPDATE pix SET status_local = $2, motivo = 'já encerrado', mp_status = $3, mp_status_detail = $4, verificado_em = $5 WHERE id = $1`,
          [pix.id, expirado ? 'expirado' : 'cancelado', deNovo.pagamento.status, deNovo.pagamento.statusDetail, agora],
        );
      });
      return 'ja_encerrado';
    }
  }
  await transacao(cliente, async () => {
    await cliente.query(
      `UPDATE pix SET status_local = 'falha_cancelamento', motivo = $2, verificado_em = $3 WHERE id = $1`,
      [pix.id, cancelamento.motivo, agora],
    );
  });
  return 'falha';
}

async function invalidarVarios(app: App, cliente: Cliente, ids: string[], agora: Date, emCurso: Set<string>): Promise<void> {
  for (const id of ids) {
    try {
      await invalidarUmPix(app, cliente, id, agora, emCurso);
    } catch (erro) {
      console.error(`Falha ao invalidar PIX ${id}: ${mensagemErro(erro)}`);
    }
  }
}

async function falharEmissao(cliente: Cliente, pixId: string, motivo: string, agora: Date): Promise<void> {
  await transacao(cliente, async () => {
    await cliente.query(
      `UPDATE pix SET status_local = 'falha_emissao', motivo = $2, verificado_em = $3 WHERE id = $1`,
      [pixId, motivo, agora],
    );
  });
}

async function concluirEmissao(
  app: App,
  cliente: Cliente,
  entrada: {
    pixId: string;
    chave: string;
    pessoa: PessoaCobranca;
    cobrancaId: string;
    ano: number;
    mes: number;
    total: number;
    vence: Date;
    agora: Date;
  },
): Promise<boolean> {
  const token = await carregarTokenMp(cliente);
  if (!token) {
    await falharEmissao(cliente, entrada.pixId, 'Mercado Pago não configurado', entrada.agora);
    return false;
  }
  if (!app.env.publicUrl) {
    await falharEmissao(cliente, entrada.pixId, 'URL pública não configurada', entrada.agora);
    return false;
  }
  let criado;
  try {
    criado = await app.mp.criar(token, {
      idempotencyKey: entrada.chave,
      transactionAmount: centavosParaReais(entrada.total),
      description: `${formatarCompetencia(entrada.ano, entrada.mes)} ${entrada.pessoa.nome}`.slice(0, 200),
      payerEmail: entrada.pessoa.email,
      payerFirstName: primeiroNome(entrada.pessoa.nome),
      payerCpf: entrada.pessoa.cpf,
      dateOfExpiration: formatarExpiracaoMp(entrada.vence),
      notificationUrl: urlNotificacao(app.env.publicUrl),
      externalReference: entrada.cobrancaId,
    });
  } catch (erro) {
    await falharEmissao(cliente, entrada.pixId, redigir(mensagemErro(erro), [token]), entrada.agora);
    return false;
  }
  if (!criado.ok) {
    await falharEmissao(cliente, entrada.pixId, criado.motivo, entrada.agora);
    return false;
  }
  const aceito = criado.status === 'pending' || criado.status === 'in_process' || criado.status === 'authorized' || criado.status === 'approved';
  if (!aceito) {
    await falharEmissao(cliente, entrada.pixId, `Mercado Pago devolveu status ${criado.status}.`, entrada.agora);
    return false;
  }
  await transacao(cliente, async () => {
    await cliente.query(
      `UPDATE pix
       SET mp_payment_id = $2, status_local = 'pendente', mp_status = $3, mp_status_detail = $4,
           copia_e_cola = $5, ticket_url = $6, verificado_em = $7, motivo = NULL
       WHERE id = $1`,
      [entrada.pixId, criado.id, criado.status, criado.statusDetail, criado.qrCode, criado.ticketUrl, entrada.agora],
    );
  });
  if (criado.status === 'approved') await sincronizarNaTrava(app, cliente, criado.id, entrada.agora);
  return true;
}

export async function gerarCobranca(
  app: App,
  pessoaId: string,
  ano: number,
  mes: number,
  origem: OrigemGeracao,
  agora = app.clock(),
): Promise<ResultadoGeracao> {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || ano < 2000 || ano > 2100 || mes < 1 || mes > 12) {
    return { ok: false, aviso: 'Mês ou ano inválido.' };
  }
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const pessoa = await pessoaPorId(cliente, pessoaId);
    if (!pessoa) return { ok: false, aviso: 'Pessoa não encontrada.' };
    const mesma = await ativaNaCompetencia(cliente, pessoaId, ano, mes);
    if (mesma) return { ok: false, aviso: `já existe cobrança em ${formatarCompetencia(ano, mes)}` };
    if (origem === 'job' && (await existeNoMes(cliente, pessoaId, ano, mes))) {
      return { ok: false, aviso: 'Já existe cobrança cancelada neste mês.' };
    }
    const posterior = await ativaPosterior(cliente, pessoaId, ano, mes);
    if (posterior) {
      return { ok: false, aviso: `já existe cobrança posterior em ${formatarCompetencia(posterior.competencia_ano, posterior.competencia_mes)}` };
    }
    let anterior = await anteriorAtiva(cliente, pessoaId, ano, mes);
    if (anterior) {
      const pixAnterior = await pixAtivo(cliente, anterior.id);
      if (pixAnterior?.mp_payment_id) {
        const remoto = await consultarRemoto(app, cliente, pixAnterior.mp_payment_id);
        if (!remoto.ok) return { ok: false, aviso: `Não foi possível consultar o PIX anterior: ${remoto.motivo}` };
        if (remoto.pagamento.status === 'approved') {
          const efeito = await transacao(cliente, () => aplicarRemoto(cliente, pixAnterior, remoto.pagamento, agora));
          await concluirEfeito(app, cliente, efeito, agora, new Set());
          anterior = await cobrancaPorId(cliente, anterior.id);
        } else if (remoto.pagamento.status === 'cancelled' || remoto.pagamento.status === 'expired') {
          const expirado = remoto.pagamento.status === 'expired' || remoto.pagamento.statusDetail === 'expired';
          await transacao(cliente, async () => {
            await cliente.query(
              `UPDATE pix SET status_local = $2, motivo = COALESCE(motivo, 'já encerrado'), mp_status = $3, mp_status_detail = $4, verificado_em = $5
               WHERE id = $1 AND status_local IN ('pendente', 'falha_cancelamento')`,
              [pixAnterior.id, expirado ? 'expirado' : 'cancelado', remoto.pagamento.status, remoto.pagamento.statusDetail, agora],
            );
          });
        }
      }
    }
    const itens = await consultar<{
      id: string;
      descricao: string;
      valor_centavos: number;
      inicio_ano: number;
      inicio_mes: number;
      fim_ano: number;
      fim_mes: number;
    }>(cliente, 'SELECT * FROM item WHERE pessoa_id = $1 ORDER BY criado_em, id', [pessoaId]);
    const cobrancaId = randomUUID();
    const rascunhos = comporLinhas({
      novaCobrancaId: cobrancaId,
      ano,
      mes,
      linhasAnterioresAbertas: anterior?.status === 'aberta' ? await linhasDa(cliente, anterior.id) : null,
      itens: itens.map((item) => ({
        id: item.id,
        descricao: item.descricao,
        valorCentavos: item.valor_centavos,
        inicioAno: item.inicio_ano,
        inicioMes: item.inicio_mes,
        fimAno: item.fim_ano,
        fimMes: item.fim_mes,
      })),
    });
    const total = rascunhos.reduce((soma, linha) => soma + linha.valorCentavos, 0);
    if (rascunhos.length === 0 || total <= 0) return { ok: false, aviso: 'nenhum item para este mês' };
    const pixId = randomUUID();
    const chave = randomUUID();
    const vence = somarDias(agora, pessoa.validade_pix_dias);
    try {
      await transacao(cliente, async () => {
        await cliente.query(
          `INSERT INTO cobranca (
            id, pessoa_id, competencia_ano, competencia_mes, anterior_id, origem_geracao, status,
            canal_email_selecionado, canal_whatsapp_selecionado
          ) VALUES ($1,$2,$3,$4,$5,$6,'aberta',$7,$8)`,
          [cobrancaId, pessoaId, ano, mes, anterior?.id ?? null, origem, pessoa.canal_email, pessoa.canal_whatsapp],
        );
        for (const linha of rascunhos) {
          await cliente.query(
            `INSERT INTO linha_cobranca (
              id, cobranca_id, item_id, origem_cobranca_id, competencia_origem_ano, competencia_origem_mes, descricao, valor_centavos
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [randomUUID(), cobrancaId, linha.itemId, linha.origemCobrancaId, linha.competenciaOrigemAno, linha.competenciaOrigemMes, linha.descricao, linha.valorCentavos],
          );
        }
        await cliente.query(
          `INSERT INTO pix (id, cobranca_id, idempotency_key, valor_centavos, validade_dias, vence_em, status_local)
           VALUES ($1,$2,$3,$4,$5,$6,'emitindo')`,
          [pixId, cobrancaId, chave, total, pessoa.validade_pix_dias, vence],
        );
        await marcarAlertas(cliente, pessoaId);
      });
    } catch (erro) {
      if (codigoPg(erro) === '23505') return { ok: false, aviso: `já existe cobrança em ${formatarCompetencia(ano, mes)}` };
      throw erro;
    }
    const pixOk = await concluirEmissao(app, cliente, { pixId, chave, pessoa, cobrancaId, ano, mes, total, vence, agora });
    if (pixOk) await enviarMensagem(app, cliente, cobrancaId, 'cobranca', agora);
    if (anterior) {
      const aindaAtivo = await pixAtivo(cliente, anterior.id);
      if (aindaAtivo) await invalidarUmPix(app, cliente, aindaAtivo.id, agora, new Set());
      else {
        const ultimo = await ultimoPix(cliente, anterior.id);
        if (ultimo && (ultimo.status_local === 'cancelado' || ultimo.status_local === 'expirado') && !ultimo.motivo) {
          await transacao(cliente, async () => {
            await cliente.query(`UPDATE pix SET motivo = 'já encerrado' WHERE id = $1 AND motivo IS NULL`, [ultimo.id]);
          });
        }
      }
    }
    return { ok: true, cobrancaId, pixOk };
  });
}

export async function gerarDoDia(app: App, agora: Date): Promise<void> {
  const hoje = partesNoFuso(agora);
  const pessoas = await consultar<{ id: string; dia_cobranca: number }>(
    app.pool,
    'SELECT id, dia_cobranca FROM pessoa WHERE ativa = true ORDER BY nome, id',
  );
  for (const pessoa of pessoas) {
    if (diaEfetivo(pessoa.dia_cobranca, hoje.year, hoje.month) !== hoje.day) continue;
    try {
      await gerarCobranca(app, pessoa.id, hoje.year, hoje.month, 'job', agora);
    } catch (erro) {
      console.error(`Falha ao gerar cobrança da pessoa ${pessoa.id}: ${mensagemErro(erro)}`);
    }
  }
}

export async function gerarLote(app: App, ano: number, mes: number, agora = app.clock()): Promise<ResultadoLote> {
  const hoje = partesNoFuso(agora);
  if (ano * 12 + mes > hoje.year * 12 + hoje.month) {
    return { recusado: 'Mês futuro não é gerado em lote.', geradas: 0, pixFalhos: 0, puladas: [], falhas: [] };
  }
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || ano < 2000 || ano > 2100 || mes < 1 || mes > 12) {
    return { recusado: 'Mês ou ano inválido.', geradas: 0, pixFalhos: 0, puladas: [], falhas: [] };
  }
  const pessoas = await consultar<{ id: string; nome: string; dia_cobranca: number }>(
    app.pool,
    'SELECT id, nome, dia_cobranca FROM pessoa WHERE ativa = true ORDER BY nome, id',
  );
  const resultado: ResultadoLote = { recusado: null, geradas: 0, pixFalhos: 0, puladas: [], falhas: [] };
  const mesAtual = ano === hoje.year && mes === hoje.month;
  for (const pessoa of pessoas) {
    if (mesAtual && diaEfetivo(pessoa.dia_cobranca, ano, mes) > hoje.day) {
      resultado.puladas.push({ nome: pessoa.nome, motivo: 'dia ainda não chegou' });
      continue;
    }
    try {
      const gerada = await gerarCobranca(app, pessoa.id, ano, mes, 'lote', agora);
      if (!gerada.ok) {
        if (gerada.aviso.startsWith('já existe cobrança em ')) resultado.puladas.push({ nome: pessoa.nome, motivo: 'já tem cobrança' });
        else if (gerada.aviso.startsWith('já existe cobrança posterior')) resultado.puladas.push({ nome: pessoa.nome, motivo: 'cobrança posterior' });
        else if (gerada.aviso === 'nenhum item para este mês') resultado.puladas.push({ nome: pessoa.nome, motivo: 'sem itens' });
        else resultado.falhas.push({ nome: pessoa.nome, motivo: gerada.aviso });
        continue;
      }
      resultado.geradas += 1;
      if (!gerada.pixOk) {
        resultado.pixFalhos += 1;
        resultado.falhas.push({ nome: pessoa.nome, motivo: 'Cobrança registrada, mas a emissão do PIX falhou.' });
      }
    } catch (erro) {
      resultado.falhas.push({ nome: pessoa.nome, motivo: mensagemErro(erro) });
    }
  }
  return resultado;
}

export async function baixaManual(
  app: App,
  cobrancaId: string,
  escolha: 'invalidar' | 'manter' | null,
  agora = app.clock(),
): Promise<{ ok: true; aviso?: string } | { ok: false; aviso: string }> {
  const dona = await consultar<{ pessoa_id: string }>(app.pool, 'SELECT pessoa_id FROM cobranca WHERE id = $1', [cobrancaId]);
  const pessoaId = dona[0]?.pessoa_id;
  if (!pessoaId) return { ok: false, aviso: 'A baixa manual só pode ser feita na cobrança vigente.' };
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const cobranca = await cobrancaPorId(cliente, cobrancaId);
    const vigente = cobranca ? await vigenteDaPessoa(cliente, cobranca.pessoa_id) : null;
    if (!cobranca || cobranca.status !== 'aberta' || vigente?.id !== cobranca.id) {
      return { ok: false, aviso: 'A baixa manual só pode ser feita na cobrança vigente.' };
    }
    const pix = await pixAtivo(cliente, cobranca.id);
    if (pix && escolha !== 'invalidar' && escolha !== 'manter') {
      return { ok: false, aviso: 'Escolha se o PIX ativo será invalidado ou mantido.' };
    }
    if (pix?.mp_payment_id) {
      const remoto = await consultarRemoto(app, cliente, pix.mp_payment_id);
      if (!remoto.ok) return { ok: false, aviso: 'Não foi possível consultar o PIX. Tente de novo.' };
      if (remoto.pagamento.status === 'approved') {
        const efeito = await transacao(cliente, () => aplicarRemoto(cliente, pix, remoto.pagamento, agora));
        await concluirEfeito(app, cliente, efeito, agora, new Set());
        return { ok: true, aviso: 'O PIX já estava pago. A baixa foi registrada pelo pagamento.' };
      }
    }
    const ancestrais = await transacao(cliente, async () => {
      await quitarCadeia(cliente, cobranca, agora, 'manual');
      return pixAtivosAnteriores(cliente, cobranca.id);
    });
    await enviarMensagem(app, cliente, cobranca.id, 'confirmacao', agora);
    const emCurso = new Set<string>();
    if (pix && escolha === 'invalidar') await invalidarUmPix(app, cliente, pix.id, agora, emCurso);
    await invalidarVarios(app, cliente, ancestrais, agora, emCurso);
    return { ok: true };
  });
}

export async function cancelarCobranca(
  app: App,
  cobrancaId: string,
  motivo: string,
  agora = app.clock(),
): Promise<{ ok: true; aviso?: string } | { ok: false; aviso: string }> {
  const texto = motivo.trim();
  if (!texto) return { ok: false, aviso: 'Informe o motivo do cancelamento.' };
  if (texto.length > 500) return { ok: false, aviso: 'O motivo pode ter no máximo 500 caracteres.' };
  const dona = await consultar<{ pessoa_id: string }>(app.pool, 'SELECT pessoa_id FROM cobranca WHERE id = $1', [cobrancaId]);
  const pessoaId = dona[0]?.pessoa_id;
  if (!pessoaId) return { ok: false, aviso: 'Cobrança não encontrada.' };
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const cobranca = await cobrancaPorId(cliente, cobrancaId);
    if (!cobranca) return { ok: false, aviso: 'Cobrança não encontrada.' };
    if (cobranca.status === 'paga') return { ok: false, aviso: 'Cobrança paga não pode ser cancelada.' };
    if (cobranca.status === 'cancelada') return { ok: false, aviso: 'A cobrança já está cancelada.' };
    const posterior = await ativaPosterior(cliente, cobranca.pessoa_id, cobranca.competencia_ano, cobranca.competencia_mes);
    if (posterior) {
      return { ok: false, aviso: `Não é possível cancelar: existe cobrança posterior em ${formatarCompetencia(posterior.competencia_ano, posterior.competencia_mes)}.` };
    }
    const pix = await pixAtivo(cliente, cobranca.id);
    if (pix) {
      const resultado = await invalidarUmPix(app, cliente, pix.id, agora, new Set());
      if (resultado === 'pago') return { ok: true, aviso: 'O PIX estava pago. A cobrança foi quitada e não foi cancelada.' };
    }
    const atual = await cobrancaPorId(cliente, cobranca.id);
    if (!atual || atual.status !== 'aberta') return { ok: true, aviso: 'A cobrança foi quitada pelo pagamento.' };
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE cobranca
         SET status = 'cancelada', cancelada_em = $2, motivo_cancelamento = $3
         WHERE id = $1 AND status = 'aberta'`,
        [cobranca.id, agora, texto],
      );
    });
    return { ok: true };
  });
}

async function estadoParaAcoes(cliente: Consultavel, cobranca: Cobranca) {
  const vigente = await vigenteDaPessoa(cliente, cobranca.pessoa_id);
  const posterior = await ativaPosterior(cliente, cobranca.pessoa_id, cobranca.competencia_ano, cobranca.competencia_mes);
  const ativo = await pixAtivo(cliente, cobranca.id);
  const ultimo = await ultimoPix(cliente, cobranca.id);
  return acoesDisponiveis({
    status: cobranca.status,
    vigente: vigente?.id === cobranca.id,
    temAtivaPosterior: Boolean(posterior),
    temPixAtivo: Boolean(ativo),
    ultimoPix: ultimo?.status_local ?? null,
  });
}

export async function gerarNovoPix(app: App, cobrancaId: string, agora = app.clock()): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const dona = await consultar<{ pessoa_id: string }>(app.pool, 'SELECT pessoa_id FROM cobranca WHERE id = $1', [cobrancaId]);
  const pessoaId = dona[0]?.pessoa_id;
  if (!pessoaId) return { ok: false, aviso: 'Cobrança não encontrada.' };
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const cobranca = await cobrancaPorId(cliente, cobrancaId);
    if (!cobranca) return { ok: false, aviso: 'Cobrança não encontrada.' };
    const acoes = await estadoParaAcoes(cliente, cobranca);
    if (!acoes.novoPix) return { ok: false, aviso: 'Não é possível gerar um novo PIX nesta cobrança.' };
    const pessoa = await pessoaPorId(cliente, cobranca.pessoa_id);
    if (!pessoa) return { ok: false, aviso: 'Pessoa não encontrada.' };
    const linhas = await linhasDa(cliente, cobranca.id);
    const total = linhas.reduce((soma, linha) => soma + linha.valorCentavos, 0);
    if (total <= 0) return { ok: false, aviso: 'A cobrança não tem valor para um PIX.' };
    const pixId = randomUUID();
    const chave = randomUUID();
    const vence = somarDias(agora, pessoa.validade_pix_dias);
    await transacao(cliente, async () => {
      await cliente.query(
        `INSERT INTO pix (id, cobranca_id, idempotency_key, valor_centavos, validade_dias, vence_em, status_local)
         VALUES ($1,$2,$3,$4,$5,$6,'emitindo')`,
        [pixId, cobranca.id, chave, total, pessoa.validade_pix_dias, vence],
      );
    });
    await concluirEmissao(app, cliente, {
      pixId,
      chave,
      pessoa,
      cobrancaId: cobranca.id,
      ano: cobranca.competencia_ano,
      mes: cobranca.competencia_mes,
      total,
      vence,
      agora,
    });
    return { ok: true };
  });
}

export async function tentarEmissao(app: App, cobrancaId: string, agora = app.clock()): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const dona = await consultar<{ pessoa_id: string }>(app.pool, 'SELECT pessoa_id FROM cobranca WHERE id = $1', [cobrancaId]);
  const pessoaId = dona[0]?.pessoa_id;
  if (!pessoaId) return { ok: false, aviso: 'Cobrança não encontrada.' };
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const cobranca = await cobrancaPorId(cliente, cobrancaId);
    if (!cobranca) return { ok: false, aviso: 'Cobrança não encontrada.' };
    const acoes = await estadoParaAcoes(cliente, cobranca);
    if (!acoes.tentarEmissao) return { ok: false, aviso: 'Não há emissão para tentar de novo.' };
    const pix = await ultimoPix(cliente, cobranca.id);
    const pessoa = await pessoaPorId(cliente, cobranca.pessoa_id);
    if (!pix || !pessoa) return { ok: false, aviso: 'Não há emissão para tentar de novo.' };
    await transacao(cliente, async () => {
      await cliente.query(
        `UPDATE pix SET status_local = 'emitindo', motivo = NULL WHERE id = $1 AND status_local IN ('falha_emissao', 'emitindo')`,
        [pix.id],
      );
    });
    const ok = await concluirEmissao(app, cliente, {
      pixId: pix.id,
      chave: pix.idempotency_key,
      pessoa,
      cobrancaId: cobranca.id,
      ano: cobranca.competencia_ano,
      mes: cobranca.competencia_mes,
      total: pix.valor_centavos,
      vence: pix.vence_em,
      agora,
    });
    if (ok) await enviarMensagem(app, cliente, cobranca.id, 'cobranca', agora);
    return ok ? { ok: true } : { ok: false, aviso: 'A emissão do PIX falhou de novo. O motivo está na cobrança.' };
  });
}

export async function invalidarPix(app: App, cobrancaId: string, agora = app.clock()): Promise<{ ok: true; aviso?: string } | { ok: false; aviso: string }> {
  const dona = await consultar<{ pessoa_id: string }>(app.pool, 'SELECT pessoa_id FROM cobranca WHERE id = $1', [cobrancaId]);
  const pessoaId = dona[0]?.pessoa_id;
  if (!pessoaId) return { ok: false, aviso: 'Cobrança não encontrada.' };
  return comTravaPessoa(app.pool, pessoaId, async (cliente) => {
    const pix = await pixAtivo(cliente, cobrancaId);
    if (!pix) return { ok: false, aviso: 'Não há PIX ativo para invalidar.' };
    const resultado = await invalidarUmPix(app, cliente, pix.id, agora, new Set());
    if (resultado === 'pago') return { ok: true, aviso: 'O PIX estava pago. A cobrança foi atualizada.' };
    if (resultado === 'cancelado' || resultado === 'ja_encerrado') return { ok: true };
    return { ok: false, aviso: 'Não foi possível invalidar o PIX.' };
  });
}

export async function verificarPixAtivos(app: App, agora = app.clock()): Promise<void> {
  const pixes = await consultar<{ id: string; mp_payment_id: string }>(
    app.pool,
    `SELECT id, mp_payment_id FROM pix
     WHERE status_local IN ('pendente', 'falha_cancelamento') AND mp_payment_id IS NOT NULL`,
  );
  for (const pix of pixes) {
    try {
      await sincronizarPagamento(app, pix.mp_payment_id, agora);
    } catch (erro) {
      console.error(`Falha ao verificar PIX ${pix.id}: ${mensagemErro(erro)}`);
    }
  }
}

export async function enviarInadimplenciasDevidas(app: App, agora = app.clock()): Promise<void> {
  const abertas = await consultar<{ id: string; pessoa_id: string }>(
    app.pool,
    `SELECT id, pessoa_id FROM cobranca WHERE status = 'aberta'`,
  );
  for (const cobranca of abertas) {
    try {
      await comTravaPessoa(app.pool, cobranca.pessoa_id, async (cliente) => {
        const vigente = await vigenteDaPessoa(cliente, cobranca.pessoa_id);
        if (vigente?.id !== cobranca.id) return;
        const pessoa = await pessoaPorId(cliente, cobranca.pessoa_id);
        const pix = await ultimoPix(cliente, cobranca.id);
        if (!pessoa || !pix || pix.aviso_inadimplencia_em) return;
        if (pix.status_local !== 'pendente' && pix.status_local !== 'expirado' && pix.status_local !== 'falha_cancelamento') return;
        const limite = somarDias(pix.vence_em, pessoa.dias_aviso_inadimplencia);
        if (agora.getTime() < limite.getTime()) return;
        await enviarMensagem(app, cliente, cobranca.id, 'inadimplencia', agora);
        await transacao(cliente, async () => {
          await cliente.query('UPDATE pix SET aviso_inadimplencia_em = $2 WHERE id = $1 AND aviso_inadimplencia_em IS NULL', [pix.id, agora]);
        });
      });
    } catch (erro) {
      console.error(`Falha no aviso de inadimplência ${cobranca.id}: ${mensagemErro(erro)}`);
    }
  }
}

export async function aplicarDiasPendentes(app: App, agora = app.clock()): Promise<void> {
  const hoje = partesNoFuso(agora);
  const pessoas = await consultar<{ id: string }>(
    app.pool,
    'SELECT id FROM pessoa WHERE dia_cobranca_pendente IS NOT NULL',
  );
  for (const pessoa of pessoas) {
    try {
      await comTravaPessoa(app.pool, pessoa.id, async (cliente) => {
        await cliente.query(
          `UPDATE pessoa
           SET dia_cobranca = dia_cobranca_pendente,
               dia_cobranca_pendente = NULL,
               dia_pendente_ano = NULL,
               dia_pendente_mes = NULL,
               atualizado_em = $2
           WHERE id = $1
             AND dia_cobranca_pendente IS NOT NULL
             AND (dia_pendente_ano < $3 OR (dia_pendente_ano = $3 AND dia_pendente_mes <= $4))`,
          [pessoa.id, agora, hoje.year, hoje.month],
        );
      });
    } catch (erro) {
      console.error(`Falha ao aplicar dia pendente ${pessoa.id}: ${mensagemErro(erro)}`);
    }
  }
}
