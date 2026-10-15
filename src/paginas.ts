import type { Flash } from './acesso.ts';
import type { CartaoPessoa, Detalhe, LinhaHistorico } from './consultas.ts';
import { formatarDataHora } from './domain/calendar.ts';
import { formatarReais } from './domain/money.ts';
import type { ConfigPublica, TemplateLinha } from './configuracao.ts';
import { variaveisDoCenario, type TipoMensagem } from './domain/template.ts';
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

export function layout(opcoes: { titulo: string; corpo: string; autenticado: boolean; flash: Flash | null }): string {
  const nav = opcoes.autenticado
    ? `<nav>
        <a href="/">Quem deve</a>
        <a href="/cobrancas">Histórico</a>
        <a href="/templates">Templates</a>
        <a href="/configuracao">Configuração</a>
        <form method="post" action="/sair"><button type="submit">Sair</button></form>
      </nav>`
    : '';
  const flash = opcoes.flash
    ? `<div class="flash ${opcoes.flash.tipo === 'ok' ? 'ok' : 'erro'}">${e(opcoes.flash.texto)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(opcoes.titulo)} · PagaEu</title>
  <style>
    :root { color-scheme: light; --bg:#efe6d6; --paper:#fffaf3; --ink:#241c14; --muted:#6f655b; --line:#e3d5c3; --green:#1c6b45; --green-bg:#e7f6ee; --red:#8d2d2d; --red-bg:#fdeeee; --amber:#8a5a12; --amber-bg:#fff4df; --gray:#8d847b; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Segoe UI", "Helvetica Neue", sans-serif; background: radial-gradient(circle at top left, #f7f1e6, var(--bg) 42%); color: var(--ink); }
    header { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:18px 28px; border-bottom:1px solid var(--line); background: rgba(255,250,243,.92); position:sticky; top:0; }
    header strong { font-family: Georgia, "Iowan Old Style", serif; font-size: 1.4rem; letter-spacing: .02em; }
    nav { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
    nav a { color: var(--ink); text-decoration:none; font-weight:600; }
    main { max-width: 1100px; margin: 0 auto; padding: 28px 20px 64px; }
    h1, h2 { font-family: Georgia, "Iowan Old Style", serif; font-weight: 600; }
    h1 { margin: 0 0 8px; font-size: 2rem; }
    .sub { color: var(--muted); margin: 0 0 22px; }
    a { color: var(--green); }
    .cards { display:grid; gap:14px; }
    .card, form.bloco, .bloco { background: var(--paper); border:1px solid var(--line); border-radius: 16px; padding: 16px 18px; }
    .topo { display:flex; justify-content:space-between; gap:12px; align-items:baseline; flex-wrap:wrap; }
    .dinheiro { font-variant-numeric: tabular-nums; font-weight: 700; }
    .muted { color: var(--muted); }
    .row { display:flex; gap:10px; flex-wrap:wrap; align-items:end; }
    label { display:flex; flex-direction:column; gap:4px; font-size:.92rem; }
    input, select, textarea { font: inherit; color: inherit; background:#fff; border:1px solid #d9cbb8; border-radius:10px; padding:8px 10px; }
    textarea { width:100%; min-height: 180px; }
    button, .botao { background: var(--ink); color: #fffaf3; border:0; border-radius: 999px; padding: 8px 14px; font: inherit; cursor: pointer; text-decoration:none; display:inline-block; }
    button.secundario, .botao.secundario { background: transparent; color: var(--ink); border:1px solid var(--line); }
    button.perigo { background: var(--red); }
    button.destaque { background: var(--green); }
    table { width:100%; border-collapse: collapse; }
    th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
    .flash { white-space: pre-wrap; border-radius:12px; padding:12px 14px; margin-bottom:16px; }
    .flash.ok { background: var(--green-bg); }
    .flash.erro, .alerta { background: var(--amber-bg); border:1px solid #efd3a4; border-radius:12px; padding:12px 14px; margin: 10px 0; }
    .ponto { display:inline-flex; align-items:center; gap:6px; margin-right:10px; }
    .ponto i { width:9px; height:9px; border-radius:50%; display:inline-block; background: var(--gray); }
    .ponto.enviado i { background: var(--green); }
    .ponto.falha i { background: var(--red); }
    .tag { border-radius:999px; padding:2px 8px; background:#f3ecdf; font-size:.85rem; }
    .tag.off { background: var(--red-bg); }
    .acoes { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
    .codigo { font-family: ui-monospace, monospace; word-break: break-all; }
    @media (max-width: 720px) { header, main { padding-left:14px; padding-right:14px; } table { display:block; overflow:auto; } }
  </style>
</head>
<body>
  <header><strong>PagaEu</strong>${nav}</header>
  <main>
    ${flash}
    ${opcoes.corpo}
  </main>
</body>
</html>`;
}

