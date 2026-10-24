import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { confirmarCodigo, entrarComSenha, lerSessao } from '../src/acesso.ts';
import { lerConfigPublica, preverTemplate, salvarTemplate } from '../src/configuracao.ts';
import { civilParaUtc } from '../src/domain/calendar.ts';
import { CORPO_COBRANCA } from '../src/domain/template.ts';
import { criarPessoa, salvarItem } from '../src/pessoas.ts';
import { app, correio, csrf, encerrar, evolution, fixar, limpar, ouvir, preparar, SessaoHttp } from './suporte.ts';

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
    assert.match(codigo.texto, /Código por e-mail/);
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
  app().env.twoFactorEnabled = false;
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

  app().env.twoFactorEnabled = false;
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
      sessao.pedir('GET', '/quem-deve'),
      sessao.pedir('GET', '/?de=2026-01&ate=2026-03'),
    ]);
    assert.equal(paginas.every((pagina) => pagina.status === 200), true);
    assert.match(paginas[0]!.texto, /<h1>Dashboard<\/h1>/);
    assert.match(paginas[0]!.texto, /Consultar cobranças abertas/);
    assert.match(paginas[0]!.texto, /action="\/lote"/);
    assert.match(paginas[2]!.texto, /formaction="\/templates\/email\/cobranca\/prever"/);
    assert.equal(paginas[2]!.texto.includes('Pré-visualizar um rascunho'), false);
    assert.match(paginas[5]!.texto, /<h1>Quem deve<\/h1>/);
    assert.match(paginas[5]!.texto, /data-filtro-situacao/);
    assert.match(paginas[6]!.texto, /Competências de 01\/2026 a 03\/2026/);
    const configuracao = paginas[3]!.texto;
    for (const segredo of ['mp-token-teste', 'whsec-teste', 'smtp-segredo', 'chave-super-secreta', 'segredo-teste']) {
      assert.equal(configuracao.includes(segredo), false, segredo);
    }
    const hash = await app().pool.query<{ senha_painel_hash: string }>('SELECT senha_painel_hash FROM configuracao WHERE id = 1');
    assert.equal(configuracao.includes(hash.rows[0]!.senha_painel_hash), false);
    assert.match(configuracao, /definido: sim/);
    assert.match(configuracao, /evolution\.example/);
    assert.match(configuracao, /name="conciliacao_intervalo_minutos"/);
    assert.match(configuracao, /Telefone para 2FA/);
    const previa = await sessao.pedir('POST', '/templates/email/cobranca/prever', {
      csrf: csrf(paginas[2]!.texto),
      assunto: 'Cobrança de {competencia}',
      corpo: 'Olá {nome}. Total: R$ {total}',
    });
    assert.equal(previa.status, 200);
    assert.match(previa.texto, /modal-previa-template/);
    assert.match(previa.texto, /Maria Exemplo/);
    assert.match(previa.texto, /Cobrança de 03\/2026/);
    assert.match(previa.texto, /Total: R\$ 1\.150,00/);
    assert.match(previa.texto, /<textarea name="corpo">Olá \{nome\}\. Total: R\$ \{total\}<\/textarea>/);
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
    const itens = await sessao.pedir('GET', `/pessoas/${id}?aba=lancamentos`);
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
    assert.match(avisoAjax.html ?? '', /value="10,00"/);
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
    const lista = await sessao.pedir('GET', `/pessoas/${id}?aba=lancamentos`);
    assert.match(lista.texto, /Aluguel contínuo/);
    assert.match(lista.texto, /Lançamentos recorrentes/);
    assert.match(lista.texto, /03\/2026/);
    assert.match(lista.texto, /—/);
    assert.match(lista.texto, /ficha-tabela-scroll/);
    assert.match(lista.texto, /data-label="Descrição"/);
    assert.match(lista.texto, /data-label="Fim"/);
    assert.match(lista.texto, /overflow-x:auto/);
    const historicoAba = await sessao.pedir('GET', `/pessoas/${id}?aba=historico`);
    assert.match(historicoAba.texto, /Cobranças geradas/);
    assert.match(historicoAba.texto, /ficha-tabela-scroll/);
    assert.match(historicoAba.texto, /Nenhuma cobrança gerada ainda/);
    assert.match(historicoAba.texto, /Pago em/);
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

