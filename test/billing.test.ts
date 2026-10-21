import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { receberWebhook } from '../src/webhook.ts';
import { detalharCobranca, linhasAfetadas, montarPainel } from '../src/consultas.ts';
import { montarDashboard } from '../src/dashboard.ts';
import {
  baixaManual,
  cancelarCobranca,
  gerarCobranca,
  gerarLote,
  gerarNovoPix,
  invalidarPix,
  tentarEmissao,
  consultarCobrancasAbertas,
  reabrirCobranca,
  verificarPixAtivos,
  type ResultadoGeracao,
} from '../src/cobrancas.ts';
import { civilParaUtc } from '../src/domain/calendar.ts';
import { CORPO_COBRANCA } from '../src/domain/template.ts';
import { executarAgendado, executarConciliacaoAutomatica, executarJobDiario } from '../src/job.ts';
import { criarPessoa, definirAtiva, obterPessoa, salvarItem, atualizarPessoa } from '../src/pessoas.ts';
import { conciliarPixNativos } from '../src/conciliacaoPix.ts';
import { csrf, encerrar, evolution, fixar, limpar, mp, ouvir, poolFora, preparar, SessaoHttp, totalCentavos, agora, app, correio, usarPixNativo } from './suporte.ts';

type CobrancaLinha = {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  status: string;
  paga_em: Date | null;
  origem_baixa: string | null;
  quitada_por_id: string | null;
};

function sp(ano: number, mes: number, dia: number, hora = 9, minuto = 0): Date {
  return civilParaUtc(ano, mes, dia, hora, minuto, 0);
}

function exigir(resultado: ResultadoGeracao): { cobrancaId: string; pixOk: boolean } {
  if (!resultado.ok) throw new Error(resultado.aviso);
  return resultado;
}

async function cobrancasDe(pessoaId: string): Promise<CobrancaLinha[]> {
  const resultado = await app().pool.query<CobrancaLinha>(
    `SELECT id, competencia_ano, competencia_mes, status, paga_em, origem_baixa, quitada_por_id
     FROM cobranca WHERE pessoa_id = $1 ORDER BY competencia_ano, competencia_mes, criado_em`,
    [pessoaId],
  );
  return resultado.rows;
}

async function criarAna(): Promise<string> {
  const pessoa = await criarPessoa(app(), {
    nome: 'Ana',
    whatsapp: '(11) 98888-7777',
    email: 'ana@example.com',
    diaCobranca: 31,
    validadePixDias: 10,
    diasAviso: 5,
  });
  if (!pessoa.ok) throw new Error(pessoa.aviso);
  for (const item of [
    { descricao: 'Aluguel', valorCentavos: 100_000, inicioMes: 3, fimMes: 5 },
    { descricao: 'Internet', valorCentavos: 15_000, inicioMes: 3, fimMes: 3 },
    { descricao: 'Água', valorCentavos: 8_000, inicioMes: 4, fimMes: 4 },
  ]) {
    const salvo = await salvarItem(app(), pessoa.id, null, {
      descricao: item.descricao,
      valorCentavos: item.valorCentavos,
      inicioAno: 2026,
      inicioMes: item.inicioMes,
      fimAno: 2026,
      fimMes: item.fimMes,
    });
    if (!salvo.ok) throw new Error(salvo.aviso);
  }
  return pessoa.id;
}

async function gerarMeses(pessoaId: string): Promise<CobrancaLinha[]> {
  fixar(sp(2026, 3, 31));
  await executarJobDiario(app(), agora);
  fixar(sp(2026, 4, 30));
  await executarJobDiario(app(), agora);
  fixar(sp(2026, 5, 31));
  await executarJobDiario(app(), agora);
  return cobrancasDe(pessoaId);
}

before(async () => {
  await preparar();
});

beforeEach(async () => {
  fixar(sp(2026, 3, 31));
  await limpar();
});

after(async () => {
  await encerrar();
});

test('provedor nativo gera copia e cola sem gateway e segue no WhatsApp', async () => {
  const pessoaId = await criarAna();
  await usarPixNativo('erick@example.com');
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  assert.equal(gerada.pixOk, true);
  assert.equal(mp.criacoes.length, 0);
  const pix = await app().pool.query<{ provedor: string; copia_e_cola: string; mp_payment_id: string | null; status_local: string }>(
    'SELECT provedor, copia_e_cola, mp_payment_id, status_local FROM pix WHERE cobranca_id = $1',
    [gerada.cobrancaId],
  );
  const linha = pix.rows[0]!;
  assert.equal(linha.provedor, 'nativo');
  assert.equal(linha.mp_payment_id, null);
  assert.equal(linha.status_local, 'pendente');
  assert.match(linha.copia_e_cola, /^000201.*br\.gov\.bcb\.pix.*54071150\.00.*0509ANA032026.*6304[0-9A-F]{4}$/);
  assert.equal(evolution.enviados.at(-1)?.text, linha.copia_e_cola);
  assert.match(evolution.enviados.at(-2)?.text ?? '', /Olá/);

  await verificarPixAtivos(app(), agora);
  assert.equal(mp.criacoes.length, 0);

  const invalidado = await invalidarPix(app(), gerada.cobrancaId, agora);
  assert.equal(invalidado.ok, true);
  assert.equal(mp.cancelamentos.length, 0);
  const novo = await gerarNovoPix(app(), gerada.cobrancaId, agora);
  assert.equal(novo.ok, true);

  const baixa = await baixaManual(app(), gerada.cobrancaId, 'invalidar', agora);
  assert.equal(baixa.ok, true);
  const status = await app().pool.query<{ status: string }>('SELECT status FROM cobranca WHERE id = $1', [gerada.cobrancaId]);
  assert.equal(status.rows[0]?.status, 'paga');
  assert.equal(mp.criacoes.length, 0);
});

