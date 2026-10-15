import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { App } from './app.ts';
import {
  confirmarCodigo,
  definirFlash,
  encerrarSessao,
  entrarComSenha,
  lerSessao,
  pegarFlash,
  reenviarCodigo,
  type Flash,
  type Sessao,
} from './acesso.ts';
import { detalharCobranca, listarHistorico, montarPainel } from './consultas.ts';
import {
  baixaManual,
  cancelarCobranca,
  gerarCobranca,
  gerarLote,
  gerarNovoPix,
  invalidarPix,
  tentarEmissao,
  type ResultadoLote,
} from './cobrancas.ts';
import { diaEfetivo, formatarDataHora, partesNoFuso } from './domain/calendar.ts';
import { interpretarReais } from './domain/money.ts';
import type { Canal, TipoMensagem } from './domain/template.ts';
import {
  lerConfigPublica,
  listarTemplates,
  preverTemplate,
  restaurarTemplate,
  salvarConfiguracao,
  salvarTemplate,
  testarEvolution,
} from './configuracao.ts';
import { bancoSaudavel, consultar } from './db.ts';
import { mensagemErro } from './texto.ts';
import {
  criarPessoa,
  definirAtiva,
  excluirItem,
  listarItens,
  listarPessoas,
  obterPessoa,
  salvarItem,
  atualizarPessoa,
} from './pessoas.ts';
import { reenviar } from './mensagens.ts';
import {
  layout,
  paginaConfiguracao,
  paginaDetalhe,
  paginaHistorico,
  paginaItens,
  paginaLogin,
  paginaPessoa,
  paginaQuemDeve,
  paginaTemplates,
} from './paginas.ts';
import { receberWebhook } from './webhook.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = {
  app: App;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  form: URLSearchParams;
  raw: string;
  sessao: Sessao | null;
  cookies: string[];
};

type Rota = { metodo: string; regex: RegExp; chaves: string[]; tratar: (ctx: Ctx) => Promise<void> };

const rotas: Rota[] = [];

function rota(metodo: string, caminho: string, tratar: (ctx: Ctx) => Promise<void>): void {
  const chaves: string[] = [];
  const regex = new RegExp(`^${caminho.replace(/:([A-Za-z]+)/g, (_texto, chave: string) => {
    chaves.push(chave);
    return '([^/]+)';
  })}$`);
  rotas.push({ metodo, regex, chaves, tratar });
}

function cookieSeguro(app: App): boolean {
  return app.env.publicUrl.startsWith('https://');
}

function definirCookie(ctx: Ctx, nome: string, valor: string, maxAge: number): void {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (cookieSeguro(ctx.app)) partes.push('Secure');
  ctx.cookies.push(partes.join('; '));
}

function limparCookie(ctx: Ctx, nome: string): void {
  definirCookie(ctx, nome, '', 0);
}

function lerCookies(req: IncomingMessage): Map<string, string> {
  const mapa = new Map<string, string>();
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return mapa;
  for (const parte of cabecalho.split(';')) {
    const divisor = parte.indexOf('=');
    if (divisor < 0) continue;
    mapa.set(parte.slice(0, divisor).trim(), decodeURIComponent(parte.slice(divisor + 1).trim()));
  }
  return mapa;
}

