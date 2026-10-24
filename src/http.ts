import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from './app.ts';
import {
  confirmarCodigo,
  definirFlash,
  encerrarSessao,
  entrarComSenha,
  lerSessao,
  pegarFlash,
  reenviarCodigo,
  SESSAO_OCIOSA_MS,
  type CanalCodigo,
  type Flash,
  type Sessao,
} from './acesso.ts';
import { detalharCobranca, listarHistorico, listarLinhasDasCobrancas, montarPainel } from './consultas.ts';
import { montarDashboard } from './dashboard.ts';
import { normalizarPeriodo, type Competencia, type Periodo } from './domain/painel.ts';
import {
  baixaManual,
  cancelarCobranca,
  reabrirCobranca,
  consultarCobrancasAbertas,
  gerarCobranca,
  gerarLote,
  gerarNovoPix,
  invalidarPix,
  tentarEmissao,
  type ResultadoConsultaAbertas,
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
  testarSmtp,
} from './configuracao.ts';
import { caminhoProibido, nomeEstaticoPermitido } from './caminho.ts';
import { bancoSaudavel, consultar } from './db.ts';
import {
  aguardarReenvioCodigoMs,
  ipDoPedido,
  registrarEnvioCodigoLogin,
  registrarFalha,
  registrarSucesso,
  verificarTentativa,
} from './limites.ts';
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
import { reenviarCanais } from './mensagens.ts';
import {
  layout,
  paginaConfiguracao,
  paginaDetalhe,
  paginaHistorico,
  paginaLogin,
  paginaPessoa,
  paginaFichaPessoa,
  modalResultadoConsultaPagamentos,
  paginaDashboard,
  paginaQuemDeve,
  paginaTemplates,
  type AbaFicha,
  type FichaPessoaDados,
  type RascunhoItem,
} from './paginas.ts';
import { receberWebhook } from './webhook.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pastaEstatica = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const tiposEstaticos: Record<string, string> = {
  'jquery.min.js': 'text/javascript; charset=utf-8',
  'toastr.min.js': 'text/javascript; charset=utf-8',
  'toastr.min.css': 'text/css; charset=utf-8',
  'painel.js': 'text/javascript; charset=utf-8',
};
const cacheEstatico = new Map<string, Buffer>();

