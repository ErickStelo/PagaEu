import type { App } from './app.ts';
import { carregarPix, carregarTokenMp, type ProvedorPix } from './configuracao.ts';
import type { Consultavel } from './db.ts';
import { formatarCompetencia, formatarExpiracaoMp } from './domain/calendar.ts';
import { centavosParaReais } from './domain/money.ts';
import { gerarPixCopiaECola, txidCobranca } from './domain/pix.ts';
import { urlNotificacaoEnviavel } from './env.ts';
import { mensagemErro, primeiroNome, redigir } from './texto.ts';

export type EntradaEmissao = {
  chave: string;
  pessoa: { nome: string; email: string; cpf: string | null };
  cobrancaId: string;
  ano: number;
  mes: number;
  total: number;
  vence: Date;
};

export type PixEmitido = {
  ok: true;
  mpPaymentId: string | null;
  mpStatus: string | null;
  mpStatusDetail: string | null;
  copiaECola: string;
  ticketUrl: string | null;
  txid: string | null;
};

export type ResultadoEmissao = PixEmitido | { ok: false; motivo: string };

type EmissorPix = (app: App, cliente: Consultavel, entrada: EntradaEmissao) => Promise<ResultadoEmissao>;

const STATUS_MP_ACEITOS = new Set(['pending', 'in_process', 'authorized', 'approved']);

const emitirMercadoPago: EmissorPix = async (app, cliente, entrada) => {
  const token = await carregarTokenMp(cliente);
  if (!token) return { ok: false, motivo: 'Mercado Pago não configurado' };
  if (!app.env.publicUrl) return { ok: false, motivo: 'URL pública não configurada' };
  try {
    const criado = await app.mp.criar(token, {
      idempotencyKey: entrada.chave,
      transactionAmount: centavosParaReais(entrada.total),
      description: `${formatarCompetencia(entrada.ano, entrada.mes)} ${entrada.pessoa.nome}`.slice(0, 200),
      payerEmail: entrada.pessoa.email,
      payerFirstName: primeiroNome(entrada.pessoa.nome),
      payerCpf: entrada.pessoa.cpf,
      dateOfExpiration: formatarExpiracaoMp(entrada.vence),
      notificationUrl: urlNotificacaoEnviavel(app.env.publicUrl),
      externalReference: entrada.cobrancaId,
    });
    if (!criado.ok) return { ok: false, motivo: criado.motivo };
    if (!STATUS_MP_ACEITOS.has(criado.status)) return { ok: false, motivo: `Mercado Pago devolveu status ${criado.status}.` };
    return {
      ok: true,
      mpPaymentId: criado.id,
      mpStatus: criado.status,
      mpStatusDetail: criado.statusDetail,
      copiaECola: criado.qrCode,
      ticketUrl: criado.ticketUrl,
      txid: null,
    };
  } catch (erro) {
    return { ok: false, motivo: redigir(mensagemErro(erro), [token]) };
  }
};

const emitirNativo: EmissorPix = async (_app, cliente, entrada) => {
  const { chave, recebedor, cidade } = await carregarPix(cliente);
  if (!chave) return { ok: false, motivo: 'Chave PIX não configurada em Configuração.' };
  try {
    const txid = txidCobranca(entrada.pessoa.nome, entrada.ano, entrada.mes);
    const copiaECola = gerarPixCopiaECola({
      chave,
      recebedor,
      cidade,
      valorCentavos: entrada.total,
      txid,
    });
    return { ok: true, mpPaymentId: null, mpStatus: null, mpStatusDetail: null, copiaECola, ticketUrl: null, txid };
  } catch (erro) {
    return { ok: false, motivo: mensagemErro(erro) };
  }
};

const emissores: Record<ProvedorPix, EmissorPix> = {
  mercadopago: emitirMercadoPago,
  nativo: emitirNativo,
};

export function emitirPix(app: App, cliente: Consultavel, provedor: ProvedorPix, entrada: EntradaEmissao): Promise<ResultadoEmissao> {
  return emissores[provedor](app, cliente, entrada);
}
