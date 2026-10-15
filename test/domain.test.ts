import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { acoesDisponiveis, mpPermiteCancelar } from '../src/domain/acoes.ts';
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
import { formatarCentavos, formatarReais, interpretarReais } from '../src/domain/money.ts';
import { CORPO_COBRANCA, DADOS_FICTICIOS, preencherTemplate, validarTemplate } from '../src/domain/template.ts';
import { urlNotificacao } from '../src/env.ts';
import { corpoPagamento } from '../src/mercadopago.ts';

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

test('ações, cancelamento no Mercado Pago e corpo do PIX', () => {
  const vigente = acoesDisponiveis({
    status: 'aberta',
    vigente: true,
    temAtivaPosterior: false,
    temPixAtivo: true,
    ultimoPix: 'pendente',
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
  });
  assert.equal(depois.baixaManual, false);
  assert.equal(depois.cancelar, false);
  assert.equal(mpPermiteCancelar('pending'), true);
  assert.equal(mpPermiteCancelar('in_process'), true);
  assert.equal(mpPermiteCancelar('authorized'), true);
  assert.equal(mpPermiteCancelar('approved'), false);
  assert.equal(mpPermiteCancelar('cancelled'), false);
  const semCpf = corpoPagamento({
    idempotencyKey: 'k',
    transactionAmount: 11.5,
    description: '03/2026 Ana',
    payerEmail: 'ana@example.com',
    payerFirstName: 'Ana',
    payerCpf: null,
    dateOfExpiration: '2026-04-10T09:00:00.000-03:00',
    notificationUrl: urlNotificacao('https://painel.example'),
    externalReference: 'cobranca',
  });
  const payer = semCpf.payer as Record<string, unknown>;
  assert.equal('identification' in payer, false);
  assert.equal(semCpf.notification_url, 'https://painel.example/webhooks/mercadopago?source_news=webhooks');
  const comCpf = corpoPagamento({
    idempotencyKey: 'k',
    transactionAmount: 11.5,
    description: '03/2026 Ana',
    payerEmail: 'ana@example.com',
    payerFirstName: 'Ana',
    payerCpf: '52998224725',
    dateOfExpiration: '2026-04-10T09:00:00.000-03:00',
    notificationUrl: 'https://painel.example/webhooks/mercadopago?source_news=webhooks',
    externalReference: 'cobranca',
  });
  assert.deepEqual((comCpf.payer as { identification: unknown }).identification, { type: 'CPF', number: '52998224725' });
});

test('documento, template e assinatura do webhook', () => {
  assert.equal(normalizarCpf('529.982.247-25'), '52998224725');
  assert.equal(normalizarCpf('111.111.111-11'), null);
  assert.equal(normalizarWhatsapp('(11) 98888-7777'), '5511988887777');
  assert.equal(validarTemplate('whatsapp', 'cobranca', null, 'Olá {nome}'), 'O template de cobrança precisa de {total} e {copia_e_cola}.');
  assert.match(validarTemplate('email', 'cobranca', 'Oi', `${CORPO_COBRANCA} {inexistente}`) ?? '', /\{inexistente\}/);
  assert.equal(validarTemplate('whatsapp', 'cobranca', null, CORPO_COBRANCA), null);
  assert.match(preencherTemplate(CORPO_COBRANCA, DADOS_FICTICIOS), /Maria Exemplo/);
  const manifesto = montarManifesto({ dataId: 'ABC', requestId: 'req-1', ts: '1' });
  assert.equal(manifesto, 'id:abc;request-id:req-1;ts:1;');
  const v1 = createHmac('sha256', 'whsec-teste').update(manifesto).digest('hex');
  assert.equal(assinaturaConfere(manifesto, 'whsec-teste', v1), true);
  assert.equal(assinaturaConfere(manifesto, 'whsec-teste', '00'), false);
});
