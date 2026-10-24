import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { acoesDisponiveis, mpPermiteCancelar } from '../src/domain/acoes.ts';
import { mesesDoGrafico, normalizarPeriodo, situacaoCobranca } from '../src/domain/painel.ts';
import { modalResultadoConsultaPagamentos } from '../src/paginas.ts';
import { assinaturaConfere, montarManifesto } from '../src/domain/assinatura.ts';
import {
  chaveDiaria,
  chaveHoraria,
  civilParaUtc,
  diaEfetivo,
  formatarExpiracaoMp,
  somarDias,
} from '../src/domain/calendar.ts';
import { comporLinhas, itemCobreCompetencia, type ItemComposicao, type LinhaRascunho } from '../src/domain/composicao.ts';
import { planejarTrocaDeDia } from '../src/domain/dia.ts';
import { normalizarCpf, normalizarWhatsapp } from '../src/domain/documento.ts';
import { caminhoProibido, nomeEstaticoPermitido } from '../src/caminho.ts';
import { casarPixNativos } from '../src/domain/conciliacao.ts';
import { crc16, gerarPixCopiaECola, txidCobranca } from '../src/domain/pix.ts';
import { lerPagamentoPixRecebido } from '../src/mercadopago.ts';
import { hostRemotoPermitido, urlHttpRemotaPermitida } from '../src/domain/url.ts';
import { formatarCentavos, formatarReais, interpretarReais } from '../src/domain/money.ts';
import { intervaloConciliacaoValido } from '../src/configuracao.ts';
import { lerEnv, segundoFatorAtivo } from '../src/env.ts';
import { CORPO_COBRANCA, DADOS_FICTICIOS, preencherTemplate, validarTemplate } from '../src/domain/template.ts';
import { corpoOrdem } from '../src/mercadopago.ts';

const aluguel: ItemComposicao = {
  id: 'aluguel',
  descricao: 'Aluguel',
  valorCentavos: 100_000,
  inicioAno: 2026,
  inicioMes: 3,
  fimAno: 2026,
  fimMes: 5,
};
const internet: ItemComposicao = {
  id: 'internet',
  descricao: 'Internet',
  valorCentavos: 15_000,
  inicioAno: 2026,
  inicioMes: 3,
  fimAno: 2026,
  fimMes: 3,
};
const agua: ItemComposicao = {
  id: 'agua',
  descricao: 'Água',
  valorCentavos: 8_000,
  inicioAno: 2026,
  inicioMes: 4,
  fimAno: 2026,
  fimMes: 4,
};

function total(linhas: LinhaRascunho[]): number {
  return linhas.reduce((soma, linha) => soma + linha.valorCentavos, 0);
}

test('dinheiro brasileiro e competência', () => {
  assert.equal(formatarCentavos(115_000), '1.150,00');
  assert.equal(formatarReais(323_000), 'R$ 3.230,00');
  assert.equal(interpretarReais('1.150,00'), 115_000);
  assert.equal(interpretarReais('R$ 80,00'), 8_000);
  assert.equal(interpretarReais('0,00'), null);
});

test('dia 31 cai no último dia e 09:00 de São Paulo é 12:00 UTC', () => {
  assert.equal(diaEfetivo(31, 2026, 4), 30);
  assert.equal(diaEfetivo(31, 2026, 2), 28);
  assert.equal(diaEfetivo(31, 2028, 2), 29);
  const marco = civilParaUtc(2026, 3, 31, 9, 0, 0);
  assert.equal(marco.toISOString(), '2026-03-31T12:00:00.000Z');
  const vence = somarDias(marco, 10);
  assert.equal(vence.toISOString(), '2026-04-10T12:00:00.000Z');
  assert.equal(formatarExpiracaoMp(vence), '2026-04-10T09:00:00.000-03:00');
  assert.equal(chaveDiaria(civilParaUtc(2026, 3, 31, 8, 0, 0)), null);
  assert.equal(chaveDiaria(marco), '2026-03-31');
  assert.equal(chaveHoraria(marco), null);
  assert.equal(chaveHoraria(civilParaUtc(2026, 3, 31, 10, 0, 0)), '2026-03-31T10');
});