async function lerCorpo(req: IncomingMessage): Promise<string> {
  const pedacos: Buffer[] = [];
  let tamanho = 0;
  for await (const pedaco of req) {
    const buffer = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco);
    tamanho += buffer.length;
    if (tamanho > 1_000_000) throw new Error('Corpo grande demais.');
    pedacos.push(buffer);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

function aplicarCookies(ctx: Ctx): void {
  if (ctx.cookies.length) ctx.res.setHeader('Set-Cookie', ctx.cookies);
}

function html(ctx: Ctx, status: number, titulo: string, corpo: string, flash: Flash | null): void {
  if (ctx.sessao) definirCookie(ctx, 'pagaeu_sessao', ctx.sessao.id, 12 * 60 * 60);
  aplicarCookies(ctx);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
  ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
  ctx.res.setHeader('Referrer-Policy', 'same-origin');
  ctx.res.end(layout({ titulo, corpo, autenticado: Boolean(ctx.sessao), flash }));
}

function redirecionar(ctx: Ctx, local: string): void {
  if (ctx.sessao) definirCookie(ctx, 'pagaeu_sessao', ctx.sessao.id, 12 * 60 * 60);
  aplicarCookies(ctx);
  ctx.res.statusCode = 303;
  ctx.res.setHeader('Location', local);
  ctx.res.end();
}

async function flashERedireciona(ctx: Ctx, local: string, flash: Flash): Promise<void> {
  if (ctx.sessao) await definirFlash(ctx.app, ctx.sessao.id, flash);
  redirecionar(ctx, local);
}

function csrfConfere(ctx: Ctx): boolean {
  if (!ctx.sessao) return false;
  const enviado = ctx.form.get('csrf') ?? '';
  const esquerda = Buffer.from(ctx.sessao.csrf);
  const direita = Buffer.from(enviado);
  if (esquerda.length === 0 || esquerda.length !== direita.length) return false;
  return timingSafeEqual(esquerda, direita);
}

function inteiro(valor: string | null): number {
  if (!valor || !/^\d+$/.test(valor.trim())) return Number.NaN;
  return Number(valor.trim());
}

function marcado(form: URLSearchParams, nome: string): boolean {
  return form.get(nome) === '1';
}

function textoLote(resultado: ResultadoLote): string {
  if (resultado.recusado) return resultado.recusado;
  const linhas = [
    `${resultado.geradas} cobrança(s) gerada(s).`,
    resultado.pixFalhos ? `${resultado.pixFalhos} emissão(ões) de PIX falharam e a cobrança ficou registrada.` : '',
    `${resultado.puladas.length} pessoa(s) pulada(s).`,
    ...resultado.puladas.map((item) => `${item.nome}: ${item.motivo}`),
    resultado.falhas.length ? `${resultado.falhas.length} falha(s).` : '',
    ...resultado.falhas.map((item) => `${item.nome}: ${item.motivo}`),
  ];
  return linhas.filter(Boolean).join('\n');
}

function canalValido(valor: string): valor is Canal {
  return valor === 'email' || valor === 'whatsapp';
}

function tipoValido(valor: string): valor is TipoMensagem {
  return valor === 'cobranca' || valor === 'confirmacao' || valor === 'inadimplencia';
}

rota('GET', '/health', async (ctx) => {
  const ok = await bancoSaudavel(ctx.app.pool);
  ctx.res.statusCode = ok ? 200 : 503;
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.end(JSON.stringify({ ok }));
});

rota('POST', '/webhooks/mercadopago', async (ctx) => {
  const status = await receberWebhook(
    ctx.app,
    {
      assinatura: ctx.req.headers['x-signature']?.toString(),
      requestId: ctx.req.headers['x-request-id']?.toString(),
    },
    ctx.url,
    ctx.raw,
  );
  ctx.res.statusCode = status;
  ctx.res.end();
});

rota('GET', '/login', async (ctx) => {
  if (ctx.sessao) return redirecionar(ctx, '/');
  const codigo = lerCookies(ctx.req).get('pagaeu_codigo');
  html(ctx, 200, 'Entrar', paginaLogin(null, Boolean(codigo)), null);
});

rota('POST', '/login', async (ctx) => {
  const resultado = await entrarComSenha(ctx.app, ctx.form.get('usuario') ?? '', ctx.form.get('senha') ?? '');
  if (!resultado.ok) return html(ctx, 401, 'Entrar', paginaLogin(resultado.aviso, false), null);
  if ('sessaoId' in resultado) {
    limparCookie(ctx, 'pagaeu_codigo');
    definirCookie(ctx, 'pagaeu_sessao', resultado.sessaoId, 12 * 60 * 60);
    ctx.sessao = await lerSessao(ctx.app, resultado.sessaoId);
    return redirecionar(ctx, '/');
  }
  definirCookie(ctx, 'pagaeu_codigo', resultado.codigoId, 30 * 60);
  html(ctx, 200, 'Código', paginaLogin(null, true), null);
});

rota('POST', '/login/codigo', async (ctx) => {
  const codigoId = lerCookies(ctx.req).get('pagaeu_codigo');
  if (!codigoId) return html(ctx, 401, 'Entrar', paginaLogin('Entre novamente com usuário e senha.', false), null);
  const resultado = await confirmarCodigo(ctx.app, codigoId, ctx.form.get('codigo') ?? '');
  if (!resultado.ok) return html(ctx, 401, 'Código', paginaLogin(resultado.aviso, true), null);
  limparCookie(ctx, 'pagaeu_codigo');
  definirCookie(ctx, 'pagaeu_sessao', resultado.sessaoId, 12 * 60 * 60);
  ctx.sessao = await lerSessao(ctx.app, resultado.sessaoId);
  redirecionar(ctx, '/');
});

rota('POST', '/login/reenviar', async (ctx) => {
  const codigoId = lerCookies(ctx.req).get('pagaeu_codigo');
  if (!codigoId) return html(ctx, 401, 'Entrar', paginaLogin('Entre novamente com usuário e senha.', false), null);
  const resultado = await reenviarCodigo(ctx.app, codigoId);
  if (!resultado.ok) return html(ctx, 200, 'Código', paginaLogin(resultado.aviso, true), null);
  definirCookie(ctx, 'pagaeu_codigo', resultado.codigoId, 30 * 60);
  html(ctx, 200, 'Código', paginaLogin('Enviamos outro código.', true), null);
});

rota('POST', '/sair', async (ctx) => {
  if (ctx.sessao) await encerrarSessao(ctx.app, ctx.sessao.id);
  limparCookie(ctx, 'pagaeu_sessao');
  ctx.sessao = null;
  redirecionar(ctx, '/login');
});

rota('GET', '/', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  const flash = await pegarFlash(ctx.app, ctx.sessao.id);
  const hoje = partesNoFuso(ctx.app.clock());
  const corpo = paginaQuemDeve(
    await montarPainel(ctx.app),
    ctx.sessao.csrf,
    `${String(hoje.day).padStart(2, '0')}/${String(hoje.month).padStart(2, '0')}/${hoje.year}`,
  );
  html(ctx, 200, 'Quem deve', corpo, flash);
});

