const PREFIXOS_SENSIVEIS = [
  '/src/',
  '/deploy/',
  '/scripts/',
  '/test/',
  '/node_modules/',
  '/.git',
  '/.tools/',
];

export function caminhoProibido(pathname: string): boolean {
  if (!pathname || pathname.includes('\\')) return true;
  let decodificado = pathname;
  try {
    decodificado = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const lower = decodificado.toLowerCase();
  if (lower.includes('..')) return true;
  if (lower === '/.env' || lower.endsWith('/.env') || lower.includes('.env')) return true;
  for (const prefixo of PREFIXOS_SENSIVEIS) {
    if (lower === prefixo.slice(0, -1) || lower.startsWith(prefixo)) return true;
  }
  const partes = decodificado.split('/').filter(Boolean);
  for (const parte of partes) {
    if (parte === '.env' || parte.startsWith('.env.')) return true;
    if (parte.startsWith('.') && parte !== '.well-known') return true;
  }
  return false;
}

export function nomeEstaticoPermitido(nome: string): boolean {
  if (!nome || nome.includes('/') || nome.includes('\\') || nome.includes('..')) return false;
  if (nome.startsWith('.')) return false;
  return true;
}
