import type { Flash } from './acesso.ts';
import type { ResultadoConsultaAbertas } from './cobrancas.ts';
import type { CartaoPessoa, Detalhe, LinhaHistorico, LinhaResumoCobranca, SituacaoPessoa } from './consultas.ts';
import type { Dashboard, MesGrafico } from './dashboard.ts';
import { formatarCompetencia, formatarDataHora } from './domain/calendar.ts';
import { competenciaParaCampo, type SituacaoCobranca } from './domain/painel.ts';
import { formatarReais } from './domain/money.ts';
import {
  INTERVALOS_CONCILIACAO_MINUTOS,
  ROTULOS_INTERVALO_CONCILIACAO,
  type ConfigPublica,
  type TemplateLinha,
} from './configuracao.ts';
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

type NomeIcone =
  | 'abrir'
  | 'aviso'
  | 'cancelar'
  | 'check'
  | 'consultar'
  | 'copiar'
  | 'dashboard'
  | 'editar'
  | 'enviar'
  | 'entrar'
  | 'engrenagem'
  | 'excluir'
  | 'fechar'
  | 'filtro'
  | 'gerar'
  | 'historico'
  | 'inativar'
  | 'lista'
  | 'mail'
  | 'mais'
  | 'olho'
  | 'pessoa'
  | 'plug'
  | 'quem'
  | 'reativar'
  | 'reabrir'
  | 'restaurar'
  | 'reenviar'
  | 'sair'
  | 'salvar'
  | 'templates'
  | 'voltar';

const TRACOS_ICONE: Record<NomeIcone, string> = {
  abrir: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  aviso: '<path d="m10.29 3.86-8.2 14.2A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.71-2.94l-8.2-14.2a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  cancelar: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  consultar: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  copiar: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16V4a2 2 0 0 1 2-2h10"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  enviar: '<path d="M14.5 21.7 12 13 3.3 9.5 21 3Z"/><path d="M12 13 21 3"/>',
  entrar: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 1v2.5M12 20.5V23M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1 12h2.5M20.5 12H23M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  excluir: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  fechar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  filtro: '<path d="M3 5h18l-7 8v5l-4 2v-7Z"/>',
  gerar: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  historico: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  inativar: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 5 5"/><path d="m22 11-5 5"/>',
  lista: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  mais: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  pessoa: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  plug: '<path d="M8.5 8.5 5 12a5 5 0 0 0 7 7l3.5-3.5"/><path d="m12 12 6-6"/><path d="m15 9 3-3 2 2"/><path d="M9 15l-3 3-2-2"/>',
  quem: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  reativar: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  reabrir: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  restaurar: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  reenviar: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  salvar: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  templates: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  voltar: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
};

function icone(nome: NomeIcone): string {
  return `<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRACOS_ICONE[nome]}</svg>`;
}

function rotulo(nome: NomeIcone, texto: string): string {
  return `${icone(nome)}${e(texto)}`;
}

function botaoFechar(): string {
  return `<button type="button" class="secundario modal-fechar modal-fechar-x" aria-label="Fechar">${icone('fechar')}</button>`;
}

function classeCampoInvalido(erros: Record<string, string> | null, nome: string): string {
  return erros?.[nome] ? ' class="invalido"' : '';
}

const NOMES_TIPO: Record<string, string> = {
  cobranca: 'Cobrança',
  confirmacao: 'Confirmação de pagamento',
  inadimplencia: 'Aviso de inadimplência',
};

const NOMES_CANAL: Record<string, string> = { email: 'E-mail', whatsapp: 'WhatsApp' };
const NOMES_STATUS: Record<string, string> = { aberta: 'Aberta', paga: 'Paga', cancelada: 'Cancelada' };

type Secao = 'dashboard' | 'quem' | 'historico' | 'templates' | 'configuracao';

function secaoAtual(caminho: string): Secao {
  if (caminho === '/') return 'dashboard';
  if (caminho.startsWith('/cobrancas')) return 'historico';
  if (caminho.startsWith('/templates')) return 'templates';
  if (caminho.startsWith('/configuracao')) return 'configuracao';
  return 'quem';
}

function itemNav(atual: Secao, id: Secao, href: string, nome: string, nomeIcone: NomeIcone): string {
  const ativo = atual === id ? ' class="ativo" aria-current="page"' : '';
  return `<a href="${href}"${ativo}>${icone(nomeIcone)}<span>${nome}</span></a>`;
}