function indicador(nome: string, valor: CartaoPessoa['email']): string {
  if (!valor) return `<span class="ponto"><i></i>${e(nome)} não enviado</span>`;
  const classe = valor.resultado === 'enviado' ? 'enviado' : 'falha';
  const texto = valor.resultado === 'enviado' ? 'enviado' : 'falha';
  const motivo = valor.motivo ? ` — ${e(valor.motivo)}` : '';
  return `<span class="ponto ${classe}"><i></i>${e(nome)} ${texto}${motivo}</span>`;
}

function csrf(token: string): string {
  return `<input type="hidden" name="csrf" value="${e(token)}">`;
}

export function paginaLogin(erro: string | null, etapaCodigo: boolean): string {
  const aviso = erro ? `<p class="alerta">${e(erro)}</p>` : '';
  if (etapaCodigo) {
    return `<h1>Código por e-mail</h1><p class="sub">Enviamos um código de 6 dígitos. Ele vale 10 minutos.</p>${aviso}
      <form class="bloco" method="post" action="/login/codigo">
        <label>Código<input name="codigo" inputmode="numeric" autocomplete="one-time-code" required></label>
        <div class="acoes"><button type="submit">Entrar</button></div>
      </form>
      <form method="post" action="/login/reenviar"><button class="secundario" type="submit">Reenviar código</button></form>`;
  }
  return `<h1>Entrar</h1><p class="sub">Painel do dono.</p>${aviso}
    <form class="bloco" method="post" action="/login">
      <div class="row">
        <label>Usuário<input name="usuario" autocomplete="username" required></label>
        <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      </div>
      <div class="acoes"><button type="submit">Continuar</button></div>
    </form>`;
}

