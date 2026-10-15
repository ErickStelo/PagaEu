import { centavosParaReais, reaisParaCentavos } from './domain/money.ts';
import type { EntradaPix, MercadoPagoGateway, PagamentoRemoto } from './gateways.ts';
import { mensagemErro, redigir } from './texto.ts';

const API = 'https://api.mercadopago.com';

export function corpoPagamento(entrada: EntradaPix): Record<string, unknown> {
  const payer: Record<string, unknown> = {
    email: entrada.payerEmail,
    first_name: entrada.payerFirstName,
  };
  if (entrada.payerCpf) {
    payer.identification = { type: 'CPF', number: entrada.payerCpf };
  }
  return {
    transaction_amount: entrada.transactionAmount,
    payment_method_id: 'pix',
    description: entrada.description,
    payer,
    date_of_expiration: entrada.dateOfExpiration,
    notification_url: entrada.notificationUrl,
    external_reference: entrada.externalReference,
  };
}

function lerPagamento(corpo: Record<string, unknown>): PagamentoRemoto | null {
  const id = corpo.id;
  const status = corpo.status;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (typeof status !== 'string') return null;
  const amount = typeof corpo.transaction_amount === 'number' ? corpo.transaction_amount : Number.NaN;
  const aprovado = typeof corpo.date_approved === 'string' ? new Date(corpo.date_approved) : null;
  return {
    id: String(id),
    status,
    statusDetail: typeof corpo.status_detail === 'string' ? corpo.status_detail : null,
    valorCentavos: reaisParaCentavos(amount),
    dateApproved: aprovado && !Number.isNaN(aprovado.getTime()) ? aprovado : null,
  };
}

function motivoResposta(corpo: unknown, token: string): { motivo: string; errorCode: number | null } {
  if (!corpo || typeof corpo !== 'object') return { motivo: 'Resposta inválida do Mercado Pago.', errorCode: null };
  const registro = corpo as { message?: unknown; cause?: { code?: unknown; description?: unknown }[] };
  const causa = registro.cause?.find((item) => typeof item.description === 'string' || typeof item.code === 'number');
  const codigo = typeof causa?.code === 'number' ? causa.code : null;
  const texto = typeof causa?.description === 'string'
    ? causa.description
    : typeof registro.message === 'string'
      ? registro.message
      : 'Falha no Mercado Pago.';
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
        const resposta = await fetch(`${API}/v1/payments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': entrada.idempotencyKey,
          },
          body: JSON.stringify(corpoPagamento(entrada)),
          signal: AbortSignal.timeout(15_000),
        });
        const corpo = await lerJson(resposta);
        if (!resposta.ok || !corpo || typeof corpo !== 'object') {
          return { ok: false, motivo: motivoResposta(corpo, token).motivo };
        }
        const pagamento = lerPagamento(corpo as Record<string, unknown>);
        const transacao = (corpo as { point_of_interaction?: { transaction_data?: { qr_code?: unknown; ticket_url?: unknown } } })
          .point_of_interaction?.transaction_data;
        const qr = typeof transacao?.qr_code === 'string' ? transacao.qr_code : '';
        if (!pagamento || !qr) return { ok: false, motivo: 'O Mercado Pago não devolveu o código PIX.' };
        return {
          ok: true,
          id: pagamento.id,
          status: pagamento.status,
          statusDetail: pagamento.statusDetail,
          qrCode: qr,
          ticketUrl: typeof transacao?.ticket_url === 'string' ? transacao.ticket_url : null,
        };
      } catch (erro) {
        return { ok: false, motivo: redigir(mensagemErro(erro), [token]) };
      }
    },
    async consultar(token, id) {
      try {
        const resposta = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        const corpo = await lerJson(resposta);
        if (!resposta.ok || !corpo || typeof corpo !== 'object') {
          return { ok: false, motivo: motivoResposta(corpo, token).motivo };
        }
        const pagamento = lerPagamento(corpo as Record<string, unknown>);
        if (!pagamento) return { ok: false, motivo: 'Consulta do Mercado Pago sem pagamento.' };
        return { ok: true, pagamento };
      } catch (erro) {
        return { ok: false, motivo: redigir(mensagemErro(erro), [token]) };
      }
    },
    async cancelar(token, id) {
      try {
        const resposta = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'cancelled' }),
          signal: AbortSignal.timeout(15_000),
        });
        const corpo = await lerJson(resposta);
        if (!resposta.ok || !corpo || typeof corpo !== 'object') {
          const falha = motivoResposta(corpo, token);
          return { ok: false, statusCode: resposta.status, errorCode: falha.errorCode, motivo: falha.motivo };
        }
        const pagamento = lerPagamento(corpo as Record<string, unknown>);
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
