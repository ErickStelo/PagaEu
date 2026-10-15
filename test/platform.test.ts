import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Compose sobe só a aplicação e aponta o banco por variável', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const exemplo = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.equal(/image:\s*postgres/i.test(compose), false);
  assert.equal(compose.includes('POSTGRES_PASSWORD'), false);
  assert.match(compose, /env_file:/);
  assert.match(compose, /external:\s*true/);
  assert.match(compose, /\$\{PAGAEU_DOCKER_NETWORK\}/);
  assert.match(compose, /\$\{PAGAEU_PORT:-3000\}:3000/);
  assert.match(compose, /\/health/);
  assert.match(dockerfile, /node:22/);
  assert.equal(dockerfile.includes('postgres:'), false);
  for (const chave of [
    'DATABASE_URL',
    'EVOLUTION_GO_URL',
    'EVOLUTION_GO_API_KEY',
    'EVOLUTION_GO_INSTANCE',
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
