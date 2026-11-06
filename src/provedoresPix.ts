import type { App } from './app.ts';
import { carregarPix } from './configuracao.ts';
import type { Consultavel } from './db.ts';
import { gerarPixCopiaECola, txidCobranca } from './domain/pix.ts';
import { mensagemErro } from './texto.ts';

export type EntradaEmissao = {
  chave: string;
  pessoa: { nome: string; email: string; cpf: string | null };
  cobrancaId: string;
  ano: number;
  mes: number;
  total: number;
  vence: Date;
  txid?: string;
};

export type PixEmitido = {
  ok: true;
  mpPaymentId: null;
  mpStatus: null;
  mpStatusDetail: null;
  copiaECola: string;
  ticketUrl: null;
  txid: string;
};

export type ResultadoEmissao = PixEmitido | { ok: false; motivo: string };

/** Emissão sempre local (EMV + chave cadastrada). Mercado Pago não cria cobrança PIX. */
export async function emitirPix(
  _app: App,
  cliente: Consultavel,
  entrada: EntradaEmissao,
): Promise<ResultadoEmissao> {
  const { chave, recebedor, cidade } = await carregarPix(cliente);
  if (!chave) return { ok: false, motivo: 'Chave PIX não configurada em Configuração.' };
  try {
    const txid = entrada.txid ?? txidCobranca(entrada.pessoa.nome, entrada.ano, entrada.mes);
    const copiaECola = gerarPixCopiaECola({
      chave,
      recebedor,
      cidade,
      valorCentavos: entrada.total,
      txid,
    });
    return {
      ok: true,
      mpPaymentId: null,
      mpStatus: null,
      mpStatusDetail: null,
      copiaECola,
      ticketUrl: null,
      txid,
    };
  } catch (erro) {
    return { ok: false, motivo: mensagemErro(erro) };
  }
}