export function layout(opcoes: {
  titulo: string;
  corpo: string;
  autenticado: boolean;
  flash: Flash | null;
  caminho?: string;
  sessaoExpiraEmMs?: number;
}): string {
  const atual = secaoAtual(opcoes.caminho ?? '/');
  const nav = opcoes.autenticado
    ? `<aside>
        <a class="marca" href="/">PagaEu</a>
        <nav>
          ${itemNav(atual, 'dashboard', '/', 'Dashboard', 'dashboard')}
          ${itemNav(atual, 'quem', '/quem-deve', 'Quem deve', 'quem')}
          ${itemNav(atual, 'historico', '/cobrancas', 'Cobranças', 'historico')}
          ${itemNav(atual, 'templates', '/templates', 'Templates', 'templates')}
          ${itemNav(atual, 'configuracao', '/configuracao', 'Configuração', 'engrenagem')}
        </nav>
        ${
          opcoes.sessaoExpiraEmMs
            ? `<p class="sessao-contador muted" id="sessao-contador" data-expira-em="${opcoes.sessaoExpiraEmMs}">Sessão: <strong data-valor>--:--</strong></p>`
            : ''
        }
        <form method="post" action="/sair"><button class="sair" type="submit">${rotulo('sair', 'Sair')}</button></form>
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
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <meta name="googlebot" content="noindex, nofollow">
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
    aside nav { display:flex; flex-direction:column; gap:4px; }
    aside nav a { display:flex; align-items:center; gap:10px; color:var(--muted); text-decoration:none; font-weight:600; border-radius:8px; padding:10px 12px; }
    aside nav a:hover { color:var(--ink); background:rgba(255,255,255,.04); }
    aside nav a.ativo { color:var(--ciano); background:rgba(34,211,238,.1); }
    aside form { margin-top:auto; }
    .sessao-contador { margin:0 10px 10px; font-size:.82rem; line-height:1.4; }
    .sessao-contador strong, .contador-reenvio strong { font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:600; color:var(--ink); }
    button.sair { width:100%; justify-content:flex-start; background:transparent; color:var(--muted); border:1px solid var(--line); }
    main { padding:32px 32px 72px; min-width:0; }
    h1, h2 { font-family: "Space Grotesk", sans-serif; font-weight:600; letter-spacing:-.03em; }
    h1 { margin:0 0 8px; font-size:2rem; }
    h2 { margin:0 0 12px; font-size:1.15rem; }
    .sub, .trilha { color:var(--muted); margin:0 0 22px; }
    .trilha { margin-bottom:8px; font-size:.92rem; }
    a { color:var(--ciano); }
    a:has(> .icone) { display:inline-flex; align-items:center; gap:6px; }
    .metricas { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px; }
    .metrica { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
    .metrica span { display:block; color:var(--muted); font-size:.8rem; letter-spacing:.04em; text-transform:uppercase; }
    .metrica strong { display:block; margin-top:6px; font-family:"JetBrains Mono", ui-monospace, monospace; font-size:1.35rem; font-weight:600; }
    .metrica .ciano { color:var(--ciano); }
    .metrica .ok { color:var(--ok); }
    .metrica .amber { color:var(--amber); }
    .metrica small { display:block; margin-top:6px; color:var(--muted); font-size:.82rem; }
    .ciano { color:var(--ciano); }
    .num { text-align:right; }
    .pequeno { font-size:.84rem; }
    .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    .filtro-periodo, .filtros-lista { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .filtro-periodo label { flex-direction:row; align-items:center; gap:8px; }
    .filtro-periodo input { padding:7px 10px; }
    .filtros-lista input[type="search"] { min-width:240px; }
    .graficos { display:grid; grid-template-columns:minmax(0, 2fr) minmax(280px, 1fr); gap:16px; margin-bottom:16px; }
    .acoes-dashboard { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; margin-bottom:16px; }
    .graficos .bloco, .acoes-dashboard .bloco { margin-bottom:0; }
    .acoes-dashboard .bloco { display:flex; flex-direction:column; }
    .acoes-dashboard .bloco > .row, .acoes-dashboard .bloco > form { margin-top:auto; }
    .bloco-cabeca { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .bloco-cabeca h2 { margin:0; }
    .bloco-cabeca p { margin:4px 0 0; font-size:.85rem; }
    .grafico { width:100%; height:auto; display:block; }
    .grafico .grade { stroke:var(--line); }
    .grafico .eixo { fill:var(--muted); font:500 11px "JetBrains Mono", ui-monospace, monospace; }
    .grafico rect { stroke:none; }
    .grafico-vazio { padding:48px 0; text-align:center; }
    .serie-paga { fill:var(--ok); stroke:var(--ok); background:var(--ok); }
    .serie-aberta { fill:var(--ciano); stroke:var(--ciano); background:var(--ciano); }
    .serie-atrasada { fill:var(--amber); stroke:var(--amber); background:var(--amber); }
    .rosca { display:flex; justify-content:center; padding:4px 0 14px; }
    .rosca svg { width:180px; height:180px; }
    .rosca circle { fill:none; stroke-width:18; }
    .rosca .trilho { stroke:rgba(255,255,255,.06); }
    .rosca-rotulo { fill:var(--muted); font:600 10px Geist, sans-serif; letter-spacing:.08em; }
    .rosca-valor { fill:var(--ink); font:600 15px "JetBrains Mono", ui-monospace, monospace; }
    .legenda { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
    .legenda li { display:flex; justify-content:space-between; gap:12px; align-items:center; font-size:.9rem; }
    .legenda-linha { display:flex; gap:16px; flex-wrap:wrap; }
    .legenda-nome { display:inline-flex; align-items:center; gap:8px; }
    .legenda i { width:10px; height:10px; border-radius:3px; display:inline-block; }
    .tabela-bloco { padding:0; overflow:auto; }
    .tabela-pessoas { min-width:860px; }
    .tabela-pessoas th, .tabela-pessoas td { padding:12px 14px; vertical-align:middle; }
    .tabela-pessoas th, .tabela-pessoas td.num, .tabela-pessoas td.codigo { white-space:nowrap; }
    .tabela-pessoas td:last-child { white-space:nowrap; }
    .tabela-pessoas tbody tr:hover { background:rgba(255,255,255,.02); }
    .tabela-pessoas tfoot td { width:auto; border-bottom:0; background:rgba(255,255,255,.02); color:var(--muted); }
    .tabela-pessoas td .acoes { margin-top:0; }
    .nome-pessoa { color:var(--ink); font-weight:600; text-decoration:none; }
    .nome-pessoa:hover { color:var(--ciano); }
    .envio .ponto { display:flex; margin:0; font-size:.84rem; }
    .tags { display:flex; gap:6px; flex-wrap:wrap; }
    .alerta-linha { color:var(--amber); font-size:.8rem; margin-top:4px; }
    button.compacto { padding:5px 10px; font-size:.84rem; }
    .link-acao { display:inline-flex; align-items:center; gap:5px; font-weight:600; padding:0 4px; }
    @media (max-width: 1080px) {
      .graficos, .acoes-dashboard { grid-template-columns:1fr; }
    }
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
    button, .botao { background:var(--ciano); color:var(--ciano-ink); border:0; border-radius:8px; padding:9px 14px; font:inherit; font-weight:600; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; }
    .icone { width:1.05em; height:1.05em; flex:0 0 auto; }
    button.secundario, .botao.secundario { background:transparent; color:var(--ink); border:1px solid var(--line); }
    button:disabled, button[disabled] { opacity:.45; cursor:not-allowed; pointer-events:none; }
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
    label.invalido input, label.invalido select, label.invalido textarea { border-color:var(--red); box-shadow:0 0 0 1px rgba(252,165,165,.45); }
    .ponto { display:inline-flex; align-items:center; gap:6px; margin-right:10px; }
    .ponto i { width:9px; height:9px; border-radius:50%; display:inline-block; background:var(--gray); }
    .ponto.enviado i { background:var(--ok); }
    .ponto.falha i { background:#F87171; }
    .tag { display:inline-flex; align-items:center; border-radius:8px; padding:2px 8px; background:rgba(255,255,255,.06); font-size:.8rem; }
    .tag.ok { color:var(--ok); background:var(--ok-bg); }
    .tag.off { color:var(--red); background:var(--red-bg); }
    .tag.aberta { color:#67E8F9; background:rgba(34,211,238,.12); }
    .tag.atrasada { color:var(--amber); background:var(--amber-bg); }
    .acoes, .checks { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px; }
    .acoes { justify-content:flex-end; }
    .checks label, label:has(input[type="checkbox"]), label:has(input[type="radio"]) { flex-direction:row; align-items:center; color:var(--ink); }
    input[type="checkbox"], input[type="radio"] { accent-color:var(--ciano); width:1rem; height:1rem; }
    .codigo { font-family:"JetBrains Mono", ui-monospace, monospace; word-break:break-all; }
    .ficha { display:grid; grid-template-columns:minmax(0, 1fr) minmax(260px, 340px); gap:16px; align-items:start; }
    .ficha-trilha { display:flex; flex-direction:row; align-items:center; gap:8px; margin:0 0 16px; font-size:.92rem; color:var(--muted); white-space:nowrap; }
    .ficha-trilha a { color:var(--muted); text-decoration:none; font-weight:500; padding:0; border-radius:0; background:transparent; }
    .ficha-trilha a:hover { color:var(--ink); background:transparent; }
    .ficha-trilha strong { color:var(--ink); font-weight:600; }
    .ficha-cabeca { display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap; margin-bottom:8px; }
    .ficha-identidade { display:flex; gap:14px; align-items:center; min-width:0; }
    .ficha-avatar { width:48px; height:48px; border-radius:8px; background:#0B1220; border:1px solid var(--line); display:grid; place-items:center; font-family:"Space Grotesk",sans-serif; font-weight:600; font-size:.95rem; letter-spacing:.02em; color:var(--ciano); flex-shrink:0; }
    .ficha-identidade h1 { margin:0 0 4px; font-size:1.75rem; line-height:1.15; }
    .ficha-identidade .sub { margin:0; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .ficha-status { display:inline-flex; align-items:center; gap:6px; color:var(--ok); font-weight:600; }
    .ficha-status i { width:8px; height:8px; border-radius:50%; background:var(--ok); display:inline-block; }
    .ficha-status.inativa { color:var(--gray); }
    .ficha-status.inativa i { background:var(--gray); }
    .ficha-acoes-topo { display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:flex-end; }
    .ficha-gerar { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; margin:0; padding:8px 10px; background:#0B1220; border:1px solid var(--line); border-radius:8px; }
    .ficha-gerar label { flex:0 0 auto; min-width:0; gap:4px; font-size:.75rem; letter-spacing:.04em; text-transform:uppercase; }
    .ficha-gerar input { width:4.6rem; height:36px; padding:6px 8px; }
    .ficha-gerar button, .ficha-acoes-topo > form > button { height:36px; }
    .ficha-abas { display:flex; gap:2px; border-bottom:1px solid var(--line); margin:18px 0 18px; overflow-x:auto; -webkit-overflow-scrolling:touch; }
    .ficha-aba { color:var(--muted); text-decoration:none; font-family:"Space Grotesk",sans-serif; font-weight:600; padding:12px 16px; border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap; flex:0 0 auto; }
    .ficha-aba:hover { color:var(--ink); }
    .ficha-aba.ativa { color:var(--ciano); border-bottom-color:var(--ciano); }
    .ficha-aba .contagem { color:var(--gray); font-weight:500; margin-left:6px; font-family:Geist,sans-serif; }
    .ficha-painel .bloco { margin-bottom:0; }
    .ficha-form-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px 18px; }
    .ficha-form-grid > label { gap:6px; }
    .ficha-form-grid input { height:38px; background:#070B14; }
    .ficha-form-grid .linha-inteira { grid-column:1 / -1; }
    .ficha-painel form.bloco > .bloco-cabeca { margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid var(--line); }
    .ficha-tabela { padding:0; overflow:hidden; }
    .ficha-tabela > .bloco-cabeca { margin:0; padding:16px 18px; border-bottom:1px solid var(--line); align-items:center; }
    .ficha-tabela > .bloco-cabeca p { margin:4px 0 0; }
    .ficha-tabela-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; max-width:100%; }
    .ficha-tabela table { min-width:720px; width:100%; }
    .ficha-tabela th, .ficha-tabela td { vertical-align:middle; padding:12px 16px; }
    .ficha-tabela th:last-child, .ficha-tabela td:last-child { width:auto; white-space:nowrap; }
    .ficha-tabela th { background:#0B1220; letter-spacing:.06em; }
    .ficha-tabela td.dinheiro, .ficha-tabela th.num { text-align:right; }
    .ficha-tabela tbody tr:hover { background:#162238; }
    .ficha-tabela .acoes-celula { display:flex; gap:8px; justify-content:flex-end; align-items:center; flex-wrap:nowrap; margin:0; }
    .ficha-tabela .acoes-celula form { margin:0; }
    .ficha-tabela tfoot td { background:rgba(255,255,255,.03); border-bottom:0; padding:14px 16px; }
    .ficha-metricas { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin:16px 0 4px; }
    .ficha-metricas .metrica strong { font-size:1.15rem; }
    .modal-ficha { max-width:min(560px, calc(100vw - 32px)); }
    .modal-ficha form { gap:12px; }
    .modal-itens-cobranca { max-width:min(560px, calc(100vw - 32px)); }
    .modal-itens-cobranca table { margin:0; }
    .modal-itens-cobranca th:last-child, .modal-itens-cobranca td:last-child { width:auto; }
    .modal-itens-cobranca tfoot td { border-bottom:0; font-weight:600; }
    input[type="checkbox"] { appearance:none; width:16px; height:16px; margin:0; border:1px solid rgba(255,255,255,.22); border-radius:4px; background:#070B14; display:inline-grid; place-items:center; }
    input[type="checkbox"]:checked { background:var(--ciano); border-color:var(--ciano); }
    input[type="checkbox"]:checked::after { content:""; width:8px; height:5px; border-left:2px solid var(--ciano-ink); border-bottom:2px solid var(--ciano-ink); transform:rotate(-45deg) translateY(-1px); }
    @media (max-width: 900px) {
      .ficha-form-grid, .ficha-metricas { grid-template-columns:1fr; }
      .ficha-cabeca { align-items:flex-start; }
      .ficha-tabela-scroll { overflow:visible; }
      .ficha-tabela table { min-width:0; width:100%; display:block; overflow:visible; }
      .ficha-tabela thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
      .ficha-tabela tbody, .ficha-tabela tfoot { display:block; width:100%; }
      .ficha-tabela tbody tr {
        display:grid;
        grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:10px 16px;
        padding:16px 18px;
        border-bottom:1px solid var(--line);
      }
      .ficha-tabela tbody td {
        display:block;
        padding:0;
        border:0;
        width:auto;
        white-space:normal;
      }
      .ficha-tabela tbody td:first-child { grid-column:1 / -1; font-weight:600; }
      .ficha-tabela tbody td[colspan],
      .ficha-tabela tbody td.celula-acoes { grid-column:1 / -1; }
      .ficha-tabela tbody td[data-label]::before {
        content:attr(data-label);
        display:block;
        color:var(--muted);
        font-size:.7rem;
        letter-spacing:.06em;
        text-transform:uppercase;
        font-weight:600;
        margin-bottom:2px;
      }
      .ficha-tabela tbody td:first-child::before,
      .ficha-tabela tbody td.celula-acoes::before,
      .ficha-tabela tbody td[colspan]::before { display:none; }
      .ficha-tabela td.dinheiro, .ficha-tabela th.num { text-align:left; }
      .ficha-tabela .acoes-celula { justify-content:flex-start; flex-wrap:wrap; }
      .ficha-tabela tfoot tr {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        padding:14px 18px;
        background:rgba(255,255,255,.03);
      }
      .ficha-tabela tfoot td { display:block; padding:0; border:0; width:auto; background:transparent; }
      .ficha-tabela tfoot td[colspan], .ficha-tabela tfoot td:empty { display:none; }
    }
    .lateral { display:grid; gap:14px; }
    .lateral .acoes { justify-content:flex-start; }
    .lateral .acoes .botao, .lateral .acoes button { width:100%; justify-content:center; }
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
    .modal form, .modal .modal-corpo { padding:20px 22px 22px; display:grid; gap:14px; margin:0; }
    .modal-cabeca { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .modal-cabeca h2 { margin:0; font-size:1.15rem; }
    .modal-fechar-x { min-width:2.25rem; min-height:2.25rem; padding:6px; }
    .modal-rodape { justify-content:flex-end; margin-top:4px; }
    .modal-largo { max-width:min(480px, calc(100vw - 32px)); }
    .modal-mensagem { max-width:min(640px, calc(100vw - 32px)); max-height:min(85vh, 720px); overflow:auto; }
    .mensagem-assunto { margin:0; }
    .mensagem-previa { margin:0; white-space:pre-wrap; font-family:Geist, sans-serif; font-size:.95rem; line-height:1.55; background:rgba(255,255,255,.03); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
    .consulta-resumo { display:grid; gap:12px; }
    .consulta-bloco { border:1px solid var(--line); border-radius:10px; padding:12px 14px; background:rgba(255,255,255,.02); }
    .consulta-bloco h3 { margin:0 0 10px; font-size:.7rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); }
    .consulta-bloco-total { border-color:rgba(34,211,238,.35); background:rgba(34,211,238,.06); }
    .consulta-bloco-total h3 { color:var(--ciano); }
    .consulta-linha { display:flex; justify-content:space-between; align-items:baseline; gap:20px; padding:7px 0; border-bottom:1px solid var(--line); font-size:.92rem; }
    .consulta-linha:last-child { border-bottom:0; padding-bottom:0; }
    .consulta-linha:first-of-type { padding-top:0; }
    .consulta-linha span { color:var(--muted); flex:1; min-width:0; }
    .consulta-linha strong { font-weight:600; font-variant-numeric:tabular-nums; color:var(--ink); flex-shrink:0; }
    .lista-falhas { margin:0; padding:12px 14px; border-radius:8px; background:var(--amber-bg); border:1px solid rgba(252,211,77,.28); color:#FDE68A; list-style:none; }
    .lista-falhas li { padding:4px 0; }
    button.carregando { opacity:.7; cursor:wait; }
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
      aside nav { flex-direction:row; flex-wrap:wrap; }
      aside form { margin-top:12px; }
      main, .marca-login { padding:20px 16px 48px; }
      .metrica, .card { margin-bottom:12px; }
      table { display:block; overflow:auto; }
      .tabela-pessoas { display:table; overflow:visible; }
      .ficha-tabela table { overflow:visible; }
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

function etiqueta(texto: string, tipo: 'ok' | 'off' | 'aberta' | 'atrasada' | '' = ''): string {
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

function botaoModal(id: string, texto: string, classe = 'secundario', nomeIcone: NomeIcone = 'abrir'): string {
  return `<button type="button" class="${classe}" data-modal-abrir="${e(id)}">${rotulo(nomeIcone, texto)}</button>`;
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
        ${botaoFechar()}
      </header>
      <p class="muted">Marque os canais em que deseja enviar.</p>
      <div class="checks">${marcadores}</div>
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">${rotulo('voltar', 'Voltar')}</button>
        <button type="submit">${rotulo('enviar', textoEnviar)}</button>
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
        ${botaoFechar()}
      </header>
      ${pixOpcoes ? `<p class="muted">O que fazer com o PIX ativo?</p>${pixOpcoes}` : '<p class="muted">A cobrança será marcada como paga manualmente.</p>'}
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">${rotulo('voltar', 'Voltar')}</button>
        <button class="destaque" type="submit">${rotulo('check', 'Confirmar baixa')}</button>
      </div>
    </form>
  </dialog>`;
}

