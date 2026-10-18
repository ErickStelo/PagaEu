function octeto(valor: string): number {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 && numero <= 255 ? numero : Number.NaN;
}

export function hostRemotoPermitido(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '::') return false;
  if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal')) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = octeto(ipv4[1]);
    const b = octeto(ipv4[2]);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }

  if (host.includes(':')) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  }

  return true;
}

export function urlHttpRemotaPermitida(urlTexto: string): boolean {
  try {
    const parsed = new URL(urlTexto);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return hostRemotoPermitido(parsed.hostname);
  } catch {
    return false;
  }
}
