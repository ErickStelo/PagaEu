import { randomUUID } from 'node:crypto';
import { centavosParaReais, reaisParaCentavos } from './domain/money.ts';
import type { EntradaPix, MercadoPagoGateway, PagamentoRemoto } from './gateways.ts';
import { mensagemErro, redigir } from './texto.ts';

const API = 'https://api.mercadopago.com';
const MINIMO_PIX_MS = 30 * 60 * 1000;
const MAXIMO_PIX_MS = 30 * 24 * 60 * 60 * 1000;

export function corpoOrdem(entrada: EntradaPix, agora = new Date()): Record<string, unknown> {
  const valor = centavosParaReais(Math.round(entrada.transactionAmount * 100)).toFixed(2);
  const payer: Record<string, unknown> = {
    email: entrada.payerEmail,
    first_name: entrada.payerFirstName,
  };
  if (entrada.payerCpf) {
    payer.identification = { type: 'CPF', number: entrada.payerCpf };
  }
  const pagamento: Record<string, unknown> = {
    amount: valor,
    payment_method: { id: 'pix', type: 'bank_transfer' },
  };
  const validade = duracaoPix(entrada.dateOfExpiration, agora);
  if (validade) pagamento.expiration_time = validade;
  return {
    type: 'online',
    processing_mode: 'automatic',
    total_amount: valor,
    external_reference: entrada.externalReference,
    description: entrada.description,
    payer,
    transactions: { payments: [pagamento] },
  };
}

export function duracaoPix(expiraEm: string, agora: Date): string | null {
  const ate = new Date(expiraEm);
  if (Number.isNaN(ate.getTime())) return null;
  let ms = ate.getTime() - agora.getTime();
  if (ms < MINIMO_PIX_MS) ms = MINIMO_PIX_MS;
  if (ms > MAXIMO_PIX_MS) ms = MAXIMO_PIX_MS;
  const totalSegundos = Math.floor(ms / 1000);
  const dias = Math.floor(totalSegundos / 86_400);
  const horas = Math.floor((totalSegundos % 86_400) / 3_600);
  const minutos = Math.floor((totalSegundos % 3_600) / 60);
  const segundos = totalSegundos % 60;
  let texto = `P${dias}D`;
  if (horas || minutos || segundos) texto += `T${horas}H${minutos}M${segundos}S`;
  return texto;
}

function statusInterno(status: string, detalhe: string | null): string {
  if (status === 'processed') return 'approved';
  if (status === 'expired' || detalhe === 'expired') return 'expired';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'processing') return 'in_process';
  if (status === 'action_required' || status === 'created') return 'pending';
  if (status === 'failed') return 'rejected';
  return status;
}

function valorDoCampo(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim()) return Number(valor);
  return Number.NaN;
}

function pagamentoDaOrdem(corpo: Record<string, unknown>): Record<string, unknown> | null {
  const transacoes = corpo.transactions;
  if (!transacoes || typeof transacoes !== 'object') return null;
  const lista = (transacoes as { payments?: unknown }).payments;
  const primeiro = Array.isArray(lista) ? lista[0] : null;
  if (!primeiro || typeof primeiro !== 'object') return null;
  return primeiro as Record<string, unknown>;
}

function lerOrdem(corpo: Record<string, unknown>): PagamentoRemoto | null {
  const id = corpo.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const pagamento = pagamentoDaOrdem(corpo);
  const statusBruto = typeof pagamento?.status === 'string'
    ? pagamento.status
    : typeof corpo.status === 'string'
      ? corpo.status
      : null;
  if (!statusBruto) return null;
  const detalheBruto = typeof pagamento?.status_detail === 'string'
    ? pagamento.status_detail
    : typeof corpo.status_detail === 'string'
      ? corpo.status_detail
      : null;
  const status = statusInterno(statusBruto, detalheBruto);
  const amount = valorDoCampo(pagamento?.amount ?? corpo.total_amount);
  const aprovadoEm = corpo.date_approved ?? corpo.last_updated_date;
  const aprovado = status === 'approved' && typeof aprovadoEm === 'string' ? new Date(aprovadoEm) : null;
  return {
    id: String(id),
    status,
    statusDetail: detalheBruto,
    valorCentavos: reaisParaCentavos(amount),
    dateApproved: aprovado && !Number.isNaN(aprovado.getTime()) ? aprovado : null,
  };
}

function codigoPix(corpo: Record<string, unknown>): { qrCode: string; ticketUrl: string | null } | null {
  const pagamento = pagamentoDaOrdem(corpo);
  const metodo = pagamento?.payment_method;
  if (!metodo || typeof metodo !== 'object') return null;
  const qr = (metodo as { qr_code?: unknown }).qr_code;
  if (typeof qr !== 'string' || !qr) return null;
  const ticket = (metodo as { ticket_url?: unknown }).ticket_url;
  return { qrCode: qr, ticketUrl: typeof ticket === 'string' ? ticket : null };
}