test('conciliação automática baixa PIX nativo pelo TxId no Mercado Pago', async () => {
  const pessoaId = await criarAna();
  await usarPixNativo('erick@example.com');
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  const txid = await app().pool.query<{ txid: string }>('SELECT txid FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId]);
  const identificador = txid.rows[0]?.txid ?? 'ANA032026';
  mp.entradasPix = [
    {
      id: 'mp-conc-1',
      valorCentavos: 115_000,
      txid: identificador,
      dateApproved: sp(2026, 3, 31, 9),
    },
  ];
  const resultado = await conciliarPixNativos(app(), agora);
  assert.equal(resultado.conciliadas, 1);
  const cobranca = await app().pool.query<{ status: string }>('SELECT status FROM cobranca WHERE id = $1', [gerada.cobrancaId]);
  assert.equal(cobranca.rows[0]?.status, 'paga');
  assert.equal(correio.enviados.some((item) => item.subject.includes('Pagamento recebido')), true);
});

test('reabrir cobrança paga permite conciliar de novo', async () => {
  const pessoaId = await criarAna();
  await usarPixNativo('erick@example.com');
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  const txid = await app().pool.query<{ txid: string }>('SELECT txid FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId]);
  mp.entradasPix = [
    {
      id: 'mp-reabrir',
      valorCentavos: 115_000,
      txid: txid.rows[0]?.txid ?? 'ANA032026',
      dateApproved: sp(2026, 3, 31, 9),
    },
  ];
  assert.equal((await consultarCobrancasAbertas(app(), agora)).pagas, 1);
  assert.equal((await reabrirCobranca(app(), gerada.cobrancaId, agora)).ok, true);
  assert.equal((await cobrancasDe(pessoaId))[0]?.status, 'aberta');
  const deNovo = await consultarCobrancasAbertas(app(), agora);
  assert.equal(deNovo.pagas, 1);
});

test('dashboard separa em aberto, atrasada e recebida sem contar duas vezes', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  const marco = { inicio: { ano: 2026, mes: 3 }, fim: { ano: 2026, mes: 3 } };
  const noPrazo = await montarDashboard(app(), marco, agora);
  assert.equal(noPrazo.totais.aberta.quantidade, 1);
  assert.equal(noPrazo.totais.aberta.valorCentavos, 115_000);
  assert.equal(noPrazo.meses.length, 6);
  const depois = await montarDashboard(app(), marco, sp(2026, 4, 25));
  assert.equal(depois.totais.atrasada.quantidade, 1);
  assert.equal(depois.atrasadas[0]?.cobrancaId, gerada.cobrancaId);
  const painel = await montarPainel(app(), sp(2026, 4, 25));
  assert.equal(painel[0]?.situacao, 'atrasada');
  const pix = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId])).rows[0]!;
  mp.aprovar(pix.mp_payment_id, agora);
  await verificarPixAtivos(app(), agora);
  const pago = await montarDashboard(app(), marco, agora);
  assert.equal(pago.totais.paga.quantidade, 1);
  assert.equal(pago.totais.aberta.quantidade + pago.totais.atrasada.quantidade, 0);
  assert.equal(pago.taxaRecebimento, 1);
  assert.equal((await montarPainel(app(), agora))[0]?.situacao, 'paga');
});

test('consultar cobranças abertas concilia PIX nativo pelo painel', async () => {
  const pessoaId = await criarAna();
  await usarPixNativo('erick@example.com');
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  const txid = await app().pool.query<{ txid: string }>('SELECT txid FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId]);
  mp.entradasPix = [
    {
      id: 'mp-conc-painel',
      valorCentavos: 115_000,
      txid: txid.rows[0]?.txid ?? 'ANA032026',
      dateApproved: sp(2026, 3, 31, 9),
    },
  ];
  correio.enviados.length = 0;
  const resultado = await consultarCobrancasAbertas(app(), agora);
  assert.equal(resultado.conciliacao.conciliadas, 1);
  assert.equal(resultado.pagas, 1);
  assert.equal((await cobrancasDe(pessoaId))[0]?.status, 'paga');
});

test('provedor nativo sem chave falha a emissão com motivo claro', async () => {
  const pessoaId = await criarAna();
  await usarPixNativo(null);
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  assert.equal(gerada.pixOk, false);
  const pix = await app().pool.query<{ status_local: string; motivo: string }>('SELECT status_local, motivo FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId]);
  assert.equal(pix.rows[0]?.status_local, 'falha_emissao');
  assert.match(pix.rows[0]?.motivo ?? '', /Chave PIX não configurada/);
  await usarPixNativo('erick@example.com');
  const retentativa = await tentarEmissao(app(), gerada.cobrancaId, agora);
  assert.equal(retentativa.ok, true);
});

test('rolagem da Ana não soma os meses de novo', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  await executarJobDiario(app(), agora);
  await executarJobDiario(app(), agora);
  let lista = await cobrancasDe(pessoaId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]?.competencia_mes, 3);
  assert.equal(await totalCentavos(lista[0]!.id), 115_000);
  const pix = await app().pool.query<{ vence_em: Date; idempotency_key: string }>('SELECT vence_em, idempotency_key FROM pix WHERE cobranca_id = $1', [lista[0]!.id]);
  assert.equal(pix.rows[0]?.vence_em.toISOString(), sp(2026, 4, 10).toISOString());
  const texto = `${correio.enviados.map((item) => item.text).join('\n')}\n${evolution.enviados.map((item) => item.text).join('\n')}`;
  assert.match(texto, /1\.150,00/);
  assert.match(texto, /10/);
  assert.match(texto, /10\/04\/2026 09:00/);
  const copia = await app().pool.query<{ copia_e_cola: string }>('SELECT copia_e_cola FROM pix WHERE cobranca_id = $1', [lista[0]!.id]);
  const zap = evolution.enviados;
  assert.equal(zap.at(-1)?.text, copia.rows[0]?.copia_e_cola);
  assert.match(zap.at(-2)?.text ?? '', /Olá/);

  fixar(sp(2026, 4, 29));
  await executarJobDiario(app(), agora);
  assert.equal((await cobrancasDe(pessoaId)).length, 1);

  fixar(sp(2026, 4, 30));
  await executarJobDiario(app(), agora);
  lista = await cobrancasDe(pessoaId);
  const abril = lista.find((item) => item.competencia_mes === 4);
  assert.ok(abril);
  assert.equal(await totalCentavos(abril.id), 223_000);
  assert.notEqual(await totalCentavos(abril.id), 338_000);
  fixar(sp(2026, 4, 30, 10));
  const painelAbril = await montarPainel(app(), agora);
  assert.equal(painelAbril[0]?.valorCentavos, 223_000);

  fixar(sp(2026, 5, 31));
  await executarJobDiario(app(), agora);
  lista = await cobrancasDe(pessoaId);
  const maio = lista.find((item) => item.competencia_mes === 5);
  assert.ok(maio);
  assert.equal(await totalCentavos(maio.id), 323_000);
  const origens = await app().pool.query<{ competencia_origem_mes: number }>(
    'SELECT competencia_origem_mes FROM linha_cobranca WHERE cobranca_id = $1',
    [maio.id],
  );
  assert.equal(origens.rows.length, 5);
  assert.equal(origens.rows.some((linha) => linha.competencia_origem_mes === 2 || linha.competencia_origem_mes === 6), false);
  const modelo = await app().pool.query<{ corpo: string }>(`SELECT corpo FROM template WHERE canal = 'whatsapp' AND tipo = 'cobranca'`);
  assert.equal(modelo.rows[0]?.corpo, CORPO_COBRANCA);
});