function modalReabrirCobranca(detalhe: Detalhe, csrfToken: string): string {
  if (!detalhe.acoes.reabrir) return '';
  const id = `modal-reabrir-${detalhe.id}`;
  return `<dialog class="modal" id="${e(id)}">
    <form id="reabrir-cobranca-${e(detalhe.id)}" method="post" action="/cobrancas/${e(detalhe.id)}/reabrir">
      ${csrf(csrfToken)}
      <header class="modal-cabeca">
        <h2>Reabrir cobrança</h2>
        ${botaoFechar()}
      </header>
      <p class="muted">Volta a cobrança vigente para em aberto, remove o registro local da baixa e recoloca o PIX aprovado como pendente (PIX nativo perde o vínculo com o pagamento no Mercado Pago). Não estorna dinheiro na conta.</p>
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">${rotulo('voltar', 'Voltar')}</button>
        <button class="perigo" type="submit">${rotulo('reabrir', 'Confirmar reabertura')}</button>
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
        ${botaoFechar()}
      </header>
      <label>Motivo<input name="motivo" required maxlength="500" value="${e(motivo)}"></label>
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">${rotulo('voltar', 'Voltar')}</button>
        <button class="perigo" type="submit">${rotulo('cancelar', 'Confirmar cancelamento')}</button>
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
    modalReabrirCobranca(detalhe, csrfToken),
    modalCancelarCobranca(detalhe, csrfToken, motivo),
  ].join('');
}

function acoesDaCobranca(
  id: string,
  csrfToken: string,
  opcoes: { copia: string | null; email: boolean; whatsapp: boolean },
): string {
  const copiar = opcoes.copia
    ? `<button type="button" class="secundario" data-texto="${e(opcoes.copia)}">${rotulo('copiar', 'Copiar chave PIX')}</button>`
    : '';
  const reenviar = opcoes.email || opcoes.whatsapp
    ? botaoModal(`modal-reenviar-cobranca-${id}`, 'Reenviar', 'secundario', 'reenviar')
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
    partes.push(`<button type="button" class="secundario" data-texto="${e(detalhe.pixAtivo.copia)}">${rotulo('copiar', 'Copiar chave PIX')}</button>`);
  }
  if (canaisMensagem(detalhe, 'cobranca').length) {
    partes.push(botaoModal(`modal-reenviar-cobranca-${detalhe.id}`, 'Reenviar', 'secundario', 'reenviar'));
  }
  if (canaisMensagem(detalhe, 'inadimplencia').length) {
    partes.push(botaoModal(`modal-inadimplencia-${detalhe.id}`, 'Enviar inadimplência', 'secundario', 'aviso'));
  }
  if (canaisMensagem(detalhe, 'confirmacao').length) {
    partes.push(botaoModal(`modal-confirmacao-${detalhe.id}`, 'Reenviar confirmação', 'secundario', 'mail'));
  }
  if (detalhe.acoes.novoPix) {
    partes.push(`<form method="post" action="/cobrancas/${e(detalhe.id)}/novo-pix">${csrf(csrfToken)}<button type="submit">${rotulo('gerar', 'Gerar novo PIX')}</button></form>`);
  }
  if (detalhe.acoes.invalidarPix) {
    partes.push(`<form method="post" action="/cobrancas/${e(detalhe.id)}/invalidar-pix">${csrf(csrfToken)}<button class="secundario" type="submit">${rotulo('cancelar', 'Invalidar PIX')}</button></form>`);
  }
  if (detalhe.acoes.tentarEmissao) {
    partes.push(`<form method="post" action="/cobrancas/${e(detalhe.id)}/tentar-emissao">${csrf(csrfToken)}<button type="submit">${rotulo('reenviar', 'Tentar emissão de novo')}</button></form>`);
  }
  if (detalhe.acoes.baixaManual) {
    partes.push(botaoModal(`modal-baixa-${detalhe.id}`, 'Confirmar baixa', 'destaque', 'check'));
  }
  if (detalhe.acoes.reabrir) {
    partes.push(botaoModal(`modal-reabrir-${detalhe.id}`, 'Reabrir cobrança', 'secundario', 'reabrir'));
  }
  if (detalhe.acoes.cancelar && !motivoCancelamento) {
    partes.push(botaoModal(`modal-cancelar-${detalhe.id}`, 'Cancelar cobrança', 'perigo', 'cancelar'));
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

export type AbaFicha = 'informacoes' | 'lancamentos' | 'historico';

export type FichaPessoaDados = {
  aba: AbaFicha;
  pessoa: Pessoa;
  diaEfetivo: number;
  itens: Item[];
  itensUsados: Set<string>;
  historico: LinhaHistorico[];
  linhasCobranca: Record<string, LinhaResumoCobranca[]>;
  csrfToken: string;
  rascunhoPessoa?: RascunhoPessoa | null;
  rascunhoItem?: RascunhoItem | null;
  geracao?: RascunhoMes | null;
};

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
  telefone2fa: string;
  smtpHost: string;
  smtpPorta: string;
  smtpUsuario: string;
  smtpRemetenteNome: string;
  smtpRemetenteEmail: string;
  smtpCriptografia: string;
  evolutionUrl: string;
  evolutionInstance: string;
  pixProvedor: string;
  pixChave: string;
  pixRecebedor: string;
  pixCidade: string;
  conciliacaoIntervaloMinutos: string;
};

export type RascunhoTemplate = {
  canal: string;
  tipo: string;
  assunto: string;
  corpo: string;
  destino: 'previa' | 'bloco';
};

export function paginaLogin(
  erro: string | null,
  etapaCodigo: boolean,
  valor = '',
  canal: 'whatsapp' | 'email' = 'email',
  cooldownReenvioSeg = 0,
): string {
  const aviso = erro ? `<p class="alerta">${e(erro)}</p>` : '';
  if (etapaCodigo) {
    const titulo = canal === 'whatsapp' ? 'Código por WhatsApp' : 'Código por e-mail';
    const sub =
      canal === 'whatsapp'
        ? 'Enviamos um código de 6 dígitos no WhatsApp. Ele vale 10 minutos.'
        : 'Enviamos um código de 6 dígitos. Ele vale 10 minutos.';
    const reenvioBloqueado = cooldownReenvioSeg > 0;
    const botaoReenviar = reenvioBloqueado
      ? `<button id="btn-reenviar-codigo" class="secundario" type="button" disabled aria-disabled="true">${rotulo('reenviar', 'Reenviar código')}</button>`
      : `<button id="btn-reenviar-codigo" class="secundario" type="submit">${rotulo('reenviar', 'Reenviar código')}</button>`;
    const contadorReenvio = `<p class="muted contador-reenvio" id="reenvio-contador"${reenvioBloqueado ? '' : ' hidden'}>Reenviar em <strong data-valor>00:00</strong></p>`;
    return `<h1>${titulo}</h1><p class="sub">${sub}</p>${aviso}
      <form method="post" action="/login/codigo">
        <label>Código<input name="codigo" inputmode="numeric" autocomplete="one-time-code" required value="${e(valor)}"></label>
        <div class="acoes"><button type="submit">${rotulo('entrar', 'Entrar')}</button></div>
      </form>
      <form method="post" action="/login/reenviar" id="form-reenviar-codigo" data-cooldown-seg="${cooldownReenvioSeg}"><div class="acoes">${botaoReenviar}</div></form>${contadorReenvio}`;
  }
  return `<h1>Entrar</h1><p class="sub">Painel do dono.</p>${aviso}
    <form method="post" action="/login">
      <label>Usuário<input name="usuario" autocomplete="username" required value="${e(valor)}"></label>
      <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <div class="acoes"><button type="submit">${rotulo('entrar', 'Continuar')}</button></div>
    </form>
    <p class="muted">Se o 2FA estiver ligado, o código de 6 dígitos chega no WhatsApp ou no e-mail do dono.</p>`;
}

function linhaConsulta(rotulo: string, valor: string | number): string {
  return `<div class="consulta-linha"><span>${e(rotulo)}</span><strong>${e(String(valor))}</strong></div>`;
}

function blocoConsulta(titulo: string, itens: { rotulo: string; valor: number }[], destaque = false): string {
  const corpo = itens.map((item) => linhaConsulta(item.rotulo, item.valor)).join('');
  const classe = destaque ? 'consulta-bloco consulta-bloco-total' : 'consulta-bloco';
  return `<section class="${classe}"><h3>${e(titulo)}</h3>${corpo}</section>`;
}

export function modalResultadoConsultaPagamentos(resultado: ResultadoConsultaAbertas): string {
  const { conciliacao: c } = resultado;
  const pagasGateway = Math.max(0, resultado.pagas - c.conciliadas);
  const teveAtividade =
    c.pendentes > 0
    || c.entradasMp > 0
    || c.conciliadas > 0
    || resultado.consultadas > 0
    || resultado.pagas > 0
    || resultado.falhas.length > 0;
  const blocos = teveAtividade
    ? [
        blocoConsulta('PIX nativo · extrato Mercado Pago', [
          { rotulo: 'Pendentes no sistema', valor: c.pendentes },
          { rotulo: 'Entradas novas no extrato', valor: c.entradasMp },
          { rotulo: 'Cobranças quitadas', valor: c.conciliadas },
        ]),
        blocoConsulta('PIX Mercado Pago · gateway', [
          { rotulo: 'PIX consultados', valor: resultado.consultadas },
          { rotulo: 'Cobranças quitadas', valor: pagasGateway },
        ]),
        blocoConsulta('Total', [
          { rotulo: 'Quitadas nesta consulta', valor: resultado.pagas },
          { rotulo: 'Confirmações enviadas', valor: resultado.confirmacoes },
          { rotulo: 'Sem canal de confirmação', valor: resultado.semCanal },
          { rotulo: 'Falha ao enviar confirmação', valor: resultado.falhaConfirmacao },
        ], true),
      ].join('')
    : '';
  const falhas = resultado.falhas.length
    ? `<ul class="lista-falhas">${resultado.falhas.map((texto) => `<li>${e(texto)}</li>`).join('')}</ul>`
    : '';
  const intro = teveAtividade
    ? '<p class="muted">Resumo do que foi consultado e atualizado agora.</p>'
    : '<p class="muted">Nenhum PIX pendente para conciliar ou consultar no gateway, e nenhuma cobrança nova foi quitada.</p>';
  const tom = resultado.falhas.length && resultado.pagas === 0 ? 'erro' : 'ok';
  return `<dialog class="modal modal-largo" id="modal-consulta-cobrancas" data-modal-inicial data-consulta-tom="${tom}">
    <div class="modal-corpo">
      <header class="modal-cabeca">
        <h2>Resultado da consulta</h2>
        ${botaoFechar()}
      </header>
      ${intro}
      ${teveAtividade ? `<div class="consulta-resumo">${blocos}</div>` : ''}
      ${falhas}
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">${rotulo('fechar', 'Fechar')}</button>
      </div>
    </div>
  </dialog>`;
}

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const SERIES: { chave: SituacaoCobranca; nome: string; classe: string }[] = [
  { chave: 'paga', nome: 'Recebido', classe: 'serie-paga' },
  { chave: 'aberta', nome: 'Em aberto', classe: 'serie-aberta' },
  { chave: 'atrasada', nome: 'Atrasado', classe: 'serie-atrasada' },
];

function tagSituacao(situacao: SituacaoPessoa): string {
  if (situacao === 'aberta') return etiqueta('Em aberto', 'aberta');
  if (situacao === 'atrasada') return etiqueta('Atrasada', 'atrasada');
  if (situacao === 'paga') return etiqueta('Paga', 'ok');
  return etiqueta('Sem cobrança');
}

function formatarCompacto(centavos: number): string {
  const reais = centavos / 100;
  if (reais >= 1000) return `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(reais).toLocaleString('pt-BR')}`;
}

function escalaMaxima(valor: number): number {
  if (valor <= 0) return 10_000;
  const magnitude = 10 ** Math.floor(Math.log10(valor));
  const passo = [1, 2, 2.5, 5, 10].find((fator) => fator * magnitude >= valor) ?? 10;
  return passo * magnitude;
}

function formatarDia(data: Date): string {
  return formatarDataHora(data).slice(0, 10);
}

function graficoBarras(meses: MesGrafico[]): string {
  const largura = 640;
  const altura = 260;
  const esquerda = 72;
  const direita = 8;
  const topo = 12;
  const base = 30;
  const areaLargura = largura - esquerda - direita;
  const areaAltura = altura - topo - base;
  const somas = meses.map((mes) => mes.paga + mes.aberta + mes.atrasada);
  if (somas.every((soma) => soma === 0)) {
    return '<p class="muted grafico-vazio">Sem cobranças nas competências do gráfico.</p>';
  }
  const maximo = escalaMaxima(Math.max(...somas));
  const passo = areaLargura / meses.length;
  const largBarra = Math.min(44, passo * 0.56);
  const grade = [0, 1, 2, 3, 4].map((marca) => {
    const y = topo + areaAltura - (areaAltura * marca) / 4;
    return `<line class="grade" x1="${esquerda}" x2="${largura - direita}" y1="${y}" y2="${y}"/>
      <text class="eixo" x="${esquerda - 8}" y="${y + 4}" text-anchor="end">${e(formatarCompacto((maximo * marca) / 4))}</text>`;
  }).join('');
  const barras = meses.map((mes, posicao) => {
    const x = esquerda + passo * posicao + (passo - largBarra) / 2;
    let acumulado = 0;
    const segmentos = SERIES.map((serie) => {
      const valor = mes[serie.chave];
      if (valor <= 0) return '';
      const h = (valor / maximo) * areaAltura;
      acumulado += h;
      const y = topo + areaAltura - acumulado;
      return `<rect class="${serie.classe}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${largBarra.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${e(`${serie.nome} ${formatarCompetencia(mes.competencia.ano, mes.competencia.mes)}: ${formatarReais(valor)}`)}</title></rect>`;
    }).join('');
    const rotulo = `${NOMES_MES[mes.competencia.mes - 1]!.slice(0, 3)}/${String(mes.competencia.ano).slice(2)}`;
    return `${segmentos}<text class="eixo" x="${(x + largBarra / 2).toFixed(1)}" y="${altura - 8}" text-anchor="middle">${e(rotulo)}</text>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Cobranças por mês">${grade}${barras}</svg>`;
}

