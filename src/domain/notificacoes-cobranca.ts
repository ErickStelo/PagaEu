import { somarDias } from './calendar.ts';

export type ConfigNotificacoesCobranca = {
  quantidade: number;
  intervaloDias: number;
  aposVencimentoDias: number;
};

/** Instante em que a notificação N (1-based) pode ser enviada. A 1ª é na emissão do PIX. Demais: após vencimento da cobrança. */
export function momentoNotificacaoCobranca(
  indice: number,
  vencimentoCobranca: Date,
  config: ConfigNotificacoesCobranca,
): Date | null {
  if (indice < 1 || indice > config.quantidade) return null;
  if (indice === 1) return null;
  return somarDias(vencimentoCobranca, config.aposVencimentoDias + (indice - 2) * config.intervaloDias);
}

/** Quantas notificações automáticas de cobrança já deveriam ter sido enviadas. */
export function notificacoesCobrancaDevidas(
  agora: Date,
  vencimentoCobranca: Date,
  config: ConfigNotificacoesCobranca,
  pixComCodigo: boolean,
): number {
  if (!pixComCodigo || config.quantidade < 1) return 0;
  let devidas = 1;
  for (let indice = 2; indice <= config.quantidade; indice += 1) {
    const quando = momentoNotificacaoCobranca(indice, vencimentoCobranca, config);
    if (!quando || agora.getTime() < quando.getTime()) break;
    devidas = indice;
  }
  return devidas;
}