test('pagamento da vigente quita a cadeia uma vez', async () => {
  const pessoaId = await criarAna();
  const lista = await gerarMeses(pessoaId);
  const maio = lista.find((item) => item.competencia_mes === 5);
  assert.ok(maio);
  const pix = await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [maio.id]);
  const mpId = pix.rows[0]?.mp_payment_id;
  assert.ok(mpId);
  const quando = sp(2026, 6, 2, 11, 20);
  mp.aprovar(mpId, quando);
  await verificarPixAtivos(app(), quando);
  const quitadas = await cobrancasDe(pessoaId);
  assert.equal(quitadas.length, 3);
  for (const cobranca of quitadas) {
    assert.equal(cobranca.status, 'paga');
    assert.equal(cobranca.paga_em?.toISOString(), quando.toISOString());
  }
  assert.equal(quitadas.find((item) => item.competencia_mes === 5)?.origem_baixa, 'pagamento');
  assert.equal(quitadas.find((item) => item.competencia_mes === 4)?.origem_baixa, 'cascata');
  assert.equal(quitadas.find((item) => item.competencia_mes === 3)?.quitada_por_id, maio.id);
  const confirmacoes = await app().pool.query<{ cobranca_id: string }>(`SELECT cobranca_id FROM envio WHERE tipo = 'confirmacao'`);
  assert.deepEqual([...new Set(confirmacoes.rows.map((linha) => linha.cobranca_id))], [maio.id]);
  const texto = correio.enviados.map((item) => item.text).join('\n');
  assert.match(texto, /03\/2026, 04\/2026 e 05\/2026/);
  const pagaEm = (await cobrancasDe(pessoaId))[2]?.paga_em?.toISOString();
  await verificarPixAtivos(app(), sp(2026, 6, 3));
  assert.equal((await cobrancasDe(pessoaId))[2]?.paga_em?.toISOString(), pagaEm);
  assert.equal((await app().pool.query(`SELECT COUNT(*)::int AS n FROM envio WHERE tipo = 'confirmacao'`)).rows[0]?.n, confirmacoes.rows.length);
});

test('baixa manual e cancelamento só na vigente sem posterior', async () => {
  const pessoaId = await criarAna();
  const lista = await gerarMeses(pessoaId);
  const abril = lista.find((item) => item.competencia_mes === 4);
  const maio = lista.find((item) => item.competencia_mes === 5);
  assert.ok(abril && maio);
  const baixa = await baixaManual(app(), abril.id, 'invalidar', agora);
  assert.equal(baixa.ok, false);
  if (!baixa.ok) assert.match(baixa.aviso, /vigente/);
  const detalheAbril = await detalharCobranca(app(), abril.id);
  const detalheMaio = await detalharCobranca(app(), maio.id);
  assert.equal(detalheAbril?.acoes.baixaManual, false);
  assert.equal(detalheMaio?.acoes.baixaManual, true);
  const cancelado = await cancelarCobranca(app(), abril.id, 'não quero', agora);
  assert.equal(cancelado.ok, false);
  const pago = await baixaManual(app(), maio.id, 'invalidar', agora);
  assert.equal(pago.ok, true);
  const deNovo = await cancelarCobranca(app(), maio.id, 'tarde demais', agora);
  assert.equal(deNovo.ok, false);
  if (!deNovo.ok) assert.match(deNovo.aviso, /paga/);

  await limpar();
  const outra = await criarAna();
  const meses = await gerarMeses(outra);
  const maioAberto = meses.find((item) => item.competencia_mes === 5);
  const abrilAberto = meses.find((item) => item.competencia_mes === 4);
  assert.ok(maioAberto && abrilAberto);
  assert.equal((await cancelarCobranca(app(), maioAberto.id, 'acerto', agora)).ok, true);
  assert.equal((await cancelarCobranca(app(), abrilAberto.id, 'acerto', agora)).ok, true);

  app().env.loginCodeDisabled = true;
  const servidor = await ouvir();
  try {
    const sessao = new SessaoHttp(servidor.base);
    assert.equal((await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' })).status, 303);
    const paginaMaio = await sessao.pedir('GET', `/cobrancas/${maioAberto.id}`);
    const paginaMarco = await sessao.pedir('GET', `/cobrancas/${meses[0]!.id}`);
    assert.equal(paginaMaio.texto.includes('Confirmar baixa'), false);
    assert.match(paginaMarco.texto, /Confirmar baixa/);
    const token = csrf(paginaMarco.texto);
    const recusa = await sessao.pedir('POST', `/cobrancas/${maioAberto.id}/baixa`, { csrf: token, pix: 'invalidar' });
    assert.equal(recusa.status, 303);
  } finally {
    await servidor.fechar();
  }
});

test('segunda geração do mês ativo é recusada e cancelada não trava o manual', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 5, 31));
  const primeira = exigir(await gerarCobranca(app(), pessoaId, 2026, 5, 'manual', agora));
  const segunda = await gerarCobranca(app(), pessoaId, 2026, 5, 'manual', agora);
  assert.equal(segunda.ok, false);
  if (!segunda.ok) assert.equal(segunda.aviso, 'já existe cobrança em 05/2026');
  assert.equal((await cobrancasDe(pessoaId)).length, 1);
  assert.equal((await cancelarCobranca(app(), primeira.cobrancaId, 'refazer', agora)).ok, true);
  await executarJobDiario(app(), agora);
  assert.equal((await cobrancasDe(pessoaId)).filter((item) => item.competencia_mes === 5).length, 1);
  const refeita = exigir(await gerarCobranca(app(), pessoaId, 2026, 5, 'manual', agora));
  assert.equal(await totalCentavos(refeita.cobrancaId), 100_000);
});

