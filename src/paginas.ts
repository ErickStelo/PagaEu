import type { Flash } from './acesso.ts';
import type { CartaoPessoa, Detalhe, LinhaHistorico } from './consultas.ts';
import { formatarDataHora } from './domain/calendar.ts';
import { formatarReais } from './domain/money.ts';
import type { ConfigPublica, TemplateLinha } from './configuracao.ts';
import { variaveisDoCenario, type Canal, type TipoMensagem } from './domain/template.ts';
import type { Item, Pessoa } from './pessoas.ts';

export function escapar(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function e(valor: unknown): string {
  return escapar(valor);
}

const NOMES_TIPO: Record<string, string> = {
  cobranca: 'Cobrança',
  confirmacao: 'Confirmação de pagamento',
  inadimplencia: 'Aviso de inadimplência',
};

const NOMES_CANAL: Record<string, string> = { email: 'E-mail', whatsapp: 'WhatsApp' };
const NOMES_STATUS: Record<string, string> = { aberta: 'Aberta', paga: 'Paga', cancelada: 'Cancelada' };

type Secao = 'quem' | 'historico' | 'templates' | 'configuracao';

function secaoAtual(caminho: string): Secao {
  if (caminho.startsWith('/cobrancas')) return 'historico';
  if (caminho.startsWith('/templates')) return 'templates';
  if (caminho.startsWith('/configuracao')) return 'configuracao';
  return 'quem';
}

function itemNav(atual: Secao, id: Secao, href: string, nome: string): string {
  const ativo = atual === id ? ' class="ativo" aria-current="page"' : '';
  return `<a href="${href}"${ativo}>${nome}</a>`;
}

export function layout(opcoes: { titulo: string; corpo: string; autenticado: boolean; flash: Flash | null; caminho?: string }): string {
  const atual = secaoAtual(opcoes.caminho ?? '/');
  const nav = opcoes.autenticado
    ? `<aside>
        <a class="marca" href="/">PagaEu</a>
        <nav>
          ${itemNav(atual, 'quem', '/', 'Quem deve')}
          ${itemNav(atual, 'historico', '/cobrancas', 'Histórico')}
          ${itemNav(atual, 'templates', '/templates', 'Templates')}
          ${itemNav(atual, 'configuracao', '/configuracao', 'Configuração')}
        </nav>
        <form method="post" action="/sair"><button class="sair" type="submit">Sair</button></form>
      </aside>`
    : `<section class="marca-login">
        <p class="olho">Console PIX</p>
        <strong>PagaEu</strong>
        <p>Cobrança PIX do mês, num painel só seu.</p>
        <ul>
          <li>Quem deve</li>
          <li>PIX do Mercado Pago</li>
          <li>Aviso por e-mail e WhatsApp</li>
        </ul>
      </section>`;
  const flash = opcoes.flash
    ? `<div class="flash ${opcoes.flash.tipo === 'ok' ? 'ok' : 'erro'}">${e(opcoes.flash.texto)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(opcoes.titulo)} · PagaEu</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@500;600&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: dark; --bg:#070B14; --paper:#101828; --ink:#E8EEF9; --muted:#A8B6CF; --line:rgba(255,255,255,.08); --ciano:#22D3EE; --ciano-ink:#04252B; --ok:#6EE7B7; --ok-bg:rgba(52,211,153,.14); --red:#FCA5A5; --red-bg:rgba(248,113,113,.14); --amber:#FCD34D; --amber-bg:rgba(252,211,77,.12); --gray:#7E8BA3; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: Geist, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
    body.app { display:grid; grid-template-columns: 240px minmax(0, 1fr); }
    aside { position:sticky; top:0; height:100vh; display:flex; flex-direction:column; gap:18px; padding:22px 14px; background:#0B1220; border-right:1px solid var(--line); }
    .marca, aside .marca { font-family: "Space Grotesk", sans-serif; font-size:1.35rem; font-weight:600; letter-spacing:-.03em; color:var(--ink); text-decoration:none; padding:0 10px; }
    nav { display:flex; flex-direction:column; gap:4px; }
    nav a { color:var(--muted); text-decoration:none; font-weight:600; border-radius:8px; padding:10px 12px; }
    nav a:hover { color:var(--ink); background:rgba(255,255,255,.04); }
    nav a.ativo { color:var(--ciano); background:rgba(34,211,238,.1); }
    aside form { margin-top:auto; }
    button.sair { width:100%; text-align:left; background:transparent; color:var(--muted); border:1px solid var(--line); }
    main { padding:32px 32px 72px; min-width:0; }
    h1, h2 { font-family: "Space Grotesk", sans-serif; font-weight:600; letter-spacing:-.03em; }
    h1 { margin:0 0 8px; font-size:2rem; }
    h2 { margin:0 0 12px; font-size:1.15rem; }
    .sub, .trilha { color:var(--muted); margin:0 0 22px; }
    .trilha { margin-bottom:8px; font-size:.92rem; }
    a { color:var(--ciano); }
    .metricas { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px; }
    .metrica { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
    .metrica span { display:block; color:var(--muted); font-size:.8rem; letter-spacing:.04em; text-transform:uppercase; }
    .metrica strong { display:block; margin-top:6px; font-family:"JetBrains Mono", ui-monospace, monospace; font-size:1.35rem; font-weight:600; }
    .metrica .ciano { color:var(--ciano); }
    .metrica .ok { color:var(--ok); }
    .metrica .amber { color:var(--amber); }
    .cards { display:grid; gap:14px; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); }
    .card, form.bloco, .bloco, section.bloco { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:16px 18px; }
    .topo { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; margin-bottom:16px; }
    .dinheiro { font-family:"JetBrains Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; font-weight:600; }
    .muted { color:var(--muted); }
    .row { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
    .row > label { flex:1 1 180px; }
    .row input, .row select { width:100%; }
    form.bloco, section.bloco { margin-bottom:16px; }
    form.bloco h2:not(:first-of-type) { margin-top:28px; padding-top:20px; border-top:1px solid var(--line); }
    label { display:flex; flex-direction:column; gap:6px; font-size:.92rem; color:var(--muted); min-width:0; }
    input, select, textarea { font:inherit; color:var(--ink); background:#0B1220; border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:9px 11px; }
    input:focus, select:focus, textarea:focus, button:focus-visible, a:focus-visible { outline:2px solid var(--ciano); outline-offset:2px; }
    textarea { width:100%; min-height:180px; }
    textarea.codigo { min-height:72px; }
    button, .botao { background:var(--ciano); color:var(--ciano-ink); border:0; border-radius:8px; padding:9px 14px; font:inherit; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
    button.secundario, .botao.secundario { background:transparent; color:var(--ink); border:1px solid var(--line); }
    button.perigo { background:#7F1D1D; color:#FEE2E2; }
    button.destaque { background:#047857; color:#ECFDF5; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
    th:last-child, td:last-child { width:1%; white-space:nowrap; }
    td:last-child .acoes { margin-top:0; flex-wrap:nowrap; }
    th { color:var(--muted); font-size:.75rem; letter-spacing:.04em; text-transform:uppercase; font-weight:600; }
    .flash { white-space:pre-wrap; border-radius:8px; padding:12px 14px; margin-bottom:16px; }
    .flash.ok { background:var(--ok-bg); color:var(--ok); }
    .flash.erro, .alerta { background:var(--amber-bg); color:#FDE68A; border:1px solid rgba(252,211,77,.28); border-radius:8px; padding:12px 14px; margin:10px 0; }
    .ponto { display:inline-flex; align-items:center; gap:6px; margin-right:10px; }
    .ponto i { width:9px; height:9px; border-radius:50%; display:inline-block; background:var(--gray); }
    .ponto.enviado i { background:var(--ok); }
    .ponto.falha i { background:#F87171; }
    .tag { display:inline-flex; align-items:center; border-radius:8px; padding:2px 8px; background:rgba(255,255,255,.06); font-size:.8rem; }
    .tag.ok { color:var(--ok); background:var(--ok-bg); }
    .tag.off { color:var(--red); background:var(--red-bg); }
    .tag.aberta { color:#67E8F9; background:rgba(34,211,238,.12); }
    .acoes, .checks { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px; }
    .acoes { justify-content:flex-end; }
    .checks label, label:has(input[type="checkbox"]), label:has(input[type="radio"]) { flex-direction:row; align-items:center; color:var(--ink); }
    input[type="checkbox"], input[type="radio"] { accent-color:var(--ciano); width:1rem; height:1rem; }
    .codigo { font-family:"JetBrains Mono", ui-monospace, monospace; word-break:break-all; }
    .ficha { display:grid; grid-template-columns:minmax(0, 1fr) minmax(260px, 340px); gap:16px; align-items:start; }
    .lateral { display:grid; gap:14px; }
    .lateral .acoes { justify-content:flex-start; }
    .lateral .acoes .botao, .lateral .acoes button { width:100%; text-align:center; }
    .timeline-mensagens { list-style:none; margin:0; padding:4px 0 0; }
    .timeline-mensagens li { position:relative; margin:0; padding:0 0 18px 26px; }
    .timeline-mensagens li::before { content:""; position:absolute; left:5px; top:5px; width:10px; height:10px; border-radius:50%; background:var(--gray); box-shadow:0 0 0 3px var(--paper); }
    .timeline-mensagens li.enviado::before { background:var(--ok); }
    .timeline-mensagens li.falha::before { background:#F87171; }
    .timeline-mensagens li::after { content:""; position:absolute; left:9px; top:18px; bottom:0; width:2px; background:var(--line); }
    .timeline-mensagens li:last-child { padding-bottom:0; }
    .timeline-mensagens li:last-child::after { display:none; }
    .timeline-mensagens .timeline-quando { margin:0 0 4px; font-size:.85rem; }
    .timeline-mensagens .timeline-titulo { margin:0; }
    .timeline-mensagens .timeline-motivo { margin:6px 0 0; font-size:.9rem; }
    .modal { border:1px solid var(--line); border-radius:12px; padding:0; margin:auto; background:var(--paper); color:var(--ink); max-width:min(440px, calc(100vw - 32px)); width:100%; }
    .modal::backdrop { background:rgba(7,11,20,.75); }
    .modal form { padding:20px 22px 22px; display:grid; gap:14px; margin:0; }
    .modal-cabeca { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .modal-cabeca h2 { margin:0; font-size:1.15rem; }
    .modal-fechar-x { min-width:2.25rem; padding:2px 8px; line-height:1.2; }
    .modal-rodape { justify-content:flex-end; margin-top:4px; }
    body.porta { display:grid; grid-template-columns:minmax(280px, 1.05fr) minmax(320px, 1fr); grid-template-rows:1fr; }
    .marca-login { padding:64px 56px; background:#0B1220; border-top:3px solid var(--ciano); }
    .marca-login .olho { margin:0 0 18px; color:var(--ciano); font-family:"JetBrains Mono", ui-monospace, monospace; font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; }
    .marca-login strong { display:block; font-family:"Space Grotesk", sans-serif; font-size:3rem; letter-spacing:-.04em; }
    .marca-login p { color:var(--muted); font-size:1.05rem; max-width:28ch; }
    .marca-login ul { margin:28px 0 0; padding:0; list-style:none; display:grid; gap:10px; }
    .marca-login li { display:flex; align-items:center; gap:10px; }
    .marca-login li::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--ciano); }
    body.porta main { place-self:center; width:min(440px, calc(100% - 48px)); background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:28px; }
    body.porta form { display:grid; gap:14px; }
    body.porta form + form { margin-top:4px; }
    body.porta .sub { margin-bottom:18px; }
    @media (max-width: 720px) {
      .ficha { display:block; }
      .lateral { margin-top:16px; }
      .lateral .acoes .botao, .lateral .acoes button { width:auto; }
    }
    @media (max-width: 720px) {
      body.app, body.porta { display:block; }
      aside { position:static; height:auto; border-right:0; border-bottom:1px solid var(--line); }
      nav { flex-direction:row; flex-wrap:wrap; }
      aside form { margin-top:12px; }
      main, .marca-login { padding:20px 16px 48px; }
      .metrica, .card { margin-bottom:12px; }
      table { display:block; overflow:auto; }
    }
    main:focus { outline:none; }
  </style>
  <link rel="stylesheet" href="/estatico/toastr.min.css">
  <style>
    #toast-container > div { opacity:1; box-shadow:none; border-radius:8px; background-repeat:no-repeat; background-position:15px center; }
    #toast-container > .toast { font-family: Geist, "Segoe UI", sans-serif; }
    #toast-container > .toast-success { background-color:#065F46; }
    #toast-container > .toast-error { background-color:#7F1D1D; }
    #toast-container > .toast-info { background-color:#155E75; }
    #toast-container > .toast-warning { background-color:#92400E; }
    .toast-message { white-space:pre-wrap; }
  </style>
</head>
<body class="${opcoes.autenticado ? 'app' : 'porta'}">
  ${nav}
  <main tabindex="-1">
    ${flash}
    ${opcoes.corpo}
  </main>
  <script src="/estatico/jquery.min.js"></script>
  <script src="/estatico/toastr.min.js"></script>
  <script src="/estatico/painel.js"></script>
</body>
</html>`;
}

function etiqueta(texto: string, tipo: 'ok' | 'off' | 'aberta' | '' = ''): string {
  return `<span class="tag ${tipo}">${e(texto)}</span>`;
}

function tagStatus(status: string): string {
  const nome = NOMES_STATUS[status] ?? status;
  if (status === 'paga') return etiqueta(nome, 'ok');
  if (status === 'cancelada') return etiqueta(nome, 'off');
  if (status === 'aberta') return etiqueta(nome, 'aberta');
  return etiqueta(nome);
}

function indicador(nome: string, valor: CartaoPessoa['email']): string {
  if (!valor) return `<span class="ponto"><i></i>${e(nome)} não enviado</span>`;
  const classe = valor.resultado === 'enviado' ? 'enviado' : 'falha';
  const texto = valor.resultado === 'enviado' ? 'enviado' : 'falha';
  const motivo = valor.motivo ? ` — ${e(valor.motivo)}` : '';
  return `<span class="ponto ${classe}"><i></i>${e(nome)} ${texto}${motivo}</span>`;
}

function timelineMensagens(detalhe: Detalhe): string {
  const eventos = detalhe.indicadores.flatMap((item) =>
    item.tentativas.map((tentativa) => ({
      tentadoEm: tentativa.tentadoEm,
      tipo: item.tipo,
      canal: item.canal,
      resultado: tentativa.resultado,
      motivo: tentativa.motivo,
    })),
  );
  eventos.sort((a, b) => a.tentadoEm.getTime() - b.tentadoEm.getTime());
  if (!eventos.length) return '<p class="muted">Nenhuma mensagem enviada ainda.</p>';
  const itens = eventos.map((evento) => {
    const classe = evento.resultado === 'enviado' ? 'enviado' : 'falha';
    const rotulo = evento.resultado === 'enviado' ? 'Enviado' : 'Falha no envio';
    const titulo = `${NOMES_TIPO[evento.tipo] ?? evento.tipo} · ${NOMES_CANAL[evento.canal] ?? evento.canal}`;
    const detalheFalha = evento.motivo ? `<p class="muted timeline-motivo">${e(evento.motivo)}</p>` : '';
    return `<li class="${classe}">
        <p class="timeline-quando muted">${e(formatarDataHora(evento.tentadoEm))}</p>
        <p class="timeline-titulo"><strong>${e(titulo)}</strong> · ${e(rotulo)}</p>
        ${detalheFalha}
      </li>`;
  }).join('');
  return `<ol class="timeline-mensagens">${itens}</ol>`;
}

function csrf(token: string): string {
  return `<input type="hidden" name="csrf" value="${e(token)}">`;
}

function canaisMensagem(detalhe: Detalhe, tipo: TipoMensagem): Canal[] {
  return (['email', 'whatsapp'] as const).filter((canal) => detalhe.podeReenviar[`${tipo}:${canal}`]);
}

function canaisMensagemFlags(email: boolean, whatsapp: boolean): { email: boolean; whatsapp: boolean } {
  return { email, whatsapp };
}

function botaoModal(id: string, rotulo: string, classe = 'secundario'): string {
  return `<button type="button" class="${classe}" data-modal-abrir="${e(id)}">${e(rotulo)}</button>`;
}

function modalMensagem(
  idModal: string,
  cobrancaId: string,
  csrfToken: string,
  tipo: TipoMensagem,
  titulo: string,
  textoEnviar: string,
  canais: { email: boolean; whatsapp: boolean },
): string {
  if (!canais.email && !canais.whatsapp) return '';
  const marcadores = [
    canais.email ? '<label><input type="checkbox" name="canal" value="email" checked> E-mail</label>' : '',
    canais.whatsapp ? '<label><input type="checkbox" name="canal" value="whatsapp" checked> WhatsApp</label>' : '',
  ].join('');
  return `<dialog class="modal" id="${e(idModal)}">
    <form method="post" action="/cobrancas/${e(cobrancaId)}/reenviar">
      ${csrf(csrfToken)}
      <input type="hidden" name="tipo" value="${e(tipo)}">
      <header class="modal-cabeca">
        <h2>${e(titulo)}</h2>
        <button type="button" class="secundario modal-fechar modal-fechar-x" aria-label="Fechar">×</button>
      </header>
      <p class="muted">Marque os canais em que deseja enviar.</p>
      <div class="checks">${marcadores}</div>
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">Voltar</button>
        <button type="submit">${e(textoEnviar)}</button>
      </div>
    </form>
  </dialog>`;
}

function modalBaixaManual(detalhe: Detalhe, csrfToken: string): string {
  if (!detalhe.acoes.baixaManual) return '';
  const id = `modal-baixa-${detalhe.id}`;
  const pixOpcoes = detalhe.pixAtivo
    ? `<div class="checks"><label><input type="radio" name="pix" value="invalidar" checked> Invalidar o PIX</label>
      <label><input type="radio" name="pix" value="manter"> Manter o PIX ativo</label></div>`
    : '';
  return `<dialog class="modal" id="${e(id)}">
    <form id="baixa-cobranca-${e(detalhe.id)}" method="post" action="/cobrancas/${e(detalhe.id)}/baixa">
      ${csrf(csrfToken)}
      <header class="modal-cabeca">
        <h2>Confirmar baixa</h2>
        <button type="button" class="secundario modal-fechar modal-fechar-x" aria-label="Fechar">×</button>
      </header>
      ${pixOpcoes ? `<p class="muted">O que fazer com o PIX ativo?</p>${pixOpcoes}` : '<p class="muted">A cobrança será marcada como paga manualmente.</p>'}
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">Voltar</button>
        <button class="destaque" type="submit">Confirmar baixa</button>
      </div>
    </form>
  </dialog>`;
}

function modalCancelarCobranca(detalhe: Detalhe, csrfToken: string, motivo: string): string {
  if (!detalhe.acoes.cancelar) return '';
  const id = `modal-cancelar-${detalhe.id}`;
  const inicial = motivo ? ' data-modal-inicial' : '';
  return `<dialog class="modal" id="${e(id)}"${inicial}>
    <form id="cancelar-cobranca-${e(detalhe.id)}" method="post" action="/cobrancas/${e(detalhe.id)}/cancelar">
      ${csrf(csrfToken)}
      <header class="modal-cabeca">
        <h2>Cancelar cobrança</h2>
        <button type="button" class="secundario modal-fechar modal-fechar-x" aria-label="Fechar">×</button>
      </header>
      <label>Motivo<input name="motivo" required maxlength="500" value="${e(motivo)}"></label>
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">Voltar</button>
        <button class="perigo" type="submit">Confirmar cancelamento</button>
      </div>
    </form>
  </dialog>`;
}

function modaisAcaoDetalhe(detalhe: Detalhe, csrfToken: string, motivo: string): string {
  const cobranca = canaisMensagemFlags(
    detalhe.podeReenviar['cobranca:email'] ?? false,
    detalhe.podeReenviar['cobranca:whatsapp'] ?? false,
  );
  const inadimplencia = canaisMensagemFlags(
    detalhe.podeReenviar['inadimplencia:email'] ?? false,
    detalhe.podeReenviar['inadimplencia:whatsapp'] ?? false,
  );
  const confirmacao = canaisMensagemFlags(
    detalhe.podeReenviar['confirmacao:email'] ?? false,
    detalhe.podeReenviar['confirmacao:whatsapp'] ?? false,
  );
  return [
    modalMensagem(`modal-reenviar-cobranca-${detalhe.id}`, detalhe.id, csrfToken, 'cobranca', 'Reenviar cobrança', 'Enviar', cobranca),
    modalMensagem(`modal-inadimplencia-${detalhe.id}`, detalhe.id, csrfToken, 'inadimplencia', 'Inadimplência', 'Enviar aviso', inadimplencia),
    modalMensagem(`modal-confirmacao-${detalhe.id}`, detalhe.id, csrfToken, 'confirmacao', 'Confirmação de pagamento', 'Enviar', confirmacao),
    modalBaixaManual(detalhe, csrfToken),
    modalCancelarCobranca(detalhe, csrfToken, motivo),
  ].join('');
}

function acoesDaCobranca(
  id: string,
  csrfToken: string,
  opcoes: { copia: string | null; email: boolean; whatsapp: boolean },
): string {
  const copiar = opcoes.copia
    ? `<button type="button" class="secundario" data-texto="${e(opcoes.copia)}">Copiar chave PIX</button>`
    : '';
  const reenviar = opcoes.email || opcoes.whatsapp
    ? botaoModal(`modal-reenviar-cobranca-${id}`, 'Reenviar')
    : '';
  const modal = opcoes.email || opcoes.whatsapp
    ? modalMensagem(`modal-reenviar-cobranca-${id}`, id, csrfToken, 'cobranca', 'Reenviar cobrança', 'Enviar', canaisMensagemFlags(opcoes.email, opcoes.whatsapp))
    : '';
  if (!copiar && !reenviar) return '';
  return `<div class="acoes">${copiar}${reenviar}</div>${modal}`;
}

function botoesAcaoDetalhe(detalhe: Detalhe, csrfToken: string, motivoCancelamento = ''): string {
  const partes: string[] = [];
  if (detalhe.pixAtivo?.copia) {
    partes.push(`<button type="button" class="secundario" data-texto="${e(detalhe.pixAtivo.copia)}">Copiar chave PIX</button>`);
  }
  if (canaisMensagem(detalhe, 'cobranca').length) {
    partes.push(botaoModal(`modal-reenviar-cobranca-${detalhe.id}`, 'Reenviar'));
  }
  if (canaisMensagem(detalhe, 'inadimplencia').length) {
    partes.push(botaoModal(`modal-inadimplencia-${detalhe.id}`, 'Enviar inadimplência'));
  }
  if (canaisMensagem(detalhe, 'confirmacao').length) {
    partes.push(botaoModal(`modal-confirmacao-${detalhe.id}`, 'Reenviar confirmação'));
  }
  if (detalhe.acoes.novoPix) {
    partes.push(`<form method="post" action="/cobrancas/${e(detalhe.id)}/novo-pix">${csrf(csrfToken)}<button type="submit">Gerar novo PIX</button></form>`);
  }
  if (detalhe.acoes.invalidarPix) {
    partes.push(`<form method="post" action="/cobrancas/${e(detalhe.id)}/invalidar-pix">${csrf(csrfToken)}<button class="secundario" type="submit">Invalidar PIX</button></form>`);
  }
  if (detalhe.acoes.tentarEmissao) {
    partes.push(`<form method="post" action="/cobrancas/${e(detalhe.id)}/tentar-emissao">${csrf(csrfToken)}<button type="submit">Tentar emissão de novo</button></form>`);
  }
  if (detalhe.acoes.baixaManual) {
    partes.push(botaoModal(`modal-baixa-${detalhe.id}`, 'Confirmar baixa', 'destaque'));
  }
  if (detalhe.acoes.cancelar && !motivoCancelamento) {
    partes.push(botaoModal(`modal-cancelar-${detalhe.id}`, 'Cancelar cobrança', 'perigo'));
  }
  return partes.join('');
}

export type RascunhoPessoa = {
  nome: string;
  whatsapp: string;
  email: string;
  cpf: string;
  diaCobranca: string;
  validadePixDias: string;
  diasAviso: string;
  canalEmail: boolean;
  canalWhatsapp: boolean;
};

export type RascunhoMes = { mes: string; ano: string };

export type RascunhoItem = {
  id: string | null;
  descricao: string;
  valor: string;
  inicioMes: string;
  inicioAno: string;
  fimMes: string;
  fimAno: string;
};

export type RascunhoConfig = {
  usuario: string;
  emailDono: string;
  smtpHost: string;
  smtpPorta: string;
  smtpUsuario: string;
  smtpRemetenteNome: string;
  smtpRemetenteEmail: string;
  smtpCriptografia: string;
  evolutionUrl: string;
  evolutionInstance: string;
};

export type RascunhoTemplate = {
  canal: string;
  tipo: string;
  assunto: string;
  corpo: string;
  destino: 'previa' | 'bloco';
};

export function paginaLogin(erro: string | null, etapaCodigo: boolean, valor = ''): string {
  const aviso = erro ? `<p class="alerta">${e(erro)}</p>` : '';
  if (etapaCodigo) {
    return `<h1>Código por e-mail</h1><p class="sub">Enviamos um código de 6 dígitos. Ele vale 10 minutos.</p>${aviso}
      <form method="post" action="/login/codigo">
        <label>Código<input name="codigo" inputmode="numeric" autocomplete="one-time-code" required value="${e(valor)}"></label>
        <div class="acoes"><button type="submit">Entrar</button></div>
      </form>
      <form method="post" action="/login/reenviar"><div class="acoes"><button class="secundario" type="submit">Reenviar código</button></div></form>`;
  }
  return `<h1>Entrar</h1><p class="sub">Painel do dono.</p>${aviso}
    <form method="post" action="/login">
      <label>Usuário<input name="usuario" autocomplete="username" required value="${e(valor)}"></label>
      <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <div class="acoes"><button type="submit">Continuar</button></div>
    </form>
    <p class="muted">O código de 6 dígitos chega no e-mail do dono.</p>`;
}

export function paginaQuemDeve(cartoes: CartaoPessoa[], csrfToken: string, hoje: string, geracao: RascunhoMes | null = null): string {
  const emAberto = cartoes.reduce((soma, cartao) => soma + (cartao.cobrancaId ? cartao.valorCentavos : 0), 0);
  const ativas = cartoes.filter((cartao) => cartao.pessoa.ativa).length;
  const alertas = cartoes.filter((cartao) => cartao.alertaItensPagos || cartao.excedente || cartao.divergencia).length;
  const lista = cartoes.map((cartao) => {
    const alertas = [
      cartao.alertaItensPagos ? `A vigente inclui itens já pagos por um PIX antigo${cartao.linhasAfetadas.length ? `: ${cartao.linhasAfetadas.join(', ')}` : ''}.` : '',
      cartao.excedente ? 'Pagamento excedente.' : '',
      cartao.divergencia ? 'Divergência de valor.' : '',
    ].filter(Boolean);
    return `<article class="card">
      <div class="topo">
        <div><a href="/pessoas/${e(cartao.pessoa.id)}"><strong>${e(cartao.pessoa.nome)}</strong></a>
          ${cartao.pessoa.ativa ? etiqueta('Ativa', 'ok') : etiqueta('Inativa', 'off')}
          <div class="muted">Dia ${cartao.pessoa.dia_cobranca} · efetivo ${cartao.diaEfetivo}${cartao.pessoa.dia_cobranca_pendente ? ` · pendente ${cartao.pessoa.dia_cobranca_pendente} a partir de ${String(cartao.pessoa.dia_pendente_mes).padStart(2, '0')}/${cartao.pessoa.dia_pendente_ano}` : ''}</div>
        </div>
        <div class="dinheiro">${formatarReais(cartao.valorCentavos)}</div>
      </div>
      <p>${cartao.competencia ? `Vigente ${e(cartao.competencia)}` : 'Sem cobrança vigente'} · PIX ${e(cartao.pixTexto)}</p>
      <div>${indicador('E-mail', cartao.email)}${indicador('WhatsApp', cartao.whatsapp)}</div>
      ${alertas.map((texto) => `<p class="alerta">${e(texto)}</p>`).join('')}
      ${cartao.cobrancaId ? `<a href="/cobrancas/${e(cartao.cobrancaId)}">Abrir cobrança</a>` : ''}
      ${cartao.cobrancaId ? acoesDaCobranca(cartao.cobrancaId, csrfToken, { copia: cartao.copiaPix, email: cartao.podeEmail, whatsapp: cartao.podeWhatsapp }) : ''}
    </article>`;
  }).join('');
  return `<div class="topo"><div><h1>Quem deve</h1><p class="sub">Hoje, ${e(hoje)}. O valor é só o da cobrança vigente.</p></div>
    <a class="botao" href="/pessoas/nova">Nova pessoa</a></div>
    <section class="metricas" aria-label="Resumo">
      <article class="metrica"><span>Em aberto</span><strong class="ciano">${formatarReais(emAberto)}</strong></article>
      <article class="metrica"><span>Pessoas ativas</span><strong class="ok">${ativas}</strong></article>
      <article class="metrica"><span>Com alerta</span><strong class="amber">${alertas}</strong></article>
    </section>
    <section class="bloco">
      <h2>Pagamentos no Mercado Pago</h2>
      <p class="muted">Consulta o PIX das cobranças abertas. Se estava pendente e agora consta como pago, a cobrança é quitada e a confirmação é enviada.</p>
      <form method="post" action="/cobrancas/consultar">${csrf(csrfToken)}
        <div class="acoes"><button type="submit">Consultar cobranças abertas</button></div>
      </form>
    </section>
    <form class="bloco" method="post" action="/lote">
      ${csrf(csrfToken)}
      <h2>Gerar cobranças do mês</h2>
      <div class="row">
        <label>Mês<input name="mes" type="number" min="1" max="12" required value="${e(geracao?.mes ?? '')}"></label>
        <label>Ano<input name="ano" type="number" min="2000" max="2100" required value="${e(geracao?.ano ?? '')}"></label>
        <button type="submit">Gerar cobranças do mês</button>
      </div>
    </form>
    <div class="cards">${lista || '<p>Nenhuma pessoa cadastrada.</p>'}</div>`;
}

export function paginaPessoa(
  pessoa: Pessoa | null,
  efetivo: number | null,
  csrfToken: string,
  itensHref: string | null,
  rascunho: RascunhoPessoa | null = null,
  geracao: RascunhoMes | null = null,
): string {
  const nome = rascunho?.nome ?? pessoa?.nome ?? '';
  const whatsapp = rascunho?.whatsapp ?? pessoa?.whatsapp ?? '';
  const email = rascunho?.email ?? pessoa?.email ?? '';
  const cpf = rascunho?.cpf ?? pessoa?.cpf ?? '';
  const dia = rascunho ? rascunho.diaCobranca : String(pessoa?.dia_cobranca_pendente ?? pessoa?.dia_cobranca ?? 10);
  const validade = rascunho ? rascunho.validadePixDias : String(pessoa?.validade_pix_dias ?? 10);
  const avisoDias = rascunho ? rascunho.diasAviso : String(pessoa?.dias_aviso_inadimplencia ?? 5);
  const emailLigado = rascunho ? rascunho.canalEmail : !pessoa || pessoa.canal_email;
  const whatsappLigado = rascunho ? rascunho.canalWhatsapp : !pessoa || pessoa.canal_whatsapp;
  return `<h1>${pessoa ? e(pessoa.nome) : 'Nova pessoa'}</h1>
    ${pessoa ? `<p class="sub">Dia efetivo deste mês: ${efetivo}.${pessoa.dia_cobranca_pendente ? ` Dia ${pessoa.dia_cobranca_pendente} vale a partir de ${String(pessoa.dia_pendente_mes).padStart(2, '0')}/${pessoa.dia_pendente_ano}.` : ''}</p>` : '<p class="sub">E-mail e WhatsApp começam ligados. O PIX vale 10 dias e o aviso sai 5 dias depois do vencimento.</p>'}
    <form class="bloco" method="post" action="${pessoa ? `/pessoas/${e(pessoa.id)}` : '/pessoas'}">
      ${csrf(csrfToken)}
      <div class="row">
        <label>Nome<input name="nome" required maxlength="120" value="${e(nome)}"></label>
        <label>WhatsApp<input name="whatsapp" required value="${e(whatsapp)}" placeholder="11999999999"></label>
        <label>E-mail<input name="email" type="email" required value="${e(email)}"></label>
        <label>CPF<input name="cpf" value="${e(cpf)}" placeholder="opcional"></label>
        <label>Dia de cobrança<input name="dia_cobranca" type="number" min="1" max="31" required value="${e(dia)}"></label>
        <label>Validade do PIX (dias)<input name="validade_pix_dias" type="number" min="1" max="30" required value="${e(validade)}"></label>
        <label>Dias para o aviso<input name="dias_aviso_inadimplencia" type="number" min="1" max="60" required value="${e(avisoDias)}"></label>
      </div>
      <div class="checks">
        <label><input type="checkbox" name="canal_email" value="1" ${emailLigado ? 'checked' : ''}> E-mail</label>
        <label><input type="checkbox" name="canal_whatsapp" value="1" ${whatsappLigado ? 'checked' : ''}> WhatsApp</label>
      </div>
      <div class="acoes"><button type="submit">Salvar</button></div>
    </form>
    ${pessoa ? `<div class="acoes">
      <form method="post" action="/pessoas/${e(pessoa.id)}/ativa">${csrf(csrfToken)}<input type="hidden" name="ativa" value="${pessoa.ativa ? '0' : '1'}"><button class="secundario" type="submit">${pessoa.ativa ? 'Inativar' : 'Reativar'}</button></form>
      <a class="botao secundario" href="${e(itensHref)}">Itens</a>
      <a class="botao secundario" href="/cobrancas?pessoa=${e(pessoa.id)}">Histórico</a>
    </div>
    <form class="bloco" method="post" action="/pessoas/${e(pessoa.id)}/gerar">
      ${csrf(csrfToken)}
      <h2>Gerar cobrança</h2>
      <div class="row">
        <label>Mês<input name="mes" type="number" min="1" max="12" required value="${e(geracao?.mes ?? '')}"></label>
        <label>Ano<input name="ano" type="number" min="2000" max="2100" required value="${e(geracao?.ano ?? '')}"></label>
        <button type="submit">Gerar cobrança</button>
      </div>
    </form>` : ''}`;
}

function valoresItem(item: Item | null, rascunho: RascunhoItem | null, novo: boolean): RascunhoItem {
  const deste = rascunho && (novo ? rascunho.id === null : rascunho.id === item?.id);
  if (deste && rascunho) return rascunho;
  if (!item) return { id: null, descricao: '', valor: '', inicioMes: '', inicioAno: '', fimMes: '', fimAno: '' };
  return {
    id: item.id,
    descricao: item.descricao,
    valor: formatarReais(item.valor_centavos).replace('R$ ', ''),
    inicioMes: String(item.inicio_mes),
    inicioAno: String(item.inicio_ano),
    fimMes: item.fim_mes === null ? '' : String(item.fim_mes),
    fimAno: item.fim_ano === null ? '' : String(item.fim_ano),
  };
}

function fimExibido(mes: number | null, ano: number | null): string {
  if (mes === null || ano === null) return '—';
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

export function paginaItens(pessoa: Pessoa, itens: Item[], usados: Set<string>, csrfToken: string, rascunho: RascunhoItem | null = null): string {
  const linhas = itens.map((item) => {
    const valores = valoresItem(item, rascunho, false);
    return `<tr>
      <td>${e(item.descricao)}</td>
      <td class="dinheiro">${formatarReais(item.valor_centavos)}</td>
      <td>${String(item.inicio_mes).padStart(2, '0')}/${item.inicio_ano}</td>
      <td>${fimExibido(item.fim_mes, item.fim_ano)}</td>
      <td>${usados.has(item.id) ? 'em cobrança' : `<form method="post" action="/itens/${e(item.id)}/excluir">${csrf(csrfToken)}<button class="secundario" type="submit">Excluir</button></form>`}</td>
    </tr>
    <tr><td colspan="5">
      <form method="post" action="/itens/${e(item.id)}">${csrf(csrfToken)}
        <div class="row">
          <input type="hidden" name="pessoa_id" value="${e(pessoa.id)}">
          <label>Descrição<input name="descricao" maxlength="200" required value="${e(valores.descricao)}"></label>
          <label>Valor<input name="valor" required value="${e(valores.valor)}"></label>
          <label>Início mês<input name="inicio_mes" type="number" min="1" max="12" value="${e(valores.inicioMes)}"></label>
          <label>Início ano<input name="inicio_ano" type="number" min="2000" max="2100" value="${e(valores.inicioAno)}"></label>
          <label>Fim mês<input name="fim_mes" type="number" min="1" max="12" placeholder="opcional" value="${e(valores.fimMes)}"></label>
          <label>Fim ano<input name="fim_ano" type="number" min="2000" max="2100" placeholder="opcional" value="${e(valores.fimAno)}"></label>
          <button type="submit">Atualizar</button>
        </div>
      </form>
    </td></tr>`;
  }).join('');
  const novo = valoresItem(null, rascunho, true);
  return `<h1>Itens de ${e(pessoa.nome)}</h1><p class="sub">O fim é opcional. Sem ele, o item continua em todo mês a partir do início. Início igual ao fim é cobrança única.</p>
    <form class="bloco" method="post" action="/pessoas/${e(pessoa.id)}/itens">${csrf(csrfToken)}
      <div class="row">
        <label>Descrição<input name="descricao" maxlength="200" required value="${e(novo.descricao)}"></label>
        <label>Valor<input name="valor" required placeholder="1.150,00" value="${e(novo.valor)}"></label>
        <label>Início mês<input name="inicio_mes" type="number" min="1" max="12" required value="${e(novo.inicioMes)}"></label>
        <label>Início ano<input name="inicio_ano" type="number" min="2000" max="2100" required value="${e(novo.inicioAno)}"></label>
        <label>Fim mês<input name="fim_mes" type="number" min="1" max="12" placeholder="opcional" value="${e(novo.fimMes)}"></label>
        <label>Fim ano<input name="fim_ano" type="number" min="2000" max="2100" placeholder="opcional" value="${e(novo.fimAno)}"></label>
        <button type="submit">Adicionar</button>
      </div>
    </form>
    <table><thead><tr><th>Descrição</th><th>Valor</th><th>Início</th><th>Fim</th><th></th></tr></thead><tbody>${linhas}</tbody></table>`;
}

export function paginaHistorico(linhas: LinhaHistorico[], pessoas: Pessoa[], csrfToken: string, filtro: { pessoa?: string; status?: string; mes?: string; ano?: string }): string {
  const opcoes = pessoas.map((pessoa) => `<option value="${e(pessoa.id)}" ${filtro.pessoa === pessoa.id ? 'selected' : ''}>${e(pessoa.nome)}</option>`).join('');
  const corpo = linhas.map((linha) => `<tr>
      <td><a href="/cobrancas/${e(linha.id)}">${e(linha.pessoa)}</a></td>
      <td>${e(linha.competencia)}</td>
      <td>${tagStatus(linha.status)}</td>
      <td>${linha.embutidaEm ? e(linha.embutidaEm) : '—'}</td>
      <td class="dinheiro">${formatarReais(linha.total)}</td>
      <td>${e(linha.origem)}</td>
      <td>${indicador('E-mail', linha.email)}${indicador('WhatsApp', linha.whatsapp)}</td>
      <td>${acoesDaCobranca(linha.id, csrfToken, { copia: linha.copiaPix, email: linha.podeEmail, whatsapp: linha.podeWhatsapp })}</td>
    </tr>`).join('');
  return `<h1>Histórico de cobranças</h1><p class="sub">As canceladas ficam de fora até você filtrar por elas.</p>
    <form class="bloco" method="get" action="/cobrancas">
      <div class="row">
        <label>Pessoa<select name="pessoa"><option value="">Todas</option>${opcoes}</select></label>
        <label>Status<select name="status">
          <option value="" ${!filtro.status ? 'selected' : ''}>Ativas</option>
          <option value="aberta" ${filtro.status === 'aberta' ? 'selected' : ''}>Abertas</option>
          <option value="paga" ${filtro.status === 'paga' ? 'selected' : ''}>Pagas</option>
          <option value="cancelada" ${filtro.status === 'cancelada' ? 'selected' : ''}>Canceladas</option>
          <option value="todas" ${filtro.status === 'todas' ? 'selected' : ''}>Todas</option>
        </select></label>
        <label>Mês<input name="mes" value="${e(filtro.mes ?? '')}"></label>
        <label>Ano<input name="ano" value="${e(filtro.ano ?? '')}"></label>
        <button type="submit">Filtrar</button>
      </div>
    </form>
    <table><thead><tr><th>Pessoa</th><th>Competência</th><th>Status</th><th>Embutida em</th><th>Total</th><th>Origem</th><th>Cobrança</th><th></th></tr></thead>
    <tbody>${corpo || '<tr><td colspan="8">Nenhuma cobrança.</td></tr>'}</tbody></table>`;
}

export function paginaDetalhe(detalhe: Detalhe, csrfToken: string, motivo = ''): string {
  const linhas = detalhe.linhas.map((linha) => `<tr>
      <td>${e(linha.descricao)}</td><td>${e(linha.competencia)}</td>
      <td class="dinheiro">${formatarReais(linha.valorCentavos)}</td>
      <td>${linha.carregada ? 'carregada' : 'nova'}</td>
    </tr>`).join('');
  const pixes = detalhe.pixes.map((pix) => `<tr>
      <td class="dinheiro">${formatarReais(pix.valorCentavos)}</td>
      <td>${e(pix.status)}</td><td>${pix.validadeDias} dias</td>
      <td>${e(formatarDataHora(pix.venceEm))}</td>
      <td>${e(pix.mpStatus ?? '')}</td><td>${e(pix.motivo ?? '')}</td>
    </tr>`).join('');
  const eventos = detalhe.eventos.map((evento) => `<li>${e(evento.efeito)} · ${formatarReais(evento.valorCentavos)} · ${e(formatarDataHora(evento.recebidoEm))}</li>`).join('');
  const afetadas = detalhe.linhasAfetadas.map((linha) => `${linha.descricao} (${String(linha.mes).padStart(2, '0')}/${linha.ano})`).join(', ');
  return `<p class="trilha"><a href="/cobrancas">Histórico</a> / ${e(detalhe.pessoa)}</p>
    <div class="topo"><div><h1>${e(detalhe.pessoa)} · ${e(detalhe.competencia)}</h1>
    <p class="sub"><a href="/pessoas/${e(detalhe.pessoaId)}">${e(detalhe.pessoa)}</a> · ${tagStatus(detalhe.status)} · ${e(detalhe.origem)}${detalhe.pagaEm ? ` · paga em ${e(formatarDataHora(detalhe.pagaEm))} (${e(detalhe.origemBaixa)})` : ''}</p></div>
    <p class="dinheiro">Total ${formatarReais(detalhe.total)}</p></div>
    ${detalhe.alerta || afetadas ? `<p class="alerta">A vigente inclui itens já pagos por um PIX antigo${afetadas ? `: ${e(afetadas)}` : ''}.</p>` : ''}
    ${eventos ? `<ul>${eventos}</ul>` : ''}
    ${detalhe.motivoCancelamento ? `<p>Cancelada em ${e(detalhe.canceladaEm ? formatarDataHora(detalhe.canceladaEm) : '')}. Motivo: ${e(detalhe.motivoCancelamento)}</p>` : ''}
    <div class="ficha">
      <div class="coluna">
        <div class="bloco"><table><thead><tr><th>Descrição</th><th>Origem</th><th>Valor</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
        ${detalhe.pixAtivo ? `<div class="bloco"><h2>PIX ativo</h2><p>Vence em ${e(formatarDataHora(detalhe.pixAtivo.venceEm))} · <span class="dinheiro">${formatarReais(detalhe.pixAtivo.valorCentavos)}</span></p>
          <textarea id="pix-copia" class="codigo" readonly>${e(detalhe.pixAtivo.copia)}</textarea></div>` : '<p>Sem PIX ativo.</p>'}
        <div class="bloco"><h2>Histórico de PIX</h2>
        <table><thead><tr><th>Valor</th><th>Status</th><th>Validade</th><th>Vencimento</th><th>Mercado Pago</th><th>Motivo</th></tr></thead><tbody>${pixes}</tbody></table></div>
        <section class="bloco"><h2>Mensagens</h2>${timelineMensagens(detalhe)}</section>
      </div>
      <aside class="lateral">
        <section class="bloco"><h2>Ações</h2>
          <div class="acoes">${botoesAcaoDetalhe(detalhe, csrfToken, motivo) || '<span class="muted">Nenhuma ação disponível.</span>'}</div>
        </section>
      </aside>
    </div>
    ${modaisAcaoDetalhe(detalhe, csrfToken, motivo)}`;
}

export function paginaTemplates(
  modelos: TemplateLinha[],
  csrfToken: string,
  previsao: { titulo: string; assunto: string; corpo: string } | null,
  rascunho: RascunhoTemplate | null = null,
): string {
  const blocos = modelos.map((modelo) => {
    const tipo = modelo.tipo as TipoMensagem;
    const editando = rascunho?.destino === 'bloco' && rascunho.canal === modelo.canal && rascunho.tipo === modelo.tipo;
    const assunto = editando && rascunho ? rascunho.assunto : (modelo.assunto ?? '');
    const corpo = editando && rascunho ? rascunho.corpo : modelo.corpo;
    return `<section class="bloco">
      <form method="post" action="/templates/${e(modelo.canal)}/${e(modelo.tipo)}">
        ${csrf(csrfToken)}
        <h2>${e(NOMES_CANAL[modelo.canal] ?? modelo.canal)} · ${e(NOMES_TIPO[modelo.tipo] ?? modelo.tipo)}</h2>
        <p class="muted">Variáveis: ${e(variaveisDoCenario(tipo).map((nome) => `{${nome}}`).join(', '))}</p>
        ${modelo.canal === 'email' ? `<label>Assunto<input name="assunto" value="${e(assunto)}"></label>` : ''}
        <label>Texto<textarea name="corpo">${e(corpo)}</textarea></label>
        <div class="acoes"><button type="submit">Salvar</button></div>
      </form>
      <form method="post" action="/templates/${e(modelo.canal)}/${e(modelo.tipo)}/prever">${csrf(csrfToken)}
        <input type="hidden" name="assunto" value="${e(modelo.assunto ?? '')}">
        <input type="hidden" name="corpo_atual" value="1">
        <div class="acoes"><button class="secundario" type="submit" formaction="/templates/${e(modelo.canal)}/${e(modelo.tipo)}/restaurar">Restaurar padrão</button></div>
      </form>
    </section>`;
  }).join('');
  const previa = previsao
    ? `<section class="bloco"><h2>Pré-visualização · ${e(previsao.titulo)}</h2><p class="muted">Dados fictícios, de ninguém cadastrado.</p>
      ${previsao.assunto ? `<p><strong>${e(previsao.assunto)}</strong></p>` : ''}<pre>${e(previsao.corpo)}</pre></section>`
    : '';
  const previaRascunho = rascunho?.destino === 'previa' ? rascunho : null;
  const opcao = (valor: string, rotulo: string, atual: string | undefined) =>
    `<option value="${valor}" ${atual === valor ? 'selected' : ''}>${rotulo}</option>`;
  return `<h1>Templates</h1><p class="sub">Seis textos: e-mail e WhatsApp para cobrança, confirmação e inadimplência.</p>
    ${previa}
    <form class="bloco" method="post" action="/templates/prever">${csrf(csrfToken)}
      <h2>Pré-visualizar um rascunho</h2>
      <div class="row">
        <label>Canal<select name="canal">${opcao('whatsapp', 'WhatsApp', previaRascunho?.canal)}${opcao('email', 'E-mail', previaRascunho?.canal)}</select></label>
        <label>Cenário<select name="tipo">${opcao('cobranca', 'Cobrança', previaRascunho?.tipo)}${opcao('confirmacao', 'Confirmação', previaRascunho?.tipo)}${opcao('inadimplencia', 'Inadimplência', previaRascunho?.tipo)}</select></label>
      </div>
      <label>Assunto<input name="assunto" value="${e(previaRascunho?.assunto ?? '')}"></label>
      <label>Texto<textarea name="corpo">${e(previaRascunho?.corpo ?? '')}</textarea></label>
      <div class="acoes"><button type="submit">Pré-visualizar</button></div>
    </form>
    ${blocos}`;
}

export function paginaConfiguracao(config: ConfigPublica, csrfToken: string, rascunho: RascunhoConfig | null = null): string {
  const vista = rascunho
    ? {
        ...config,
        usuario: rascunho.usuario,
        emailDono: rascunho.emailDono,
        smtpHost: rascunho.smtpHost,
        smtpPorta: rascunho.smtpPorta,
        smtpUsuario: rascunho.smtpUsuario,
        smtpRemetenteNome: rascunho.smtpRemetenteNome,
        smtpRemetenteEmail: rascunho.smtpRemetenteEmail,
        smtpCriptografia: rascunho.smtpCriptografia,
        evolution: { ...config.evolution, url: rascunho.evolutionUrl, instancia: rascunho.evolutionInstance },
      }
    : config;
  config = vista;
  const teste = config.evolution.ultimoTesteEm
    ? `${config.evolution.ultimoTesteOk ? 'Conexão encontrada' : 'Falhou'} em ${formatarDataHora(config.evolution.ultimoTesteEm)}. ${config.evolution.ultimoTesteMotivo ?? ''}`
    : 'Ainda não testada.';
  return `<h1>Configuração</h1>
    <p class="sub">Segredo gravado não volta para a tela. Campo em branco mantém o valor atual.</p>
    <form class="bloco" method="post" action="/configuracao">${csrf(csrfToken)}
      <h2>Acesso</h2>
      <div class="row">
        <label>Usuário<input name="usuario" required value="${e(config.usuario)}"></label>
        <label>E-mail do código<input name="email_dono" type="email" required value="${e(config.emailDono)}"></label>
        <label>Senha atual<input name="senha_atual" type="password" autocomplete="current-password"></label>
        <label>Senha nova<input name="senha_nova" type="password" autocomplete="new-password"></label>
      </div>
      <h2>Mercado Pago</h2>
      <p>Token: ${config.mpAccessTokenDefinido ? etiqueta('definido: sim', 'ok') : etiqueta('definido: não', 'off')}. Segredo do webhook: ${config.mpWebhookSecretDefinido ? etiqueta('definido: sim', 'ok') : etiqueta('definido: não', 'off')}.</p>
      <p>URL de notificação: <span class="codigo">${e(config.urlNotificacao || 'defina PAGAEU_PUBLIC_URL')}</span></p>
      <div class="row">
        <label>Access token<input name="mp_access_token" type="password" autocomplete="off"></label>
        <label>Segredo do webhook<input name="mp_webhook_secret" type="password" autocomplete="off"></label>
      </div>
      <h2>SMTP</h2>
      <p>Senha: ${config.smtpSenhaDefinida ? etiqueta('definido: sim', 'ok') : etiqueta('definido: não', 'off')}.</p>
      <div class="row">
        <label>Host<input name="smtp_host" value="${e(config.smtpHost)}"></label>
        <label>Porta<input name="smtp_porta" value="${e(config.smtpPorta)}" placeholder="587"></label>
        <label>Usuário<input name="smtp_usuario" value="${e(config.smtpUsuario)}"></label>
        <label>Senha<input name="smtp_senha" type="password" autocomplete="off"></label>
        <label>Nome do remetente<input name="smtp_remetente_nome" value="${e(config.smtpRemetenteNome)}"></label>
        <label>E-mail do remetente<input name="smtp_remetente_email" value="${e(config.smtpRemetenteEmail)}"></label>
        <label>Criptografia<select name="smtp_criptografia">
          <option value="starttls" ${config.smtpCriptografia === 'starttls' ? 'selected' : ''}>STARTTLS</option>
          <option value="tls_implicito" ${config.smtpCriptografia === 'tls_implicito' ? 'selected' : ''}>TLS implícito</option>
          <option value="nenhuma" ${config.smtpCriptografia === 'nenhuma' ? 'selected' : ''}>Sem criptografia</option>
        </select></label>
      </div>
      <p class="muted">O teste usa o SMTP já salvo. Salve antes se alterou host, porta ou senha.</p>
      <div class="row">
        <label>E-mail de teste<input name="email_teste" type="email" placeholder="${e(config.emailDono)}" autocomplete="off"></label>
      </div>
      <div class="acoes">
        <button class="secundario" type="submit" formaction="/configuracao/smtp" formmethod="post">Enviar e-mail teste</button>
      </div>
      <h2>Evolution Go</h2>
      <p>Chave API: ${config.evolution.chaveDefinida ? etiqueta('definido: sim', 'ok') : etiqueta('definido: não', 'off')}. ${e(teste)}</p>
      <div class="row">
        <label>URL<input name="evolution_url" value="${e(config.evolution.url)}" placeholder="https://evolution.example"></label>
        <label>Instância<input name="evolution_instance" value="${e(config.evolution.instancia)}"></label>
        <label>Chave API<input name="evolution_api_key" type="password" autocomplete="off"></label>
      </div>
      <p class="muted">O teste usa o Evolution já salvo. Salve antes se alterou URL, instância ou chave.</p>
      <div class="acoes">
        <button class="secundario" type="submit" formaction="/configuracao/evolution" formmethod="post">Testar conexão</button>
        <button type="submit">Salvar</button>
      </div>
    </form>`;
}