function servirEstatico(res: ServerResponse, caminho: string, metodo: string): boolean {
  const nome = caminho.slice('/estatico/'.length);
  if (!nomeEstaticoPermitido(nome)) return false;
  const tipo = tiposEstaticos[nome];
  if (!tipo) return false;
  let corpo = nome === 'painel.js' ? undefined : cacheEstatico.get(nome);
  if (!corpo) {
    corpo = readFileSync(join(pastaEstatica, nome));
    if (nome !== 'painel.js') cacheEstatico.set(nome, corpo);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', tipo);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  cabecalhosSeguranca(res);
  res.setHeader('Cache-Control', 'no-cache');
  if (metodo === 'HEAD') res.end();
  else res.end(corpo);
  return true;
}

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

const AVISO_LIMITE = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

function avisoCooldownReenvio(aguardarMs: number): string {
  const minutos = Math.max(1, Math.ceil(aguardarMs / 60_000));
  return minutos === 1
    ? 'Aguarde 1 minuto para reenviar o código.'
    : `Aguarde ${minutos} minutos para reenviar o código.`;
}

function segundosCooldownReenvio(ip: string, agoraMs: number): number {
  return Math.ceil(aguardarReenvioCodigoMs(ip, agoraMs) / 1000);
}

const CABECALHO_ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

const CORPO_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

function cabecalhosSemIndexacao(res: ServerResponse): void {
  res.setHeader('X-Robots-Tag', CABECALHO_ROBOTS);
}

function cabecalhosSeguranca(res: ServerResponse): void {
  cabecalhosSemIndexacao(res);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

function cookieSeguro(ctx: Ctx): boolean {
  if (ctx.app.env.publicUrl.startsWith('https://')) return true;
  const encaminhado = ctx.req.headers['x-forwarded-proto'];
  if (typeof encaminhado === 'string' && encaminhado.split(',')[0].trim().toLowerCase() === 'https') return true;
  return false;
}

function canalCodigo(valor: string | undefined): CanalCodigo {
  return valor === 'whatsapp' ? 'whatsapp' : 'email';
}

function paginaLoginEtapaCodigo(ctx: Ctx, erro: string | null, valor = ''): string {
  const agoraMs = ctx.app.clock().getTime();
  const ip = ipDoPedido(ctx.req);
  return paginaLogin(
    erro,
    true,
    valor,
    canalCodigo(lerCookies(ctx.req).get('pagaeu_codigo_canal')),
    segundosCooldownReenvio(ip, agoraMs),
  );
}

function recusarLimiteLogin(ctx: Ctx, etapaCodigo: boolean, valor = ''): void {
  if (pedidoAjax(ctx)) {
    json(ctx, 429, { ok: false, aviso: AVISO_LIMITE });
    return;
  }
  html(
    ctx,
    429,
    etapaCodigo ? 'Código' : 'Entrar',
    paginaLogin(AVISO_LIMITE, etapaCodigo, valor, canalCodigo(lerCookies(ctx.req).get('pagaeu_codigo_canal'))),
    null,
  );
}

function definirCookie(ctx: Ctx, nome: string, valor: string, maxAge: number): void {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (cookieSeguro(ctx)) partes.push('Secure');
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

function pedidoAjax(ctx: Ctx): boolean {
  return ctx.req.headers['x-pagaeu'] === '1';
}

function json(ctx: Ctx, status: number, corpo: Record<string, unknown>): void {
  if (ctx.sessao) definirCookie(ctx, 'pagaeu_sessao', ctx.sessao.id, 12 * 60 * 60);
  aplicarCookies(ctx);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
  ctx.res.setHeader('Referrer-Policy', 'same-origin');
  cabecalhosSeguranca(ctx.res);
  ctx.res.end(JSON.stringify(corpo));
}

function html(ctx: Ctx, status: number, titulo: string, corpo: string, flash: Flash | null): void {
  if (pedidoAjax(ctx)) {
    const aviso = flash?.texto || (status === 403 ? 'Ação recusada.' : status >= 400 ? 'Não foi possível concluir.' : '');
    const payload: Record<string, unknown> = {
      ok: status < 400 && flash?.tipo !== 'erro',
      aviso,
    };
    if (corpo) {
      payload.html = corpo;
      payload.titulo = titulo;
    }
    json(ctx, status, payload);
    return;
  }
  if (ctx.sessao) definirCookie(ctx, 'pagaeu_sessao', ctx.sessao.id, 12 * 60 * 60);
  aplicarCookies(ctx);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
  ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
  ctx.res.setHeader('Referrer-Policy', 'same-origin');
  cabecalhosSeguranca(ctx.res);
  const sessaoExpiraEmMs = ctx.sessao ? ctx.sessao.ultimoUsoEm.getTime() + SESSAO_OCIOSA_MS : undefined;
  ctx.res.end(
    layout({ titulo, corpo, autenticado: Boolean(ctx.sessao), flash, caminho: ctx.url.pathname, sessaoExpiraEmMs }),
  );
}

function redirecionar(ctx: Ctx, local: string): void {
  if (pedidoAjax(ctx)) {
    json(ctx, 200, { ok: true, aviso: '', ir: local, recarregar: true });
    return;
  }
  if (ctx.sessao) definirCookie(ctx, 'pagaeu_sessao', ctx.sessao.id, 12 * 60 * 60);
  aplicarCookies(ctx);
  ctx.res.statusCode = 303;
  ctx.res.setHeader('Location', local);
  ctx.res.end();
}

async function flashERedireciona(ctx: Ctx, local: string, flash: Flash): Promise<void> {
  if (pedidoAjax(ctx)) {
    json(ctx, flash.tipo === 'ok' ? 200 : 422, { ok: flash.tipo === 'ok', aviso: flash.texto, ir: local });
    return;
  }
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

function inteiroOpcional(valor: string | null): number | null {
  if (!valor || !valor.trim()) return null;
  return inteiro(valor);
}

function marcado(form: URLSearchParams, nome: string): boolean {
  return form.get(nome) === '1';
}

function contar(quantidade: number, um: string, varios: string): string {
  return quantidade === 1 ? `1 ${um}` : `${quantidade} ${varios}`;
}

function textoConsulta(resultado: ResultadoConsultaAbertas): string {
  const linhas: string[] = [];
  const { conciliacao: c } = resultado;
  if (c.pendentes > 0 || c.conciliadas > 0 || c.entradasMp > 0) {
    linhas.push(
      `PIX nativo: ${c.conciliadas} quitada(s) de ${c.pendentes} pendente(s); ${c.entradasMp} entrada(s) nova(s) no extrato Mercado Pago.`,
    );
  }
  if (resultado.consultadas > 0) {
    linhas.push(contar(resultado.consultadas, 'PIX do gateway consultado.', 'PIX do gateway consultados.'));
  }
  if (resultado.pagas > 0) {
    linhas.push(contar(resultado.pagas, 'cobrança quitada.', 'cobranças quitadas.'));
  } else if (resultado.consultadas > 0 || c.pendentes > 0) {
    linhas.push('Nenhuma cobrança nova quitada nesta consulta.');
  }
  if (resultado.confirmacoes) {
    linhas.push(contar(resultado.confirmacoes, 'confirmação de pagamento enviada.', 'confirmações de pagamento enviadas.'));
  }
  if (resultado.semCanal) {
    linhas.push(contar(resultado.semCanal, 'quitada sem canal de confirmação ligado.', 'quitadas sem canal de confirmação ligado.'));
  }
  if (resultado.falhaConfirmacao) {
    linhas.push(contar(resultado.falhaConfirmacao, 'quitada com falha ao enviar confirmação.', 'quitadas com falha ao enviar confirmação.'));
  }
  linhas.push(...resultado.falhas);
  if (!linhas.length) return 'Nada a atualizar: sem PIX pendente para consultar ou conciliar.';
  return linhas.join('\n');
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
  ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
  cabecalhosSemIndexacao(ctx.res);
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
  const canal = canalCodigo(lerCookies(ctx.req).get('pagaeu_codigo_canal'));
  const agoraMs = ctx.app.clock().getTime();
  const cooldownSeg = codigo ? segundosCooldownReenvio(ipDoPedido(ctx.req), agoraMs) : 0;
  html(ctx, 200, codigo ? 'Código' : 'Entrar', paginaLogin(null, Boolean(codigo), '', canal, cooldownSeg), null);
});

rota('POST', '/login', async (ctx) => {
  const agoraMs = ctx.app.clock().getTime();
  const chave = `senha:${ipDoPedido(ctx.req)}`;
  const limite = verificarTentativa(chave, agoraMs);
  if (!limite.permitido) return recusarLimiteLogin(ctx, false, ctx.form.get('usuario') ?? '');
  const resultado = await entrarComSenha(ctx.app, ctx.form.get('usuario') ?? '', ctx.form.get('senha') ?? '');
  if (!resultado.ok) {
    registrarFalha(chave, agoraMs);
    if (pedidoAjax(ctx)) return json(ctx, 401, { ok: false, aviso: resultado.aviso });
    return html(ctx, 401, 'Entrar', paginaLogin(resultado.aviso, false, ctx.form.get('usuario') ?? ''), null);
  }
  if ('sessaoId' in resultado) {
    registrarSucesso(chave);
    limparCookie(ctx, 'pagaeu_codigo');
    limparCookie(ctx, 'pagaeu_codigo_canal');
    definirCookie(ctx, 'pagaeu_sessao', resultado.sessaoId, 12 * 60 * 60);
    ctx.sessao = await lerSessao(ctx.app, resultado.sessaoId);
    return redirecionar(ctx, '/');
  }
  const ip = ipDoPedido(ctx.req);
  registrarEnvioCodigoLogin(ip, agoraMs);
  definirCookie(ctx, 'pagaeu_codigo', resultado.codigoId, 30 * 60);
  definirCookie(ctx, 'pagaeu_codigo_canal', resultado.canal, 30 * 60);
  html(
    ctx,
    200,
    'Código',
    paginaLogin(null, true, '', resultado.canal, segundosCooldownReenvio(ip, agoraMs)),
    null,
  );
});

rota('POST', '/login/codigo', async (ctx) => {
  const agoraMs = ctx.app.clock().getTime();
  const chave = `codigo:${ipDoPedido(ctx.req)}`;
  const limite = verificarTentativa(chave, agoraMs);
  if (!limite.permitido) return recusarLimiteLogin(ctx, true, ctx.form.get('codigo') ?? '');
  const codigoId = lerCookies(ctx.req).get('pagaeu_codigo');
  if (!codigoId) {
    if (pedidoAjax(ctx)) return json(ctx, 401, { ok: false, aviso: 'Entre novamente com usuário e senha.', recarregar: true, ir: '/login' });
    return html(ctx, 401, 'Entrar', paginaLogin('Entre novamente com usuário e senha.', false), null);
  }
  const resultado = await confirmarCodigo(ctx.app, codigoId, ctx.form.get('codigo') ?? '');
  if (!resultado.ok) {
    registrarFalha(chave, agoraMs);
    if (pedidoAjax(ctx)) return json(ctx, 401, { ok: false, aviso: resultado.aviso });
    return html(ctx, 401, 'Código', paginaLoginEtapaCodigo(ctx, resultado.aviso, ctx.form.get('codigo') ?? ''), null);
  }
  registrarSucesso(chave);
  registrarSucesso(`senha:${ipDoPedido(ctx.req)}`);
  limparCookie(ctx, 'pagaeu_codigo');
  limparCookie(ctx, 'pagaeu_codigo_canal');
  definirCookie(ctx, 'pagaeu_sessao', resultado.sessaoId, 12 * 60 * 60);
  ctx.sessao = await lerSessao(ctx.app, resultado.sessaoId);
  redirecionar(ctx, '/');
});

rota('POST', '/login/reenviar', async (ctx) => {
  const agoraMs = ctx.app.clock().getTime();
  const ip = ipDoPedido(ctx.req);
  const aguardarMs = aguardarReenvioCodigoMs(ip, agoraMs);
  if (aguardarMs > 0) {
    const aviso = avisoCooldownReenvio(aguardarMs);
    const canal = canalCodigo(lerCookies(ctx.req).get('pagaeu_codigo_canal'));
    const cooldownSeg = segundosCooldownReenvio(ip, agoraMs);
    if (pedidoAjax(ctx)) return json(ctx, 429, { ok: false, aviso });
    return html(ctx, 429, 'Código', paginaLogin(aviso, true, '', canal, cooldownSeg), null);
  }
  const codigoId = lerCookies(ctx.req).get('pagaeu_codigo');
  if (!codigoId) {
    if (pedidoAjax(ctx)) return json(ctx, 401, { ok: false, aviso: 'Entre novamente com usuário e senha.', recarregar: true, ir: '/login' });
    return html(ctx, 401, 'Entrar', paginaLogin('Entre novamente com usuário e senha.', false), null);
  }
  const resultado = await reenviarCodigo(ctx.app, codigoId);
  if (!resultado.ok) {
    if (pedidoAjax(ctx)) return json(ctx, 422, { ok: false, aviso: resultado.aviso });
    return html(ctx, 200, 'Código', paginaLoginEtapaCodigo(ctx, resultado.aviso), null);
  }
  registrarEnvioCodigoLogin(ip, agoraMs);
  definirCookie(ctx, 'pagaeu_codigo', resultado.codigoId, 30 * 60);
  definirCookie(ctx, 'pagaeu_codigo_canal', resultado.canal, 30 * 60);
  html(
    ctx,
    200,
    'Código',
    paginaLogin(null, true, '', resultado.canal, segundosCooldownReenvio(ip, agoraMs)),
    { tipo: 'ok', texto: 'Enviamos outro código.' },
  );
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
  const periodo = normalizarPeriodo(ctx.url.searchParams.get('de'), ctx.url.searchParams.get('ate'), competenciaAtual(ctx));
  html(ctx, 200, 'Dashboard', await corpoDashboard(ctx, { periodo }), flash);
});

rota('GET', '/quem-deve', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  const flash = await pegarFlash(ctx.app, ctx.sessao.id);
  html(ctx, 200, 'Quem deve', paginaQuemDeve(await montarPainel(ctx.app), ctx.sessao.csrf), flash);
});

rota('POST', '/cobrancas/consultar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await consultarCobrancasAbertas(ctx.app);
  const falhaGrave = resultado.falhas.length > 0 && resultado.pagas === 0;
  if (pedidoAjax(ctx)) {
    json(ctx, falhaGrave ? 422 : 200, {
      ok: !falhaGrave,
      html: await corpoDashboard(ctx, { modalConsulta: modalResultadoConsultaPagamentos(resultado) }),
      titulo: 'Dashboard',
      abrirModal: 'modal-consulta-cobrancas',
    });
    return;
  }
  await flashERedireciona(ctx, '/', { tipo: falhaGrave ? 'erro' : 'ok', texto: textoConsulta(resultado) });
});

rota('POST', '/lote', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await gerarLote(ctx.app, inteiro(ctx.form.get('ano')), inteiro(ctx.form.get('mes')));
  if (resultado.recusado) {
    return html(ctx, 422, 'Dashboard', await corpoDashboard(ctx, { geracao: rascunhoMes(ctx) }), {
      tipo: 'erro',
      texto: textoLote(resultado),
    });
  }
  await flashERedireciona(ctx, '/', { tipo: 'ok', texto: textoLote(resultado) });
});

