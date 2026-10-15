import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { App } from './app.ts';
import { carregarSmtp } from './configuracao.ts';
import { consultar } from './db.ts';
import { confereHash, gerarHash } from './senha.ts';

const OCIOSA_MS = 12 * 60 * 60 * 1000;
const CODIGO_MS = 10 * 60 * 1000;

export type Sessao = {
  id: string;
  csrf: string;
  ultimoUsoEm: Date;
};

export type Flash = {
  tipo: 'ok' | 'erro';
  texto: string;
};

type LinhaSessao = {
  id: string;
  csrf: string;
  ultimo_uso_em: Date;
  flash: string | null;
};

const AVISO_LOGIN = 'Usuário ou senha inválidos.';

export async function entrarComSenha(
  app: App,
  usuario: string,
  senha: string,
  agora = app.clock(),
): Promise<{ ok: true; sessaoId: string } | { ok: true; codigoId: string } | { ok: false; aviso: string }> {
  const linhas = await consultar<{ usuario_painel: string; senha_painel_hash: string; email_dono: string }>(
    app.pool,
    'SELECT usuario_painel, senha_painel_hash, email_dono FROM configuracao WHERE id = 1',
  );
  const config = linhas[0];
  if (!config || config.usuario_painel !== usuario || !(await confereHash(senha, config.senha_painel_hash))) {
    return { ok: false, aviso: AVISO_LOGIN };
  }
  if (app.env.loginCodeDisabled) {
    const sessaoId = await abrirSessao(app, agora);
    return { ok: true, sessaoId };
  }
  const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const id = randomUUID();
  await app.pool.query(`UPDATE codigo_login SET usado_em = $1 WHERE usado_em IS NULL`, [agora]);
  await app.pool.query(
    `INSERT INTO codigo_login (id, codigo_hash, expira_em) VALUES ($1, $2, $3)`,
    [id, await gerarHash(codigo), new Date(agora.getTime() + CODIGO_MS)],
  );
  const smtp = await carregarSmtp(app.pool);
  const envio = await app.correio.enviar(smtp, {
    to: config.email_dono,
    subject: 'Código de acesso do PagaEu',
    text: `Seu código de acesso é ${codigo}. Ele vale por 10 minutos e só pode ser usado uma vez.`,
  });
  if (!envio.ok) {
    return { ok: false, aviso: 'Não foi possível enviar o código por e-mail. Use a chave de emergência no servidor se o SMTP estiver fora.' };
  }
  return { ok: true, codigoId: id };
}

export async function confirmarCodigo(
  app: App,
  codigoId: string,
  codigo: string,
  agora = app.clock(),
): Promise<{ ok: true; sessaoId: string } | { ok: false; aviso: string }> {
  const linhas = await consultar<{ id: string; codigo_hash: string; expira_em: Date; usado_em: Date | null }>(
    app.pool,
    'SELECT id, codigo_hash, expira_em, usado_em FROM codigo_login WHERE id = $1',
    [codigoId],
  );
  const pendente = linhas[0];
  const invalido = { ok: false as const, aviso: 'Código inválido ou vencido.' };
  if (!pendente || pendente.usado_em || agora.getTime() >= pendente.expira_em.getTime()) return invalido;
  if (!(await confereHash(codigo.trim(), pendente.codigo_hash))) return invalido;
  await app.pool.query('UPDATE codigo_login SET usado_em = $1 WHERE id = $2 AND usado_em IS NULL', [agora, codigoId]);
  const sessaoId = await abrirSessao(app, agora);
  return { ok: true, sessaoId };
}

export async function reenviarCodigo(
  app: App,
  codigoId: string,
  agora = app.clock(),
): Promise<{ ok: true; codigoId: string } | { ok: false; aviso: string }> {
  const existe = await app.pool.query('SELECT 1 FROM codigo_login WHERE id = $1', [codigoId]);
  if (!existe.rowCount) return { ok: false, aviso: 'Entre novamente com usuário e senha.' };
  const config = await consultar<{ email_dono: string }>(app.pool, 'SELECT email_dono FROM configuracao WHERE id = 1');
  const email = config[0]?.email_dono;
  if (!email) return { ok: false, aviso: 'E-mail do dono não configurado.' };
  const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const id = randomUUID();
  await app.pool.query('UPDATE codigo_login SET usado_em = $1 WHERE usado_em IS NULL', [agora]);
  await app.pool.query('INSERT INTO codigo_login (id, codigo_hash, expira_em) VALUES ($1, $2, $3)', [
    id,
    await gerarHash(codigo),
    new Date(agora.getTime() + CODIGO_MS),
  ]);
  const envio = await app.correio.enviar(await carregarSmtp(app.pool), {
    to: email,
    subject: 'Código de acesso do PagaEu',
    text: `Seu código de acesso é ${codigo}. Ele vale por 10 minutos e só pode ser usado uma vez.`,
  });
  if (!envio.ok) return { ok: false, aviso: 'Não foi possível reenviar o código.' };
  return { ok: true, codigoId: id };
}

async function abrirSessao(app: App, agora: Date): Promise<string> {
  const id = randomUUID();
  const csrf = randomBytes(24).toString('hex');
  await app.pool.query('INSERT INTO sessao (id, csrf, ultimo_uso_em) VALUES ($1, $2, $3)', [id, csrf, agora]);
  return id;
}

export async function lerSessao(app: App, id: string, agora = app.clock()): Promise<Sessao | null> {
  const linhas = await consultar<LinhaSessao>(app.pool, 'SELECT id, csrf, ultimo_uso_em, flash FROM sessao WHERE id = $1', [id]);
  const sessao = linhas[0];
  if (!sessao) return null;
  if (agora.getTime() - sessao.ultimo_uso_em.getTime() > OCIOSA_MS) {
    await app.pool.query('DELETE FROM sessao WHERE id = $1', [id]);
    return null;
  }
  await app.pool.query('UPDATE sessao SET ultimo_uso_em = $1 WHERE id = $2', [agora, id]);
  return { id: sessao.id, csrf: sessao.csrf, ultimoUsoEm: agora };
}

export async function encerrarSessao(app: App, id: string): Promise<void> {
  await app.pool.query('DELETE FROM sessao WHERE id = $1', [id]);
}

export async function definirFlash(app: App, sessaoId: string, flash: Flash): Promise<void> {
  await app.pool.query('UPDATE sessao SET flash = $1 WHERE id = $2', [JSON.stringify(flash), sessaoId]);
}

export async function pegarFlash(app: App, sessaoId: string): Promise<Flash | null> {
  const linhas = await consultar<{ flash: string | null }>(app.pool, 'SELECT flash FROM sessao WHERE id = $1', [sessaoId]);
  const texto = linhas[0]?.flash;
  if (!texto) return null;
  await app.pool.query('UPDATE sessao SET flash = NULL WHERE id = $1', [sessaoId]);
  try {
    const flash = JSON.parse(texto) as Flash;
    if (flash.tipo !== 'ok' && flash.tipo !== 'erro') return null;
    return flash;
  } catch {
    return null;
  }
}
