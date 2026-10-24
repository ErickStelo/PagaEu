import { hostRemotoPermitido } from './domain/url.ts';

export type Env = {
  databaseUrl: string;
  publicUrl: string;
  adminUser: string;
  adminPassword: string;
  adminEmail: string;
  twoFactorEnabled: boolean;
  port: number;
};

function flagLigada(valor: string | undefined): boolean {
  const normalizado = (valor ?? '').trim().toLowerCase();
  return normalizado === '1' || normalizado === 'true' || normalizado === 'sim';
}

export function segundoFatorAtivo(env: Env): boolean {
  return env.twoFactorEnabled;
}

function semBarra(valor: string): string {
  return valor.trim().replace(/\/+$/, '');
}

export function lerEnv(origem: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = origem.DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL é obrigatória.');
  const porta = Number(origem.PAGAEU_PORT ?? origem.PORT ?? 3000);
  return {
    databaseUrl,
    publicUrl: semBarra(origem.PAGAEU_PUBLIC_URL ?? ''),
    adminUser: origem.PAGAEU_ADMIN_USER?.trim() ?? '',
    adminPassword: origem.PAGAEU_ADMIN_PASSWORD ?? '',
    adminEmail: origem.PAGAEU_ADMIN_EMAIL?.trim() ?? '',
    twoFactorEnabled: flagLigada(origem.PAGAEU_2FA_ENABLED),
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