function graficoRosca(totais: Dashboard['totais']): string {
  const total = SERIES.reduce((soma, serie) => soma + totais[serie.chave].valorCentavos, 0);
  const raio = 60;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;
  const fatias = total > 0
    ? SERIES.map((serie) => {
        const valor = totais[serie.chave].valorCentavos;
        if (valor <= 0) return '';
        const comprimento = (valor / total) * circunferencia;
        const fatia = `<circle class="${serie.classe}" cx="80" cy="80" r="${raio}" stroke-dasharray="${comprimento.toFixed(2)} ${(circunferencia - comprimento).toFixed(2)}" stroke-dashoffset="${(-acumulado).toFixed(2)}" transform="rotate(-90 80 80)"><title>${e(`${serie.nome}: ${formatarReais(valor)}`)}</title></circle>`;
        acumulado += comprimento;
        return fatia;
      }).join('')
    : '';
  const legenda = SERIES.map((serie) => {
    const valor = totais[serie.chave].valorCentavos;
    const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
    return `<li><span class="legenda-nome"><i class="${serie.classe}"></i>${e(serie.nome)} <span class="muted">(${pct}%)</span></span><strong class="dinheiro">${formatarReais(valor)}</strong></li>`;
  }).join('');
  return `<div class="rosca">
      <svg viewBox="0 0 160 160" role="img" aria-label="Situação no período">
        <circle class="trilho" cx="80" cy="80" r="${raio}"/>${fatias}
        <text class="rosca-rotulo" x="80" y="72" text-anchor="middle">TOTAL</text>
        <text class="rosca-valor" x="80" y="94" text-anchor="middle">${e(formatarCompacto(total))}</text>
      </svg>
    </div>
    <ul class="legenda">${legenda}</ul>`;
}

function metricaDashboard(rotulo: string, valor: string, classe: string, detalhe: string): string {
  return `<article class="metrica"><span>${e(rotulo)}</span><strong class="${classe}">${e(valor)}</strong><small>${e(detalhe)}</small></article>`;
}

function contarCobrancas(quantidade: number): string {
  return quantidade === 1 ? '1 cobrança' : `${quantidade} cobranças`;
}