rota('GET', '/pessoas/nova', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  html(ctx, 200, 'Nova pessoa', paginaPessoa(null, null, ctx.sessao.csrf, null), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/pessoas', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const criada = await criarPessoa(ctx.app, entradaPessoa(ctx));
  if (!criada.ok) {
    return html(ctx, 422, 'Nova pessoa', paginaPessoa(null, null, ctx.sessao.csrf, null, rascunhoPessoa(ctx)), {
      tipo: 'erro',
      texto: criada.aviso,
    });
  }
  await flashERedireciona(ctx, `/pessoas/${criada.id}`, { tipo: 'ok', texto: 'Pessoa cadastrada.' });
});

rota('GET', '/pessoas/:id', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  if (!UUID.test(ctx.params.id ?? '')) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  const pessoa = await obterPessoa(ctx.app, ctx.params.id ?? '');
  if (!pessoa) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  const atual = competenciaAtual(ctx);
  const corpo = await corpoFichaPessoa(ctx, pessoa, parseAbaFicha(ctx.url.searchParams.get('aba')), {
    geracao: { mes: String(atual.mes), ano: String(atual.ano) },
  });
  html(ctx, 200, pessoa.nome, corpo, await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/pessoas/:id', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const salva = await atualizarPessoa(ctx.app, ctx.params.id ?? '', entradaPessoa(ctx));
  if (!salva.ok) return htmlPessoa(ctx, ctx.params.id ?? '', rascunhoPessoa(ctx), null, { tipo: 'erro', texto: salva.aviso });
  const texto = ['Pessoa atualizada.', ...salva.avisos].filter(Boolean).join('\n');
  await flashERedireciona(ctx, `/pessoas/${ctx.params.id}?aba=informacoes`, { tipo: 'ok', texto });
});