rota('POST', '/lote', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await gerarLote(ctx.app, inteiro(ctx.form.get('ano')), inteiro(ctx.form.get('mes')));
  await flashERedireciona(ctx, '/', { tipo: resultado.recusado ? 'erro' : 'ok', texto: textoLote(resultado) });
});

rota('GET', '/pessoas/nova', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  html(ctx, 200, 'Nova pessoa', paginaPessoa(null, null, ctx.sessao.csrf, null), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/pessoas', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const criada = await criarPessoa(ctx.app, entradaPessoa(ctx));
  if (!criada.ok) return flashERedireciona(ctx, '/pessoas/nova', { tipo: 'erro', texto: criada.aviso });
  await flashERedireciona(ctx, `/pessoas/${criada.id}`, { tipo: 'ok', texto: 'Pessoa cadastrada.' });
});

rota('GET', '/pessoas/:id', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  if (!UUID.test(ctx.params.id ?? '')) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  const pessoa = await obterPessoa(ctx.app, ctx.params.id ?? '');
  if (!pessoa) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  const hoje = partesNoFuso(ctx.app.clock());
  html(
    ctx,
    200,
    pessoa.nome,
    paginaPessoa(pessoa, diaEfetivo(pessoa.dia_cobranca, hoje.year, hoje.month), ctx.sessao.csrf, `/pessoas/${pessoa.id}/itens`),
    await pegarFlash(ctx.app, ctx.sessao.id),
  );
});

rota('POST', '/pessoas/:id', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const salva = await atualizarPessoa(ctx.app, ctx.params.id ?? '', entradaPessoa(ctx));
  const texto = salva.ok ? ['Pessoa atualizada.', ...salva.avisos].filter(Boolean).join('\n') : salva.aviso;
  await flashERedireciona(ctx, `/pessoas/${ctx.params.id}`, { tipo: salva.ok ? 'ok' : 'erro', texto });
});

rota('POST', '/pessoas/:id/ativa', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await definirAtiva(ctx.app, ctx.params.id ?? '', ctx.form.get('ativa') === '1');
  await flashERedireciona(ctx, `/pessoas/${ctx.params.id}`, {
    tipo: resultado.ok ? 'ok' : 'erro',
    texto: resultado.ok ? 'Situação atualizada.' : resultado.aviso,
  });
});

