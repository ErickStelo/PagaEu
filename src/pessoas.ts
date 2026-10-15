import { randomUUID } from 'node:crypto';
import type { App } from './app.ts';
import { consultar } from './db.ts';
import { partesNoFuso } from './domain/calendar.ts';
import { emailValido, normalizarCpf, normalizarWhatsapp } from './domain/documento.ts';
import { planejarTrocaDeDia } from './domain/dia.ts';

export type Pessoa = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string;
  cpf: string | null;
  dia_cobranca: number;
  dia_cobranca_pendente: number | null;
  dia_pendente_ano: number | null;
  dia_pendente_mes: number | null;
  validade_pix_dias: number;
  dias_aviso_inadimplencia: number;
  canal_email: boolean;
  canal_whatsapp: boolean;
  ativa: boolean;
};

export type Item = {
  id: string;
  pessoa_id: string;
  descricao: string;
  valor_centavos: number;
  inicio_ano: number;
  inicio_mes: number;
  fim_ano: number;
  fim_mes: number;
};

export type EntradaPessoa = {
  nome: string;
  whatsapp: string;
  email: string;
  cpf?: string | null;
  diaCobranca: number;
  validadePixDias?: number;
  diasAviso?: number;
  canalEmail?: boolean;
  canalWhatsapp?: boolean;
};

type PessoaNormalizada = {
  nome: string;
  whatsapp: string;
  email: string;
  cpf: string | null;
  diaCobranca: number;
  validadePixDias: number;
  diasAviso: number;
  canalEmail: boolean;
  canalWhatsapp: boolean;
};

function normalizarPessoa(entrada: EntradaPessoa, criacao: boolean): PessoaNormalizada | string {
  const nome = entrada.nome.trim();
  if (nome.length < 1 || nome.length > 120) return 'O nome precisa ter de 1 a 120 caracteres.';
  const whatsapp = normalizarWhatsapp(entrada.whatsapp);
  if (!whatsapp) return 'WhatsApp inválido. Use DDI e DDD, ou um número brasileiro.';
  const email = entrada.email.trim();
  if (!emailValido(email)) return 'E-mail inválido.';
  const cpfBruto = (entrada.cpf ?? '').trim();
  let cpf: string | null = null;
  if (cpfBruto) {
    cpf = normalizarCpf(cpfBruto);
    if (!cpf) return 'CPF inválido.';
  }
  if (!Number.isInteger(entrada.diaCobranca) || entrada.diaCobranca < 1 || entrada.diaCobranca > 31) {
    return 'O dia de cobrança precisa estar entre 1 e 31.';
  }
  const validade = entrada.validadePixDias ?? 10;
  const aviso = entrada.diasAviso ?? 5;
  if (!Number.isInteger(validade) || validade < 1 || validade > 30) return 'A validade do PIX precisa estar entre 1 e 30 dias.';
  if (!Number.isInteger(aviso) || aviso < 1 || aviso > 60) return 'Os dias de aviso precisam estar entre 1 e 60.';
  return {
    nome,
    whatsapp,
    email,
    cpf,
    diaCobranca: entrada.diaCobranca,
    validadePixDias: validade,
    diasAviso: aviso,
    canalEmail: entrada.canalEmail ?? (criacao ? true : false),
    canalWhatsapp: entrada.canalWhatsapp ?? (criacao ? true : false),
  };
}

export async function obterPessoa(app: App, id: string): Promise<Pessoa | null> {
  const linhas = await consultar<Pessoa>(app.pool, 'SELECT * FROM pessoa WHERE id = $1', [id]);
  return linhas[0] ?? null;
}

export async function listarPessoas(app: App): Promise<Pessoa[]> {
  return consultar<Pessoa>(app.pool, 'SELECT * FROM pessoa ORDER BY nome, id');
}