rota('POST', '/pessoas/:id/ativa', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await definirAtiva(ctx.app, ctx.params.id ?? '', ctx.form.get('ativa') === '1');
  await flashERedireciona(ctx, `/pessoas/${ctx.params.id}?aba=informacoes`, {
    tipo: resultado.ok ? 'ok' : 'erro',
    texto: resultado.ok ? 'Situação atualizada.' : resultado.aviso,
  });
});

rota('POST', '/pessoas/:id/gerar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const gerada = await gerarCobranca(ctx.app, ctx.params.id ?? '', inteiro(ctx.form.get('ano')), inteiro(ctx.form.get('mes')), 'manual');
  if (!gerada.ok) return htmlPessoa(ctx, ctx.params.id ?? '', null, rascunhoMes(ctx), { tipo: 'erro', texto: gerada.aviso });
  await flashERedireciona(ctx, `/cobrancas/${gerada.cobrancaId}`, {
    tipo: gerada.pixOk ? 'ok' : 'erro',
    texto: gerada.pixOk ? 'Cobrança gerada.' : 'A cobrança foi registrada, mas a emissão do PIX falhou.',
  });
});

rota('GET', '/pessoas/:id/itens', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  if (!UUID.test(ctx.params.id ?? '')) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  redirecionar(ctx, `/pessoas/${ctx.params.id}?aba=lancamentos`);
});