test('alterar o item não reescreve linha antiga e o mês anterior fica bloqueado', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  await executarJobDiario(app(), agora);
  fixar(sp(2026, 4, 30));
  await executarJobDiario(app(), agora);
  const aluguel = await app().pool.query<{ id: string }>('SELECT id FROM item WHERE descricao = $1', ['Aluguel']);
  const alterado = await salvarItem(app(), pessoaId, aluguel.rows[0]!.id, {
    descricao: 'Aluguel',
    valorCentavos: 110_000,
    inicioAno: 2026,
    inicioMes: 3,
    fimAno: 2026,
    fimMes: 5,
  });
  assert.equal(alterado.ok, true);
  fixar(sp(2026, 5, 31));
  const maio = exigir(await gerarCobranca(app(), pessoaId, 2026, 5, 'manual', agora));
  assert.equal(await totalCentavos(maio.cobrancaId), 333_000);
  const marco = (await cobrancasDe(pessoaId)).find((item) => item.competencia_mes === 3);
  assert.equal(await totalCentavos(marco!.id), 115_000);
  assert.equal((await cancelarCobranca(app(), maio.cobrancaId, 'preço voltou', agora)).ok, true);
  await salvarItem(app(), pessoaId, aluguel.rows[0]!.id, {
    descricao: 'Aluguel',
    valorCentavos: 100_000,
    inicioAno: 2026,
    inicioMes: 3,
    fimAno: 2026,
    fimMes: 5,
  });
  const refeita = exigir(await gerarCobranca(app(), pessoaId, 2026, 5, 'manual', agora));
  assert.equal(await totalCentavos(refeita.cobrancaId), 323_000);
  const abril = await gerarCobranca(app(), pessoaId, 2026, 4, 'manual', agora);
  const marcoDeNovo = await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora);
  assert.equal(abril.ok, false);
  assert.equal(marcoDeNovo.ok, false);
  if (!abril.ok) assert.equal(abril.aviso, 'já existe cobrança em 04/2026');
  const junho = exigir(await gerarCobranca(app(), pessoaId, 2026, 6, 'manual', agora));
  const origensJunho = await app().pool.query<{ competencia_origem_mes: number }>(
    'SELECT competencia_origem_mes FROM linha_cobranca WHERE cobranca_id = $1',
    [junho.cobrancaId],
  );
  assert.equal(origensJunho.rows.some((linha) => linha.competencia_origem_mes === 6), false);
  const vazia = await criarPessoa(app(), { nome: 'Sem mês', whatsapp: '11900000000', email: 'vazio@example.com', diaCobranca: 1 });
  if (!vazia.ok) throw new Error(vazia.aviso);
  const fevereiro = await gerarCobranca(app(), pessoaId, 2026, 2, 'manual', agora);
  assert.equal(fevereiro.ok, false);
  if (!fevereiro.ok) assert.equal(fevereiro.aviso, 'já existe cobrança posterior em 03/2026');
  const semItem = await gerarCobranca(app(), vazia.id, 2026, 3, 'manual', agora);
  assert.equal(semItem.ok, false);
  if (!semItem.ok) assert.equal(semItem.aviso, 'nenhum item para este mês');
  const futura = await criarPessoa(app(), { nome: 'Agosto', whatsapp: '11900000001', email: 'agosto@example.com', diaCobranca: 1 });
  if (!futura.ok) throw new Error(futura.aviso);
  const itemAgosto = await salvarItem(app(), futura.id, null, {
    descricao: 'Só agosto',
    valorCentavos: 2_000,
    inicioAno: 2026,
    inicioMes: 8,
    fimAno: 2026,
    fimMes: 8,
  });
  if (!itemAgosto.ok) throw new Error(itemAgosto.aviso);
  assert.equal((await gerarCobranca(app(), futura.id, 2026, 8, 'manual', agora)).ok, true);
  const julho = await gerarCobranca(app(), futura.id, 2026, 7, 'manual', agora);
  assert.equal(julho.ok, false);
  if (!julho.ok) assert.equal(julho.aviso, 'já existe cobrança posterior em 08/2026');
});

test('PIX antigo pago não altera a cobrança posterior e a regeração não copia linha quitada', async () => {
  fixar(sp(2026, 2, 10));
  const pessoa = await criarPessoa(app(), {
    nome: 'Bruno',
    whatsapp: '11977776666',
    email: 'bruno@example.com',
    diaCobranca: 10,
    validadePixDias: 30,
    diasAviso: 5,
  });
  if (!pessoa.ok) throw new Error(pessoa.aviso);
  const item = await salvarItem(app(), pessoa.id, null, {
    descricao: 'Mensalidade',
    valorCentavos: 50_000,
    inicioAno: 2026,
    inicioMes: 2,
    fimAno: 2026,
    fimMes: 3,
  });
  if (!item.ok) throw new Error(item.aviso);
  await executarJobDiario(app(), agora);
  const fevereiro = (await cobrancasDe(pessoa.id))[0];
  assert.ok(fevereiro);
  assert.equal(await totalCentavos(fevereiro.id), 50_000);
  const pixFevereiro = await app().pool.query<{ mp_payment_id: string; vence_em: Date }>(
    'SELECT mp_payment_id, vence_em FROM pix WHERE cobranca_id = $1',
    [fevereiro.id],
  );
  assert.equal(pixFevereiro.rows[0]?.vence_em.toISOString(), sp(2026, 3, 12).toISOString());
  mp.modoCancelamento = 'falha';
  fixar(sp(2026, 3, 10));
  await executarJobDiario(app(), agora);
  const marco = (await cobrancasDe(pessoa.id)).find((cobranca) => cobranca.competencia_mes === 3);
  assert.ok(marco);
  assert.equal(await totalCentavos(marco.id), 100_000);
  const statusAntigo = await app().pool.query<{ status_local: string }>('SELECT status_local FROM pix WHERE cobranca_id = $1', [fevereiro.id]);
  assert.equal(statusAntigo.rows[0]?.status_local, 'falha_cancelamento');
  const quando = sp(2026, 3, 11, 10);
  mp.aprovar(pixFevereiro.rows[0]!.mp_payment_id, quando, 50_000);
  await verificarPixAtivos(app(), quando);
  const depois = await cobrancasDe(pessoa.id);
  assert.equal(depois.find((cobranca) => cobranca.competencia_mes === 2)?.status, 'paga');
  assert.equal(depois.find((cobranca) => cobranca.competencia_mes === 3)?.status, 'aberta');
  assert.equal(await totalCentavos(marco.id), 100_000);
  const afetadas = await linhasAfetadas(app(), marco.id);
  assert.equal(afetadas.some((linha) => linha.mes === 2), true);
  const detalhe = await detalharCobranca(app(), marco.id);
  assert.equal(detalhe?.alerta, true);
  assert.equal((await cancelarCobranca(app(), marco.id, 'refazer março', quando)).ok, true);
  const novo = exigir(await gerarCobranca(app(), pessoa.id, 2026, 3, 'manual', quando));
  assert.equal(await totalCentavos(novo.cobrancaId), 50_000);
});