export function paginaQuemDeve(cartoes: CartaoPessoa[], csrfToken: string, hoje: string): string {
  const lista = cartoes.map((cartao) => {
    const alertas = [
      cartao.alertaItensPagos ? `A vigente inclui itens já pagos por um PIX antigo${cartao.linhasAfetadas.length ? `: ${cartao.linhasAfetadas.join(', ')}` : ''}.` : '',
      cartao.excedente ? 'Pagamento excedente.' : '',
      cartao.divergencia ? 'Divergência de valor.' : '',
    ].filter(Boolean);
    return `<article class="card">
      <div class="topo">
        <div><a href="/pessoas/${e(cartao.pessoa.id)}"><strong>${e(cartao.pessoa.nome)}</strong></a>
          ${cartao.pessoa.ativa ? '' : '<span class="tag off">inativa</span>'}
          <div class="muted">Dia ${cartao.pessoa.dia_cobranca} · efetivo ${cartao.diaEfetivo}${cartao.pessoa.dia_cobranca_pendente ? ` · pendente ${cartao.pessoa.dia_cobranca_pendente} a partir de ${String(cartao.pessoa.dia_pendente_mes).padStart(2, '0')}/${cartao.pessoa.dia_pendente_ano}` : ''}</div>
        </div>
        <div class="dinheiro">${formatarReais(cartao.valorCentavos)}</div>
      </div>
      <p>${cartao.competencia ? `Vigente ${e(cartao.competencia)}` : 'Sem cobrança vigente'} · PIX ${e(cartao.pixTexto)}</p>
      <div>${indicador('E-mail', cartao.email)}${indicador('WhatsApp', cartao.whatsapp)}</div>
      ${alertas.map((texto) => `<p class="alerta">${e(texto)}</p>`).join('')}
      ${cartao.cobrancaId ? `<a href="/cobrancas/${e(cartao.cobrancaId)}">Abrir cobrança</a>` : ''}
    </article>`;
  }).join('');
  return `<div class="topo"><div><h1>Quem deve</h1><p class="sub">Hoje, ${e(hoje)}. O valor é só o da cobrança vigente.</p></div>
    <a class="botao" href="/pessoas/nova">Nova pessoa</a></div>
    <form class="bloco" method="post" action="/lote">
      ${csrf(csrfToken)}
      <h2>Gerar cobranças do mês</h2>
      <div class="row">
        <label>Mês<input name="mes" type="number" min="1" max="12" required></label>
        <label>Ano<input name="ano" type="number" min="2000" max="2100" required></label>
        <button type="submit">Gerar cobranças do mês</button>
      </div>
    </form>
    <div class="cards">${lista || '<p>Nenhuma pessoa cadastrada.</p>'}</div>`;
}