rota('POST', '/pessoas/:id/gerar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const gerada = await gerarCobranca(ctx.app, ctx.params.id ?? '', inteiro(ctx.form.get('ano')), inteiro(ctx.form.get('mes')), 'manual');
  if (!gerada.ok) return flashERedireciona(ctx, `/pessoas/${ctx.params.id}`, { tipo: 'erro', texto: gerada.aviso });
  await flashERedireciona(ctx, `/cobrancas/${gerada.cobrancaId}`, {
    tipo: gerada.pixOk ? 'ok' : 'erro',
    texto: gerada.pixOk ? 'Cobrança gerada.' : 'A cobrança foi registrada, mas a emissão do PIX falhou.',
  });
});

rota('GET', '/pessoas/:id/itens', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  const pessoa = await obterPessoa(ctx.app, ctx.params.id ?? '');
  if (!pessoa) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  const itens = await listarItens(ctx.app, pessoa.id);
  const usados = new Set<string>();
  if (itens.length) {
    const linhas = await consultar<{ item_id: string }>(
      ctx.app.pool,
      'SELECT DISTINCT item_id FROM linha_cobranca WHERE item_id = ANY($1::uuid[])',
      [itens.map((item) => item.id)],
    );
    for (const linha of linhas) usados.add(linha.item_id);
  }
  html(ctx, 200, 'Itens', paginaItens(pessoa, itens, usados, ctx.sessao.csrf), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/pessoas/:id/itens', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const salvo = await salvarItem(ctx.app, ctx.params.id ?? '', null, entradaItem(ctx));
  await flashERedireciona(ctx, `/pessoas/${ctx.params.id}/itens`, { tipo: salvo.ok ? 'ok' : 'erro', texto: salvo.ok ? 'Item salvo.' : salvo.aviso });
});

rota('POST', '/itens/:id', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const pessoaId = ctx.form.get('pessoa_id') ?? '';
  const salvo = await salvarItem(ctx.app, pessoaId, ctx.params.id ?? '', entradaItem(ctx));
  await flashERedireciona(ctx, `/pessoas/${pessoaId}/itens`, { tipo: salvo.ok ? 'ok' : 'erro', texto: salvo.ok ? 'Item atualizado.' : salvo.aviso });
});

rota('POST', '/itens/:id/excluir', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const dono = await consultar<{ pessoa_id: string }>(ctx.app.pool, 'SELECT pessoa_id FROM item WHERE id = $1', [ctx.params.id]);
  const pessoaId = dono[0]?.pessoa_id ?? '';
  const apagado = await excluirItem(ctx.app, ctx.params.id ?? '');
  await flashERedireciona(ctx, pessoaId ? `/pessoas/${pessoaId}/itens` : '/', {
    tipo: apagado.ok ? 'ok' : 'erro',
    texto: apagado.ok ? 'Item excluído.' : apagado.aviso,
  });
});

rota('GET', '/cobrancas', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  const ano = inteiro(ctx.url.searchParams.get('ano'));
  const mes = inteiro(ctx.url.searchParams.get('mes'));
  const linhas = await listarHistorico(ctx.app, {
    pessoaId: ctx.url.searchParams.get('pessoa') || undefined,
    status: ctx.url.searchParams.get('status') || undefined,
    ...(Number.isInteger(ano) && Number.isInteger(mes) ? { ano, mes } : {}),
  });
  html(
    ctx,
    200,
    'Histórico',
    paginaHistorico(linhas, await listarPessoas(ctx.app), {
      pessoa: ctx.url.searchParams.get('pessoa') ?? '',
      status: ctx.url.searchParams.get('status') ?? '',
      mes: ctx.url.searchParams.get('mes') ?? '',
      ano: ctx.url.searchParams.get('ano') ?? '',
    }),
    await pegarFlash(ctx.app, ctx.sessao.id),
  );
});

rota('GET', '/cobrancas/:id', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  const detalhe = await detalharCobranca(ctx.app, ctx.params.id ?? '');
  if (!detalhe) return html(ctx, 404, 'Não encontrada', '<h1>Cobrança não encontrada</h1>', null);
  html(ctx, 200, detalhe.competencia, paginaDetalhe(detalhe, ctx.sessao.csrf), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/cobrancas/:id/baixa', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const escolha = ctx.form.get('pix');
  const resultado = await baixaManual(ctx.app, ctx.params.id ?? '', escolha === 'invalidar' || escolha === 'manter' ? escolha : null);
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, {
    tipo: resultado.ok ? 'ok' : 'erro',
    texto: resultado.ok ? (resultado.aviso ?? 'Baixa registrada.') : resultado.aviso,
  });
});