function motivoResposta(corpo: unknown, token: string): { motivo: string; errorCode: number | null } {
  if (!corpo || typeof corpo !== 'object') return { motivo: 'Resposta inválida do Mercado Pago.', errorCode: null };
  const registro = corpo as {
    message?: unknown;
    errors?: { code?: unknown; message?: unknown; description?: unknown }[];
    cause?: { code?: unknown; message?: unknown; description?: unknown }[];
  };
  const causas = [...(registro.errors ?? []), ...(registro.cause ?? [])];
  const causa = causas.find((item) => typeof item.code === 'string' || typeof item.code === 'number' || typeof item.description === 'string' || typeof item.message === 'string');
  const codigoBruto = causa?.code;
  const codigo = typeof codigoBruto === 'number' ? codigoBruto : typeof codigoBruto === 'string' && /^\d+$/.test(codigoBruto) ? Number(codigoBruto) : null;
  const codigoTexto = typeof codigoBruto === 'string' ? codigoBruto : '';
  if (codigoTexto === 'invalid_email_for_sandbox') {
    return {
      motivo: 'No sandbox, o e-mail do pagador precisa ser de um usuário de teste (@testuser.com).',
      errorCode: codigo,
    };
  }
  const texto = typeof causa?.description === 'string'
    ? causa.description
    : typeof causa?.message === 'string'
      ? causa.message
      : typeof registro.message === 'string'
        ? registro.message
        : codigoTexto || 'Falha no Mercado Pago.';
  return { motivo: redigir(texto, [token]), errorCode: codigo };
}

async function lerJson(resposta: Response): Promise<unknown> {
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}

export function criarMercadoPago(): MercadoPagoGateway {
  return {
    async criar(token, entrada) {
      try {
        const resposta = await fetch(`${API}/v1/orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': entrada.idempotencyKey,
          },
          body: JSON.stringify(corpoOrdem(entrada)),
          signal: AbortSignal.timeout(15_000),
        });
        const corpo = await lerJson(resposta);
        if (!resposta.ok || !corpo || typeof corpo !== 'object') {
          return { ok: false, motivo: motivoResposta(corpo, token).motivo };
        }
        const ordem = corpo as Record<string, unknown>;
        const pagamento = lerOrdem(ordem);
        const pix = codigoPix(ordem);
        if (!pagamento || !pix) return { ok: false, motivo: 'O Mercado Pago não devolveu o código PIX.' };
        return {
          ok: true,
          id: pagamento.id,
          status: pagamento.status,
          statusDetail: pagamento.statusDetail,
          qrCode: pix.qrCode,
          ticketUrl: pix.ticketUrl,
        };
      } catch (erro) {
        return { ok: false, motivo: redigir(mensagemErro(erro), [token]) };
      }
    },
    async consultar(token, id) {
      try {
        const resposta = await fetch(`${API}/v1/orders/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        const corpo = await lerJson(resposta);
        if (!resposta.ok || !corpo || typeof corpo !== 'object') {
          return { ok: false, motivo: motivoResposta(corpo, token).motivo };
        }
        const pagamento = lerOrdem(corpo as Record<string, unknown>);
        if (!pagamento) return { ok: false, motivo: 'Consulta do Mercado Pago sem pagamento.' };
        return { ok: true, pagamento };
      } catch (erro) {
        return { ok: false, motivo: redigir(mensagemErro(erro), [token]) };
      }
    },
    async cancelar(token, id) {
      try {
        const resposta = await fetch(`${API}/v1/orders/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': randomUUID(),
          },
          body: '{}',
          signal: AbortSignal.timeout(15_000),
        });
        const corpo = await lerJson(resposta);
        if (!resposta.ok || !corpo || typeof corpo !== 'object') {
          const falha = motivoResposta(corpo, token);
          return { ok: false, statusCode: resposta.status, errorCode: falha.errorCode, motivo: falha.motivo };
        }
        const pagamento = lerOrdem(corpo as Record<string, unknown>);
        if (!pagamento || pagamento.status !== 'cancelled') {
          return { ok: false, statusCode: resposta.status, errorCode: null, motivo: 'O Mercado Pago não cancelou o PIX.' };
        }
        return { ok: true, status: pagamento.status, statusDetail: pagamento.statusDetail };
      } catch (erro) {
        return { ok: false, statusCode: 0, errorCode: null, motivo: redigir(mensagemErro(erro), [token]) };
      }
    },
  };
}

export function valorEmReais(centavos: number): number {
  return centavosParaReais(centavos);
}