export function paginaDashboard(
  painel: Dashboard,
  csrfToken: string,
  opcoes: { geracao: RascunhoMes | null; padraoGeracao: { mes: number; ano: number }; modalConsulta?: string | null },
): string {
  const { periodo, totais } = painel;
  const inicio = formatarCompetencia(periodo.inicio.ano, periodo.inicio.mes);
  const fim = formatarCompetencia(periodo.fim.ano, periodo.fim.mes);
  const textoPeriodo = inicio === fim ? `Competência ${inicio}` : `Competências de ${inicio} a ${fim}`;
  const taxa = painel.taxaRecebimento === null ? '—' : `${Math.round(painel.taxaRecebimento * 100)}%`;
  const primeiroMes = painel.meses[0]?.competencia;
  const ultimoMes = painel.meses.at(-1)?.competencia;
  const faixaGrafico = primeiroMes && ultimoMes
    ? `${formatarCompetencia(primeiroMes.ano, primeiroMes.mes)} a ${formatarCompetencia(ultimoMes.ano, ultimoMes.mes)}`
    : '';
  const mesGeracao = Number(opcoes.geracao?.mes || opcoes.padraoGeracao.mes);
  const anoGeracao = opcoes.geracao?.ano || String(opcoes.padraoGeracao.ano);
  const opcoesMes = NOMES_MES.map((nome, indice) =>
    `<option value="${indice + 1}" ${mesGeracao === indice + 1 ? 'selected' : ''}>${String(indice + 1).padStart(2, '0')} · ${nome}</option>`,
  ).join('');
  const atrasadas = painel.atrasadas.map((linha) => `<tr>
      <td><strong>${e(linha.pessoa)}</strong></td>
      <td class="codigo">${e(linha.competencia)}</td>
      <td>${e(formatarDia(linha.venceEm))}</td>
      <td>${etiqueta(linha.diasAtraso === 1 ? '1 dia' : `${linha.diasAtraso} dias`, 'atrasada')}</td>
      <td class="dinheiro num">${formatarReais(linha.valorCentavos)}</td>
      <td><a href="/cobrancas/${e(linha.cobrancaId)}">${rotulo('abrir', 'Abrir cobrança')}</a></td>
    </tr>`).join('');
  return `<div class="topo"><div><h1>Dashboard</h1><p class="sub">${e(textoPeriodo)}</p></div>
    <form class="filtro-periodo" method="get" action="/">
      <label>De<input type="month" name="de" value="${e(competenciaParaCampo(periodo.inicio))}" placeholder="AAAA-MM" required></label>
      <label>Até<input type="month" name="ate" value="${e(competenciaParaCampo(periodo.fim))}" placeholder="AAAA-MM" required></label>
      <button class="secundario" type="submit">${rotulo('filtro', 'Filtrar')}</button>
    </form></div>
    <section class="metricas" aria-label="Indicadores do período">
      ${metricaDashboard('Em aberto', formatarReais(totais.aberta.valorCentavos), 'ciano', `${contarCobrancas(totais.aberta.quantidade)} no prazo`)}
      ${metricaDashboard('Recebido', formatarReais(totais.paga.valorCentavos), 'ok', `${contarCobrancas(totais.paga.quantidade)} quitadas`)}
      ${metricaDashboard('Atrasado', formatarReais(totais.atrasada.valorCentavos), 'amber', `${contarCobrancas(totais.atrasada.quantidade)} com PIX vencido`)}
      ${metricaDashboard('Taxa de recebimento', taxa, '', 'recebido sobre o total do período')}
    </section>
    <div class="graficos">
      <section class="bloco">
        <div class="bloco-cabeca"><div><h2>Cobranças por mês</h2><p class="muted">${e(faixaGrafico)}</p></div>
          <ul class="legenda legenda-linha">${SERIES.map((serie) => `<li><span class="legenda-nome"><i class="${serie.classe}"></i>${e(serie.nome)}</span></li>`).join('')}</ul></div>
        ${graficoBarras(painel.meses)}
      </section>
      <section class="bloco">
        <div class="bloco-cabeca"><div><h2>Situação no período</h2><p class="muted">${e(textoPeriodo)}</p></div></div>
        ${graficoRosca(totais)}
      </section>
    </div>
    <div class="acoes-dashboard">
      <form class="bloco" method="post" action="/lote">
        ${csrf(csrfToken)}
        <h2>Gerar cobranças do mês</h2>
        <p class="muted">Gera a cobrança e o PIX de todas as pessoas ativas na competência escolhida.</p>
        <div class="row">
          <label>Mês<select name="mes" required>${opcoesMes}</select></label>
          <label>Ano<input name="ano" type="number" min="2000" max="2100" required value="${e(anoGeracao)}"></label>
          <button type="submit">${rotulo('gerar', 'Gerar cobranças')}</button>
        </div>
      </form>
      <section class="bloco">
        <h2>Consultar pagamentos</h2>
        <p class="muted">Concilia PIX nativo pelo extrato do Mercado Pago e consulta os PIX emitidos pelo gateway. Cobrança quitada dispara a confirmação nos canais ligados.</p>
        <form method="post" action="/cobrancas/consultar">${csrf(csrfToken)}
          <div class="acoes"><button type="submit">${rotulo('consultar', 'Consultar cobranças abertas')}</button></div>
        </form>
      </section>
    </div>
    <section class="bloco">
      <div class="bloco-cabeca"><h2>Atrasadas</h2>${painel.atrasadas.length ? etiqueta(contarCobrancas(painel.atrasadas.length), 'atrasada') : ''}</div>
      ${atrasadas
        ? `<table><thead><tr><th>Pessoa</th><th>Competência</th><th>Vencimento</th><th>Atraso</th><th class="num">Valor</th><th></th></tr></thead><tbody>${atrasadas}</tbody></table>`
        : '<p class="muted">Nenhuma cobrança atrasada no período.</p>'}
    </section>
    ${opcoes.modalConsulta ?? ''}`;
}

function canaisDaPessoa(pessoa: Pessoa): string {
  const canais = [pessoa.canal_whatsapp ? 'WhatsApp' : '', pessoa.canal_email ? 'e-mail' : ''].filter(Boolean);
  return canais.length ? canais.join(' e ') : 'sem canal';
}

function linhaQuemDeve(cartao: CartaoPessoa, csrfToken: string): string {
  const alertas = [
    cartao.alertaItensPagos ? `Inclui itens já pagos por um PIX antigo${cartao.linhasAfetadas.length ? `: ${cartao.linhasAfetadas.join(', ')}` : ''}.` : '',
    cartao.excedente ? 'Pagamento excedente.' : '',
    cartao.divergencia ? 'Divergência de valor.' : '',
  ].filter(Boolean);
  const idModal = cartao.cobrancaId ? `modal-reenviar-cobranca-${cartao.cobrancaId}` : '';
  const podeReenviar = Boolean(cartao.cobrancaId && (cartao.podeEmail || cartao.podeWhatsapp));
  const acoes = [
    cartao.copiaPix ? `<button type="button" class="secundario compacto" data-texto="${e(cartao.copiaPix)}">${rotulo('copiar', 'Copiar PIX')}</button>` : '',
    podeReenviar ? botaoModal(idModal, 'Reenviar', 'secundario compacto', 'reenviar') : '',
    `<a class="link-acao" href="/pessoas/${e(cartao.pessoa.id)}">${rotulo('abrir', 'Abrir')}</a>`,
  ].join('');
  const modal = podeReenviar && cartao.cobrancaId
    ? modalMensagem(idModal, cartao.cobrancaId, csrfToken, 'cobranca', 'Reenviar cobrança', 'Enviar', canaisMensagemFlags(cartao.podeEmail, cartao.podeWhatsapp))
    : '';
  const envio = cartao.cobrancaId
    ? `${cartao.pessoa.canal_email ? indicador('E-mail', cartao.email) : ''}${cartao.pessoa.canal_whatsapp ? indicador('WhatsApp', cartao.whatsapp) : ''}`
    : '';
  return `<tr data-pessoa data-nome="${e(cartao.pessoa.nome)}" data-situacao="${e(cartao.situacao)}" data-inativa="${cartao.pessoa.ativa ? '0' : '1'}">
      <td><a class="nome-pessoa" href="/pessoas/${e(cartao.pessoa.id)}">${e(cartao.pessoa.nome)}</a>
        <div class="muted pequeno">Dia ${cartao.diaEfetivo} · ${e(canaisDaPessoa(cartao.pessoa))}</div>
        ${alertas.map((texto) => `<div class="alerta-linha">${e(texto)}</div>`).join('')}</td>
      <td class="codigo">${e(cartao.competencia ?? '—')}</td>
      <td class="dinheiro num">${cartao.cobrancaId ? formatarReais(cartao.valorCentavos) : '—'}</td>
      <td><div class="tags">${tagSituacao(cartao.situacao)}${cartao.pessoa.ativa ? '' : etiqueta('Inativa', 'off')}</div></td>
      <td class="muted pequeno">${e(cartao.pixTexto)}</td>
      <td class="envio">${envio || '<span class="muted">—</span>'}</td>
      <td><div class="acoes">${acoes}</div>${modal}</td>
    </tr>`;
}

export function paginaQuemDeve(cartoes: CartaoPessoa[], csrfToken: string): string {
  const corpo = cartoes.length
    ? `${cartoes.map((cartao) => linhaQuemDeve(cartao, csrfToken)).join('')}
       <tr data-filtro-vazio hidden><td colspan="7" class="muted">Nenhuma pessoa encontrada com esse filtro.</td></tr>`
    : '<tr><td colspan="7" class="muted">Nenhuma pessoa cadastrada.</td></tr>';
  return `<div class="topo"><div><h1>Quem deve</h1><p class="sub">Todas as pessoas com a cobrança mais recente de cada uma.</p></div>
    <div class="filtros-lista">
      <label><span class="sr">Buscar pessoa</span><input type="search" placeholder="Buscar pessoa" data-filtro-busca autocomplete="off"></label>
      <label><span class="sr">Situação</span><select data-filtro-situacao>
        <option value="">Situação: todas</option>
        <option value="aberta">Em aberto</option>
        <option value="atrasada">Atrasada</option>
        <option value="paga">Paga</option>
        <option value="sem_cobranca">Sem cobrança</option>
        <option value="inativa">Inativa</option>
      </select></label>
      <a class="botao" href="/pessoas/nova">${rotulo('pessoa', 'Nova pessoa')}</a>
    </div></div>
    <div class="bloco tabela-bloco">
      <table class="tabela-pessoas">
        <thead><tr><th>Pessoa</th><th>Competência</th><th class="num">Valor mais recente</th><th>Situação</th><th>PIX</th><th>Envio</th><th>Ações</th></tr></thead>
        <tbody>${corpo}</tbody>
      </table>
    </div>`;
}