rota('POST', '/cobrancas/:id/cancelar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await cancelarCobranca(ctx.app, ctx.params.id ?? '', ctx.form.get('motivo') ?? '');
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, {
    tipo: resultado.ok ? 'ok' : 'erro',
    texto: resultado.ok ? (resultado.aviso ?? 'Cobrança cancelada.') : resultado.aviso,
  });
});

rota('POST', '/cobrancas/:id/novo-pix', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await gerarNovoPix(ctx.app, ctx.params.id ?? '');
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, { tipo: resultado.ok ? 'ok' : 'erro', texto: resultado.ok ? 'Novo PIX gerado.' : resultado.aviso });
});

rota('POST', '/cobrancas/:id/invalidar-pix', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await invalidarPix(ctx.app, ctx.params.id ?? '');
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, {
    tipo: resultado.ok ? 'ok' : 'erro',
    texto: resultado.ok ? (resultado.aviso ?? 'PIX invalidado.') : resultado.aviso,
  });
});

rota('POST', '/cobrancas/:id/tentar-emissao', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await tentarEmissao(ctx.app, ctx.params.id ?? '');
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, { tipo: resultado.ok ? 'ok' : 'erro', texto: resultado.ok ? 'PIX emitido.' : resultado.aviso });
});

rota('POST', '/cobrancas/:id/reenviar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const tipo = ctx.form.get('tipo') ?? '';
  const canal = ctx.form.get('canal') ?? '';
  if (!tipoValido(tipo) || !canalValido(canal)) {
    return flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, { tipo: 'erro', texto: 'Reenvio inválido.' });
  }
  const resultado = await reenviar(ctx.app, ctx.params.id ?? '', tipo, canal);
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, { tipo: resultado.ok ? 'ok' : 'erro', texto: resultado.ok ? 'Reenvio registrado.' : resultado.aviso });
});

rota('GET', '/templates', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  html(ctx, 200, 'Templates', paginaTemplates(await listarTemplates(ctx.app), ctx.sessao.csrf, null), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/templates/prever', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const canal = ctx.form.get('canal') ?? '';
  const tipo = ctx.form.get('tipo') ?? '';
  if (!canalValido(canal) || !tipoValido(tipo)) return html(ctx, 400, 'Templates', '<h1>Template inválido</h1>', null);
  const previsto = preverTemplate(canal, tipo, ctx.form.get('assunto'), ctx.form.get('corpo') ?? '');
  if (!previsto.ok) {
    return html(ctx, 200, 'Templates', paginaTemplates(await listarTemplates(ctx.app), ctx.sessao.csrf, null), { tipo: 'erro', texto: previsto.aviso });
  }
  html(
    ctx,
    200,
    'Templates',
    paginaTemplates(await listarTemplates(ctx.app), ctx.sessao.csrf, { titulo: `${canal} ${tipo}`, assunto: previsto.assunto, corpo: previsto.corpo }),
    null,
  );
});

rota('POST', '/templates/:canal/:tipo/restaurar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const canal = ctx.params.canal ?? '';
  const tipo = ctx.params.tipo ?? '';
  if (!canalValido(canal) || !tipoValido(tipo)) return html(ctx, 404, 'Templates', '<h1>Template não encontrado</h1>', null);
  const restaurado = await restaurarTemplate(ctx.app, canal, tipo);
  await flashERedireciona(ctx, '/templates', { tipo: restaurado.ok ? 'ok' : 'erro', texto: restaurado.ok ? 'Padrão restaurado.' : restaurado.aviso });
});

rota('POST', '/templates/:canal/:tipo', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const canal = ctx.params.canal ?? '';
  const tipo = ctx.params.tipo ?? '';
  if (!canalValido(canal) || !tipoValido(tipo)) return html(ctx, 404, 'Templates', '<h1>Template não encontrado</h1>', null);
  const salvo = await salvarTemplate(ctx.app, canal, tipo, ctx.form.get('assunto'), ctx.form.get('corpo') ?? '');
  await flashERedireciona(ctx, '/templates', { tipo: salvo.ok ? 'ok' : 'erro', texto: salvo.ok ? 'Template salvo.' : salvo.aviso });
});