test('webhook, novo PIX, inadimplência, divergência e excedente', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  await executarJobDiario(app(), agora);
  const marco = (await cobrancasDe(pessoaId))[0];
  assert.ok(marco);
  const pix = await app().pool.query<{ mp_payment_id: string; idempotency_key: string; valor_centavos: number }>(
    'SELECT mp_payment_id, idempotency_key, valor_centavos FROM pix WHERE cobranca_id = $1',
    [marco.id],
  );
  const mpId = pix.rows[0]!.mp_payment_id;
  const invalido = await receberWebhook(app(), { assinatura: 'ts=1,v1=00', requestId: 'req' }, new URL(`https://painel.example/webhooks/mercadopago?data.id=${mpId}`), '{}');
  assert.equal(invalido, 401);
  assert.equal((await cobrancasDe(pessoaId))[0]?.status, 'aberta');
  const quando = sp(2026, 4, 2, 11);
  fixar(quando);
  mp.aprovar(mpId, quando);
  const tsWebhook = String(Math.floor(quando.getTime() / 1000));
  const manifesto = `id:${mpId};request-id:req-1;ts:${tsWebhook};`;
  const v1 = createHmac('sha256', 'whsec-teste').update(manifesto).digest('hex');
  const valido = await receberWebhook(
    app(),
    { assinatura: `ts=${tsWebhook},v1=${v1}`, requestId: 'req-1' },
    new URL('https://painel.example/webhooks/mercadopago'),
    JSON.stringify({ type: 'payment', data: { id: mpId } }),
  );
  assert.equal(valido, 200);
  assert.equal((await cobrancasDe(pessoaId))[0]?.paga_em?.toISOString(), quando.toISOString());
  const repetido = await receberWebhook(
    app(),
    { assinatura: `ts=${tsWebhook},v1=${v1}`, requestId: 'req-1' },
    new URL(`https://painel.example/webhooks/mercadopago?data.id=${mpId}`),
    JSON.stringify({ type: 'payment', data: { id: mpId } }),
  );
  assert.equal(repetido, 200);
  assert.equal((await cobrancasDe(pessoaId))[0]?.paga_em?.toISOString(), quando.toISOString());

  await limpar();
  const ana = await criarAna();
  fixar(sp(2026, 3, 31));
  await executarJobDiario(app(), agora);
  const aberta = (await cobrancasDe(ana))[0]!;
  const ativo = await app().pool.query<{ mp_payment_id: string; idempotency_key: string; valor_centavos: number }>(
    'SELECT mp_payment_id, idempotency_key, valor_centavos FROM pix WHERE cobranca_id = $1',
    [aberta.id],
  );
  assert.equal((await gerarNovoPix(app(), aberta.id, agora)).ok, false);
  mp.expirar(ativo.rows[0]!.mp_payment_id);
  await verificarPixAtivos(app(), sp(2026, 4, 11));
  assert.equal((await gerarNovoPix(app(), aberta.id, sp(2026, 4, 11))).ok, true);
  const pixes = await app().pool.query<{ idempotency_key: string; valor_centavos: number; status_local: string }>(
    'SELECT idempotency_key, valor_centavos, status_local FROM pix WHERE cobranca_id = $1 ORDER BY criado_em',
    [aberta.id],
  );
  assert.equal(pixes.rows.length, 2);
  assert.notEqual(pixes.rows[0]?.idempotency_key, pixes.rows[1]?.idempotency_key);
  assert.equal(pixes.rows[1]?.valor_centavos, ativo.rows[0]?.valor_centavos);
  assert.equal(pixes.rows[1]?.status_local, 'pendente');

  await limpar();
  const avisos = await criarAna();
  fixar(sp(2026, 3, 31));
  await executarJobDiario(app(), agora);
  const cobrancaAviso = (await cobrancasDe(avisos))[0]!;
  correio.enviados.length = 0;
  evolution.enviados.length = 0;
  fixar(sp(2026, 4, 14));
  await executarJobDiario(app(), agora);
  assert.equal(correio.enviados.length + evolution.enviados.length, 0);
  fixar(sp(2026, 4, 15));
  await executarJobDiario(app(), agora);
  await executarJobDiario(app(), agora);
  const inadimplencia = await app().pool.query(`SELECT COUNT(*)::int AS n FROM envio WHERE cobranca_id = $1 AND tipo = 'inadimplencia'`, [cobrancaAviso.id]);
  assert.equal(inadimplencia.rows[0]?.n, 2);

  await limpar();
  const divergente = await criarAna();
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), divergente, 2026, 3, 'manual', agora));
  const pagamento = await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId]);
  mp.aprovar(pagamento.rows[0]!.mp_payment_id, agora, 1);
  await verificarPixAtivos(app(), agora);
  assert.equal((await cobrancasDe(divergente))[0]?.status, 'aberta');
  const efeito = await app().pool.query<{ efeito: string }>(`SELECT efeito FROM evento_pagamento`);
  assert.equal(efeito.rows[0]?.efeito, 'divergencia_valor');

});

