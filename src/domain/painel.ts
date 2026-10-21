import type { StatusCobranca, StatusPix } from './acoes.ts';

export type Competencia = { ano: number; mes: number };
export type Periodo = { inicio: Competencia; fim: Competencia };
export type SituacaoCobranca = 'aberta' | 'atrasada' | 'paga';

const LIMITE_MESES_GRAFICO = 12;
const MINIMO_MESES_GRAFICO = 6;
const PIX_QUE_VENCE: ReadonlySet<StatusPix> = new Set(['pendente', 'falha_cancelamento', 'expirado']);

export function indiceCompetencia(competencia: Competencia): number {
  return competencia.ano * 12 + (competencia.mes - 1);
}

export function competenciaDoIndice(indice: number): Competencia {
  return { ano: Math.floor(indice / 12), mes: (indice % 12) + 1 };
}

export function lerCompetencia(valor: string | null | undefined): Competencia | null {
  const achado = /^(\d{4})-(\d{2})$/.exec((valor ?? '').trim());
  if (!achado) return null;
  const ano = Number(achado[1]);
  const mes = Number(achado[2]);
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return null;
  return { ano, mes };
}

export function competenciaParaCampo(competencia: Competencia): string {
  return `${competencia.ano}-${String(competencia.mes).padStart(2, '0')}`;
}

export function normalizarPeriodo(de: string | null, ate: string | null, hoje: Competencia): Periodo {
  const inicio = lerCompetencia(de) ?? hoje;
  const fim = lerCompetencia(ate) ?? (lerCompetencia(de) ?? hoje);
  return indiceCompetencia(inicio) <= indiceCompetencia(fim) ? { inicio, fim } : { inicio: fim, fim: inicio };
}

export function mesesDoGrafico(periodo: Periodo): Competencia[] {
  const fim = indiceCompetencia(periodo.fim);
  const extensao = fim - indiceCompetencia(periodo.inicio) + 1;
  const quantidade = Math.min(LIMITE_MESES_GRAFICO, Math.max(MINIMO_MESES_GRAFICO, extensao));
  return Array.from({ length: quantidade }, (_, posicao) => competenciaDoIndice(fim - quantidade + 1 + posicao));
}

export function situacaoCobranca(
  entrada: { status: StatusCobranca; pixStatus: StatusPix | null; pixVenceEm: Date | null },
  agora: Date,
): SituacaoCobranca | null {
  if (entrada.status === 'paga') return 'paga';
  if (entrada.status !== 'aberta') return null;
  const vencido = entrada.pixVenceEm !== null && entrada.pixVenceEm.getTime() < agora.getTime();
  return vencido && entrada.pixStatus !== null && PIX_QUE_VENCE.has(entrada.pixStatus) ? 'atrasada' : 'aberta';
}