test('maio da Ana copia só a cobrança anterior e fica em R$ 3.230,00', () => {
  const marco = comporLinhas({
    novaCobrancaId: 'marco',
    ano: 2026,
    mes: 3,
    linhasAnterioresAbertas: null,
    itens: [aluguel, internet, agua],
  });
  assert.equal(total(marco), 115_000);
  const abril = comporLinhas({
    novaCobrancaId: 'abril',
    ano: 2026,
    mes: 4,
    linhasAnterioresAbertas: marco,
    itens: [aluguel, internet, agua],
  });
  assert.equal(total(abril), 223_000);
  const maio = comporLinhas({
    novaCobrancaId: 'maio',
    ano: 2026,
    mes: 5,
    linhasAnterioresAbertas: abril,
    itens: [aluguel, internet, agua],
  });
  assert.equal(total(maio), 323_000);
  assert.equal(maio.length, 5);
  assert.notEqual(115_000 + 223_000 + 100_000, total(maio));
  assert.equal(itemCobreCompetencia(internet, 2026, 4), false);
  assert.equal(itemCobreCompetencia(aluguel, 2026, 3), true);
  assert.equal(itemCobreCompetencia(aluguel, 2026, 6), false);
  const continuo: ItemComposicao = { ...aluguel, id: 'continuo', fimAno: null, fimMes: null };
  assert.equal(itemCobreCompetencia(continuo, 2026, 2), false);
  assert.equal(itemCobreCompetencia(continuo, 2026, 3), true);
  assert.equal(itemCobreCompetencia(continuo, 2027, 1), true);
});

test('troca de dia segue o exemplo de junho', () => {
  const hoje = { year: 2026, month: 6, day: 10, hour: 10, minute: 0, second: 0 };
  const passado = planejarTrocaDeDia({ hoje, diaAtual: 15, diaNovo: 7, temCobrancaAtivaNoMes: false });
  assert.equal(passado.diaCobranca, 7);
  assert.equal(passado.diaPendente, null);
  assert.match(passado.avisos[0] ?? '', /não será gerado automaticamente/);
  const comCobranca = planejarTrocaDeDia({ hoje, diaAtual: 15, diaNovo: 7, temCobrancaAtivaNoMes: true });
  assert.equal(comCobranca.diaCobranca, 15);
  assert.equal(comCobranca.diaPendente, 7);
  assert.equal(comCobranca.pendenteAno, 2026);
  assert.equal(comCobranca.pendenteMes, 7);
  const hojeMesmo = planejarTrocaDeDia({ hoje, diaAtual: 5, diaNovo: 10, temCobrancaAtivaNoMes: false });
  assert.equal(hojeMesmo.diaCobranca, 10);
  assert.match(hojeMesmo.avisos[0] ?? '', /09:00 já passou/);
});

test('período do dashboard, meses do gráfico e situação da cobrança', () => {
  const hoje = { ano: 2026, mes: 10 };
  assert.deepEqual(normalizarPeriodo(null, null, hoje), { inicio: hoje, fim: hoje });
  assert.deepEqual(normalizarPeriodo('2026-12', '2026-02', hoje), { inicio: { ano: 2026, mes: 2 }, fim: { ano: 2026, mes: 12 } });
  assert.deepEqual(normalizarPeriodo('lixo', '2026-13', hoje), { inicio: hoje, fim: hoje });
  const seis = mesesDoGrafico({ inicio: hoje, fim: hoje });
  assert.equal(seis.length, 6);
  assert.deepEqual(seis[0], { ano: 2026, mes: 5 });
  assert.equal(mesesDoGrafico({ inicio: { ano: 2024, mes: 1 }, fim: hoje }).length, 12);
  const agora = new Date('2026-10-20T12:00:00Z');
  const ontem = new Date('2026-10-19T12:00:00Z');
  assert.equal(situacaoCobranca({ status: 'aberta', pixStatus: 'pendente', pixVenceEm: ontem }, agora), 'atrasada');
  assert.equal(situacaoCobranca({ status: 'aberta', pixStatus: 'expirado', pixVenceEm: ontem }, agora), 'atrasada');
  assert.equal(situacaoCobranca({ status: 'aberta', pixStatus: 'cancelado', pixVenceEm: ontem }, agora), 'aberta');
  assert.equal(situacaoCobranca({ status: 'aberta', pixStatus: 'pendente', pixVenceEm: agora }, ontem), 'aberta');
  assert.equal(situacaoCobranca({ status: 'paga', pixStatus: 'aprovado', pixVenceEm: ontem }, agora), 'paga');
  assert.equal(situacaoCobranca({ status: 'cancelada', pixStatus: null, pixVenceEm: null }, agora), null);
});

test('modal da consulta de cobranças resume PIX nativo e gateway', () => {
  const html = modalResultadoConsultaPagamentos({
    consultadas: 2,
    pagas: 3,
    confirmacoes: 1,
    semCanal: 0,
    falhaConfirmacao: 0,
    falhas: [],
    conciliacao: { pendentes: 4, entradasMp: 5, conciliadas: 1, confirmacoes: 1 },
  });
  assert.match(html, /modal-consulta-cobrancas/);
  assert.match(html, /consulta-linha/);
  assert.match(html, /Entradas novas no extrato/);
  assert.match(html, /PIX consultados/);
  assert.match(html, /<strong>3<\/strong>/);
});

