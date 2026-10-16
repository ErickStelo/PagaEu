export type Env = {
  databaseUrl: string;
  evolutionUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
  publicUrl: string;
  adminUser: string;
  adminPassword: string;
  adminEmail: string;
  loginCodeDisabled: boolean;
  port: number;
};

function semBarra(valor: string): string {
  return valor.trim().replace(/\/+$/, '');
}

export function lerEnv(origem: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = origem.DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL é obrigatória.');
  const porta = Number(origem.PAGAEU_PORT ?? origem.PORT ?? 3000);
  const desligado = (origem.PAGAEU_LOGIN_CODE_DISABLED ?? '').trim().toLowerCase();
  return {
    databaseUrl,
    evolutionUrl: semBarra(origem.EVOLUTION_GO_URL ?? ''),
    evolutionApiKey: origem.EVOLUTION_GO_API_KEY ?? '',
    evolutionInstance: origem.EVOLUTION_GO_INSTANCE ?? '',
    publicUrl: semBarra(origem.PAGAEU_PUBLIC_URL ?? ''),
    adminUser: origem.PAGAEU_ADMIN_USER?.trim() ?? '',
    adminPassword: origem.PAGAEU_ADMIN_PASSWORD ?? '',
    adminEmail: origem.PAGAEU_ADMIN_EMAIL?.trim() ?? '',
    loginCodeDisabled: desligado === '1' || desligado === 'true' || desligado === 'sim',
    port: Number.isInteger(porta) && porta > 0 ? porta : 3000,
  };
}

export function urlNotificacao(urlPublica: string): string {
  return `${urlPublica.replace(/\/+$/, '')}/webhooks/mercadopago?source_news=webhooks`;
}

export function urlNotificacaoEnviavel(urlPublica: string): string {
  if (!urlPublica) return '';
  try {
    const host = new URL(urlPublica).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return '';
    return urlNotificacao(urlPublica);
  } catch {
    return '';
  }
}
