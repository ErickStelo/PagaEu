import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { confirmarCodigo, entrarComSenha, lerSessao } from '../src/acesso.ts';
import { lerConfigPublica, preverTemplate, salvarTemplate } from '../src/configuracao.ts';
import { civilParaUtc } from '../src/domain/calendar.ts';
import { CORPO_COBRANCA } from '../src/domain/template.ts';
import { criarPessoa, salvarItem } from '../src/pessoas.ts';
import { app, correio, csrf, encerrar, fixar, limpar, ouvir, preparar, SessaoHttp } from './suporte.ts';

const inicio = civilParaUtc(2026, 3, 31, 9, 0, 0);

before(async () => {
  await preparar();
});

beforeEach(async () => {
  fixar(inicio);
  await limpar();
});

after(async () => {
  await encerrar();
});

test('login pede código, recusa senha errada e não vaza dado', async () => {
  const servidor = await ouvir();
  try {
    const anônimo = new SessaoHttp(servidor.base);
    const bloqueado = await anônimo.pedir('GET', '/');
    assert.equal(bloqueado.status, 303);
    assert.equal(bloqueado.location, '/login');
    const senha = await anônimo.pedir('POST', '/login', { usuario: 'dono', senha: 'errada' });
    assert.equal(senha.status, 401);
    assert.match(senha.texto, /Usuário ou senha inválidos/);
    assert.equal(senha.texto.includes('Ana'), false);
    assert.equal(senha.texto.includes('segredo-teste'), false);
    const codigo = await anônimo.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    assert.equal(codigo.status, 200);
    assert.match(codigo.texto, /código/i);
    const enviado = correio.enviados.at(-1)?.text ?? '';
    const digitos = enviado.match(/\d{6}/)?.[0];
    assert.ok(digitos);
    const codigoId = anônimo.cookies.get('pagaeu_codigo') ?? '';
    const errado = await anônimo.pedir('POST', '/login/codigo', { codigo: digitos === '000000' ? '000001' : '000000' });
    assert.equal(errado.status, 401);
    const certo = await anônimo.pedir('POST', '/login/codigo', { codigo: digitos });
    assert.equal(certo.status, 303);
    const painel = await anônimo.pedir('GET', '/');
    assert.equal(painel.status, 200);
    assert.match(painel.texto, /Quem deve/);
    const repetido = await confirmarCodigo(app(), codigoId, digitos, inicio);
    assert.equal(repetido.ok, false);
  } finally {
    await servidor.fechar();
  }
});