rota('POST', '/pessoas/:id/itens', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const salvo = await salvarItem(ctx.app, ctx.params.id ?? '', null, entradaItem(ctx));
  if (!salvo.ok) {
    const mostrou = await htmlItens(ctx, ctx.params.id ?? '', rascunhoItem(ctx, null), { tipo: 'erro', texto: salvo.aviso });
    if (!mostrou) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
    return;
  }
  await flashERedireciona(ctx, `/pessoas/${ctx.params.id}?aba=lancamentos`, { tipo: 'ok', texto: 'Item salvo.' });
});

rota('POST', '/itens/:id', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const pessoaId = ctx.form.get('pessoa_id') ?? '';
  const salvo = await salvarItem(ctx.app, pessoaId, ctx.params.id ?? '', entradaItem(ctx));
  if (!salvo.ok) {
    const mostrou = await htmlItens(ctx, pessoaId, rascunhoItem(ctx, ctx.params.id ?? ''), { tipo: 'erro', texto: salvo.aviso });
    if (!mostrou) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
    return;
  }
  await flashERedireciona(ctx, `/pessoas/${pessoaId}?aba=lancamentos`, { tipo: 'ok', texto: 'Item atualizado.' });
});

rota('POST', '/itens/:id/excluir', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const dono = await consultar<{ pessoa_id: string }>(ctx.app.pool, 'SELECT pessoa_id FROM item WHERE id = $1', [ctx.params.id]);
  const pessoaId = dono[0]?.pessoa_id ?? '';
  const apagado = await excluirItem(ctx.app, ctx.params.id ?? '');
  await flashERedireciona(ctx, pessoaId ? `/pessoas/${pessoaId}?aba=lancamentos` : '/', {
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
    'Cobranças',
    paginaHistorico(linhas, await listarPessoas(ctx.app), ctx.sessao.csrf, {
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

rota('POST', '/cobrancas/:id/reabrir', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx) || !UUID.test(ctx.params.id ?? '')) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await reabrirCobranca(ctx.app, ctx.params.id ?? '');
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, {
    tipo: resultado.ok ? 'ok' : 'erro',
    texto: resultado.ok ? 'Cobrança reaberta. O PIX aprovado voltou a pendente para nova consulta.' : resultado.aviso,
  });
});

rota('POST', '/cobrancas/:id/cancelar', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const resultado = await cancelarCobranca(ctx.app, ctx.params.id ?? '', ctx.form.get('motivo') ?? '');
  if (!resultado.ok) {
    const detalhe = await detalharCobranca(ctx.app, ctx.params.id ?? '');
    if (!detalhe) return html(ctx, 404, 'Não encontrada', '<h1>Cobrança não encontrada</h1>', null);
    return html(ctx, 422, detalhe.competencia, paginaDetalhe(detalhe, ctx.sessao.csrf, campo(ctx, 'motivo')), {
      tipo: 'erro',
      texto: resultado.aviso,
    });
  }
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, {
    tipo: 'ok',
    texto: resultado.aviso ?? 'Cobrança cancelada.',
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
  const canais = ctx.form.getAll('canal').filter((valor): valor is Canal => canalValido(valor));
  if (!tipoValido(tipo) || !canais.length) {
    return flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, { tipo: 'erro', texto: 'Envio inválido.' });
  }
  const resultado = await reenviarCanais(ctx.app, ctx.params.id ?? '', tipo, canais);
  const texto = resultado.ok ? (resultado.aviso ?? 'Envio registrado.') : resultado.aviso;
  await flashERedireciona(ctx, `/cobrancas/${ctx.params.id}`, { tipo: resultado.ok ? 'ok' : 'erro', texto });
});

