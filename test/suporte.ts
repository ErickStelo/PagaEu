import { createServer, type Server } from 'node:http';
import pg from 'pg';
import { criarAplicacao, type App } from '../src/app.ts';
import { criarPool } from '../src/db.ts';
import { reaisParaCentavos } from '../src/domain/money.ts';
import { lerEnv, type Env } from '../src/env.ts';
import type {
  CorreioGateway,
  EntradaPix,
  EvolutionGateway,
  MercadoPagoGateway,
  PagamentoRemoto,
  PixRecebidoMp,
  SmtpConfig,
} from '../src/gateways.ts';
import { criarServidor } from '../src/http.ts';
import { semearAdmin, semearModelos } from '../src/semente.ts';

const urlBanco = process.env.DATABASE_URL_TESTE ?? 'postgres://pagaeu:pagaeu@127.0.0.1:5432/pagaeu_test';

export class MercadoPagoFalso implements MercadoPagoGateway {
  pagamentos = new Map<string, PagamentoRemoto>();
  criacoes: EntradaPix[] = [];
  cancelamentos: string[] = [];
  proximo = 1;
  falharCriacao = false;
  lancarNaCriacao = false;
  modoCancelamento: 'ok' | 'falha' | '2018' = 'ok';
  entradasPix: PixRecebidoMp[] = [];
  falharBuscaPix = false;

  reset(): void {
    this.pagamentos.clear();
    this.criacoes = [];
    this.cancelamentos = [];
    this.proximo = 1;
    this.falharCriacao = false;
    this.lancarNaCriacao = false;
    this.modoCancelamento = 'ok';
    this.entradasPix = [];
    this.falharBuscaPix = false;
  }

  async criar(_token: string, entrada: EntradaPix) {
    this.criacoes.push(entrada);
    if (this.lancarNaCriacao) throw new Error('rede');
    if (this.falharCriacao) return { ok: false as const, motivo: 'recusado pelo banco' };
    const id = String(this.proximo++);
    const pagamento: PagamentoRemoto = {
      id,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      valorCentavos: reaisParaCentavos(entrada.transactionAmount),
      dateApproved: null,
    };
    this.pagamentos.set(id, pagamento);
    return {
      ok: true as const,
      id,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      qrCode: `pix-${id}`,
      ticketUrl: null,
    };
  }

  async consultar(_token: string, id: string) {
    const pagamento = this.pagamentos.get(id);
    if (!pagamento) return { ok: false as const, motivo: 'não encontrado' };
    return { ok: true as const, pagamento };
  }

  async buscarPixRecebidos(_token: string, inicio: Date, fim: Date) {
    if (this.falharBuscaPix) return { ok: false as const, motivo: 'busca indisponível' };
    const entradas = this.entradasPix.filter((item) => item.dateApproved >= inicio && item.dateApproved <= fim);
    return { ok: true as const, entradas };
  }

  async cancelar(_token: string, id: string) {
    this.cancelamentos.push(id);
    const pagamento = this.pagamentos.get(id);
    if (!pagamento) return { ok: false as const, statusCode: 404, errorCode: null, motivo: 'não encontrado' };
    if (this.modoCancelamento === '2018') return { ok: false as const, statusCode: 400, errorCode: 2018, motivo: 'não cancelável' };
    if (this.modoCancelamento === 'falha') return { ok: false as const, statusCode: 500, errorCode: null, motivo: 'indisponível' };
    pagamento.status = 'cancelled';
    pagamento.statusDetail = 'by_collector';
    return { ok: true as const, status: 'cancelled', statusDetail: 'by_collector' };
  }

  aprovar(id: string, quando: Date, valorCentavos?: number): void {
    const pagamento = this.pagamentos.get(id);
    if (!pagamento) throw new Error(`PIX ${id} inexistente`);
    pagamento.status = 'approved';
    pagamento.statusDetail = 'accredited';
    pagamento.dateApproved = quando;
    if (valorCentavos !== undefined) pagamento.valorCentavos = valorCentavos;
  }

  expirar(id: string): void {
    const pagamento = this.pagamentos.get(id);
    if (!pagamento) throw new Error(`PIX ${id} inexistente`);
    pagamento.status = 'cancelled';
    pagamento.statusDetail = 'expired';
  }

  definirStatus(id: string, status: string): void {
    const pagamento = this.pagamentos.get(id);
    if (!pagamento) throw new Error(`PIX ${id} inexistente`);
    pagamento.status = status;
    pagamento.statusDetail = status;
  }
}

export class CorreioFalso implements CorreioGateway {
  enviados: { to: string; subject: string; text: string }[] = [];
  falhar = false;

  reset(): void {
    this.enviados = [];
    this.falhar = false;
  }

  async enviar(config: SmtpConfig | null, mensagem: { to: string; subject: string; text: string }) {
    if (!config) return { ok: false as const, motivo: 'SMTP não configurado' };
    if (this.falhar) return { ok: false as const, motivo: 'caixa cheia' };
    this.enviados.push(mensagem);
    return { ok: true as const };
  }
}

export class EvolutionFalsa implements EvolutionGateway {
  enviados: { number: string; text: string }[] = [];
  falhar = false;

  reset(): void {
    this.enviados = [];
    this.falhar = false;
  }

  async enviarTexto(number: string, text: string) {
    if (this.falhar) return { ok: false as const, motivo: 'desconectado' };
    this.enviados.push({ number, text });
    return { ok: true as const };
  }

