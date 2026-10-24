(function () {
  toastr.options = {
    closeButton: true,
    progressBar: true,
    positionClass: 'toast-top-right',
    timeOut: 4200,
    extendedTimeOut: 1600,
    escapeHtml: true,
    preventDuplicates: false,
  };

  function mostrarFlash(raiz) {
    const flash = (raiz || document).querySelector('.flash');
    if (!flash) return;
    const texto = (flash.textContent || '').trim();
    if (texto) toastr[flash.classList.contains('ok') ? 'success' : 'error'](texto);
    flash.remove();
  }

  function formatarSegundos(segundos, comHoras) {
    const total = Math.max(0, segundos);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    if (comHoras || h > 0) return `${h}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  }

  function reenvioCodigoBloqueado(form, btn) {
    if (!form || form.id !== 'form-reenviar-codigo') return false;
    const alvo = btn || form.querySelector('#btn-reenviar-codigo, button');
    return Boolean(alvo?.disabled) || Number(form.dataset.cooldownSeg || 0) > 0;
  }

  function bloquearBotaoReenvioCodigo(btn) {
    if (!btn) return;
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.type = 'button';
  }

  function liberarBotaoReenvioCodigo(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.removeAttribute('aria-disabled');
    btn.type = 'submit';
  }

  function inicializarContadorReenvioCodigo(raiz) {
    const form = (raiz || document).querySelector('#form-reenviar-codigo');
    if (!form) return;
    if (form._reenvioTimerId) {
      window.clearTimeout(form._reenvioTimerId);
      form._reenvioTimerId = null;
    }
    let seg = Number(form.dataset.cooldownSeg || 0);
    const btn = form.querySelector('#btn-reenviar-codigo, button');
    const linha = (raiz || document).querySelector('#reenvio-contador');
    const valor = linha ? linha.querySelector('[data-valor]') : null;
    if (!seg || seg <= 0) {
      liberarBotaoReenvioCodigo(btn);
      if (linha) linha.hidden = true;
      form.dataset.cooldownSeg = '0';
      return;
    }
    if (linha) linha.hidden = false;
    bloquearBotaoReenvioCodigo(btn);
    function tick() {
      form.dataset.cooldownSeg = String(seg);
      if (seg <= 0) {
        form.dataset.cooldownSeg = '0';
        liberarBotaoReenvioCodigo(btn);
        if (linha) linha.hidden = true;
        form._reenvioTimerId = null;
        return;
      }
      if (valor) valor.textContent = formatarSegundos(seg, false);
      bloquearBotaoReenvioCodigo(btn);
      seg -= 1;
      form._reenvioTimerId = window.setTimeout(tick, 1000);
    }
    tick();
  }

  function inicializarContadorSessao(raiz) {
    const el = (raiz || document).querySelector('#sessao-contador');
    if (!el) return;
    const expira = Number(el.dataset.expiraEm);
    if (!expira) return;
    const valor = el.querySelector('[data-valor]');
    function tick() {
      const seg = Math.max(0, Math.ceil((expira - Date.now()) / 1000));
      if (valor) valor.textContent = formatarSegundos(seg, true);
      if (seg <= 0) return;
      window.setTimeout(tick, 1000);
    }
    tick();
  }

  function inicializarContadores(raiz) {
    inicializarContadorReenvioCodigo(raiz);
    inicializarContadorSessao(raiz);
  }

  function aplicar(doc) {
    const novoMain = doc.querySelector('main');
    const main = document.querySelector('main');
    if (!novoMain || !main) return false;
    if (doc.body.className !== document.body.className) return false;
    main.innerHTML = novoMain.innerHTML;
    const novaAside = doc.querySelector('aside');
    const aside = document.querySelector('aside');
    if (aside && novaAside) aside.innerHTML = novaAside.innerHTML;
    document.title = doc.title;
    mostrarFlash(document);
    inicializarModais(document);
    inicializarContadores(document);
    main.focus();
    return true;
  }

  async function navegar(url, historico) {
    const resposta = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    const doc = new DOMParser().parseFromString(await resposta.text(), 'text/html');
    if (!aplicar(doc)) {
      location.assign(resposta.url || url);
      return;
    }
    if (historico) history.pushState({}, '', resposta.url || url);
  }

  async function enviar(form, submitter) {
    const metodo = (submitter?.getAttribute('formmethod') || form.method || 'get').toLowerCase();
    if (metodo === 'get') {
      const url = new URL(form.action, location.href);
      url.search = new URLSearchParams(new FormData(form)).toString();
      await navegar(url.pathname + url.search, true);
      return;
    }
    const acao = submitter?.getAttribute('formaction') || form.action;
    const dados = new URLSearchParams(new FormData(form, submitter));
    const resposta = await fetch(acao, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-PagaEu': '1',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: dados.toString(),
    });
    const tipo = resposta.headers.get('content-type') || '';
    if (!tipo.includes('application/json')) {
      toastr.error('Não foi possível concluir.');
      return;
    }
    const json = await resposta.json();
    if (json.recarregar && json.ir) {
      location.assign(json.ir);
      return;
    }
    if (json.html) {
      const main = document.querySelector('main');
      if (main) {
        main.innerHTML = json.html;
        inicializarModais(document);
        inicializarContadores(document);
        main.focus();
      }
      if (json.titulo) document.title = json.titulo + ' · PagaEu';
      if (json.abrirModal) {
        abrirModal(json.abrirModal);
      } else if (json.aviso) {
        toastr[json.ok ? 'success' : 'error'](json.aviso);
      }
    } else if (json.aviso) {
      toastr[json.ok ? 'success' : 'error'](json.aviso);
    }
    if (json.ir) await navegar(json.ir, true);
  }

  function copiarTexto(valor) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(valor).then(() => true).catch(() => copiarPorSelecao(valor));
    }
    return Promise.resolve(copiarPorSelecao(valor));
  }

  function copiarPorSelecao(valor) {
    const area = document.createElement('textarea');
    area.value = valor;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  function abrirModal(id) {
    const dialog = document.getElementById(id);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (!dialog.open) dialog.showModal();
    const campo = dialog.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
    campo?.focus();
  }

  function fecharModal(dialog) {
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  }

  function inicializarModais(raiz) {
    const base = raiz || document;
    base.querySelectorAll('dialog[data-modal-inicial]').forEach((dialog) => {
      if (dialog instanceof HTMLDialogElement) abrirModal(dialog.id);
    });
  }

  document.addEventListener('click', (evento) => {
    const abrir = evento.target.closest('[data-modal-abrir]');
    if (abrir) {
      evento.preventDefault();
      abrirModal(abrir.getAttribute('data-modal-abrir'));
      return;
    }
    const fechar = evento.target.closest('.modal-fechar');
    if (fechar) {
      evento.preventDefault();
      const dialog = fechar.closest('dialog');
      if (dialog) fecharModal(dialog);
      return;
    }
    const copiar = evento.target.closest('[data-copiar], [data-texto]');
    if (copiar) {
      evento.preventDefault();
      const direto = copiar.getAttribute('data-texto');
      const alvoId = copiar.getAttribute('data-copiar');
      const alvo = alvoId ? document.getElementById(alvoId) : null;
      const valor = direto ?? alvo?.value ?? alvo?.textContent ?? '';
      if (!valor) return;
      copiarTexto(valor).then((ok) => {
        if (!ok) {
          toastr.error('Não foi possível copiar a chave PIX.');
          return;
        }
        toastr.success('Chave PIX copiada.');
        copiar.textContent = 'Copiado';
      });
      return;
    }
    const link = evento.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey || evento.button !== 0) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    evento.preventDefault();
    navegar(url.pathname + url.search, true).catch(() => {
      toastr.error('Não foi possível abrir a página.');
    });
  });

  document.addEventListener('submit', (evento) => {
    const form = evento.target;
    if (!(form instanceof HTMLFormElement)) return;
    const botao = evento.submitter;
    if (form.id === 'form-reenviar-codigo' && reenvioCodigoBloqueado(form, botao)) {
      evento.preventDefault();
      return;
    }
    evento.preventDefault();
    const consulta = (form.getAttribute('action') || '').includes('/cobrancas/consultar');
    const htmlBotao = botao?.innerHTML;
    if (botao) {
      botao.disabled = true;
      if (consulta) {
        botao.classList.add('carregando');
        const svg = botao.querySelector('.icone');
        botao.replaceChildren(svg ? svg.cloneNode(true) : document.createTextNode(''), document.createTextNode('Consultando…'));
      }
    }
    enviar(form, botao)
      .catch(() => {
        toastr.error('Não foi possível falar com o servidor.');
      })
      .finally(() => {
        if (!botao?.isConnected) return;
        if (form.id === 'form-reenviar-codigo') {
          inicializarContadorReenvioCodigo(document);
          return;
        }
        botao.disabled = false;
        if (consulta) {
          botao.classList.remove('carregando');
          if (htmlBotao) botao.innerHTML = htmlBotao;
        }
      });
  });

  function normalizar(texto) {
    return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function filtrarPessoas() {
    const busca = normalizar(document.querySelector('[data-filtro-busca]')?.value);
    const situacao = document.querySelector('[data-filtro-situacao]')?.value || '';
    let visiveis = 0;
    document.querySelectorAll('tr[data-pessoa]').forEach((linha) => {
      const nomeOk = !busca || normalizar(linha.getAttribute('data-nome')).includes(busca);
      const situacaoOk = !situacao
        || (situacao === 'inativa' ? linha.getAttribute('data-inativa') === '1' : linha.getAttribute('data-situacao') === situacao);
      const mostrar = nomeOk && situacaoOk;
      linha.hidden = !mostrar;
      if (mostrar) visiveis += 1;
    });
    const vazio = document.querySelector('[data-filtro-vazio]');
    if (vazio) vazio.hidden = visiveis > 0;
  }

  document.addEventListener('input', (evento) => {
    if (evento.target.closest('[data-filtro-busca]')) filtrarPessoas();
  });

  document.addEventListener('change', (evento) => {
    if (evento.target.closest('[data-filtro-situacao]')) filtrarPessoas();
  });

  window.addEventListener('popstate', () => {
    navegar(location.href, false).catch(() => {
      location.reload();
    });
  });

  mostrarFlash(document);
  inicializarModais(document);
  inicializarContadores(document);

  document.addEventListener('click', (evento) => {
    const dialog = evento.target;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('modal')) return;
    if (evento.target !== dialog) return;
    fecharModal(dialog);
  });
})();