rota('GET', '/templates', async (ctx) => {
  if (!ctx.sessao) return redirecionar(ctx, '/login');
  html(ctx, 200, 'Templates', paginaTemplates(await listarTemplates(ctx.app), ctx.sessao.csrf, null), await pegarFlash(ctx.app, ctx.sessao.id));
});

rota('POST', '/templates/:canal/:tipo/prever', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const canal = ctx.params.canal ?? '';
  const tipo = ctx.params.tipo ?? '';
  if (!canalValido(canal) || !tipoValido(tipo)) return html(ctx, 404, 'Templates', '<h1>Template não encontrado</h1>', null);
  const rascunho = { canal, tipo, assunto: campo(ctx, 'assunto'), corpo: campo(ctx, 'corpo'), destino: 'bloco' as const };
  const previsto = preverTemplate(canal, tipo, ctx.form.get('assunto'), ctx.form.get('corpo') ?? '');
  if (!previsto.ok) {
    return html(ctx, 422, 'Templates', paginaTemplates(await listarTemplates(ctx.app), ctx.sessao.csrf, null, rascunho), {
      tipo: 'erro',
      texto: previsto.aviso,
    });
  }
  html(
    ctx,
    200,
    'Templates',
    paginaTemplates(
      await listarTemplates(ctx.app),
      ctx.sessao.csrf,
      { canal, tipo, assunto: previsto.assunto, corpo: previsto.corpo },
      rascunho,
    ),
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
  if (!salvo.ok) {
    return html(
      ctx,
      422,
      'Templates',
      paginaTemplates(await listarTemplates(ctx.app), ctx.sessao.csrf, null, {
        canal,
        tipo,
        assunto: campo(ctx, 'assunto'),
        corpo: campo(ctx, 'corpo'),
        destino: 'bloco',
      }),
      { tipo: 'erro', texto: salvo.aviso },
    );
  }
  await flashERedireciona(ctx, '/templates', { tipo: 'ok', texto: 'Template salvo.' });
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
    telefone2fa: ctx.form.get('telefone_2fa') ?? '',
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
    evolutionUrl: ctx.form.get('evolution_url') ?? '',
    evolutionInstance: ctx.form.get('evolution_instance') ?? '',
    evolutionApiKey: ctx.form.get('evolution_api_key') ?? '',
    pixProvedor: ctx.form.get('pix_provedor') ?? 'mercadopago',
    pixChave: ctx.form.get('pix_chave') ?? '',
    pixRecebedor: ctx.form.get('pix_recebedor') ?? '',
    pixCidade: ctx.form.get('pix_cidade') ?? '',
    conciliacaoIntervaloMinutos: ctx.form.get('conciliacao_intervalo_minutos') ?? '60',
  });
  if (!salvo.ok) {
    const errosCampos = salvo.campo ? { [salvo.campo]: salvo.aviso } : null;
    return html(ctx, 422, 'Configuração', paginaConfiguracao(await lerConfigPublica(ctx.app), ctx.sessao.csrf, rascunhoConfig(ctx), errosCampos), {
      tipo: 'erro',
      texto: salvo.aviso,
    });
  }
  await flashERedireciona(ctx, '/configuracao', { tipo: 'ok', texto: 'Configuração salva.' });
});