test('emissão reaproveita a chave e o cancelamento respeita o status remoto', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  mp.lancarNaCriacao = true;
  const falha = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  assert.equal(falha.pixOk, false);
  const antes = await app().pool.query<{ status_local: string; idempotency_key: string }>('SELECT status_local, idempotency_key FROM pix WHERE cobranca_id = $1', [falha.cobrancaId]);
  assert.equal(antes.rows[0]?.status_local, 'falha_emissao');
  mp.lancarNaCriacao = false;
  assert.equal((await tentarEmissao(app(), falha.cobrancaId, agora)).ok, true);
  const depois = await app().pool.query<{ status_local: string; idempotency_key: string }>('SELECT status_local, idempotency_key FROM pix WHERE cobranca_id = $1', [falha.cobrancaId]);
  assert.equal(depois.rows.length, 1);
  assert.equal(depois.rows[0]?.idempotency_key, antes.rows[0]?.idempotency_key);
  assert.equal(depois.rows[0]?.status_local, 'pendente');

  const mpId = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [falha.cobrancaId])).rows[0]!.mp_payment_id;
  mp.aprovar(mpId, agora);
  const cancelamentosAntes = mp.cancelamentos.length;
  const invalidado = await invalidarPix(app(), falha.cobrancaId, agora);
  assert.equal(invalidado.ok, true);
  assert.equal(mp.cancelamentos.length, cancelamentosAntes);
  assert.equal((await cobrancasDe(pessoaId))[0]?.status, 'paga');

  await limpar();
  const outra = await criarAna();
  const aberta = exigir(await gerarCobranca(app(), outra, 2026, 3, 'manual', agora));
  const idPendente = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [aberta.cobrancaId])).rows[0]!.mp_payment_id;
  assert.equal((await invalidarPix(app(), aberta.cobrancaId, agora)).ok, true);
  assert.equal(mp.cancelamentos.includes(idPendente), true);

  await limpar();
  const expirada = await criarAna();
  const cobranca = exigir(await gerarCobranca(app(), expirada, 2026, 3, 'manual', agora));
  const idExpirado = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [cobranca.cobrancaId])).rows[0]!.mp_payment_id;
  mp.expirar(idExpirado);
  mp.cancelamentos = [];
  assert.equal((await invalidarPix(app(), cobranca.cobrancaId, agora)).ok, true);
  assert.deepEqual(mp.cancelamentos, []);
  const motivo = await app().pool.query<{ status_local: string; motivo: string }>('SELECT status_local, motivo FROM pix WHERE cobranca_id = $1', [cobranca.cobrancaId]);
  assert.equal(motivo.rows[0]?.status_local, 'expirado');
  assert.equal(motivo.rows[0]?.motivo, 'já encerrado');

  await limpar();
  const bloqueado = await criarAna();
  const alvo = exigir(await gerarCobranca(app(), bloqueado, 2026, 3, 'manual', agora));
  const idRemoto = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [alvo.cobrancaId])).rows[0]!.mp_payment_id;
  mp.definirStatus(idRemoto, 'rejected');
  mp.cancelamentos = [];
  assert.equal((await invalidarPix(app(), alvo.cobrancaId, agora)).ok, false);
  assert.deepEqual(mp.cancelamentos, []);
});

test('lote do mês, pessoa inativa e CPF opcional', async () => {
  fixar(sp(2026, 6, 14));
  const rafael = await criarPessoa(app(), { nome: 'Rafael', whatsapp: '11911112222', email: 'rafael@example.com', diaCobranca: 5 });
  const diaOito = await criarPessoa(app(), { nome: 'Carla', whatsapp: '11911113333', email: 'carla@example.com', diaCobranca: 8 });
  const diaVinte = await criarPessoa(app(), { nome: 'Pedro', whatsapp: '11911114444', email: 'pedro@example.com', diaCobranca: 20 });
  const semItens = await criarPessoa(app(), { nome: 'Sem Itens', whatsapp: '11911115555', email: 'sem@example.com', diaCobranca: 8 });
  const inativa = await criarPessoa(app(), { nome: 'Inativa', whatsapp: '11911116666', email: 'inativa@example.com', diaCobranca: 8 });
  const posterior = await criarPessoa(app(), { nome: 'Futura', whatsapp: '11911117777', email: 'futura@example.com', diaCobranca: 1 });
  const passado = await criarPessoa(app(), { nome: 'Passado', whatsapp: '11911118888', email: 'passado@example.com', diaCobranca: 20 });
  if (!rafael.ok || !diaOito.ok || !diaVinte.ok || !semItens.ok || !inativa.ok || !posterior.ok || !passado.ok) throw new Error('pessoa');
  const item = { descricao: 'Taxa', valorCentavos: 1_000, inicioAno: 2026, inicioMes: 5, fimAno: 2026, fimMes: 7 };
  for (const id of [rafael.id, diaOito.id, diaVinte.id, inativa.id, posterior.id, passado.id]) {
    const salvo = await salvarItem(app(), id, null, item);
    if (!salvo.ok) throw new Error(salvo.aviso);
  }
  assert.equal((await gerarCobranca(app(), rafael.id, 2026, 6, 'manual', agora)).ok, true);
  assert.equal((await gerarCobranca(app(), posterior.id, 2026, 7, 'manual', agora)).ok, true);
  assert.equal((await definirAtiva(app(), inativa.id, false)).ok, true);
  const lote = await gerarLote(app(), 2026, 6, agora);
  assert.equal(lote.recusado, null);
  assert.equal(lote.geradas, 1);
  assert.equal(lote.puladas.find((itemPulada) => itemPulada.nome === 'Rafael')?.motivo, 'já tem cobrança');
  assert.equal(lote.puladas.find((itemPulada) => itemPulada.nome === 'Pedro')?.motivo, 'dia ainda não chegou');
  assert.equal(lote.puladas.find((itemPulada) => itemPulada.nome === 'Sem Itens')?.motivo, 'sem itens');
  assert.equal(lote.puladas.find((itemPulada) => itemPulada.nome === 'Futura')?.motivo, 'cobrança posterior');
  assert.equal(lote.puladas.some((itemPulada) => itemPulada.nome === 'Inativa'), false);
  const futuro = await gerarLote(app(), 2026, 8, agora);
  assert.equal(futuro.recusado, 'Mês futuro não é gerado em lote.');
  const maio = await gerarLote(app(), 2026, 5, agora);
  assert.equal(maio.puladas.some((itemPulada) => itemPulada.nome === 'Passado' && itemPulada.motivo === 'dia ainda não chegou'), false);
  assert.equal(maio.geradas >= 1, true);
  const manualInativa = await gerarCobranca(app(), inativa.id, 2026, 5, 'manual', agora);
  assert.equal(manualInativa.ok, true);

  const semDocumento = await criarPessoa(app(), { nome: 'Sem CPF', whatsapp: '11922223333', email: 'semcpf@example.com', diaCobranca: 1 });
  const comDocumento = await criarPessoa(app(), {
    nome: 'Com CPF',
    whatsapp: '11922224444',
    email: 'comcpf@example.com',
    cpf: '529.982.247-25',
    diaCobranca: 1,
  });
  if (!semDocumento.ok || !comDocumento.ok) throw new Error('cpf');
  await salvarItem(app(), semDocumento.id, null, { descricao: 'Avulso', valorCentavos: 2_000, inicioAno: 2026, inicioMes: 6, fimAno: 2026, fimMes: 6 });
  await salvarItem(app(), comDocumento.id, null, { descricao: 'Avulso', valorCentavos: 2_000, inicioAno: 2026, inicioMes: 6, fimAno: 2026, fimMes: 6 });
  mp.criacoes = [];
  await gerarCobranca(app(), semDocumento.id, 2026, 6, 'manual', agora);
  await gerarCobranca(app(), comDocumento.id, 2026, 6, 'manual', agora);
  assert.equal(mp.criacoes.find((entrada) => entrada.payerEmail === 'semcpf@example.com')?.payerCpf, null);
  assert.equal(mp.criacoes.find((entrada) => entrada.payerEmail === 'comcpf@example.com')?.payerCpf, '52998224725');
});

