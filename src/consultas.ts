import type { App } from './app.ts';
import { vigenteDaPessoa } from './cobrancas.ts';
import { consultar } from './db.ts';
import { acoesDisponiveis, type StatusCobranca, type StatusPix } from './domain/acoes.ts';
import { diaEfetivo, diasInteirosDesde, formatarCompetencia, partesNoFuso } from './domain/calendar.ts';
import type { Pessoa } from './pessoas.ts';

export type Indicador = { resultado: 'enviado' | 'falha'; tentadoEm: Date; motivo: string | null } | null;

export type CartaoPessoa = {
  pessoa: Pessoa;
  diaEfetivo: number;
  competencia: string | null;
  valorCentavos: number;
  cobrancaId: string | null;
  pixTexto: string;
  copiaPix: string | null;
  podeEmail: boolean;
  podeWhatsapp: boolean;
  email: Indicador;
  whatsapp: Indicador;
  alertaItensPagos: boolean;
  linhasAfetadas: string[];
  excedente: boolean;
  divergencia: boolean;
};

export async function montarPainel(app: App, agora = app.clock()): Promise<CartaoPessoa[]> {
  const hoje = partesNoFuso(agora);
  const pessoas = await consultar<Pessoa>(app.pool, 'SELECT * FROM pessoa ORDER BY nome, id');
  const cartoes: CartaoPessoa[] = [];
  for (const pessoa of pessoas) {
    const vigente = await vigenteDaPessoa(app.pool, pessoa.id);
    const linhas = vigente
      ? await consultar<{ descricao: string; competencia_origem_ano: number; competencia_origem_mes: number; valor_centavos: number; item_id: string }>(
          app.pool,
          `SELECT descricao, competencia_origem_ano, competencia_origem_mes, valor_centavos, item_id
           FROM linha_cobranca WHERE cobranca_id = $1
           ORDER BY competencia_origem_ano, competencia_origem_mes, descricao`,
          [vigente.id],
        )
      : [];
    const afetadas = vigente ? await linhasAfetadas(app, vigente.id) : [];
    const pix = vigente
      ? await consultar<{ status_local: StatusPix; vence_em: Date; copia_e_cola: string | null }>(
          app.pool,
          `SELECT status_local, vence_em, copia_e_cola FROM pix
           WHERE cobranca_id = $1 AND status_local IN ('pendente', 'falha_cancelamento')
           ORDER BY criado_em DESC LIMIT 1`,
          [vigente.id],
        )
      : [];
    const envios = vigente
      ? await consultar<{ canal: 'email' | 'whatsapp'; resultado: 'enviado' | 'falha'; tentado_em: Date; motivo: string | null }>(
          app.pool,
          `SELECT DISTINCT ON (canal) canal, resultado, tentado_em, motivo
           FROM envio WHERE cobranca_id = $1 AND tipo = 'cobranca'
           ORDER BY canal, tentado_em DESC`,
          [vigente.id],
        )
      : [];
    const eventos = await consultar<{ efeito: string }>(
      app.pool,
      `SELECT efeito FROM evento_pagamento e
       JOIN cobranca c ON c.id = e.cobranca_id
       WHERE c.pessoa_id = $1 AND e.efeito IN ('excedente', 'divergencia_valor')`,
      [pessoa.id],
    );
    const ativo = pix[0];
    let pixTexto = 'sem PIX';
    if (ativo) {
      pixTexto = ativo.vence_em.getTime() >= agora.getTime()
        ? `ativo até ${formatarQuando(ativo.vence_em)}`
        : textoVencido(ativo.vence_em, agora);
    }
    const indicador = (canal: 'email' | 'whatsapp'): Indicador => {
      const envio = envios.find((item) => item.canal === canal);
      if (!envio) return null;
      return { resultado: envio.resultado, tentadoEm: envio.tentado_em, motivo: envio.motivo };
    };
    cartoes.push({
      pessoa,
      diaEfetivo: diaEfetivo(pessoa.dia_cobranca, hoje.year, hoje.month),
      competencia: vigente ? formatarCompetencia(vigente.competencia_ano, vigente.competencia_mes) : null,
      valorCentavos: linhas.reduce((soma, linha) => soma + linha.valor_centavos, 0),
      cobrancaId: vigente?.id ?? null,
      pixTexto,
      copiaPix: ativo?.copia_e_cola ?? null,
      podeEmail: Boolean(ativo?.copia_e_cola && vigente?.status === 'aberta' && vigente.canal_email_selecionado),
      podeWhatsapp: Boolean(ativo?.copia_e_cola && vigente?.status === 'aberta' && vigente.canal_whatsapp_selecionado),
      email: indicador('email'),
      whatsapp: indicador('whatsapp'),
      alertaItensPagos: Boolean(vigente?.alerta_itens_ja_pagos) || afetadas.length > 0,
      linhasAfetadas: afetadas.map((linha) => `${linha.descricao} (${formatarCompetencia(linha.ano, linha.mes)})`),
      excedente: eventos.some((evento) => evento.efeito === 'excedente'),
      divergencia: eventos.some((evento) => evento.efeito === 'divergencia_valor'),
    });
  }
  return cartoes;
}