test('ações, cancelamento no Mercado Pago e corpo do PIX', () => {
  const vigente = acoesDisponiveis({
    status: 'aberta',
    vigente: true,
    temAtivaPosterior: false,
    temPixAtivo: true,
    ultimoPix: 'pendente',
    quitadaPorCascata: false,
    competenciaPrincipal: true,
  });
  assert.equal(vigente.baixaManual, true);
  assert.equal(vigente.novoPix, false);
  assert.equal(vigente.invalidarPix, true);
  const depois = acoesDisponiveis({
    status: 'aberta',
    vigente: false,
    temAtivaPosterior: true,
    temPixAtivo: false,
    ultimoPix: 'cancelado',
    quitadaPorCascata: false,
    competenciaPrincipal: false,
  });
  assert.equal(depois.baixaManual, false);
  assert.equal(depois.cancelar, false);
  assert.equal(mpPermiteCancelar('pending'), true);
  assert.equal(mpPermiteCancelar('in_process'), true);
  assert.equal(mpPermiteCancelar('authorized'), true);
  assert.equal(mpPermiteCancelar('approved'), false);
  assert.equal(mpPermiteCancelar('cancelled'), false);
  const agora = new Date('2026-04-01T12:00:00.000Z');
  const semCpf = corpoOrdem({
    idempotencyKey: 'k',
    transactionAmount: 11.5,
    description: '03/2026 Ana',
    payerEmail: 'ana@example.com',
    payerFirstName: 'Ana',
    payerCpf: null,
    dateOfExpiration: '2026-04-10T09:00:00.000-03:00',
    notificationUrl: 'https://painel.example/webhooks/mercadopago?source_news=webhooks',
    externalReference: 'cobranca',
  }, agora);
  const payer = semCpf.payer as Record<string, unknown>;
  assert.equal('identification' in payer, false);
  assert.equal(semCpf.type, 'online');
  assert.equal(semCpf.processing_mode, 'automatic');
  assert.equal(semCpf.total_amount, '11.50');
  assert.equal('notification_url' in semCpf, false);
  const pagamento = (semCpf.transactions as { payments: Record<string, unknown>[] }).payments[0]!;
  assert.equal(pagamento.amount, '11.50');
  assert.deepEqual(pagamento.payment_method, { id: 'pix', type: 'bank_transfer' });
  assert.match(String(pagamento.expiration_time), /^P\d+D/);
  const comCpf = corpoOrdem({
    idempotencyKey: 'k',
    transactionAmount: 11.5,
    description: '03/2026 Ana',
    payerEmail: 'ana@example.com',
    payerFirstName: 'Ana',
    payerCpf: '52998224725',
    dateOfExpiration: '2026-04-10T09:00:00.000-03:00',
    notificationUrl: '',
    externalReference: 'cobranca',
  }, agora);
  assert.deepEqual((comCpf.payer as { identification: unknown }).identification, { type: 'CPF', number: '52998224725' });
  assert.equal('notification_url' in comCpf, false);
});

test('conciliação casa TxId e depois valor único no mês', () => {
  const pendentes = [
    {
      pixId: 'a',
      cobrancaId: 'c1',
      pessoaId: 'p1',
      valorCentavos: 115_000,
      competenciaAno: 2026,
      competenciaMes: 3,
      txid: 'ANA032026',
    },
    {
      pixId: 'b',
      cobrancaId: 'c2',
      pessoaId: 'p2',
      valorCentavos: 50_000,
      competenciaAno: 2026,
      competenciaMes: 3,
      txid: 'JOAO032026',
    },
  ];
  const entradas = [
    { mpPaymentId: 'mp-1', valorCentavos: 115_000, txid: 'ANA032026', aprovadoEm: new Date('2026-03-15T12:00:00Z') },
    { mpPaymentId: 'mp-2', valorCentavos: 50_000, txid: null, aprovadoEm: new Date('2026-03-16T12:00:00Z') },
  ];
  const pares = casarPixNativos(pendentes, entradas, () => ({ ano: 2026, mes: 3 }));
  assert.equal(pares.length, 2);
  assert.equal(pares[0]?.criterio, 'txid');
  assert.equal(pares[1]?.criterio, 'valor');
});

test('parser do Mercado Pago ignora PIX não aprovado e não-PIX', () => {
  assert.equal(lerPagamentoPixRecebido({ status: 'pending', payment_method_id: 'pix', transaction_amount: 10 }), null);
  assert.equal(lerPagamentoPixRecebido({ status: 'approved', payment_method_id: 'visa', transaction_amount: 10 }), null);
  const ok = lerPagamentoPixRecebido({
    id: 99,
    status: 'approved',
    payment_method_id: 'pix',
    currency_id: 'BRL',
    transaction_amount: 1150,
    date_approved: '2026-03-15T12:00:00.000Z',
    transaction_details: { transaction_id: 'ANA032026' },
  });
  assert.equal(ok?.valorCentavos, 115_000);
  assert.equal(ok?.txid, 'ANA032026');
});

