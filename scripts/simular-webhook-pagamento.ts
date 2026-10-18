import { createHmac, randomUUID } from 'node:crypto';
import { criarAplicacao } from '../src/app.ts';
import { carregarSegredoWebhook, carregarTokenMp } from '../src/configuracao.ts';
import { gerarNovoPix, invalidarPix } from '../src/cobrancas.ts';
import { montarManifesto } from '../src/domain/assinatura.ts';
import { consultar } from '../src/db.ts';
import { receberWebhook } from '../src/webhook.ts';

const COBRANCA_ID = process.argv[2] ?? '22059daf-c2ec-4ad9-bc89-7c7e70185e1c';
const BASE_URL = process.env.SIMULAR_WEBHOOK_URL ?? 'http://127.0.0.1:3000';

async function aguardarProcessado(token: string, mpId: string, tentativas = 30): Promise<boolean> {
  for (let i = 0; i < tentativas; i += 1) {
    const resposta = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(mpId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const corpo = (await resposta.json()) as { status?: string };
    if (corpo.status === 'processed') return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

const app = await criarAplicacao();
const pessoa = await consultar<{ id: string; nome: string; email: string }>(
  app.pool,
  `SELECT p.id, p.nome, p.email FROM pessoa p
   JOIN cobranca c ON c.pessoa_id = p.id WHERE c.id = $1`,
  [COBRANCA_ID],
);
const alvo = pessoa[0];
if (!alvo) {
  console.error('Cobrança não encontrada.');
  process.exit(1);
}

const nomeAnterior = alvo.nome;
const emailAnterior = alvo.email;
await app.pool.query(`UPDATE pessoa SET nome = 'APRO', email = 'test@testuser.com' WHERE id = $1`, [alvo.id]);

const invalidado = await invalidarPix(app, COBRANCA_ID);
if (!invalidado.ok) {
  console.error('Invalidar PIX:', invalidado.aviso);
  process.exit(1);
}
const emitido = await gerarNovoPix(app, COBRANCA_ID);
if (!emitido.ok) {
  console.error('Novo PIX:', emitido.aviso);
  await app.pool.query(`UPDATE pessoa SET nome = $2, email = $3 WHERE id = $1`, [alvo.id, nomeAnterior, emailAnterior]);
  process.exit(1);
}

const pix = await consultar<{ mp_payment_id: string }>(
  app.pool,
  `SELECT mp_payment_id FROM pix WHERE cobranca_id = $1 AND status_local = 'pendente' ORDER BY criado_em DESC LIMIT 1`,
  [COBRANCA_ID],
);
const mpId = pix[0]?.mp_payment_id;
if (!mpId) {
  console.error('PIX pendente sem id do Mercado Pago.');
  process.exit(1);
}

const token = await carregarTokenMp(app.pool);
if (!token) {
  console.error('Token do Mercado Pago ausente.');
  process.exit(1);
}

console.log(`Aguardando aprovação automática do sandbox (order ${mpId})…`);
const aprovado = await aguardarProcessado(token, mpId);
if (!aprovado) {
  console.error('O Mercado Pago não aprovou a order a tempo. Confira credenciais de teste e payer APRO.');
  await app.pool.query(`UPDATE pessoa SET nome = $2, email = $3 WHERE id = $1`, [alvo.id, nomeAnterior, emailAnterior]);
  process.exit(1);
}

const segredo = await carregarSegredoWebhook(app.pool);
if (!segredo) {
  console.error('Segredo do webhook não configurado no painel.');
  process.exit(1);
}

const ts = String(Math.floor(Date.now() / 1000));
const requestId = `sim-${randomUUID()}`;
const manifesto = montarManifesto({ dataId: mpId, requestId, ts });
const v1 = createHmac('sha256', segredo).update(manifesto).digest('hex');
const corpo = JSON.stringify({ type: 'payment', data: { id: mpId } });
const url = new URL('/webhooks/mercadopago', BASE_URL);

const viaFetch = async (): Promise<number> => {
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': `ts=${ts},v1=${v1}`,
      'x-request-id': requestId,
    },
    body: corpo,
  });
  return resposta.status;
};

let status = await viaFetch();
if (status === 0 || status >= 500) {
  status = await receberWebhook(app, { assinatura: `ts=${ts},v1=${v1}`, requestId }, url, corpo);
}

await app.pool.query(`UPDATE pessoa SET nome = $2, email = $3 WHERE id = $1`, [alvo.id, nomeAnterior, emailAnterior]);

const cobranca = await consultar<{ status: string; paga_em: Date | null }>(
  app.pool,
  'SELECT status, paga_em FROM cobranca WHERE id = $1',
  [COBRANCA_ID],
);
console.log(`Webhook HTTP ${status}`);
console.log(`Cobrança ${COBRANCA_ID}: status=${cobranca[0]?.status}, paga_em=${cobranca[0]?.paga_em?.toISOString() ?? 'null'}`);
await app.pool.end();
process.exit(cobranca[0]?.status === 'paga' ? 0 : 1);
