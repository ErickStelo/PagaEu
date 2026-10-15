import { createHmac, timingSafeEqual } from 'node:crypto';

export function montarManifesto(entrada: {
  dataId?: string | null;
  requestId?: string | null;
  ts: string;
}): string {
  const partes: string[] = [];
  if (entrada.dataId) {
    const id = /[a-z]/i.test(entrada.dataId) ? entrada.dataId.toLowerCase() : entrada.dataId;
    partes.push(`id:${id}`);
  }
  if (entrada.requestId) partes.push(`request-id:${entrada.requestId}`);
  partes.push(`ts:${entrada.ts}`);
  return `${partes.join(';')};`;
}

export function lerAssinatura(cabecalho: string | undefined): { ts: string; v1: string } | null {
  if (!cabecalho) return null;
  let ts = '';
  let v1 = '';
  for (const parte of cabecalho.split(',')) {
    const divisor = parte.indexOf('=');
    if (divisor < 0) continue;
    const chave = parte.slice(0, divisor).trim();
    const valor = parte.slice(divisor + 1).trim();
    if (chave === 'ts') ts = valor;
    if (chave === 'v1') v1 = valor;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

export function assinaturaConfere(manifesto: string, segredo: string, v1: string): boolean {
  const calculada = createHmac('sha256', segredo).update(manifesto).digest('hex');
  const esquerda = Buffer.from(calculada.toLowerCase());
  const direita = Buffer.from(v1.toLowerCase());
  if (esquerda.length !== direita.length) return false;
  return timingSafeEqual(esquerda, direita);
}