test('troca de dia, canal com falha e padrão da pessoa nova', async () => {
  const criada = await criarPessoa(app(), { nome: 'Nova', whatsapp: '11988887777', email: 'nova@example.com', diaCobranca: 8 });
  if (!criada.ok) throw new Error(criada.aviso);
  const pessoa = await obterPessoa(app(), criada.id);
  assert.equal(pessoa?.validade_pix_dias, 10);
  assert.equal(pessoa?.dias_aviso_inadimplencia, 5);
  assert.equal(pessoa?.canal_email, true);
  assert.equal(pessoa?.canal_whatsapp, true);
  assert.equal(pessoa?.ativa, true);

  fixar(sp(2026, 6, 10, 10));
  const trocada = await atualizarPessoa(app(), criada.id, {
    nome: 'Nova',
    whatsapp: '11988887777',
    email: 'nova@example.com',
    diaCobranca: 7,
    canalEmail: true,
    canalWhatsapp: true,
  }, agora);
  assert.equal(trocada.ok, true);
  if (trocada.ok) assert.match(trocada.avisos.join(' '), /não será gerado automaticamente/);
  assert.equal((await obterPessoa(app(), criada.id))?.dia_cobranca, 7);
  await salvarItem(app(), criada.id, null, { descricao: 'Mensal', valorCentavos: 3_000, inicioAno: 2026, inicioMes: 6, fimAno: 2026, fimMes: 7 });
  fixar(sp(2026, 6, 10));
  await executarJobDiario(app(), agora);
  assert.equal((await cobrancasDe(criada.id)).length, 0);
  fixar(sp(2026, 7, 7));
  await executarJobDiario(app(), agora);
  assert.equal((await cobrancasDe(criada.id)).length, 1);

  const comCobranca = await criarPessoa(app(), { nome: 'Dia Pendente', whatsapp: '11988886666', email: 'pendente@example.com', diaCobranca: 15 });
  if (!comCobranca.ok) throw new Error(comCobranca.aviso);
  await salvarItem(app(), comCobranca.id, null, { descricao: 'Mensal', valorCentavos: 3_000, inicioAno: 2026, inicioMes: 6, fimAno: 2026, fimMes: 7 });
  fixar(sp(2026, 6, 10, 10));
  assert.equal((await gerarCobranca(app(), comCobranca.id, 2026, 6, 'manual', agora)).ok, true);
  const plano = await atualizarPessoa(app(), comCobranca.id, {
    nome: 'Dia Pendente',
    whatsapp: '11988886666',
    email: 'pendente@example.com',
    diaCobranca: 7,
    canalEmail: true,
    canalWhatsapp: true,
  }, agora);
  assert.equal(plano.ok, true);
  const guardada = await obterPessoa(app(), comCobranca.id);
  assert.equal(guardada?.dia_cobranca, 15);
  assert.equal(guardada?.dia_cobranca_pendente, 7);
  assert.equal(guardada?.dia_pendente_mes, 7);

  correio.falhar = true;
  const canais = await criarPessoa(app(), {
    nome: 'Canais',
    whatsapp: '11955554444',
    email: 'canais@example.com',
    diaCobranca: 1,
    canalEmail: true,
    canalWhatsapp: true,
  });
  if (!canais.ok) throw new Error(canais.aviso);
  await salvarItem(app(), canais.id, null, { descricao: 'Uma', valorCentavos: 4_000, inicioAno: 2026, inicioMes: 6, fimAno: 2026, fimMes: 6 });
  const cobranca = exigir(await gerarCobranca(app(), canais.id, 2026, 6, 'manual', agora));
  const envios = await app().pool.query<{ canal: string; resultado: string }>('SELECT canal, resultado FROM envio WHERE cobranca_id = $1', [cobranca.cobrancaId]);
  assert.equal(envios.rows.find((linha) => linha.canal === 'email')?.resultado, 'falha');
  assert.equal(envios.rows.find((linha) => linha.canal === 'whatsapp')?.resultado, 'enviado');

  const soZap = await criarPessoa(app(), {
    nome: 'Só Zap',
    whatsapp: '11955553333',
    email: 'sozap@example.com',
    diaCobranca: 1,
    canalEmail: false,
    canalWhatsapp: true,
  });
  if (!soZap.ok) throw new Error(soZap.aviso);
  await salvarItem(app(), soZap.id, null, { descricao: 'Uma', valorCentavos: 4_000, inicioAno: 2026, inicioMes: 6, fimAno: 2026, fimMes: 6 });
  const zap = exigir(await gerarCobranca(app(), soZap.id, 2026, 6, 'manual', agora));
  const soWhatsapp = await app().pool.query<{ canal: string }>('SELECT canal FROM envio WHERE cobranca_id = $1', [zap.cobrancaId]);
  assert.deepEqual(soWhatsapp.rows.map((linha) => linha.canal), ['whatsapp']);
});