rota('GET', '/configuracao', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  html(ctx, 200, 'Configuração', paginaConfiguracao(await lerConfigPublica(ctx.app), ctx.sessao.csrf), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/configuracao', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const salvo = await salvarConfiguracao(ctx.app, {
    usuario: ctx.form.get('usuario') ?? '',
    emailDono: ctx.form.get('email_dono') ?? '',
    senhaAtual: ctx.form.get('senha_atual') ?? '',
    senhaNova: ctx.form.get('senha_nova') ?? '',
    mpAccessToken: ctx.form.get('mp_access_token') ?? '',
    mpWebhookSecret: ctx.form.get('mp_webhook_secret') ?? '',
    smtpHost: ctx.form.get('smtp_host') ?? '',
    smtpPorta: ctx.form.get('smtp_porta') ?? '',
    smtpUsuario: ctx.form.get('smtp_usuario') ?? '',
    smtpSenha: ctx.form.get('smtp_senha') ?? '',
    smtpRemetenteNome: ctx.form.get('smtp_remetente_nome') ?? '',
    smtpRemetenteEmail: ctx.form.get('smtp_remetente_email') ?? '',
    smtpCriptografia: ctx.form.get('smtp_criptografia') ?? 'starttls',
  });
  await flashERedireciona(ctx, '/configuracao', { tipo: salvo.ok ? 'ok' : 'erro', texto: salvo.ok ? 'Configuração salva.' : salvo.aviso });
});

rota('POST', '/configuracao/evolution', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const teste = await testarEvolution(ctx.app);
  await flashERedireciona(ctx, '/configuracao', { tipo: teste.ok ? 'ok' : 'erro', texto: teste.motivo });
});

function entradaPessoa(ctx: Ctx) {
  return {
    nome: ctx.form.get('nome') ?? '',
    whatsapp: ctx.form.get('whatsapp') ?? '',
    email: ctx.form.get('email') ?? '',
    cpf: ctx.form.get('cpf'),
    diaCobranca: inteiro(ctx.form.get('dia_cobranca')),
    validadePixDias: inteiro(ctx.form.get('validade_pix_dias')),
    diasAviso: inteiro(ctx.form.get('dias_aviso_inadimplencia')),
    canalEmail: marcado(ctx.form, 'canal_email'),
    canalWhatsapp: marcado(ctx.form, 'canal_whatsapp'),
  };
}

function entradaItem(ctx: Ctx) {
  return {
    descricao: ctx.form.get('descricao') ?? '',
    valorCentavos: interpretarReais(ctx.form.get('valor') ?? ''),
    inicioAno: inteiro(ctx.form.get('inicio_ano')),
    inicioMes: inteiro(ctx.form.get('inicio_mes')),
    fimAno: inteiro(ctx.form.get('fim_ano')),
    fimMes: inteiro(ctx.form.get('fim_mes')),
  };
}

export function criarServidor(app: App) {
  return createServer((req, res) => {
    void atender(app, req, res).catch((erro) => {
      console.error(mensagemErro(erro));
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      res.end('Erro interno.');
    });
  });
}

async function atender(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await lerCorpo(req);
  const cookies = lerCookies(req);
  const semSessao = url.pathname === '/health' || url.pathname.startsWith('/webhooks/');
  const sessaoId = cookies.get('pagaeu_sessao');
  const sessao = !semSessao && sessaoId ? await lerSessao(app, sessaoId) : null;
  const ctx: Ctx = {
    app,
    req,
    res,
    url,
    params: {},
    form: new URLSearchParams(raw),
    raw,
    sessao,
    cookies: [],
  };
  if (sessaoId && !sessao && url.pathname !== '/login' && url.pathname !== '/health' && !url.pathname.startsWith('/webhooks/')) {
    limparCookie(ctx, 'pagaeu_sessao');
  }
  const metodo = req.method ?? 'GET';
  for (const rotaAtual of rotas) {
    if (rotaAtual.metodo !== metodo) continue;
    const achado = rotaAtual.regex.exec(url.pathname);
    if (!achado) continue;
    rotaAtual.chaves.forEach((chave, indice) => {
      ctx.params[chave] = decodeURIComponent(achado[indice + 1] ?? '');
    });
    await rotaAtual.tratar(ctx);
    return;
  }
  if (!sessao && url.pathname !== '/login') {
    redirecionar(ctx, '/login');
    return;
  }
  html(ctx, 404, 'Não encontrada', '<h1>Página não encontrada</h1>', null);
}

export function dataVisivel(data: Date): string {
  return formatarDataHora(data);
}