export function paginaPessoa(pessoa: Pessoa | null, efetivo: number | null, csrfToken: string, itensHref: string | null): string {
  const valor = pessoa?.dia_cobranca_pendente ?? pessoa?.dia_cobranca ?? 10;
  return `<h1>${pessoa ? e(pessoa.nome) : 'Nova pessoa'}</h1>
    ${pessoa ? `<p class="sub">Dia efetivo deste mês: ${efetivo}.${pessoa.dia_cobranca_pendente ? ` Dia ${pessoa.dia_cobranca_pendente} vale a partir de ${String(pessoa.dia_pendente_mes).padStart(2, '0')}/${pessoa.dia_pendente_ano}.` : ''}</p>` : '<p class="sub">E-mail e WhatsApp começam ligados. O PIX vale 10 dias e o aviso sai 5 dias depois do vencimento.</p>'}
    <form class="bloco" method="post" action="${pessoa ? `/pessoas/${e(pessoa.id)}` : '/pessoas'}">
      ${csrf(csrfToken)}
      <div class="row">
        <label>Nome<input name="nome" required maxlength="120" value="${e(pessoa?.nome ?? '')}"></label>
        <label>WhatsApp<input name="whatsapp" required value="${e(pessoa?.whatsapp ?? '')}" placeholder="11999999999"></label>
        <label>E-mail<input name="email" type="email" required value="${e(pessoa?.email ?? '')}"></label>
        <label>CPF<input name="cpf" value="${e(pessoa?.cpf ?? '')}" placeholder="opcional"></label>
        <label>Dia de cobrança<input name="dia_cobranca" type="number" min="1" max="31" required value="${valor}"></label>
        <label>Validade do PIX (dias)<input name="validade_pix_dias" type="number" min="1" max="30" required value="${pessoa?.validade_pix_dias ?? 10}"></label>
        <label>Dias para o aviso<input name="dias_aviso_inadimplencia" type="number" min="1" max="60" required value="${pessoa?.dias_aviso_inadimplencia ?? 5}"></label>
      </div>
      <p>
        <label><input type="checkbox" name="canal_email" value="1" ${!pessoa || pessoa.canal_email ? 'checked' : ''}> E-mail</label>
        <label><input type="checkbox" name="canal_whatsapp" value="1" ${!pessoa || pessoa.canal_whatsapp ? 'checked' : ''}> WhatsApp</label>
      </p>
      <button type="submit">Salvar</button>
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
        <label>Mês<input name="mes" type="number" min="1" max="12" required></label>
        <label>Ano<input name="ano" type="number" min="2000" max="2100" required></label>
        <button type="submit">Gerar cobrança</button>
      </div>
    </form>` : ''}`;
}

export function paginaItens(pessoa: Pessoa, itens: Item[], usados: Set<string>, csrfToken: string): string {
  const linhas = itens.map((item) => `<tr>
      <td>${e(item.descricao)}</td>
      <td class="dinheiro">${formatarReais(item.valor_centavos)}</td>
      <td>${String(item.inicio_mes).padStart(2, '0')}/${item.inicio_ano}</td>
      <td>${String(item.fim_mes).padStart(2, '0')}/${item.fim_ano}</td>
      <td>${usados.has(item.id) ? 'em cobrança' : `<form method="post" action="/itens/${e(item.id)}/excluir">${csrf(csrfToken)}<button class="secundario" type="submit">Excluir</button></form>`}</td>
    </tr>
    <tr><td colspan="5">
      <form method="post" action="/itens/${e(item.id)}">${csrf(csrfToken)}
        <div class="row">
          <input type="hidden" name="pessoa_id" value="${e(pessoa.id)}">
          <label>Descrição<input name="descricao" maxlength="200" required value="${e(item.descricao)}"></label>
          <label>Valor<input name="valor" required value="${e(formatarReais(item.valor_centavos).replace('R$ ', ''))}"></label>
          <label>Início mês<input name="inicio_mes" type="number" min="1" max="12" value="${item.inicio_mes}"></label>
          <label>Início ano<input name="inicio_ano" type="number" min="2000" max="2100" value="${item.inicio_ano}"></label>
          <label>Fim mês<input name="fim_mes" type="number" min="1" max="12" value="${item.fim_mes}"></label>
          <label>Fim ano<input name="fim_ano" type="number" min="2000" max="2100" value="${item.fim_ano}"></label>
          <button type="submit">Atualizar</button>
        </div>
      </form>
    </td></tr>`).join('');
  return `<h1>Itens de ${e(pessoa.nome)}</h1><p class="sub">Início e fim são obrigatórios. Início igual ao fim é cobrança única.</p>
    <form class="bloco" method="post" action="/pessoas/${e(pessoa.id)}/itens">${csrf(csrfToken)}
      <div class="row">
        <label>Descrição<input name="descricao" maxlength="200" required></label>
        <label>Valor<input name="valor" required placeholder="1.150,00"></label>
        <label>Início mês<input name="inicio_mes" type="number" min="1" max="12" required></label>
        <label>Início ano<input name="inicio_ano" type="number" min="2000" max="2100" required></label>
        <label>Fim mês<input name="fim_mes" type="number" min="1" max="12" required></label>
        <label>Fim ano<input name="fim_ano" type="number" min="2000" max="2100" required></label>
        <button type="submit">Adicionar</button>
      </div>
    </form>
    <table><thead><tr><th>Descrição</th><th>Valor</th><th>Início</th><th>Fim</th><th></th></tr></thead><tbody>${linhas}</tbody></table>`;
}

export function paginaHistorico(linhas: LinhaHistorico[], pessoas: Pessoa[], filtro: { pessoa?: string; status?: string; mes?: string; ano?: string }): string {
  const opcoes = pessoas.map((pessoa) => `<option value="${e(pessoa.id)}" ${filtro.pessoa === pessoa.id ? 'selected' : ''}>${e(pessoa.nome)}</option>`).join('');
  const corpo = linhas.map((linha) => `<tr>
      <td><a href="/cobrancas/${e(linha.id)}">${e(linha.pessoa)}</a></td>
      <td>${e(linha.competencia)}</td>
      <td>${e(NOMES_STATUS[linha.status] ?? linha.status)}</td>
      <td>${linha.embutidaEm ? e(linha.embutidaEm) : '—'}</td>
      <td class="dinheiro">${formatarReais(linha.total)}</td>
      <td>${e(linha.origem)}</td>
      <td>${indicador('E-mail', linha.email)}${indicador('WhatsApp', linha.whatsapp)}</td>
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
    <table><thead><tr><th>Pessoa</th><th>Competência</th><th>Status</th><th>Embutida em</th><th>Total</th><th>Origem</th><th>Cobrança</th></tr></thead>
    <tbody>${corpo || '<tr><td colspan="7">Nenhuma cobrança.</td></tr>'}</tbody></table>`;
}

export function paginaDetalhe(detalhe: Detalhe, csrfToken: string): string {
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
  const indicadores = detalhe.indicadores.map((item) => {
    const chave = `${item.tipo}:${item.canal}`;
    const botao = detalhe.podeReenviar[chave]
      ? `<form method="post" action="/cobrancas/${e(detalhe.id)}/reenviar">${csrf(csrfToken)}
          <input type="hidden" name="tipo" value="${e(item.tipo)}"><input type="hidden" name="canal" value="${e(item.canal)}">
          <button class="secundario" type="submit">Reenviar</button></form>`
      : '';
    return `<div class="card"><strong>${e(NOMES_TIPO[item.tipo] ?? item.tipo)} · ${e(NOMES_CANAL[item.canal] ?? item.canal)}</strong>
      <div>${indicador(NOMES_CANAL[item.canal] ?? item.canal, item.indicador)}</div>
      ${item.tentativas.map((tentativa) => `<p class="muted">${e(formatarDataHora(tentativa.tentadoEm))} · ${e(tentativa.resultado)}${tentativa.motivo ? ` · ${e(tentativa.motivo)}` : ''}</p>`).join('')}
      ${botao}</div>`;
  }).join('');
  const eventos = detalhe.eventos.map((evento) => `<li>${e(evento.efeito)} · ${formatarReais(evento.valorCentavos)} · ${e(formatarDataHora(evento.recebidoEm))}</li>`).join('');
  const afetadas = detalhe.linhasAfetadas.map((linha) => `${linha.descricao} (${String(linha.mes).padStart(2, '0')}/${linha.ano})`).join(', ');
  return `<h1>${e(detalhe.pessoa)} · ${e(detalhe.competencia)}</h1>
    <p class="sub"><a href="/pessoas/${e(detalhe.pessoaId)}">${e(detalhe.pessoa)}</a> · ${e(NOMES_STATUS[detalhe.status] ?? detalhe.status)} · ${e(detalhe.origem)}${detalhe.pagaEm ? ` · paga em ${e(formatarDataHora(detalhe.pagaEm))} (${e(detalhe.origemBaixa)})` : ''}</p>
    ${detalhe.alerta || afetadas ? `<p class="alerta">A vigente inclui itens já pagos por um PIX antigo${afetadas ? `: ${e(afetadas)}` : ''}.</p>` : ''}
    ${eventos ? `<ul>${eventos}</ul>` : ''}
    ${detalhe.motivoCancelamento ? `<p>Cancelada em ${e(detalhe.canceladaEm ? formatarDataHora(detalhe.canceladaEm) : '')}. Motivo: ${e(detalhe.motivoCancelamento)}</p>` : ''}
    <table><thead><tr><th>Descrição</th><th>Origem</th><th>Valor</th><th></th></tr></thead><tbody>${linhas}</tbody></table>
    <p class="dinheiro">Total ${formatarReais(detalhe.total)}</p>
    ${detalhe.pixAtivo ? `<div class="bloco"><h2>PIX ativo</h2><p>Vence em ${e(formatarDataHora(detalhe.pixAtivo.venceEm))} · ${formatarReais(detalhe.pixAtivo.valorCentavos)}</p>
      <textarea id="pix-copia" class="codigo" readonly>${e(detalhe.pixAtivo.copia)}</textarea>
      <button type="button" data-copiar="pix-copia">Copiar</button></div>` : '<p>Sem PIX ativo.</p>'}
    <h2>Histórico de PIX</h2>
    <table><thead><tr><th>Valor</th><th>Status</th><th>Validade</th><th>Vencimento</th><th>Mercado Pago</th><th>Motivo</th></tr></thead><tbody>${pixes}</tbody></table>
    <h2>Mensagens</h2><div class="cards">${indicadores}</div>
    <div class="acoes">
      ${detalhe.acoes.baixaManual ? `<form class="bloco" method="post" action="/cobrancas/${e(detalhe.id)}/baixa">${csrf(csrfToken)}
        ${detalhe.pixAtivo ? `<p><label><input type="radio" name="pix" value="invalidar" checked> Invalidar o PIX</label>
        <label><input type="radio" name="pix" value="manter"> Manter o PIX ativo</label></p>` : ''}
        <button class="destaque" type="submit">Confirmar baixa</button></form>` : ''}
      ${detalhe.acoes.cancelar ? `<form method="post" action="/cobrancas/${e(detalhe.id)}/cancelar">${csrf(csrfToken)}
        <label>Motivo<input name="motivo" required maxlength="500"></label>
        <button class="perigo" type="submit">Cancelar cobrança</button></form>` : ''}
      ${detalhe.acoes.novoPix ? `<form method="post" action="/cobrancas/${e(detalhe.id)}/novo-pix">${csrf(csrfToken)}<button type="submit">Gerar novo PIX</button></form>` : ''}
      ${detalhe.acoes.invalidarPix ? `<form method="post" action="/cobrancas/${e(detalhe.id)}/invalidar-pix">${csrf(csrfToken)}<button class="secundario" type="submit">Invalidar PIX</button></form>` : ''}
      ${detalhe.acoes.tentarEmissao ? `<form method="post" action="/cobrancas/${e(detalhe.id)}/tentar-emissao">${csrf(csrfToken)}<button type="submit">Tentar emissão de novo</button></form>` : ''}
    </div>
    <script>
      document.querySelectorAll('[data-copiar]').forEach((botao) => {
        botao.addEventListener('click', async () => {
          const alvo = document.getElementById(botao.getAttribute('data-copiar'));
          if (!alvo) return;
          await navigator.clipboard.writeText(alvo.value || alvo.textContent || '');
          botao.textContent = 'Copiado';
        });
      });
    </script>`;
}

export function paginaTemplates(modelos: TemplateLinha[], csrfToken: string, previsao: { titulo: string; assunto: string; corpo: string } | null): string {
  const blocos = modelos.map((modelo) => {
    const tipo = modelo.tipo as TipoMensagem;
    return `<form class="bloco" method="post" action="/templates/${e(modelo.canal)}/${e(modelo.tipo)}">
      ${csrf(csrfToken)}
      <h2>${e(NOMES_CANAL[modelo.canal] ?? modelo.canal)} · ${e(NOMES_TIPO[modelo.tipo] ?? modelo.tipo)}</h2>
      <p class="muted">Variáveis: ${e(variaveisDoCenario(tipo).map((nome) => `{${nome}}`).join(', '))}</p>
      ${modelo.canal === 'email' ? `<label>Assunto<input name="assunto" value="${e(modelo.assunto ?? '')}"></label>` : ''}
      <label>Texto<textarea name="corpo">${e(modelo.corpo)}</textarea></label>
      <div class="acoes"><button type="submit">Salvar</button></div>
    </form>
    <form method="post" action="/templates/${e(modelo.canal)}/${e(modelo.tipo)}/prever">${csrf(csrfToken)}
      <input type="hidden" name="assunto" value="${e(modelo.assunto ?? '')}">
      <input type="hidden" name="corpo_atual" value="1">
      <button class="secundario" type="submit" formaction="/templates/${e(modelo.canal)}/${e(modelo.tipo)}/restaurar">Restaurar padrão</button>
    </form>`;
  }).join('');
  const previa = previsao
    ? `<section class="bloco"><h2>Pré-visualização · ${e(previsao.titulo)}</h2><p class="muted">Dados fictícios, de ninguém cadastrado.</p>
      ${previsao.assunto ? `<p><strong>${e(previsao.assunto)}</strong></p>` : ''}<pre>${e(previsao.corpo)}</pre></section>`
    : '';
  return `<h1>Templates</h1><p class="sub">Seis textos: e-mail e WhatsApp para cobrança, confirmação e inadimplência.</p>
    ${previa}
    <form class="bloco" method="post" action="/templates/prever">${csrf(csrfToken)}
      <h2>Pré-visualizar um rascunho</h2>
      <div class="row">
        <label>Canal<select name="canal"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></label>
        <label>Cenário<select name="tipo"><option value="cobranca">Cobrança</option><option value="confirmacao">Confirmação</option><option value="inadimplencia">Inadimplência</option></select></label>
      </div>
      <label>Assunto<input name="assunto"></label>
      <label>Texto<textarea name="corpo"></textarea></label>
      <button type="submit">Pré-visualizar</button>
    </form>
    ${blocos}`;
}

export function paginaConfiguracao(config: ConfigPublica, csrfToken: string): string {
  const teste = config.evolution.ultimoTesteEm
    ? `${config.evolution.ultimoTesteOk ? 'Conexão encontrada' : 'Falhou'} em ${formatarDataHora(config.evolution.ultimoTesteEm)}. ${config.evolution.ultimoTesteMotivo ?? ''}`
    : 'Ainda não testada.';
  return `<h1>Configuração</h1>
    <p class="sub">Segredo gravado não volta para a tela. Campo em branco mantém o valor atual.</p>
    <form class="bloco" method="post" action="/configuracao">${csrf(csrfToken)}
      <div class="row">
        <label>Usuário<input name="usuario" required value="${e(config.usuario)}"></label>
        <label>E-mail do código<input name="email_dono" type="email" required value="${e(config.emailDono)}"></label>
        <label>Senha atual<input name="senha_atual" type="password" autocomplete="current-password"></label>
        <label>Senha nova<input name="senha_nova" type="password" autocomplete="new-password"></label>
      </div>
      <h2>Mercado Pago</h2>
      <p>Token: ${config.mpAccessTokenDefinido ? 'definido: sim' : 'definido: não'}. Segredo do webhook: ${config.mpWebhookSecretDefinido ? 'definido: sim' : 'definido: não'}.</p>
      <p>URL de notificação: <span class="codigo">${e(config.urlNotificacao || 'defina PAGAEU_PUBLIC_URL')}</span></p>
      <div class="row">
        <label>Access token<input name="mp_access_token" type="password" autocomplete="off"></label>
        <label>Segredo do webhook<input name="mp_webhook_secret" type="password" autocomplete="off"></label>
      </div>
      <h2>SMTP</h2>
      <p>Senha: ${config.smtpSenhaDefinida ? 'definido: sim' : 'definido: não'}.</p>
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
      <div class="acoes"><button type="submit">Salvar</button></div>
    </form>
    <section class="bloco">
      <h2>Evolution Go</h2>
      <p>Somente leitura, vindo do ambiente.</p>
      <p>URL: ${e(config.evolution.url || 'não definida')}</p>
      <p>Instância: ${e(config.evolution.instancia || 'não definida')}</p>
      <p>Chave global: ${config.evolution.chaveDefinida ? 'definido: sim' : 'definido: não'}</p>
      <p>${e(teste)}</p>
      <form method="post" action="/configuracao/evolution">${csrf(csrfToken)}<button type="submit">Testar conexão</button></form>
    </section>`;
}