test('consulta automática de cobranças respeita o intervalo da configuração', async () => {
  const alvo = app();
  await alvo.pool.query(`DELETE FROM agendamento WHERE nome = 'conciliacao'`);
  await alvo.pool.query('UPDATE configuracao SET conciliacao_intervalo_minutos = 0');
  await executarConciliacaoAutomatica(alvo, agora);
  assert.equal((await alvo.pool.query(`SELECT 1 FROM agendamento WHERE nome = 'conciliacao'`)).rowCount, 0);

  await alvo.pool.query('UPDATE configuracao SET conciliacao_intervalo_minutos = 60');
  await executarConciliacaoAutomatica(alvo, agora);
  assert.equal((await alvo.pool.query(`SELECT 1 FROM agendamento WHERE nome = 'conciliacao'`)).rowCount, 1);

  await executarConciliacaoAutomatica(alvo, agora);
  assert.equal((await alvo.pool.query(`SELECT 1 FROM agendamento WHERE nome = 'conciliacao'`)).rowCount, 1);

  const depois = new Date(agora.getTime() + 61 * 60_000);
  await executarConciliacaoAutomatica(alvo, depois);
  const ultima = await alvo.pool.query<{ atualizado_em: Date }>(
    `SELECT atualizado_em FROM agendamento WHERE nome = 'conciliacao'`,
  );
  assert.equal(ultima.rowCount, 1);
  assert.equal(ultima.rows[0]!.atualizado_em.getTime(), depois.getTime());
});

test('banco fora no job não envia mensagem e o minuto falho pode repetir', async () => {
  const fora = poolFora();
  try {
    await assert.rejects(() => executarJobDiario({ ...app(), pool: fora }, agora));
  } finally {
    await fora.end();
  }
  assert.equal(correio.enviados.length, 0);

  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  const alvo = app();
  const queryOriginal = alvo.pool.query.bind(alvo.pool);
  let falhou = false;
  alvo.pool.query = ((...args: Parameters<typeof queryOriginal>) => {
    if (!falhou) {
      falhou = true;
      return Promise.reject(new Error('banco caiu'));
    }
    return queryOriginal(...args);
  }) as typeof alvo.pool.query;
  try {
    await assert.rejects(() => executarAgendado(alvo), /banco caiu/);
  } finally {
    alvo.pool.query = queryOriginal;
  }
  assert.equal((await cobrancasDe(pessoaId)).length, 0);
  const chaveAntes = await app().pool.query(`SELECT ultima_chave FROM agendamento WHERE nome = 'diario'`);
  assert.equal(chaveAntes.rows.length, 0);
  await executarAgendado(alvo);
  assert.equal((await cobrancasDe(pessoaId)).length, 1);
  await executarAgendado(alvo);
  assert.equal((await cobrancasDe(pessoaId)).length, 1);
  const chave = await app().pool.query<{ ultima_chave: string }>(`SELECT ultima_chave FROM agendamento WHERE nome = 'diario'`);
  assert.equal(chave.rows[0]?.ultima_chave, '2026-03-31');
});

test('segunda linha de PIX aprovada depois da baixa manual fica excedente', async () => {
  const pessoaId = await criarAna();
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  const primeiro = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId])).rows[0]!.mp_payment_id;
  mp.aprovar(primeiro, agora);
  await verificarPixAtivos(app(), agora);
  const id = randomUUID();
  mp.pagamentos.set('excesso-2', {
    id: 'excesso-2',
    status: 'approved',
    statusDetail: 'accredited',
    valorCentavos: 115_000,
    dateApproved: sp(2026, 4, 3, 9),
  });
  await app().pool.query(
    `INSERT INTO pix (id, cobranca_id, mp_payment_id, idempotency_key, valor_centavos, validade_dias, vence_em, status_local)
     VALUES ($1, $2, 'excesso-2', $3, 115000, 10, $4, 'pendente')`,
    [id, gerada.cobrancaId, randomUUID(), sp(2026, 4, 20)],
  );
  const pagaEm = (await cobrancasDe(pessoaId))[0]?.paga_em?.toISOString();
  await verificarPixAtivos(app(), sp(2026, 4, 3, 9));
  assert.equal((await cobrancasDe(pessoaId))[0]?.paga_em?.toISOString(), pagaEm);
  const efeito = await app().pool.query(`SELECT efeito FROM evento_pagamento WHERE mp_payment_id = 'excesso-2'`);
  assert.equal(efeito.rows[0]?.efeito, 'excedente');

  await limpar();
  const manualId = await criarAna();
  fixar(sp(2026, 3, 31));
  const manualCobranca = exigir(await gerarCobranca(app(), manualId, 2026, 3, 'manual', agora));
  const pixManual = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [manualCobranca.cobrancaId])).rows[0]!.mp_payment_id;
  const quandoManual = sp(2026, 4, 1, 9);
  assert.equal((await baixaManual(app(), manualCobranca.cobrancaId, 'manter', quandoManual)).ok, true);
  mp.aprovar(pixManual, sp(2026, 4, 2, 9));
  await verificarPixAtivos(app(), sp(2026, 4, 2, 9));
  assert.equal((await cobrancasDe(manualId))[0]?.paga_em?.toISOString(), quandoManual.toISOString());
  const efeitoManual = await app().pool.query<{ efeito: string }>('SELECT efeito FROM evento_pagamento WHERE mp_payment_id = $1', [pixManual]);
  assert.equal(efeitoManual.rows[0]?.efeito, 'excedente');
});

test('consulta das abertas quita o PIX pago e envia a confirmação', async () => {
  const pessoaId = await criarAna();
  fixar(sp(2026, 3, 31));
  const gerada = exigir(await gerarCobranca(app(), pessoaId, 2026, 3, 'manual', agora));
  const pix = (await app().pool.query<{ mp_payment_id: string }>('SELECT mp_payment_id FROM pix WHERE cobranca_id = $1', [gerada.cobrancaId])).rows[0]!;
  const quando = sp(2026, 4, 2, 11);
  mp.aprovar(pix.mp_payment_id, quando);
  correio.enviados.length = 0;
  const resultado = await consultarCobrancasAbertas(app(), quando);
  assert.equal(resultado.consultadas, 1);
  assert.equal(resultado.pagas, 1);
  assert.equal(resultado.confirmacoes, 1);
  assert.equal((await cobrancasDe(pessoaId))[0]?.status, 'paga');
  assert.equal(correio.enviados.some((item) => item.subject.includes('Pagamento recebido')), true);
  const deNovo = await consultarCobrancasAbertas(app(), quando);
  assert.equal(deNovo.consultadas, 0);
  assert.equal(correio.enviados.filter((item) => item.subject.includes('Pagamento recebido')).length, 1);
});