function monograma(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '??';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0] ?? ''}${partes[partes.length - 1][0] ?? ''}`.toUpperCase();
}

function abaFicha(href: string, id: AbaFicha, atual: AbaFicha, rotulo: string, contador?: number): string {
  const ativa = atual === id ? ' ativa' : '';
  const badge = contador !== undefined ? `<span class="contagem">${contador}</span>` : '';
  return `<a class="ficha-aba${ativa}" href="${href}?aba=${id}">${rotulo}${badge}</a>`;
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

function modalLancamento(
  pessoaId: string,
  csrfToken: string,
  valores: RascunhoItem,
  opcoes: { idModal: string; titulo: string; action: string; inicial?: boolean },
): string {
  const inicial = opcoes.inicial ? ' data-modal-inicial' : '';
  const inicioCompetencia =
    valores.inicioMes && valores.inicioAno
      ? `${String(valores.inicioMes).padStart(2, '0')}/${valores.inicioAno}`
      : '';
  const fimCompetencia =
    valores.fimMes && valores.fimAno ? `${String(valores.fimMes).padStart(2, '0')}/${valores.fimAno}` : '';
  return `<dialog class="modal modal-ficha" id="${e(opcoes.idModal)}"${inicial}>
    <form method="post" action="${e(opcoes.action)}">
      ${csrf(csrfToken)}
      ${valores.id ? `<input type="hidden" name="pessoa_id" value="${e(pessoaId)}">` : ''}
      <header class="modal-cabeca">
        <div>
          <h2>${e(opcoes.titulo)}</h2>
          <p class="muted pequeno">O fim é opcional. Sem ele, o item continua em todo mês a partir do início.</p>
        </div>
        ${botaoFechar()}
      </header>
      <label>Descrição<input name="descricao" maxlength="200" required value="${e(valores.descricao)}"></label>
      <label>Valor (R$)<input name="valor" class="dinheiro" required placeholder="1.150,00" value="${e(valores.valor)}"></label>
      <div class="row">
        <label>Início mês<input name="inicio_mes" type="number" min="1" max="12" required value="${e(valores.inicioMes)}" placeholder="MM"></label>
        <label>Início ano<input name="inicio_ano" type="number" min="2000" max="2100" required value="${e(valores.inicioAno)}"></label>
        <label>Fim mês<input name="fim_mes" type="number" min="1" max="12" placeholder="opcional" value="${e(valores.fimMes)}"></label>
        <label>Fim ano<input name="fim_ano" type="number" min="2000" max="2100" placeholder="opcional" value="${e(valores.fimAno)}"></label>
      </div>
      ${inicioCompetencia ? `<p class="muted pequeno">Prévia: ${e(inicioCompetencia)}${fimCompetencia ? ` até ${e(fimCompetencia)}` : ' · sem fim'}</p>` : ''}
      <div class="acoes modal-rodape">
        <button type="button" class="secundario modal-fechar">${rotulo('fechar', 'Cancelar')}</button>
        <button type="submit">${rotulo('salvar', 'Salvar')}</button>
      </div>
    </form>
  </dialog>`;
}

function modalItensCobranca(linha: LinhaHistorico, itens: LinhaResumoCobranca[]): string {
  const id = `modal-cobranca-itens-${linha.id}`;
  const corpo = itens.length
    ? itens
        .map(
          (item) =>
            `<tr><td>${e(item.descricao)}</td><td class="dinheiro num">${formatarReais(item.valorCentavos)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="2" class="muted">Nenhum lançamento registrado nesta cobrança.</td></tr>';
  const status = tagStatus(linha.status);
  return `<dialog class="modal modal-itens-cobranca" id="${e(id)}">
    <div class="modal-corpo">
      <header class="modal-cabeca">
        <div>
          <h2>Lançamentos da cobrança</h2>
          <p class="muted pequeno">${e(linha.competencia)} · <span class="dinheiro">${formatarReais(linha.total)}</span> · ${status}</p>
        </div>
        ${botaoFechar()}
      </header>
      <table>
        <thead><tr><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody>${corpo}</tbody>
        <tfoot><tr><td>Total</td><td class="dinheiro num">${formatarReais(linha.total)}</td></tr></tfoot>
      </table>
      <div class="acoes modal-rodape">
        <a class="botao secundario" href="/cobrancas/${e(linha.id)}">${rotulo('abrir', 'Abrir cobrança')}</a>
        <button type="button" class="secundario modal-fechar">${rotulo('fechar', 'Fechar')}</button>
      </div>
    </div>
  </dialog>`;
}

function metricasFicha(pessoa: Pessoa, diaEfetivo: number, itens: Item[], historico: LinhaHistorico[]): string {
  const totalMensal = itens.reduce((soma, item) => soma + item.valor_centavos, 0);
  const comCobranca = historico.filter((linha) => linha.status !== 'cancelada');
  const pagas = comCobranca.filter((linha) => linha.status === 'paga').length;
  const liquidacao = comCobranca.length ? `${Math.round((pagas / comCobranca.length) * 100)}%` : '—';
  const proximo = `Dia ${diaEfetivo}`;
  return `<div class="ficha-metricas">
    <div class="metrica"><span>Próximo vencimento</span><strong>${e(proximo)}</strong><small>${pessoa.ativa ? 'Cliente ativa' : 'Cliente inativa'}</small></div>
    <div class="metrica"><span>Valor mensal recorrente</span><strong class="dinheiro ciano">${formatarReais(totalMensal)}</strong><small>${itens.length} lançamento${itens.length === 1 ? '' : 's'}</small></div>
    <div class="metrica"><span>Histórico de liquidação</span><strong class="ok">${e(liquidacao)}</strong><small>${pagas} de ${comCobranca.length} cobrança${comCobranca.length === 1 ? '' : 's'}</small></div>
  </div>`;
}

function cabecalhoFicha(dados: FichaPessoaDados): string {
  const { pessoa, diaEfetivo, csrfToken, geracao } = dados;
  const pendente = pessoa.dia_cobranca_pendente
    ? ` Dia ${pessoa.dia_cobranca_pendente} vale a partir de ${String(pessoa.dia_pendente_mes).padStart(2, '0')}/${pessoa.dia_pendente_ano}.`
    : '';
  const statusClasse = pessoa.ativa ? 'ficha-status' : 'ficha-status inativa';
  const statusTexto = pessoa.ativa ? 'Ativa' : 'Inativa';
  const mesGeracao = geracao?.mes ?? '';
  const anoGeracao = geracao?.ano ?? '';
  return `<p class="ficha-trilha"><a href="/quem-deve">Quem deve</a><span aria-hidden="true">/</span><strong>${e(pessoa.nome)}</strong></p>
    <div class="ficha-cabeca">
      <div class="ficha-identidade">
        <div class="ficha-avatar" aria-hidden="true">${e(monograma(pessoa.nome))}</div>
        <div>
          <h1>${e(pessoa.nome)}</h1>
          <p class="sub"><span class="${statusClasse}"><i></i>${statusTexto}</span><span class="muted">Dia efetivo deste mês: ${diaEfetivo}.${pendente}</span></p>
        </div>
      </div>
      <div class="ficha-acoes-topo">
        <form class="ficha-gerar" method="post" action="/pessoas/${e(pessoa.id)}/gerar">
          ${csrf(csrfToken)}
          <label>Mês<input name="mes" type="number" min="1" max="12" required value="${e(mesGeracao)}"></label>
          <label>Ano<input name="ano" type="number" min="2000" max="2100" required value="${e(anoGeracao)}"></label>
          <button type="submit">${rotulo('gerar', 'Gerar cobrança')}</button>
        </form>
        <form method="post" action="/pessoas/${e(pessoa.id)}/ativa">${csrf(csrfToken)}<input type="hidden" name="ativa" value="${pessoa.ativa ? '0' : '1'}"><button class="secundario" type="submit">${pessoa.ativa ? rotulo('inativar', 'Inativar') : rotulo('reativar', 'Reativar')}</button></form>
      </div>
    </div>`;
}

function abaInformacoesFicha(dados: FichaPessoaDados): string {
  const rascunho = dados.rascunhoPessoa ?? null;
  const pessoa = dados.pessoa;
  const nome = rascunho?.nome ?? pessoa.nome;
  const whatsapp = rascunho?.whatsapp ?? pessoa.whatsapp;
  const email = rascunho?.email ?? pessoa.email;
  const cpf = rascunho?.cpf ?? pessoa.cpf ?? '';
  const dia = rascunho ? rascunho.diaCobranca : String(pessoa.dia_cobranca_pendente ?? pessoa.dia_cobranca);
  const validade = rascunho ? rascunho.validadePixDias : String(pessoa.validade_pix_dias);
  const avisoDias = rascunho ? rascunho.diasAviso : String(pessoa.dias_aviso_inadimplencia);
  const emailLigado = rascunho ? rascunho.canalEmail : pessoa.canal_email;
  const whatsappLigado = rascunho ? rascunho.canalWhatsapp : pessoa.canal_whatsapp;
  return `<form class="bloco" method="post" action="/pessoas/${e(pessoa.id)}">
      ${csrf(dados.csrfToken)}
      <div class="bloco-cabeca"><div><h2>Dados cadastrais</h2><p class="muted">Contato e regras de cobrança PIX desta pessoa.</p></div></div>
      <div class="ficha-form-grid">
        <label>Nome<input name="nome" required maxlength="120" value="${e(nome)}"></label>
        <label>WhatsApp<input name="whatsapp" required value="${e(whatsapp)}" placeholder="11999999999"></label>
        <label>E-mail<input name="email" type="email" required value="${e(email)}"></label>
        <label>CPF<input name="cpf" value="${e(cpf)}" placeholder="opcional"></label>
        <label>Dia de cobrança<input name="dia_cobranca" type="number" min="1" max="31" required value="${e(dia)}"></label>
        <label>Validade do PIX (dias)<input name="validade_pix_dias" type="number" min="1" max="30" required value="${e(validade)}"></label>
        <label>Dias para o aviso<input name="dias_aviso_inadimplencia" type="number" min="1" max="60" required value="${e(avisoDias)}"></label>
        <div class="checks linha-inteira">
          <label><input type="checkbox" name="canal_email" value="1" ${emailLigado ? 'checked' : ''}> E-mail</label>
          <label><input type="checkbox" name="canal_whatsapp" value="1" ${whatsappLigado ? 'checked' : ''}> WhatsApp</label>
        </div>
      </div>
      <div class="acoes"><button type="submit">${rotulo('salvar', 'Salvar alterações')}</button></div>
    </form>`;
}