rota('POST', '/configuracao/evolution', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const teste = await testarEvolution(ctx.app);
  await flashERedireciona(ctx, '/configuracao', { tipo: teste.ok ? 'ok' : 'erro', texto: teste.motivo });
});

rota('POST', '/configuracao/smtp', async (ctx) => {
  if (!ctx.sessao || !csrfConfere(ctx)) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const teste = await testarSmtp(ctx.app, ctx.form.get('email_teste') ?? '');
  await flashERedireciona(ctx, '/configuracao', { tipo: teste.ok ? 'ok' : 'erro', texto: teste.motivo });
});

function campo(ctx: Ctx, nome: string): string {
  return ctx.form.get(nome) ?? '';
}

function rascunhoPessoa(ctx: Ctx) {
  return {
    nome: campo(ctx, 'nome'),
    whatsapp: campo(ctx, 'whatsapp'),
    email: campo(ctx, 'email'),
    cpf: campo(ctx, 'cpf'),
    diaCobranca: campo(ctx, 'dia_cobranca'),
    validadePixDias: campo(ctx, 'validade_pix_dias'),
    diasAviso: campo(ctx, 'dias_aviso_inadimplencia'),
    canalEmail: marcado(ctx.form, 'canal_email'),
    canalWhatsapp: marcado(ctx.form, 'canal_whatsapp'),
  };
}

function rascunhoItem(ctx: Ctx, id: string | null): RascunhoItem {
  return {
    id,
    descricao: campo(ctx, 'descricao'),
    valor: campo(ctx, 'valor'),
    inicioMes: campo(ctx, 'inicio_mes'),
    inicioAno: campo(ctx, 'inicio_ano'),
    fimMes: campo(ctx, 'fim_mes'),
    fimAno: campo(ctx, 'fim_ano'),
  };
}

function rascunhoMes(ctx: Ctx) {
  return { mes: campo(ctx, 'mes'), ano: campo(ctx, 'ano') };
}

function rascunhoConfig(ctx: Ctx) {
  return {
    usuario: campo(ctx, 'usuario'),
    emailDono: campo(ctx, 'email_dono'),
    telefone2fa: campo(ctx, 'telefone_2fa'),
    smtpHost: campo(ctx, 'smtp_host'),
    smtpPorta: campo(ctx, 'smtp_porta'),
    smtpUsuario: campo(ctx, 'smtp_usuario'),
    smtpRemetenteNome: campo(ctx, 'smtp_remetente_nome'),
    smtpRemetenteEmail: campo(ctx, 'smtp_remetente_email'),
    smtpCriptografia: campo(ctx, 'smtp_criptografia'),
    evolutionUrl: campo(ctx, 'evolution_url'),
    evolutionInstance: campo(ctx, 'evolution_instance'),
    pixProvedor: campo(ctx, 'pix_provedor'),
    pixChave: campo(ctx, 'pix_chave'),
    pixRecebedor: campo(ctx, 'pix_recebedor'),
    pixCidade: campo(ctx, 'pix_cidade'),
    conciliacaoIntervaloMinutos: campo(ctx, 'conciliacao_intervalo_minutos'),
  };
}

function competenciaAtual(ctx: Ctx): Competencia {
  const hoje = partesNoFuso(ctx.app.clock());
  return { ano: hoje.year, mes: hoje.month };
}

async function corpoDashboard(
  ctx: Ctx,
  opcoes: { periodo?: Periodo; geracao?: ReturnType<typeof rascunhoMes>; modalConsulta?: string },
): Promise<string> {
  const atual = competenciaAtual(ctx);
  const periodo = opcoes.periodo ?? { inicio: atual, fim: atual };
  return paginaDashboard(await montarDashboard(ctx.app, periodo), ctx.sessao?.csrf ?? '', {
    geracao: opcoes.geracao ?? null,
    padraoGeracao: atual,
    modalConsulta: opcoes.modalConsulta ?? null,
  });
}

