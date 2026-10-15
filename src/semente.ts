import type { PoolCliente } from './db.ts';
import { TEMPLATES_PADRAO } from './domain/template.ts';
import type { Env } from './env.ts';
import { gerarHash } from './senha.ts';

export async function semearModelos(pool: PoolCliente): Promise<void> {
  for (const modelo of TEMPLATES_PADRAO) {
    await pool.query(
      `INSERT INTO template (canal, tipo, assunto, corpo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (canal, tipo) DO NOTHING`,
      [modelo.canal, modelo.tipo, modelo.assunto, modelo.corpo],
    );
  }
}

export async function semearAdmin(pool: PoolCliente, env: Env): Promise<void> {
  const existente = await pool.query('SELECT 1 FROM configuracao WHERE id = 1');
  if (existente.rowCount) return;
  if (!env.adminUser || !env.adminPassword || !env.adminEmail) {
    throw new Error('Credenciais iniciais ausentes. Defina PAGAEU_ADMIN_USER, PAGAEU_ADMIN_PASSWORD e PAGAEU_ADMIN_EMAIL.');
  }
  const hash = await gerarHash(env.adminPassword);
  await pool.query(
    `INSERT INTO configuracao (id, usuario_painel, senha_painel_hash, email_dono)
     VALUES (1, $1, $2, $3)`,
    [env.adminUser, hash, env.adminEmail],
  );
}
