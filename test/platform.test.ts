import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function lerCompose(nome: string): Promise<string> {
  return readFile(new URL(`../${nome}`, import.meta.url), 'utf8');
}

function assertComposeBase(compose: string): void {
  assert.equal(/image:\s*postgres/i.test(compose), false);
  assert.equal(compose.includes('POSTGRES_PASSWORD'), false);
  assert.match(compose, /env_file:/);
  assert.match(compose, /external:\s*true/);
  assert.match(compose, /\$\{PAGAEU_DOCKER_NETWORK/);
  assert.match(compose, /\$\{PAGAEU_PORT/);
  assert.match(compose, /\/health/);
}

test('Compose dev e prod sobem só a aplicação e apontam o banco por variável', async () => {
  const dev = await lerCompose('docker-compose.dev.yml');
  const prod = await lerCompose('docker-compose.prod.yml');
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const exemplo = await readFile(new URL('../.env.example', import.meta.url), 'utf8');

  assertComposeBase(dev);
  assertComposeBase(prod);
  assert.match(dev, /mailpit_default/);
  assert.equal(prod.includes('mailpit'), false);
  assert.match(prod, /restart:\s*always/);

  assert.match(dockerfile, /node:22/);
  assert.equal(dockerfile.includes('postgres:'), false);
  for (const chave of [
    'DATABASE_URL',
    'PAGAEU_PUBLIC_URL',
    'PAGAEU_ADMIN_USER',
    'PAGAEU_ADMIN_PASSWORD',
    'PAGAEU_ADMIN_EMAIL',
    'PAGAEU_LOGIN_CODE_DISABLED',
  ]) {
    assert.match(exemplo, new RegExp(`^${chave}=`, 'm'));
  }
  assert.equal(exemplo.includes('mp-token'), false);
  assert.equal(exemplo.includes('whsec'), false);
});