test('configuração do PIX fica no painel sem exigir senha atual', async () => {
  app().env.twoFactorEnabled = false;
  const servidor = await ouvir();
  try {
    const sessao = new SessaoHttp(servidor.base);
    await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    const tela = await sessao.pedir('GET', '/configuracao');
    assert.match(tela.texto, /<h2>PIX<\/h2>/);
    assert.match(tela.texto, /value="Erick Vinicius Stelo"/);
    assert.match(tela.texto, /value="Passo Fundo"/);
    const base = {
      csrf: csrf(tela.texto),
      usuario: 'dono',
      email_dono: 'dono@example.com',
      smtp_host: 'smtp.example',
      smtp_porta: '587',
      smtp_usuario: 'smtp-user',
      smtp_remetente_nome: 'PagaEu',
      smtp_remetente_email: 'cobranca@example.com',
      smtp_criptografia: 'starttls',
      evolution_url: 'http://evolution.example',
      evolution_instance: 'pagaeu',
      pix_provedor: 'nativo',
      pix_recebedor: 'Erick Vinicius Stelo',
      pix_cidade: 'Passo Fundo',
    };
    const semChave = await sessao.pedir('POST', '/configuracao', { ...base, pix_chave: '' });
    assert.equal(semChave.status, 422);
    assert.match(semChave.texto, /Informe a chave PIX/);
    assert.match(semChave.texto, /class="invalido"[^>]*>Chave PIX/);
    const salvo = await sessao.pedir('POST', '/configuracao', { ...base, pix_chave: 'erick@example.com' });
    assert.equal(salvo.status, 303);
    const trocaSenha = await sessao.pedir('POST', '/configuracao', {
      ...base,
      pix_chave: 'erick@example.com',
      senha_nova: 'outra-senha-forte',
    });
    assert.equal(trocaSenha.status, 422);
    assert.match(trocaSenha.texto, /Informe a senha atual/);
    const gravado = await app().pool.query<{ pix_provedor: string; pix_chave: string }>(
      'SELECT pix_provedor, pix_chave FROM configuracao WHERE id = 1',
    );
    assert.equal(gravado.rows[0]?.pix_provedor, 'nativo');
    assert.equal(gravado.rows[0]?.pix_chave, 'erick@example.com');
  } finally {
    await servidor.fechar();
  }
});