function abaLancamentosFicha(dados: FichaPessoaDados): string {
  const { pessoa, itens, itensUsados, csrfToken, rascunhoItem } = dados;
  const linhas = itens
    .map((item) => {
      const idModal = `modal-lancamento-${item.id}`;
      const podeExcluir = !itensUsados.has(item.id);
      return `<tr>
        <td data-label="Descrição">${e(item.descricao)}</td>
        <td class="dinheiro num" data-label="Valor">${formatarReais(item.valor_centavos)}</td>
        <td data-label="Início">${String(item.inicio_mes).padStart(2, '0')}/${item.inicio_ano}</td>
        <td data-label="Fim">${fimExibido(item.fim_mes, item.fim_ano)}</td>
        <td class="celula-acoes"><div class="acoes-celula">
          <button type="button" class="secundario compacto" data-modal-abrir="${e(idModal)}">${rotulo('editar', 'Editar')}</button>
          ${podeExcluir
            ? `<form method="post" action="/itens/${e(item.id)}/excluir">${csrf(csrfToken)}<button class="secundario compacto perigo" type="submit">${rotulo('excluir', 'Excluir')}</button></form>`
            : '<span class="muted pequeno">em cobrança</span>'}
        </div></td>
      </tr>`;
    })
    .join('');
  const total = itens.reduce((soma, item) => soma + item.valor_centavos, 0);
  const modaisEdit = itens
    .map((item) => {
      const valores = valoresItem(item, rascunhoItem ?? null, false);
      const inicial = rascunhoItem?.id === item.id;
      return modalLancamento(pessoa.id, csrfToken, valores, {
        idModal: `modal-lancamento-${item.id}`,
        titulo: 'Editar lançamento',
        action: `/itens/${item.id}`,
        inicial,
      });
    })
    .join('');
  const novo = valoresItem(null, rascunhoItem ?? null, true);
  const modalNovo = modalLancamento(pessoa.id, csrfToken, novo, {
    idModal: 'modal-lancamento-novo',
    titulo: 'Novo lançamento',
    action: `/pessoas/${pessoa.id}/itens`,
    inicial: rascunhoItem?.id === null,
  });
  return `<div class="bloco ficha-tabela">
      <div class="bloco-cabeca">
        <div><h2>Lançamentos recorrentes</h2><p class="muted">Itens que entram no valor consolidado da cobrança mensal.</p></div>
        <button type="button" class="botao" data-modal-abrir="modal-lancamento-novo">${rotulo('mais', 'Novo lançamento')}</button>
      </div>
      <div class="ficha-tabela-scroll">
      <table>
        <thead><tr><th>Descrição</th><th class="num">Valor</th><th>Início</th><th>Fim</th><th class="num">Ações</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="5" class="muted">Nenhum lançamento cadastrado.</td></tr>'}</tbody>
        ${itens.length ? `<tfoot><tr><td>Total mensal</td><td class="dinheiro num">${formatarReais(total)}</td><td colspan="3"></td></tr></tfoot>` : ''}
      </table>
      </div>
    </div>
    ${modalNovo}${modaisEdit}`;
}

function abaHistoricoFicha(dados: FichaPessoaDados): string {
  const { historico, linhasCobranca } = dados;
  const linhas = historico
    .map((linha) => {
      const ver = `<button type="button" class="secundario compacto" data-modal-abrir="modal-cobranca-itens-${e(linha.id)}">${rotulo('lista', 'Ver lançamentos')}</button>`;
      return `<tr>
        <td class="dinheiro num" data-label="Valor">${formatarReais(linha.total)}</td>
        <td data-label="Competência">${e(linha.competencia)}</td>
        <td data-label="Status">${tagStatus(linha.status)}</td>
        <td data-label="Pago em">${linha.pagaEm ? e(linha.pagaEm) : '—'}</td>
        <td class="celula-acoes">${ver}</td>
      </tr>`;
    })
    .join('');
  const modais = historico.map((linha) => modalItensCobranca(linha, linhasCobranca[linha.id] ?? [])).join('');
  return `<div class="bloco ficha-tabela">
      <div class="bloco-cabeca"><div><h2>Cobranças geradas</h2><p class="muted">Histórico de faturas e liquidações desta pessoa.</p></div></div>
      <div class="ficha-tabela-scroll">
      <table>
        <thead><tr><th class="num">Valor</th><th>Competência</th><th>Status</th><th>Pago em</th><th>Ações</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="5" class="muted">Nenhuma cobrança gerada ainda.</td></tr>'}</tbody>
      </table>
      </div>
    </div>
    ${modais}`;
}

export function paginaFichaPessoa(dados: FichaPessoaDados): string {
  const href = `/pessoas/${dados.pessoa.id}`;
  const abas = `${abaFicha(href, 'informacoes', dados.aba, 'Informações')}${abaFicha(href, 'lancamentos', dados.aba, 'Lançamentos', dados.itens.length)}${abaFicha(href, 'historico', dados.aba, 'Histórico', dados.historico.length)}`;
  let painel = '';
  if (dados.aba === 'informacoes') painel = abaInformacoesFicha(dados);
  else if (dados.aba === 'lancamentos') painel = abaLancamentosFicha(dados);
  else painel = abaHistoricoFicha(dados);
  return `${cabecalhoFicha(dados)}
    ${metricasFicha(dados.pessoa, dados.diaEfetivo, dados.itens, dados.historico)}
    <div class="ficha-abas" role="tablist">${abas}</div>
    <div class="ficha-painel">${painel}</div>`;
}