function formatarQuando(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(data);
}

function textoVencido(vence: Date, agora: Date): string {
  const dias = diasInteirosDesde(vence, agora);
  if (dias <= 0) return 'vencido há menos de 1 dia';
  if (dias === 1) return 'vencido há 1 dia';
  return `vencido há ${dias} dias`;
}

export type LinhaAfetada = { descricao: string; ano: number; mes: number; valorCentavos: number };

export async function linhasAfetadas(app: App, cobrancaId: string): Promise<LinhaAfetada[]> {
  const linhas = await consultar<{ descricao: string; competencia_origem_ano: number; competencia_origem_mes: number; valor_centavos: number }>(
    app.pool,
    `SELECT l.descricao, l.competencia_origem_ano, l.competencia_origem_mes, l.valor_centavos
     FROM linha_cobranca l
     JOIN cobranca c ON c.id = l.cobranca_id
     WHERE l.cobranca_id = $1
       AND EXISTS (
         SELECT 1 FROM linha_cobranca lp
         JOIN cobranca cp ON cp.id = lp.cobranca_id
         WHERE cp.pessoa_id = c.pessoa_id
           AND cp.status = 'paga'
           AND (cp.competencia_ano, cp.competencia_mes) < (c.competencia_ano, c.competencia_mes)
           AND lp.item_id = l.item_id
           AND lp.competencia_origem_ano = l.competencia_origem_ano
           AND lp.competencia_origem_mes = l.competencia_origem_mes
       )
     ORDER BY l.competencia_origem_ano, l.competencia_origem_mes, l.descricao`,
    [cobrancaId],
  );
  return linhas.map((linha) => ({
    descricao: linha.descricao,
    ano: linha.competencia_origem_ano,
    mes: linha.competencia_origem_mes,
    valorCentavos: linha.valor_centavos,
  }));
}

export type LinhaHistorico = {
  id: string;
  pessoa: string;
  pessoaId: string;
  competencia: string;
  status: StatusCobranca;
  embutidaEm: string | null;
  total: number;
  origem: string;
  email: Indicador;
  whatsapp: Indicador;
  copiaPix: string | null;
  podeEmail: boolean;
  podeWhatsapp: boolean;
};