test('sessão cai só depois de doze horas', async () => {
  app().env.loginCodeDisabled = true;
  const entrada = await entrarComSenha(app(), 'dono', 'segredo-teste', inicio);
  assert.equal(entrada.ok, true);
  if (!entrada.ok || !('sessaoId' in entrada)) throw new Error('sem sessão');
  const doze = new Date(inicio.getTime() + 12 * 60 * 60 * 1000);
  await app().pool.query('UPDATE sessao SET ultimo_uso_em = $1 WHERE id = $2', [inicio, entrada.sessaoId]);
  assert.ok(await lerSessao(app(), entrada.sessaoId, doze));
  await app().pool.query('UPDATE sessao SET ultimo_uso_em = $1 WHERE id = $2', [inicio, entrada.sessaoId]);
  assert.equal(await lerSessao(app(), entrada.sessaoId, new Date(doze.getTime() + 1)), null);

  const servidor = await ouvir();
  try {
    fixar(inicio);
    const sessao = new SessaoHttp(servidor.base);
    assert.equal((await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' })).status, 303);
    const id = sessao.cookies.get('pagaeu_sessao');
    assert.ok(id);
    await app().pool.query('UPDATE sessao SET ultimo_uso_em = $1 WHERE id = $2', [inicio, id]);
    fixar(doze);
    assert.equal((await sessao.pedir('GET', '/')).status, 200);
    await app().pool.query('UPDATE sessao SET ultimo_uso_em = $1 WHERE id = $2', [inicio, id]);
    fixar(new Date(doze.getTime() + 1));
    const expirada = await sessao.pedir('GET', '/');
    assert.equal(expirada.status, 303);
    assert.equal(expirada.location, '/login');
  } finally {
    await servidor.fechar();
  }
});

test('template, segredo e telas do painel', async () => {
  const ruim = await salvarTemplate(app(), 'whatsapp', 'cobranca', null, 'Olá {pessoa_real}');
  assert.equal(ruim.ok, false);
  if (!ruim.ok) assert.match(ruim.aviso, /\{pessoa_real\}/);
  const previo = preverTemplate('whatsapp', 'cobranca', null, CORPO_COBRANCA);
  assert.equal(previo.ok, true);
  if (previo.ok) {
    assert.match(previo.corpo, /Maria Exemplo/);
    assert.equal(previo.corpo.includes('ana@example.com'), false);
  }
  const config = await lerConfigPublica(app());
  assert.equal(config.mpAccessTokenDefinido, true);
  assert.equal(config.evolution.chaveDefinida, true);
  assert.equal(JSON.stringify(config).includes('mp-token-teste'), false);
  assert.equal(JSON.stringify(config).includes('whsec-teste'), false);
  assert.equal(JSON.stringify(config).includes('smtp-segredo'), false);
  assert.equal(JSON.stringify(config).includes('chave-super-secreta'), false);

  app().env.loginCodeDisabled = true;
  const servidor = await ouvir();
  try {
    const sessao = new SessaoHttp(servidor.base);
    await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    const paginas = await Promise.all([
      sessao.pedir('GET', '/'),
      sessao.pedir('GET', '/cobrancas'),
      sessao.pedir('GET', '/templates'),
      sessao.pedir('GET', '/configuracao'),
      sessao.pedir('GET', '/pessoas/nova'),
    ]);
    assert.equal(paginas.every((pagina) => pagina.status === 200), true);
    const configuracao = paginas[3]!.texto;
    for (const segredo of ['mp-token-teste', 'whsec-teste', 'smtp-segredo', 'chave-super-secreta', 'segredo-teste']) {
      assert.equal(configuracao.includes(segredo), false, segredo);
    }
    const hash = await app().pool.query<{ senha_painel_hash: string }>('SELECT senha_painel_hash FROM configuracao WHERE id = 1');
    assert.equal(configuracao.includes(hash.rows[0]!.senha_painel_hash), false);
    assert.match(configuracao, /definido: sim/);
    assert.match(configuracao, /evolution\.example/);
    const token = csrf(paginas[4]!.texto);
    const pessoa = await sessao.pedir('POST', '/pessoas', {
      csrf: token,
      nome: 'Tela',
      whatsapp: '11988887777',
      email: 'tela@example.com',
      dia_cobranca: '31',
      validade_pix_dias: '10',
      dias_aviso_inadimplencia: '5',
      canal_email: '1',
      canal_whatsapp: '1',
    });
    assert.equal(pessoa.status, 303);
    const id = pessoa.location?.split('/').at(-1) ?? '';
    const itens = await sessao.pedir('GET', `/pessoas/${id}/itens`);
    const tokenItem = csrf(itens.texto);
    const invalido = await sessao.pedir('POST', `/pessoas/${id}/itens`, {
      csrf: tokenItem,
      descricao: 'Sem fim',
      valor: '10,00',
      inicio_mes: '3',
      inicio_ano: '2026',
      fim_mes: '2',
      fim_ano: '2026',
    });
    assert.equal(invalido.status, 422);
    assert.match(invalido.texto, /value="Sem fim"/);
    assert.match(invalido.texto, /value="10,00"/);
    assert.match(invalido.texto, /O início não pode ser posterior ao fim/);
    assert.match(paginas[4]!.texto, /toastr\.min\.js/);
    const estatico = await sessao.pedir('GET', '/estatico/painel.js');
    assert.equal(estatico.status, 200);
    assert.match(estatico.texto, /X-PagaEu/);
    const ajax = await sessao.pedir(
      'POST',
      `/pessoas/${id}/itens`,
      {
        csrf: tokenItem,
        descricao: 'Sem fim',
        valor: '10,00',
        inicio_mes: '3',
        inicio_ano: '2026',
        fim_mes: '2',
        fim_ano: '2026',
      },
      { 'x-pagaeu': '1' },
    );
    assert.equal(ajax.status, 422);
    const avisoAjax = JSON.parse(ajax.texto) as { ok: boolean; aviso: string; html?: string };
    assert.equal(avisoAjax.ok, false);
    assert.match(avisoAjax.aviso, /O início não pode ser posterior ao fim/);
    assert.equal(avisoAjax.html, undefined);
    const salvos = await app().pool.query('SELECT id FROM item WHERE pessoa_id = $1', [id]);
    assert.equal(salvos.rows.length, 0);
    const direto = await salvarItem(app(), id, null, {
      descricao: 'Invertido',
      valorCentavos: 1_000,
      inicioAno: 2026,
      inicioMes: 5,
      fimAno: 2026,
      fimMes: 4,
    });
    assert.equal(direto.ok, false);
    const semFim = await sessao.pedir('POST', `/pessoas/${id}/itens`, {
      csrf: tokenItem,
      descricao: 'Aluguel contínuo',
      valor: '10,00',
      inicio_mes: '3',
      inicio_ano: '2026',
      fim_mes: '',
      fim_ano: '',
    });
    assert.equal(semFim.status, 303);
    const lista = await sessao.pedir('GET', `/pessoas/${id}/itens`);
    assert.match(lista.texto, /Aluguel contínuo/);
    assert.match(lista.texto, /03\/2026/);
    assert.match(lista.texto, /—/);
    const gravado = await app().pool.query<{ fim_ano: number | null; fim_mes: number | null }>(
      'SELECT fim_ano, fim_mes FROM item WHERE pessoa_id = $1',
      [id],
    );
    assert.equal(gravado.rows[0]?.fim_ano, null);
    assert.equal(gravado.rows[0]?.fim_mes, null);
    const soMes = await sessao.pedir('POST', `/pessoas/${id}/itens`, {
      csrf: tokenItem,
      descricao: 'Meio período',
      valor: '10,00',
      inicio_mes: '3',
      inicio_ano: '2026',
      fim_mes: '12',
      fim_ano: '',
    });
    assert.equal(soMes.status, 422);
    assert.match(soMes.texto, /Informe o mês e o ano de fim juntos/);
  } finally {
    await servidor.fechar();
  }
});

test('código vencido e SMTP parado não abrem sessão', async () => {
  const entrada = await entrarComSenha(app(), 'dono', 'segredo-teste', inicio);
  assert.equal(entrada.ok, true);
  if (!entrada.ok || !('codigoId' in entrada)) throw new Error('sem código');
  await app().pool.query('UPDATE codigo_login SET expira_em = $1 WHERE id = $2', [new Date(inicio.getTime() - 1), entrada.codigoId]);
  const vencido = await confirmarCodigo(app(), entrada.codigoId, '123456', inicio);
  assert.equal(vencido.ok, false);
  correio.falhar = true;
  const parado = await entrarComSenha(app(), 'dono', 'segredo-teste', inicio);
  assert.equal(parado.ok, false);
  if (!parado.ok) assert.match(parado.aviso, /chave de emergência/);
});

test('saúde responde sem sessão', async () => {
  const servidor = await ouvir();
  try {
    const resposta = await fetch(`${servidor.base}/health`);
    assert.equal(resposta.status, 200);
    assert.equal(await resposta.text(), '{"ok":true}');
  } finally {
    await servidor.fechar();
  }
});

test('arquivos sensíveis não são expostos pelo HTTP', async () => {
  const servidor = await ouvir();
  try {
    const anônimo = new SessaoHttp(servidor.base);
    for (const caminho of [
      '/.env',
      '/.env.local',
      '/estatico/../.env',
      '/estatico/.env',
      '/estatico/secret.js',
      '/src/app.ts',
      '/.git/config',
    ]) {
      const resposta = await anônimo.pedir('GET', caminho);
      assert.equal(resposta.status, 404, caminho);
      assert.equal(resposta.texto.includes('DATABASE'), false, caminho);
    }
    const estatico = await anônimo.pedir('GET', '/estatico/painel.js');
    assert.equal(estatico.status, 200);
  } finally {
    await servidor.fechar();
  }
});

test('pessoa sem dado real não aparece na pré-visualização', async () => {
  const pessoa = await criarPessoa(app(), { nome: 'Cliente Real', whatsapp: '11900001111', email: 'real@example.com', diaCobranca: 3 });
  if (!pessoa.ok) throw new Error(pessoa.aviso);
  const previsto = preverTemplate('email', 'confirmacao', 'Pago {competencia}', 'Olá {nome}. Total: R$ {total}');
  assert.equal(previsto.ok, true);
  if (previsto.ok) assert.equal(previsto.corpo.includes('Cliente Real'), false);
});