  async testarConexao() {
    return { ok: true, motivo: 'Instância encontrada.' };
  }
}

export const mp = new MercadoPagoFalso();
export const correio = new CorreioFalso();
export const evolution = new EvolutionFalsa();
export let agora = new Date('2026-03-31T12:00:00.000Z');

export function fixar(data: Date): void {
  agora = data;
}

let aplicacao: App | null = null;
let encerrado = false;

export function ambienteTeste(): Env {
  if (!urlBanco.includes('pagaeu_test')) throw new Error('Os testes só podem usar o banco pagaeu_test.');
  return lerEnv({
    DATABASE_URL: urlBanco,
    PAGAEU_ADMIN_USER: 'dono',
    PAGAEU_ADMIN_PASSWORD: 'segredo-teste',
    PAGAEU_ADMIN_EMAIL: 'dono@example.com',
    PAGAEU_PUBLIC_URL: 'https://painel.example',
    PAGAEU_2FA_ENABLED: 'true',
  });
}

export async function preparar(): Promise<App> {
  if (aplicacao) return aplicacao;
  aplicacao = await criarAplicacao({
    env: ambienteTeste(),
    mp,
    correio,
    evolution,
    clock: () => agora,
  });
  return aplicacao;
}

export function app(): App {
  if (!aplicacao) throw new Error('Aplicação de teste ainda não foi preparada.');
  return aplicacao;
}

export async function limpar(): Promise<void> {
  const atual = app();
  const { reiniciarLimites } = await import('../src/limites.ts');
  reiniciarLimites();
  await atual.pool.query(`TRUNCATE TABLE
    evento_pagamento, envio, pix, linha_cobranca, cobranca, item, codigo_login, sessao, agendamento, pessoa, template, configuracao
    RESTART IDENTITY CASCADE`);
  await semearModelos(atual.pool);
  await semearAdmin(atual.pool, atual.env);
  await atual.pool.query(
    `UPDATE configuracao SET
      mp_access_token = 'mp-token-teste',
      mp_webhook_secret = 'whsec-teste',
      smtp_host = 'smtp.example',
      smtp_porta = 587,
      smtp_usuario = 'smtp-user',
      smtp_senha = 'smtp-segredo',
      smtp_remetente_nome = 'PagaEu',
      smtp_remetente_email = 'cobranca@example.com',
      smtp_criptografia = 'starttls',
      evolution_url = 'http://evolution.example',
      evolution_instance = 'pagaeu',
      evolution_api_key = 'chave-super-secreta'
     WHERE id = 1`,
  );
  mp.reset();
  correio.reset();
  evolution.reset();
  atual.env.twoFactorEnabled = true;
}

export async function usarPixNativo(chave: string | null): Promise<void> {
  await app().pool.query(`UPDATE configuracao SET pix_provedor = 'nativo', pix_chave = $1 WHERE id = 1`, [chave]);
}

export async function encerrar(): Promise<void> {
  if (encerrado || !aplicacao) return;
  encerrado = true;
  await aplicacao.pool.end();
}

export async function totalCentavos(cobrancaId: string): Promise<number> {
  const resultado = await app().pool.query<{ total: string }>(
    'SELECT COALESCE(SUM(valor_centavos), 0)::text AS total FROM linha_cobranca WHERE cobranca_id = $1',
    [cobrancaId],
  );
  return Number(resultado.rows[0]?.total ?? 0);
}

export async function ouvir(): Promise<{ base: string; fechar: () => Promise<void> }> {
  const servidor: Server = criarServidor(app());
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === 'string') throw new Error('Sem porta.');
  return {
    base: `http://127.0.0.1:${endereco.port}`,
    fechar: () => new Promise((resolve, reject) => servidor.close((erro) => (erro ? reject(erro) : resolve()))),
  };
}

export class SessaoHttp {
  cookies = new Map<string, string>();
  private base: string;

  constructor(base: string) {
    this.base = base;
  }

  async pedir(
    metodo: string,
    caminho: string,
    formulario?: Record<string, string>,
    extras?: Record<string, string>,
  ): Promise<{ status: number; texto: string; location: string | null }> {
    const headers: Record<string, string> = { ...extras };
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([nome, valor]) => `${nome}=${encodeURIComponent(valor)}`).join('; ');
    }
    let body: string | undefined;
    if (formulario) {
      body = new URLSearchParams(formulario).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    const resposta = await fetch(`${this.base}${caminho}`, { method: metodo, headers, body, redirect: 'manual' });
    for (const cookie of resposta.headers.getSetCookie()) {
      const [par] = cookie.split(';');
      if (!par) continue;
      const divisor = par.indexOf('=');
      const nome = par.slice(0, divisor).trim();
      const valor = decodeURIComponent(par.slice(divisor + 1).trim());
      if (/Max-Age=0/i.test(cookie)) this.cookies.delete(nome);
      else this.cookies.set(nome, valor);
    }
    return { status: resposta.status, texto: await resposta.text(), location: resposta.headers.get('location') };
  }
}

export function csrf(html: string): string {
  const achado = html.match(/name="csrf" value="([^"]+)"/);
  if (!achado?.[1]) throw new Error('Token CSRF ausente.');
  return achado[1];
}

export function poolFora(): pg.Pool {
  const pool = new pg.Pool({
    connectionString: 'postgres://pagaeu:pagaeu@127.0.0.1:1/pagaeu_test',
    connectionTimeoutMillis: 400,
    max: 1,
  });
  pool.on('error', () => undefined);
  return pool;
}

export { criarPool };