test('PIX nativo gera BR Code estático válido', () => {
  const exemploBcb =
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(exemploBcb), '1D3D');
  assert.equal(txidCobranca('João da Silva', 2026, 3), 'JOAO032026');
  assert.equal(txidCobranca('Maximiliano-Augusto', 2026, 12).length <= 25, true);

  const payload = gerarPixCopiaECola({
    chave: 'erick@example.com',
    recebedor: 'Erick Vinícius Stelo',
    cidade: 'Passo Fundo',
    valorCentavos: 115_050,
    txid: txidCobranca('Ana', 2026, 3),
  });
  assert.equal(
    payload.slice(0, -4),
    '00020126390014br.gov.bcb.pix0117erick@example.com52040000530398654071150.505802BR5920Erick Vinicius Stelo6011Passo Fundo62130509ANA0320266304',
  );
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
  assert.throws(() => gerarPixCopiaECola({ chave: '', recebedor: 'X', cidade: 'Y', valorCentavos: 100, txid: 'A' }));
  assert.throws(() => gerarPixCopiaECola({ chave: 'k', recebedor: 'X', cidade: 'Y', valorCentavos: 0, txid: 'A' }));
});

test('caminhos sensíveis ficam bloqueados', () => {
  assert.equal(caminhoProibido('/.env'), true);
  assert.equal(caminhoProibido('/estatico/../.env'), true);
  assert.equal(caminhoProibido('/src/app.ts'), true);
  assert.equal(caminhoProibido('/cobrancas'), false);
  assert.equal(nomeEstaticoPermitido('painel.js'), true);
  assert.equal(nomeEstaticoPermitido('../.env'), false);
  assert.equal(nomeEstaticoPermitido('.env'), false);
});

test('host remoto permitido para integrações', () => {
  assert.equal(hostRemotoPermitido('evolution.example'), true);
  assert.equal(hostRemotoPermitido('127.0.0.1'), false);
  assert.equal(hostRemotoPermitido('10.0.0.5'), false);
  assert.equal(hostRemotoPermitido('169.254.169.254'), false);
  assert.equal(urlHttpRemotaPermitida('https://api.example.com'), true);
  assert.equal(urlHttpRemotaPermitida('http://127.0.0.1:8080'), false);
});

test('intervalos de conciliação automática', () => {
  assert.equal(intervaloConciliacaoValido(60), true);
  assert.equal(intervaloConciliacaoValido(0), true);
  assert.equal(intervaloConciliacaoValido(5), false);
});

test('segundo fator liga só com PAGAEU_2FA_ENABLED', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  assert.equal(segundoFatorAtivo(lerEnv(base)), false);
  assert.equal(segundoFatorAtivo(lerEnv({ ...base, PAGAEU_2FA_ENABLED: 'true' })), true);
  assert.equal(segundoFatorAtivo(lerEnv({ ...base, PAGAEU_2FA_ENABLED: 'false' })), false);
  assert.equal(segundoFatorAtivo(lerEnv({ ...base, PAGAEU_2FA_ENABLED: '1' })), true);
  assert.equal(segundoFatorAtivo(lerEnv({ ...base, PAGAEU_2FA_ENABLED: 'sim' })), true);
});

test('documento, template e assinatura do webhook', () => {
  assert.equal(normalizarCpf('529.982.247-25'), '52998224725');
  assert.equal(normalizarCpf('111.111.111-11'), null);
  assert.equal(normalizarWhatsapp('(11) 98888-7777'), '5511988887777');
  assert.equal(validarTemplate('whatsapp', 'cobranca', null, 'Olá {nome}'), null);
  assert.match(validarTemplate('email', 'cobranca', 'Oi', `${CORPO_COBRANCA} {inexistente}`) ?? '', /\{inexistente\}/);
  assert.equal(validarTemplate('whatsapp', 'cobranca', null, CORPO_COBRANCA), null);
  assert.match(preencherTemplate(CORPO_COBRANCA, DADOS_FICTICIOS), /Maria Exemplo/);
  const manifesto = montarManifesto({ dataId: 'ABC', requestId: 'req-1', ts: '1' });
  assert.equal(manifesto, 'id:abc;request-id:req-1;ts:1;');
  const v1 = createHmac('sha256', 'whsec-teste').update(manifesto).digest('hex');
  assert.equal(assinaturaConfere(manifesto, 'whsec-teste', v1), true);
  assert.equal(assinaturaConfere(manifesto, 'whsec-teste', '00'), false);
});
