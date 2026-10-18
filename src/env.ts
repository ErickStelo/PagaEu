import { hostRemotoPermitido } from './domain/url.ts';

export type Env = {
  databaseUrl: string;
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
    const parsed = new URL(urlPublica);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!hostRemotoPermitido(parsed.hostname)) return '';
    return urlNotificacao(urlPublica);
  } catch {
    return '';
  }
}