export function paginaPessoa(
  pessoa: Pessoa | null,
  efetivo: number | null,
  csrfToken: string,
  _itensHref: string | null,
  rascunho: RascunhoPessoa | null = null,
  _geracao: RascunhoMes | null = null,
): string {
  const nome = rascunho?.nome ?? '';
  const whatsapp = rascunho?.whatsapp ?? '';
  const email = rascunho?.email ?? '';
  const cpf = rascunho?.cpf ?? '';
  const dia = rascunho?.diaCobranca ?? '10';
  const validade = rascunho?.validadePixDias ?? '10';
  const avisoDias = rascunho?.diasAviso ?? '5';
  const emailLigado = rascunho ? rascunho.canalEmail : true;
  const whatsappLigado = rascunho ? rascunho.canalWhatsapp : true;
  return `<h1>Nova pessoa</h1>
    <p class="sub">E-mail e WhatsApp começam ligados. O PIX vale 10 dias e o aviso sai 5 dias depois do vencimento.</p>
    <form class="bloco" method="post" action="/pessoas">
      ${csrf(csrfToken)}
      <div class="ficha-form-grid">
        <label>Nome<input name="nome" required maxlength="120" value="${e(nome)}"></label>
        <label>WhatsApp<input name="whatsapp" required value="${e(whatsapp)}" placeholder="11999999999"></label>
        <label>E-mail<input name="email" type="email" required value="${e(email)}"></label>
        <label>CPF<input name="cpf" value="${e(cpf)}" placeholder="opcional"></label>
        <label>Dia de cobrança<input name="dia_cobranca" type="number" min="1" max="31" required value="${e(dia)}"></label>
        <label>Validade do PIX (dias)<input name="validade_pix_dias" type="number" min="1" max="30" required value="${e(validade)}"></label>
        <label>Dias para o aviso<input name="dias_aviso_inadimplencia" type="number" min="1" max="60" required value="${e(avisoDias)}"></label>
        <div class="checks linha-inteira">
          <label><input type="checkbox" name="canal_email" value="1" ${emailLigado ? 'checked' : ''}> E-mail</label>
          <label><input type="checkbox" name="canal_whatsapp" value="1" ${whatsappLigado ? 'checked' : ''}> WhatsApp</label>
        </div>
      </div>
      <div class="acoes"><button type="submit">${rotulo('salvar', 'Salvar')}</button></div>
    </form>`;
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
  return `<h1>Cobranças</h1><p class="sub">As canceladas ficam de fora até você filtrar por elas.</p>
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
        <button type="submit">${rotulo('filtro', 'Filtrar')}</button>
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
      <td>${pix.provedor === 'nativo' ? 'PIX nativo' : `Mercado Pago${pix.mpStatus ? ` · ${e(pix.mpStatus)}` : ''}`}</td><td>${e(pix.motivo ?? '')}</td>
    </tr>`).join('');
  const eventos = detalhe.eventos.map((evento) => `<li>${e(evento.efeito)} · ${formatarReais(evento.valorCentavos)} · ${e(formatarDataHora(evento.recebidoEm))}</li>`).join('');
  const afetadas = detalhe.linhasAfetadas.map((linha) => `${linha.descricao} (${String(linha.mes).padStart(2, '0')}/${linha.ano})`).join(', ');
  return `<p class="trilha"><a href="/cobrancas">Cobranças</a> / ${e(detalhe.pessoa)}</p>
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
        <table><thead><tr><th>Valor</th><th>Status</th><th>Validade</th><th>Vencimento</th><th>Provedor</th><th>Motivo</th></tr></thead><tbody>${pixes}</tbody></table></div>
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

function modalPreviaTemplate(previsao: { canal: string; tipo: string; assunto: string; corpo: string }): string {
  const titulo = `${NOMES_CANAL[previsao.canal] ?? previsao.canal} · ${NOMES_TIPO[previsao.tipo] ?? previsao.tipo}`;
  return `<dialog class="modal modal-mensagem" id="modal-previa-template" data-modal-inicial>
    <div class="modal-corpo">
      <header class="modal-cabeca">
        <h2>Pré-visualização</h2>
        ${botaoFechar()}
      </header>
      <p class="muted">${e(titulo)}. Dados fictícios, de ninguém cadastrado. O texto não foi salvo.</p>
      ${previsao.assunto ? `<p class="mensagem-assunto"><span class="muted">Assunto</span><br><strong>${e(previsao.assunto)}</strong></p>` : ''}
      <pre class="mensagem-previa">${e(previsao.corpo)}</pre>
      <div class="acoes modal-rodape"><button type="button" class="secundario modal-fechar">${rotulo('fechar', 'Fechar')}</button></div>
    </div>
  </dialog>`;
}

export function paginaTemplates(
  modelos: TemplateLinha[],
  csrfToken: string,
  previsao: { canal: string; tipo: string; assunto: string; corpo: string } | null,
  rascunho: RascunhoTemplate | null = null,
): string {
  const blocos = modelos.map((modelo) => {
    const tipo = modelo.tipo as TipoMensagem;
    const editando = rascunho?.destino === 'bloco' && rascunho.canal === modelo.canal && rascunho.tipo === modelo.tipo;
    const assunto = editando && rascunho ? rascunho.assunto : (modelo.assunto ?? '');
    const corpo = editando && rascunho ? rascunho.corpo : modelo.corpo;
    const caminho = `/templates/${e(modelo.canal)}/${e(modelo.tipo)}`;
    return `<section class="bloco">
      <form method="post" action="${caminho}">
        ${csrf(csrfToken)}
        <h2>${e(NOMES_CANAL[modelo.canal] ?? modelo.canal)} · ${e(NOMES_TIPO[modelo.tipo] ?? modelo.tipo)}</h2>
        <p class="muted">Variáveis: ${e(variaveisDoCenario(tipo).map((nome) => `{${nome}}`).join(', '))}</p>
        ${modelo.canal === 'email' ? `<label>Assunto<input name="assunto" value="${e(assunto)}"></label>` : ''}
        <label>Texto<textarea name="corpo">${e(corpo)}</textarea></label>
        <div class="acoes">
          <button type="submit">${rotulo('salvar', 'Salvar')}</button>
          <button class="secundario" type="submit" formaction="${caminho}/prever">${rotulo('olho', 'Pré-visualizar')}</button>
          <button class="secundario" type="submit" formaction="${caminho}/restaurar">${rotulo('restaurar', 'Restaurar padrão')}</button>
        </div>
      </form>
    </section>`;
  }).join('');
  return `<h1>Templates</h1>
    <p class="sub">Seis textos: e-mail e WhatsApp para cobrança, confirmação e inadimplência. Pré-visualizar mostra a mensagem com dados fictícios, sem gravar.</p>
    ${blocos}
    ${previsao ? modalPreviaTemplate(previsao) : ''}`;
}

export function paginaConfiguracao(
  config: ConfigPublica,
  csrfToken: string,
  rascunho: RascunhoConfig | null = null,
  errosCampos: Record<string, string> | null = null,
): string {
  const vista = rascunho
    ? {
        ...config,
        usuario: rascunho.usuario,
        emailDono: rascunho.emailDono,
        telefone2fa: rascunho.telefone2fa,
        smtpHost: rascunho.smtpHost,
        smtpPorta: rascunho.smtpPorta,
        smtpUsuario: rascunho.smtpUsuario,
        smtpRemetenteNome: rascunho.smtpRemetenteNome,
        smtpRemetenteEmail: rascunho.smtpRemetenteEmail,
        smtpCriptografia: rascunho.smtpCriptografia,
        evolution: { ...config.evolution, url: rascunho.evolutionUrl, instancia: rascunho.evolutionInstance },
        pix: {
          provedor: rascunho.pixProvedor === 'nativo' ? 'nativo' as const : 'mercadopago' as const,
          chave: rascunho.pixChave,
          recebedor: rascunho.pixRecebedor,
          cidade: rascunho.pixCidade,
        },
        conciliacaoIntervaloMinutos: Number(rascunho.conciliacaoIntervaloMinutos) as ConfigPublica['conciliacaoIntervaloMinutos'],
      }
    : config;
  config = vista;
  const teste = config.evolution.ultimoTesteEm
    ? `${config.evolution.ultimoTesteOk ? 'Conexão encontrada' : 'Falhou'} em ${formatarDataHora(config.evolution.ultimoTesteEm)}. ${config.evolution.ultimoTesteMotivo ?? ''}`
    : 'Ainda não testada.';
  const inv = (nome: string) => classeCampoInvalido(errosCampos, nome);
  const opcoesConciliacao = INTERVALOS_CONCILIACAO_MINUTOS.map((minutos) => {
    const selecionado = config.conciliacaoIntervaloMinutos === minutos ? 'selected' : '';
    return `<option value="${minutos}" ${selecionado}>${e(ROTULOS_INTERVALO_CONCILIACAO[minutos])}</option>`;
  }).join('');
  const ultimaConciliacao = config.conciliacaoUltimaEm
    ? `Última consulta automática: ${e(formatarDataHora(config.conciliacaoUltimaEm))}.`
    : config.conciliacaoIntervaloMinutos > 0
      ? 'Ainda não houve consulta automática desde que o intervalo foi definido.'
      : '';
  return `<h1>Configuração</h1>
    <p class="sub">Segredo gravado não volta para a tela. Campo em branco mantém o valor atual. A senha atual só é necessária para definir uma senha nova.</p>
    <form class="bloco" method="post" action="/configuracao">${csrf(csrfToken)}
      <h2>Acesso</h2>
      <div class="row">
        <label${inv('usuario')}>Usuário<input name="usuario" required value="${e(config.usuario)}"></label>
        <label${inv('email_dono')}>E-mail do código<input name="email_dono" type="email" required value="${e(config.emailDono)}"></label>
        <label${inv('telefone_2fa')}>Telefone para 2FA<input name="telefone_2fa" value="${e(config.telefone2fa)}" placeholder="11999999999" autocomplete="off"></label>
        <label${inv('senha_atual')}>Senha atual<input name="senha_atual" type="password" autocomplete="current-password"></label>
        <label${inv('senha_nova')}>Senha nova<input name="senha_nova" type="password" autocomplete="new-password"></label>
      </div>
      <h2>PIX</h2>
      <p class="muted">Vale para os próximos PIX emitidos; os já emitidos continuam com o provedor que os gerou. O PIX nativo usa copia e cola estático e a baixa automática lê o extrato do Mercado Pago. Baixa manual continua na cobrança.</p>
      <div class="row">
        <label${inv('conciliacao_intervalo_minutos')}>Consulta automática de cobranças em aberto<select name="conciliacao_intervalo_minutos">${opcoesConciliacao}</select></label>
      </div>
      <p class="muted">Equivale ao botão do Dashboard: concilia PIX nativo no extrato e consulta PIX pendentes no Mercado Pago. O webhook do MP continua valendo para PIX gerados por lá. ${ultimaConciliacao}</p>
      <div class="row">
        <label${inv('pix_provedor')}>Gerar PIX por<select name="pix_provedor">
          <option value="mercadopago" ${config.pix.provedor === 'mercadopago' ? 'selected' : ''}>Mercado Pago</option>
          <option value="nativo" ${config.pix.provedor === 'nativo' ? 'selected' : ''}>PIX nativo (copia e cola estático)</option>
        </select></label>
        <label${inv('pix_chave')}>Chave PIX<input name="pix_chave" maxlength="77" value="${e(config.pix.chave)}" placeholder="CPF, e-mail, +55... ou chave aleatória" autocomplete="off"></label>
        <label${inv('pix_recebedor')}>Recebedor<input name="pix_recebedor" maxlength="25" required value="${e(config.pix.recebedor)}"></label>
        <label${inv('pix_cidade')}>Cidade<input name="pix_cidade" maxlength="15" required value="${e(config.pix.cidade)}"></label>
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
        <label${inv('smtp_host')}>Host<input name="smtp_host" value="${e(config.smtpHost)}"></label>
        <label${inv('smtp_porta')}>Porta<input name="smtp_porta" value="${e(config.smtpPorta)}" placeholder="587"></label>
        <label${inv('smtp_usuario')}>Usuário<input name="smtp_usuario" value="${e(config.smtpUsuario)}"></label>
        <label${inv('smtp_senha')}>Senha<input name="smtp_senha" type="password" autocomplete="off"></label>
        <label${inv('smtp_remetente_nome')}>Nome do remetente<input name="smtp_remetente_nome" value="${e(config.smtpRemetenteNome)}"></label>
        <label${inv('smtp_remetente_email')}>E-mail do remetente<input name="smtp_remetente_email" value="${e(config.smtpRemetenteEmail)}"></label>
        <label${inv('smtp_criptografia')}>Criptografia<select name="smtp_criptografia">
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
        <button class="secundario" type="submit" formaction="/configuracao/smtp" formmethod="post">${rotulo('mail', 'Enviar e-mail teste')}</button>
      </div>
      <h2>Evolution Go</h2>
      <p>Chave API: ${config.evolution.chaveDefinida ? etiqueta('definido: sim', 'ok') : etiqueta('definido: não', 'off')}. ${e(teste)}</p>
      <div class="row">
        <label${inv('evolution_url')}>URL<input name="evolution_url" value="${e(config.evolution.url)}" placeholder="https://evolution.example"></label>
        <label${inv('evolution_instance')}>Instância<input name="evolution_instance" value="${e(config.evolution.instancia)}"></label>
        <label${inv('evolution_api_key')}>Chave API<input name="evolution_api_key" type="password" autocomplete="off"></label>
      </div>
      <p class="muted">O teste usa o Evolution já salvo. Salve antes se alterou URL, instância ou chave.</p>
      <div class="acoes">
        <button class="secundario" type="submit" formaction="/configuracao/evolution" formmethod="post">${rotulo('plug', 'Testar conexão')}</button>
        <button type="submit">${rotulo('salvar', 'Salvar')}</button>
      </div>
    </form>`;
}