test('robots e cabeçalhos impedem indexação', async () => {
  const servidor = await ouvir();
  try {
    const anônimo = new SessaoHttp(servidor.base);
    const robots = await anônimo.pedir('GET', '/robots.txt');
    assert.equal(robots.status, 200);
    assert.match(robots.texto, /Disallow:\s*\//);
    const login = await anônimo.pedir('GET', '/login');
    assert.equal(login.status, 200);
    assert.match(login.texto, /name="robots" content="noindex/);
    const cabecalhos = await fetch(`${servidor.base}/robots.txt`);
    assert.match((cabecalhos.headers.get('x-robots-tag') ?? '').toLowerCase(), /noindex/);
  } finally {
    await servidor.fechar();
  }
});

const UUID_FALSO = '00000000-0000-4000-8000-000000000000';

const GET_ADMIN = [
  '/',
  '/quem-deve',
  '/cobrancas',
  `/cobrancas/${UUID_FALSO}`,
  '/templates',
  '/configuracao',
  '/pessoas/nova',
  `/pessoas/${UUID_FALSO}`,
  `/pessoas/${UUID_FALSO}/itens`,
  '/admin',
  '/dashboard',
];

const POST_ADMIN = [
  '/lote',
  '/cobrancas/consultar',
  '/pessoas',
  `/pessoas/${UUID_FALSO}`,
  `/pessoas/${UUID_FALSO}/ativa`,
  `/pessoas/${UUID_FALSO}/gerar`,
  `/pessoas/${UUID_FALSO}/itens`,
  `/itens/${UUID_FALSO}`,
  `/itens/${UUID_FALSO}/excluir`,
  `/cobrancas/${UUID_FALSO}/baixa`,
  `/cobrancas/${UUID_FALSO}/reabrir`,
  `/cobrancas/${UUID_FALSO}/cancelar`,
  `/cobrancas/${UUID_FALSO}/novo-pix`,
  `/cobrancas/${UUID_FALSO}/invalidar-pix`,
  `/cobrancas/${UUID_FALSO}/tentar-emissao`,
  `/cobrancas/${UUID_FALSO}/reenviar`,
  '/templates/email/cobranca',
  '/templates/email/cobranca/prever',
  '/templates/email/cobranca/restaurar',
  '/configuracao',
  '/configuracao/evolution',
  '/configuracao/smtp',
];

function recusouAdmin(resposta: { status: number; texto: string; location: string | null }): boolean {
  if (resposta.status === 303) return resposta.location === '/login';
  if (resposta.status === 403) return /Ação recusada/.test(resposta.texto);
  return false;
}

test('rotas do painel recusam acesso sem sessão, cookie forjado e CSRF inválido', async () => {
  const servidor = await ouvir();
  try {
    const anônimo = new SessaoHttp(servidor.base);
    for (const caminho of GET_ADMIN) {
      const resposta = await anônimo.pedir('GET', caminho);
      assert.equal(resposta.status, 303, `GET ${caminho}`);
      assert.equal(resposta.location, '/login', `GET ${caminho}`);
      assert.equal(/Dashboard|Configuração|Quem deve/.test(resposta.texto) && resposta.texto.includes('<aside>'), false, caminho);
    }
    for (const caminho of POST_ADMIN) {
      const resposta = await anônimo.pedir('POST', caminho, { csrf: 'forjado', usuario: 'dono', senha: 'segredo-teste' });
      assert.ok(recusouAdmin(resposta), `POST anônimo ${caminho} → ${resposta.status}`);
    }

    const cookieFalso = new SessaoHttp(servidor.base);
    cookieFalso.cookies.set('pagaeu_sessao', UUID_FALSO);
    for (const caminho of ['/', '/configuracao', '/quem-deve']) {
      const resposta = await cookieFalso.pedir('GET', caminho);
      assert.equal(resposta.status, 303, `cookie UUID ${caminho}`);
      assert.equal(resposta.location, '/login');
    }
    const mutacaoFalsa = await cookieFalso.pedir('POST', '/configuracao', {
      csrf: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      usuario_painel: 'invasor',
    });
    assert.ok(recusouAdmin(mutacaoFalsa), 'POST /configuracao com sessão forjada');

    const sqlCookie = new SessaoHttp(servidor.base);
    sqlCookie.cookies.set('pagaeu_sessao', `' OR 1=1 --`);
    const injetado = await sqlCookie.pedir('GET', '/configuracao');
    assert.equal(injetado.status, 303);
    assert.equal(injetado.location, '/login');

    const etapa2fa = new SessaoHttp(servidor.base);
    const codigo = await etapa2fa.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    assert.equal(codigo.status, 200);
    assert.ok(etapa2fa.cookies.get('pagaeu_codigo'));
    assert.equal(etapa2fa.cookies.get('pagaeu_sessao'), undefined);
    const pulo2fa = await etapa2fa.pedir('GET', '/');
    assert.equal(pulo2fa.status, 303);
    assert.equal(pulo2fa.location, '/login');
    const puloConfig = await etapa2fa.pedir('POST', '/configuracao', { csrf: 'x', usuario_painel: 'invasor' });
    assert.ok(recusouAdmin(puloConfig));

    app().env.twoFactorEnabled = false;
    const autenticado = new SessaoHttp(servidor.base);
    assert.equal((await autenticado.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' })).status, 303);
    const csrfErrado = await autenticado.pedir('POST', '/lote', { csrf: 'token-errado', ano: '2026', mes: '3' });
    assert.equal(csrfErrado.status, 403);
    assert.match(csrfErrado.texto, /Ação recusada/);
    const csrfAusente = await autenticado.pedir('POST', '/configuracao', { usuario_painel: 'invasor' });
    assert.equal(csrfAusente.status, 403);
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

test('login envia código por WhatsApp quando há telefone de 2FA', async () => {
  await app().pool.query(`UPDATE configuracao SET telefone_2fa = '5511999887766' WHERE id = 1`);
  const servidor = await ouvir();
  const sessao = new SessaoHttp(servidor.base);
  try {
    const codigo = await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    assert.equal(codigo.status, 200);
    assert.match(codigo.texto, /Código por WhatsApp/);
    assert.equal(codigo.texto.includes('5511999887766'), false);
    assert.equal(correio.enviados.length, 0);
    const enviado = evolution.enviados.at(-1);
    assert.ok(enviado);
    assert.equal(enviado.number, '5511999887766');
    assert.match(enviado.text, /^Seu código de acesso PagaEu é \d{6}\. Vale 10 minutos e só pode ser usado uma vez\.$/);
    const digitos = enviado.text.match(/\d{6}/)?.[0];
    assert.ok(digitos);
    const painel = await sessao.pedir('POST', '/login/codigo', { codigo: digitos });
    assert.equal(painel.status, 303);
    assert.ok(sessao.cookies.get('pagaeu_sessao'));
  } finally {
    await servidor.fechar();
  }
});

test('login cai no e-mail se o WhatsApp falhar', async () => {
  await app().pool.query(`UPDATE configuracao SET telefone_2fa = '5511999887766' WHERE id = 1`);
  evolution.falhar = true;
  const servidor = await ouvir();
  const sessao = new SessaoHttp(servidor.base);
  try {
    const codigo = await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    assert.equal(codigo.status, 200);
    assert.match(codigo.texto, /Código por e-mail/);
    const enviado = correio.enviados.at(-1);
    assert.ok(enviado);
    const digitos = enviado.text.match(/\d{6}/)?.[0];
    assert.ok(digitos);
    const painel = await sessao.pedir('POST', '/login/codigo', { codigo: digitos });
    assert.equal(painel.status, 303);
  } finally {
    await servidor.fechar();
  }
});

test('login abre sessão direto com 2FA desligado no env', async () => {
  app().env.twoFactorEnabled = false;
  const servidor = await ouvir();
  const sessao = new SessaoHttp(servidor.base);
  try {
    const painel = await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    assert.equal(painel.status, 303);
    assert.ok(sessao.cookies.get('pagaeu_sessao'));
    assert.equal(sessao.cookies.get('pagaeu_codigo'), undefined);
  } finally {
    await servidor.fechar();
  }
});

test('configuração grava telefone de 2FA e recusa número inválido', async () => {
  app().env.twoFactorEnabled = false;
  const servidor = await ouvir();
  const sessao = new SessaoHttp(servidor.base);
  try {
    await sessao.pedir('POST', '/login', { usuario: 'dono', senha: 'segredo-teste' });
    const pagina = await sessao.pedir('GET', '/configuracao');
    const base = {
      csrf: csrf(pagina.texto),
      usuario: 'dono',
      email_dono: 'dono@example.com',
      smtp_host: 'smtp.example',
      smtp_porta: '587',
      smtp_usuario: 'smtp-user',
      smtp_remetente_nome: 'PagaEu',
      smtp_remetente_email: 'cobranca@example.com',
      smtp_criptografia: 'starttls',
      evolution_url: 'http://evolution.example',
      evolution_instance: 'pagaeu',
      pix_provedor: 'nativo',
      pix_chave: 'erick@example.com',
      pix_recebedor: 'Erick Vinicius Stelo',
      pix_cidade: 'Passo Fundo',
      conciliacao_intervalo_minutos: '60',
    };
    const invalido = await sessao.pedir('POST', '/configuracao', { ...base, telefone_2fa: 'abc' });
    assert.equal(invalido.status, 422);
    assert.match(invalido.texto, /Telefone para 2FA inválido/);
    assert.match(invalido.texto, /class="invalido"[^>]*>Telefone para 2FA/);
    const salvo = await sessao.pedir('POST', '/configuracao', { ...base, telefone_2fa: '11988887777' });
    assert.equal(salvo.status, 303);
    const config = await lerConfigPublica(app());
    assert.equal(config.telefone2fa, '5511988887777');
    const recarregada = await sessao.pedir('GET', '/configuracao');
    assert.match(recarregada.texto, /value="5511988887777"/);
  } finally {
    await servidor.fechar();
  }
});

test('reenvio de código do login espera 5 minutos entre envios', async () => {
  const { reiniciarLimites, registrarEnvioCodigoLogin, aguardarReenvioCodigoMs, podeReenviarCodigo } = await import(
    '../src/limites.ts',
  );
  reiniciarLimites();
  const t0 = 1_000_000;
  registrarEnvioCodigoLogin('ip-teste', t0);
  assert.equal(podeReenviarCodigo('ip-teste', t0 + 1), false);
  assert.equal(aguardarReenvioCodigoMs('ip-teste', t0 + 60_000), 4 * 60_000);
  assert.equal(podeReenviarCodigo('ip-teste', t0 + 5 * 60_000), true);
});
