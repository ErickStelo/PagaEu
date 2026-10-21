import { normalizarTxid } from './pix.ts';

export type PixPendenteConciliacao = {
  pixId: string;
  cobrancaId: string;
  pessoaId: string;
  valorCentavos: number;
  competenciaAno: number;
  competenciaMes: number;
  txid: string | null;
};

export type EntradaPixRecebida = {
  mpPaymentId: string;
  valorCentavos: number;
  txid: string | null;
  aprovadoEm: Date;
};

export type ParConciliado = {
  pendente: PixPendenteConciliacao;
  entrada: EntradaPixRecebida;
  criterio: 'txid' | 'valor';
};

export function casarPixNativos(
  pendentes: PixPendenteConciliacao[],
  entradas: EntradaPixRecebida[],
  competenciaDoPagamento: (data: Date) => { ano: number; mes: number },
): ParConciliado[] {
  const pares: ParConciliado[] = [];
  const usadosPix = new Set<string>();
  const usadosEntrada = new Set<string>();

  const porTxid = new Map<string, PixPendenteConciliacao>();
  for (const pendente of pendentes) {
    const chave = normalizarTxid(pendente.txid);
    if (chave && !porTxid.has(chave)) porTxid.set(chave, pendente);
  }

  for (const entrada of entradas) {
    const chave = normalizarTxid(entrada.txid);
    if (!chave) continue;
    const pendente = porTxid.get(chave);
    if (!pendente || usadosPix.has(pendente.pixId) || usadosEntrada.has(entrada.mpPaymentId)) continue;
    if (pendente.valorCentavos !== entrada.valorCentavos) continue;
    pares.push({ pendente, entrada, criterio: 'txid' });
    usadosPix.add(pendente.pixId);
    usadosEntrada.add(entrada.mpPaymentId);
  }

  for (const entrada of entradas) {
    if (usadosEntrada.has(entrada.mpPaymentId)) continue;
    const { ano, mes } = competenciaDoPagamento(entrada.aprovadoEm);
    const candidatos = pendentes.filter(
      (pendente) =>
        !usadosPix.has(pendente.pixId)
        && pendente.valorCentavos === entrada.valorCentavos
        && pendente.competenciaAno === ano
        && pendente.competenciaMes === mes,
    );
    if (candidatos.length !== 1) continue;
    const pendente = candidatos[0]!;
    pares.push({ pendente, entrada, criterio: 'valor' });
    usadosPix.add(pendente.pixId);
    usadosEntrada.add(entrada.mpPaymentId);
  }

  return pares;
}