export async function listarHistorico(
  app: App,
  filtro: { pessoaId?: string; status?: string; ano?: number; mes?: number },
): Promise<LinhaHistorico[]> {
  const where = ['TRUE'];
  const params: unknown[] = [];
  if (filtro.pessoaId) {
    params.push(filtro.pessoaId);
    where.push(`c.pessoa_id = $${params.length}`);
  }
  if (filtro.status === 'cancelada' || filtro.status === 'aberta' || filtro.status === 'paga') {
    params.push(filtro.status);
    where.push(`c.status = $${params.length}`);
  } else if (filtro.status !== 'todas') {
    where.push(`c.status <> 'cancelada'`);
  }
  if (filtro.ano && filtro.mes) {
    params.push(filtro.ano, filtro.mes);
    where.push(`c.competencia_ano = $${params.length - 1} AND c.competencia_mes = $${params.length}`);
  }
  const linhas = await consultar<{
    id: string;
    pessoa_id: string;
    nome: string;
    competencia_ano: number;
    competencia_mes: number;
    status: StatusCobranca;
    origem_geracao: string;
    canal_email_selecionado: boolean;
    canal_whatsapp_selecionado: boolean;
    copia_e_cola: string | null;
    total: number;
    embutida_ano: number | null;
    embutida_mes: number | null;
  }>(
    app.pool,
    `SELECT c.id, c.pessoa_id, p.nome, c.competencia_ano, c.competencia_mes, c.status, c.origem_geracao,
            c.canal_email_selecionado, c.canal_whatsapp_selecionado,
            COALESCE((SELECT SUM(valor_centavos) FROM linha_cobranca l WHERE l.cobranca_id = c.id), 0)::int AS total,
            emb.competencia_ano AS embutida_ano, emb.competencia_mes AS embutida_mes,
            pix.copia_e_cola
     FROM cobranca c
     JOIN pessoa p ON p.id = c.pessoa_id
     LEFT JOIN LATERAL (
       SELECT copia_e_cola FROM pix
       WHERE pix.cobranca_id = c.id
         AND pix.status_local IN ('pendente', 'falha_cancelamento')
         AND pix.copia_e_cola IS NOT NULL
       ORDER BY pix.criado_em DESC
       LIMIT 1
     ) pix ON true
     LEFT JOIN LATERAL (
       SELECT competencia_ano, competencia_mes FROM cobranca posterior
       WHERE posterior.anterior_id = c.id AND posterior.status IN ('aberta', 'paga')
       ORDER BY competencia_ano DESC, competencia_mes DESC
       LIMIT 1
     ) emb ON true
     WHERE ${where.join(' AND ')}
     ORDER BY c.competencia_ano DESC, c.competencia_mes DESC, p.nome
     LIMIT 500`,
    params,
  );
  const ids = linhas.map((linha) => linha.id);
  const envios = ids.length
    ? await consultar<{ cobranca_id: string; canal: 'email' | 'whatsapp'; resultado: 'enviado' | 'falha'; tentado_em: Date; motivo: string | null }>(
        app.pool,
        `SELECT DISTINCT ON (cobranca_id, canal) cobranca_id, canal, resultado, tentado_em, motivo
         FROM envio WHERE tipo = 'cobranca' AND cobranca_id = ANY($1::uuid[])
         ORDER BY cobranca_id, canal, tentado_em DESC`,
        [ids],
      )
    : [];
  const origemNome: Record<string, string> = { job: 'Job', manual: 'Manual', lote: 'Lote' };
  return linhas.map((linha) => {
    const indicador = (canal: 'email' | 'whatsapp'): Indicador => {
      const envio = envios.find((item) => item.cobranca_id === linha.id && item.canal === canal);
      return envio ? { resultado: envio.resultado, tentadoEm: envio.tentado_em, motivo: envio.motivo } : null;
    };
    return {
      id: linha.id,
      pessoa: linha.nome,
      pessoaId: linha.pessoa_id,
      competencia: formatarCompetencia(linha.competencia_ano, linha.competencia_mes),
      status: linha.status,
      embutidaEm: linha.embutida_ano && linha.embutida_mes ? formatarCompetencia(linha.embutida_ano, linha.embutida_mes) : null,
      total: linha.total,
      origem: origemNome[linha.origem_geracao] ?? linha.origem_geracao,
      email: indicador('email'),
      whatsapp: indicador('whatsapp'),
      copiaPix: linha.copia_e_cola,
      podeEmail: Boolean(linha.copia_e_cola && linha.status === 'aberta' && linha.canal_email_selecionado),
      podeWhatsapp: Boolean(linha.copia_e_cola && linha.status === 'aberta' && linha.canal_whatsapp_selecionado),
    };
  });
}