function parseAbaFicha(valor: string | null): AbaFicha {
  if (valor === 'lancamentos' || valor === 'historico') return valor;
  return 'informacoes';
}

async function itensUsadosEmCobranca(app: App, itens: { id: string }[]): Promise<Set<string>> {
  const usados = new Set<string>();
  if (!itens.length) return usados;
  const linhas = await consultar<{ item_id: string }>(
    app.pool,
    'SELECT DISTINCT item_id FROM linha_cobranca WHERE item_id = ANY($1::uuid[])',
    [itens.map((item) => item.id)],
  );
  for (const linha of linhas) usados.add(linha.item_id);
  return usados;
}

async function montarDadosFicha(ctx: Ctx, pessoa: Awaited<ReturnType<typeof obterPessoa>>, aba: AbaFicha): Promise<FichaPessoaDados | null> {
  if (!pessoa || !ctx.sessao) return null;
  const hoje = partesNoFuso(ctx.app.clock());
  const itens = await listarItens(ctx.app, pessoa.id);
  const historico = await listarHistorico(ctx.app, { pessoaId: pessoa.id, status: 'todas' });
  const linhasMapa = await listarLinhasDasCobrancas(ctx.app, historico.map((linha) => linha.id));
  const linhasCobranca: FichaPessoaDados['linhasCobranca'] = {};
  for (const [id, linhas] of linhasMapa.entries()) linhasCobranca[id] = linhas;
  return {
    aba,
    pessoa,
    diaEfetivo: diaEfetivo(pessoa.dia_cobranca, hoje.year, hoje.month),
    itens,
    itensUsados: await itensUsadosEmCobranca(ctx.app, itens),
    historico,
    linhasCobranca,
    csrfToken: ctx.sessao.csrf,
  };
}

async function corpoFichaPessoa(
  ctx: Ctx,
  pessoa: NonNullable<Awaited<ReturnType<typeof obterPessoa>>>,
  aba: AbaFicha,
  extras: Partial<Pick<FichaPessoaDados, 'rascunhoPessoa' | 'rascunhoItem' | 'geracao'>> = {},
): Promise<string> {
  const dados = await montarDadosFicha(ctx, pessoa, aba);
  if (!dados) return '<h1>Pessoa não encontrada</h1>';
  return paginaFichaPessoa({ ...dados, ...extras });
}

async function htmlPessoa(
  ctx: Ctx,
  pessoaId: string,
  rascunho: ReturnType<typeof rascunhoPessoa> | null,
  geracao: ReturnType<typeof rascunhoMes> | null,
  flash: Flash,
): Promise<void> {
  if (!ctx.sessao) return html(ctx, 403, 'Acesso', '<h1>Ação recusada</h1>', null);
  const pessoa = await obterPessoa(ctx.app, pessoaId);
  if (!pessoa) return html(ctx, 404, 'Não encontrada', '<h1>Pessoa não encontrada</h1>', null);
  const corpo = await corpoFichaPessoa(ctx, pessoa, 'informacoes', { rascunhoPessoa: rascunho, geracao });
  html(ctx, 422, pessoa.nome, corpo, flash);
}

async function htmlItens(ctx: Ctx, pessoaId: string, rascunho: RascunhoItem, flash: Flash): Promise<boolean> {
  if (!ctx.sessao) return false;
  const pessoa = await obterPessoa(ctx.app, pessoaId);
  if (!pessoa) return false;
  const corpo = await corpoFichaPessoa(ctx, pessoa, 'lancamentos', { rascunhoItem: rascunho });
  html(ctx, 422, pessoa.nome, corpo, flash);
  return true;
}

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
    fimAno: inteiroOpcional(ctx.form.get('fim_ano')),
    fimMes: inteiroOpcional(ctx.form.get('fim_mes')),
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
  const metodoPedido = req.method ?? 'GET';
  if (caminhoProibido(url.pathname)) {
    res.statusCode = 404;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    cabecalhosSemIndexacao(res);
    res.end();
    return;
  }
  if (url.pathname === '/robots.txt' && (metodoPedido === 'GET' || metodoPedido === 'HEAD')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    cabecalhosSeguranca(res);
    if (metodoPedido === 'HEAD') res.end();
    else res.end(CORPO_ROBOTS_TXT);
    return;
  }
  if ((metodoPedido === 'GET' || metodoPedido === 'HEAD') && url.pathname.startsWith('/estatico/')) {
    if (!servirEstatico(res, url.pathname, metodoPedido)) {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
  const raw = metodoPedido === 'GET' || metodoPedido === 'HEAD' ? '' : await lerCorpo(req);
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