export async function criarPessoa(app: App, entrada: EntradaPessoa): Promise<{ ok: true; id: string } | { ok: false; aviso: string }> {
  const normalizada = normalizarPessoa(entrada, true);
  if (typeof normalizada === 'string') return { ok: false, aviso: normalizada };
  const id = randomUUID();
  await app.pool.query(
    `INSERT INTO pessoa (
      id, nome, whatsapp, email, cpf, dia_cobranca, validade_pix_dias, dias_aviso_inadimplencia,
      canal_email, canal_whatsapp, ativa
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
    [
      id,
      normalizada.nome,
      normalizada.whatsapp,
      normalizada.email,
      normalizada.cpf,
      normalizada.diaCobranca,
      normalizada.validadePixDias,
      normalizada.diasAviso,
      normalizada.canalEmail,
      normalizada.canalWhatsapp,
    ],
  );
  return { ok: true, id };
}

export async function atualizarPessoa(
  app: App,
  id: string,
  entrada: EntradaPessoa,
  agora = app.clock(),
): Promise<{ ok: true; avisos: string[] } | { ok: false; aviso: string }> {
  const atual = await obterPessoa(app, id);
  if (!atual) return { ok: false, aviso: 'Pessoa não encontrada.' };
  const normalizada = normalizarPessoa(entrada, false);
  if (typeof normalizada === 'string') return { ok: false, aviso: normalizada };
  const hoje = partesNoFuso(agora);
  const ativas = await app.pool.query(
    `SELECT 1 FROM cobranca
     WHERE pessoa_id = $1 AND status IN ('aberta', 'paga')
       AND competencia_ano = $2 AND competencia_mes = $3`,
    [id, hoje.year, hoje.month],
  );
  const plano = planejarTrocaDeDia({
    hoje,
    diaAtual: atual.dia_cobranca,
    diaNovo: normalizada.diaCobranca,
    temCobrancaAtivaNoMes: Boolean(ativas.rowCount),
  });
  await app.pool.query(
    `UPDATE pessoa SET
      nome = $2, whatsapp = $3, email = $4, cpf = $5,
      dia_cobranca = $6, dia_cobranca_pendente = $7, dia_pendente_ano = $8, dia_pendente_mes = $9,
      validade_pix_dias = $10, dias_aviso_inadimplencia = $11,
      canal_email = $12, canal_whatsapp = $13, atualizado_em = $14
     WHERE id = $1`,
    [
      id,
      normalizada.nome,
      normalizada.whatsapp,
      normalizada.email,
      normalizada.cpf,
      plano.diaCobranca,
      plano.diaPendente,
      plano.pendenteAno,
      plano.pendenteMes,
      normalizada.validadePixDias,
      normalizada.diasAviso,
      normalizada.canalEmail,
      normalizada.canalWhatsapp,
      agora,
    ],
  );
  return { ok: true, avisos: plano.avisos };
}

export async function definirAtiva(app: App, id: string, ativa: boolean): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const resultado = await app.pool.query('UPDATE pessoa SET ativa = $2, atualizado_em = $3 WHERE id = $1', [id, ativa, app.clock()]);
  if (!resultado.rowCount) return { ok: false, aviso: 'Pessoa não encontrada.' };
  return { ok: true };
}

function validarItem(entrada: {
  descricao: string;
  valorCentavos: number | null;
  inicioAno: number;
  inicioMes: number;
  fimAno: number;
  fimMes: number;
}): string | null {
  const descricao = entrada.descricao.trim();
  if (descricao.length < 1 || descricao.length > 200) return 'A descrição precisa ter de 1 a 200 caracteres.';
  if (
    !Number.isInteger(entrada.inicioAno) ||
    !Number.isInteger(entrada.fimAno) ||
    !Number.isInteger(entrada.inicioMes) ||
    !Number.isInteger(entrada.fimMes) ||
    entrada.inicioMes < 1 ||
    entrada.inicioMes > 12 ||
    entrada.fimMes < 1 ||
    entrada.fimMes > 12 ||
    entrada.inicioAno < 2000 ||
    entrada.fimAno > 2100 ||
    entrada.fimAno < 2000 ||
    entrada.inicioAno > 2100
  ) {
    return 'Informe o mês e o ano de início e de fim.';
  }
  if (entrada.inicioAno > entrada.fimAno || (entrada.inicioAno === entrada.fimAno && entrada.inicioMes > entrada.fimMes)) {
    return 'O início não pode ser posterior ao fim.';
  }
  if (entrada.valorCentavos === null) return 'Informe um valor entre R$ 0,01 e R$ 999.999,99.';
  return null;
}

export async function listarItens(app: App, pessoaId: string): Promise<Item[]> {
  return consultar<Item>(app.pool, 'SELECT * FROM item WHERE pessoa_id = $1 ORDER BY criado_em, id', [pessoaId]);
}

export async function salvarItem(
  app: App,
  pessoaId: string,
  itemId: string | null,
  entrada: {
    descricao: string;
    valorCentavos: number | null;
    inicioAno: number;
    inicioMes: number;
    fimAno: number;
    fimMes: number;
  },
): Promise<{ ok: true; id: string } | { ok: false; aviso: string }> {
  const pessoa = await obterPessoa(app, pessoaId);
  if (!pessoa) return { ok: false, aviso: 'Pessoa não encontrada.' };
  const erro = validarItem(entrada);
  if (erro) return { ok: false, aviso: erro };
  const descricao = entrada.descricao.trim();
  if (itemId) {
    const atualizado = await app.pool.query(
      `UPDATE item SET descricao=$2, valor_centavos=$3, inicio_ano=$4, inicio_mes=$5, fim_ano=$6, fim_mes=$7, atualizado_em=$8
       WHERE id=$1 AND pessoa_id=$9`,
      [itemId, descricao, entrada.valorCentavos, entrada.inicioAno, entrada.inicioMes, entrada.fimAno, entrada.fimMes, app.clock(), pessoaId],
    );
    if (!atualizado.rowCount) return { ok: false, aviso: 'Item não encontrado.' };
    return { ok: true, id: itemId };
  }
  const id = randomUUID();
  await app.pool.query(
    `INSERT INTO item (id, pessoa_id, descricao, valor_centavos, inicio_ano, inicio_mes, fim_ano, fim_mes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, pessoaId, descricao, entrada.valorCentavos, entrada.inicioAno, entrada.inicioMes, entrada.fimAno, entrada.fimMes],
  );
  return { ok: true, id };
}

export async function excluirItem(app: App, itemId: string): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const usado = await app.pool.query('SELECT 1 FROM linha_cobranca WHERE item_id = $1 LIMIT 1', [itemId]);
  if (usado.rowCount) return { ok: false, aviso: 'Item usado em cobrança não pode ser apagado.' };
  const apagado = await app.pool.query('DELETE FROM item WHERE id = $1', [itemId]);
  if (!apagado.rowCount) return { ok: false, aviso: 'Item não encontrado.' };
  return { ok: true };
}
