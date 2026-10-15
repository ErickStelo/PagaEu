import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { mensagemErro } from './texto.ts';

const { Pool } = pg;
export type PoolCliente = pg.Pool;
export type Cliente = pg.PoolClient;

export type Consultavel = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    texto: string,
    parametros?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

export function criarPool(databaseUrl: string): PoolCliente {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    options: '-c TimeZone=UTC',
  });
  pool.on('error', (erro) => {
    console.error(`Conexão ociosa com o Postgres caiu: ${erro.message}`);
  });
  return pool;
}

export async function esperarBanco(pool: PoolCliente): Promise<void> {
  let espera = 500;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (erro) {
      console.error(`Banco indisponível, nova tentativa em ${espera}ms: ${mensagemErro(erro)}`);
      await new Promise((resolver) => setTimeout(resolver, espera));
      espera = Math.min(espera * 2, 15_000);
    }
  }
}

export async function migrar(pool: PoolCliente): Promise<void> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        aplicada_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    const pasta = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    const arquivos = readdirSync(pasta).filter((nome) => nome.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      const existente = await cliente.query('SELECT 1 FROM schema_migrations WHERE version = $1', [arquivo]);
      if (existente.rowCount) continue;
      const sql = readFileSync(join(pasta, arquivo), 'utf8');
      try {
        await cliente.query(sql);
      } catch (erro) {
        throw new Error(`Migração ${arquivo} falhou: ${mensagemErro(erro)}`);
      }
      await cliente.query('INSERT INTO schema_migrations (version) VALUES ($1)', [arquivo]);
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK');
    } catch (rollback) {
      console.error(`Falha ao desfazer a transação: ${mensagemErro(rollback)}`);
    }
    throw erro;
  } finally {
    cliente.release();
  }
}

export async function consultar<T extends pg.QueryResultRow>(
  cliente: Consultavel,
  texto: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  const resultado = await cliente.query<T>(texto, parametros);
  return resultado.rows;
}

export async function transacao<T>(cliente: Cliente, fn: () => Promise<T>): Promise<T> {
  await cliente.query('BEGIN');
  try {
    const resultado = await fn();
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK');
    } catch (rollback) {
      console.error(`Falha ao desfazer a transação: ${mensagemErro(rollback)}`);
    }
    throw erro;
  }
}

async function soltar(cliente: Cliente, travado: boolean, chave: string): Promise<void> {
  let destruir: Error | undefined;
  if (travado) {
    try {
      await cliente.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [chave]);
    } catch (erro) {
      destruir = erro instanceof Error ? erro : new Error('falha ao soltar trava');
    }
  }
  cliente.release(destruir);
}

export async function comTravaPessoa<T>(pool: PoolCliente, pessoaId: string, fn: (cliente: Cliente) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  const chave = `pessoa:${pessoaId}`;
  let travado = false;
  try {
    await cliente.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [chave]);
    travado = true;
    return await fn(cliente);
  } finally {
    await soltar(cliente, travado, chave);
  }
}

export async function comTravaManutencao<T>(
  pool: PoolCliente,
  fn: (cliente: Cliente) => Promise<T>,
): Promise<T | null> {
  const cliente = await pool.connect();
  const chave = 'pagaeu:manutencao';
  let travado = false;
  try {
    const obtido = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [chave]);
    travado = Boolean(obtido.rows[0]?.ok);
    if (!travado) return null;
    return await fn(cliente);
  } finally {
    await soltar(cliente, travado, chave);
  }
}

export async function bancoSaudavel(pool: PoolCliente): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
