export function formatarCentavos(centavos: number): string {
  const negativo = centavos < 0;
  const absoluto = Math.abs(centavos);
  const reais = Math.trunc(absoluto / 100);
  const fracao = String(absoluto % 100).padStart(2, '0');
  const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${milhar},${fracao}`;
}

export function formatarReais(centavos: number): string {
  return `R$ ${formatarCentavos(centavos)}`;
}

export function centavosParaReais(centavos: number): number {
  const negativo = centavos < 0;
  const absoluto = Math.abs(centavos);
  const texto = `${Math.trunc(absoluto / 100)}.${String(absoluto % 100).padStart(2, '0')}`;
  const valor = Number(texto);
  return negativo ? -valor : valor;
}

export function reaisParaCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function interpretarReais(entrada: string): number | null {
  const limpo = entrada.trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!limpo) return null;
  let normalizado = limpo;
  if (normalizado.includes(',')) {
    normalizado = normalizado.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(normalizado)) {
    normalizado = normalizado.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  const [reais, fracao = ''] = normalizado.split('.');
  const centavos = Number(reais) * 100 + Number(fracao.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos) || centavos < 1 || centavos > 99_999_999) return null;
  return centavos;
}

export function somarCentavos(valores: number[]): number {
  return valores.reduce((total, valor) => total + valor, 0);
}