export type Detalhe = {
  id: string;
  pessoaId: string;
  pessoa: string;
  competencia: string;
  status: StatusCobranca;
  origem: string;
  pagaEm: Date | null;
  origemBaixa: string | null;
  canceladaEm: Date | null;
  motivoCancelamento: string | null;
  total: number;
  alerta: boolean;
  linhasAfetadas: LinhaAfetada[];
  linhas: {
    descricao: string;
    competencia: string;
    valorCentavos: number;
    carregada: boolean;
  }[];
  pixAtivo: { copia: string; venceEm: Date; valorCentavos: number } | null;
  pixes: {
    valorCentavos: number;
    status: StatusPix;
    validadeDias: number;
    venceEm: Date;
    motivo: string | null;
    mpStatus: string | null;
  }[];
  indicadores: {
    tipo: 'cobranca' | 'confirmacao' | 'inadimplencia';
    canal: 'email' | 'whatsapp';
    indicador: Indicador;
    tentativas: { tentadoEm: Date; resultado: string; motivo: string | null }[];
  }[];
  eventos: { efeito: string; valorCentavos: number; recebidoEm: Date }[];
  acoes: ReturnType<typeof acoesDisponiveis>;
  podeReenviar: Record<string, boolean>;
};

export async function detalharCobranca(app: App, id: string): Promise<Detalhe | null> {
  const cobrancas = await consultar<{
    id: string;
    pessoa_id: string;
    nome: string;
    competencia_ano: number;
    competencia_mes: number;
    status: StatusCobranca;
    origem_geracao: string;
    paga_em: Date | null;
    origem_baixa: string | null;
    cancelada_em: Date | null;
    motivo_cancelamento: string | null;
    alerta_itens_ja_pagos: boolean;
    canal_email_selecionado: boolean;
    canal_whatsapp_selecionado: boolean;
  }>(
    app.pool,
    `SELECT c.*, p.nome FROM cobranca c JOIN pessoa p ON p.id = c.pessoa_id WHERE c.id = $1`,
    [id],
  );
  const cobranca = cobrancas[0];
  if (!cobranca) return null;
  const linhas = await consultar<{
    descricao: string;
    competencia_origem_ano: number;
    competencia_origem_mes: number;
    valor_centavos: number;
    origem_cobranca_id: string;
  }>(
    app.pool,
    `SELECT descricao, competencia_origem_ano, competencia_origem_mes, valor_centavos, origem_cobranca_id
     FROM linha_cobranca WHERE cobranca_id = $1
     ORDER BY competencia_origem_ano, competencia_origem_mes, descricao, id`,
    [id],
  );
  const pixes = await consultar<{
    valor_centavos: number;
    status_local: StatusPix;
    validade_dias: number;
    vence_em: Date;
    motivo: string | null;
    mp_status: string | null;
    copia_e_cola: string | null;
  }>(app.pool, `SELECT * FROM pix WHERE cobranca_id = $1 ORDER BY criado_em DESC`, [id]);
  const envios = await consultar<{
    tipo: 'cobranca' | 'confirmacao' | 'inadimplencia';
    canal: 'email' | 'whatsapp';
    tentado_em: Date;
    resultado: 'enviado' | 'falha';
    motivo: string | null;
  }>(app.pool, `SELECT * FROM envio WHERE cobranca_id = $1 ORDER BY tentado_em`, [id]);
  const eventos = await consultar<{ efeito: string; valor_centavos: number; recebido_em: Date }>(
    app.pool,
    'SELECT efeito, valor_centavos, recebido_em FROM evento_pagamento WHERE cobranca_id = $1 ORDER BY recebido_em',
    [id],
  );
  const vigente = await vigenteDaPessoa(app.pool, cobranca.pessoa_id);
  const posterior = await consultar<{ id: string }>(
    app.pool,
    `SELECT id FROM cobranca
     WHERE pessoa_id = $1 AND status IN ('aberta', 'paga')
       AND (competencia_ano, competencia_mes) > ($2, $3) LIMIT 1`,
    [cobranca.pessoa_id, cobranca.competencia_ano, cobranca.competencia_mes],
  );
  const ativo = pixes.find((pix) => pix.status_local === 'pendente' || pix.status_local === 'falha_cancelamento') ?? null;
  const ultimo = pixes[0] ?? null;
  const acoes = acoesDisponiveis({
    status: cobranca.status,
    vigente: vigente?.id === cobranca.id,
    temAtivaPosterior: posterior.length > 0,
    temPixAtivo: Boolean(ativo),
    ultimoPix: ultimo?.status_local ?? null,
  });
  const tipos = ['cobranca', 'confirmacao', 'inadimplencia'] as const;
  const canais = ['email', 'whatsapp'] as const;
  const indicadores = tipos.flatMap((tipo) =>
    canais.map((canal) => {
      const tentativas = envios.filter((envio) => envio.tipo === tipo && envio.canal === canal);
      const recente = tentativas.at(-1) ?? null;
      const selecionado = canal === 'email' ? cobranca.canal_email_selecionado : cobranca.canal_whatsapp_selecionado;
      const pode = selecionado && (
        (tipo === 'confirmacao' && cobranca.status === 'paga')
        || (tipo === 'cobranca' && cobranca.status === 'aberta' && Boolean(ativo))
        || (tipo === 'inadimplencia' && cobranca.status === 'aberta')
      );
      return {
        tipo,
        canal,
        indicador: recente ? { resultado: recente.resultado, tentadoEm: recente.tentado_em, motivo: recente.motivo } : null,
        tentativas: tentativas.map((tentativa) => ({
          tentadoEm: tentativa.tentado_em,
          resultado: tentativa.resultado,
          motivo: tentativa.motivo,
        })),
        pode,
      };
    }),
  );
  const origemNome: Record<string, string> = { job: 'Job', manual: 'Manual', lote: 'Lote' };
  return {
    id: cobranca.id,
    pessoaId: cobranca.pessoa_id,
    pessoa: cobranca.nome,
    competencia: formatarCompetencia(cobranca.competencia_ano, cobranca.competencia_mes),
    status: cobranca.status,
    origem: origemNome[cobranca.origem_geracao] ?? cobranca.origem_geracao,
    pagaEm: cobranca.paga_em,
    origemBaixa: cobranca.origem_baixa,
    canceladaEm: cobranca.cancelada_em,
    motivoCancelamento: cobranca.motivo_cancelamento,
    total: linhas.reduce((soma, linha) => soma + linha.valor_centavos, 0),
    alerta: cobranca.alerta_itens_ja_pagos,
    linhasAfetadas: await linhasAfetadas(app, cobranca.id),
    linhas: linhas.map((linha) => ({
      descricao: linha.descricao,
      competencia: formatarCompetencia(linha.competencia_origem_ano, linha.competencia_origem_mes),
      valorCentavos: linha.valor_centavos,
      carregada: linha.origem_cobranca_id !== cobranca.id,
    })),
    pixAtivo: ativo?.copia_e_cola
      ? { copia: ativo.copia_e_cola, venceEm: ativo.vence_em, valorCentavos: ativo.valor_centavos }
      : null,
    pixes: pixes.map((pix) => ({
      valorCentavos: pix.valor_centavos,
      status: pix.status_local,
      validadeDias: pix.validade_dias,
      venceEm: pix.vence_em,
      motivo: pix.motivo,
      mpStatus: pix.mp_status,
    })),
    indicadores: indicadores.map(({ pode: _pode, ...resto }) => resto),
    eventos: eventos.map((evento) => ({
      efeito: evento.efeito,
      valorCentavos: evento.valor_centavos,
      recebidoEm: evento.recebido_em,
    })),
    acoes,
    podeReenviar: Object.fromEntries(indicadores.map((item) => [`${item.tipo}:${item.canal}`, item.pode])),
  };
}
