import { criarCorreio } from './correio.ts';
import { criarPool, esperarBanco, migrar, type PoolCliente } from './db.ts';
import { lerEnv, type Env } from './env.ts';
import { criarEvolution } from './evolution.ts';
import type { CorreioGateway, EvolutionGateway, MercadoPagoGateway } from './gateways.ts';
import { criarMercadoPago } from './mercadopago.ts';
import { importarEvolutionLegado, carregarEvolution } from './configuracao.ts';
import { semearAdmin, semearModelos } from './semente.ts';

export type App = {
  pool: PoolCliente;
  env: Env;
  clock: () => Date;
  mp: MercadoPagoGateway;
  evolution: EvolutionGateway;
  correio: CorreioGateway;
};

export async function criarAplicacao(opcoes: {
  env?: Env;
  pool?: PoolCliente;
  clock?: () => Date;
  mp?: MercadoPagoGateway;
  evolution?: EvolutionGateway;
  correio?: CorreioGateway;
} = {}): Promise<App> {
  const env = opcoes.env ?? lerEnv();
  const pool = opcoes.pool ?? criarPool(env.databaseUrl);
  await esperarBanco(pool);
  await migrar(pool);
  await importarEvolutionLegado(pool, {
    url: (process.env.EVOLUTION_GO_URL ?? '').trim().replace(/\/+$/, ''),
    apiKey: process.env.EVOLUTION_GO_API_KEY ?? '',
    instance: process.env.EVOLUTION_GO_INSTANCE ?? '',
  });
  const evolution =
    opcoes.evolution ??
    criarEvolution(async () => {
      const cred = await carregarEvolution(pool);
      return cred ?? { url: '', apiKey: '', instance: '' };
    });
  const app: App = {
    pool,
    env,
    clock: opcoes.clock ?? (() => new Date()),
    mp: opcoes.mp ?? criarMercadoPago(),
    evolution,
    correio: opcoes.correio ?? criarCorreio(),
  };
  await semearModelos(pool);
  await semearAdmin(pool, env);
  return app;
}
