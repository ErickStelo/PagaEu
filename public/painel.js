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
    if (json.aviso) toastr[json.ok ? 'success' : 'error'](json.aviso);
    if (json.html) {
      const main = document.querySelector('main');
      if (main) {
        main.innerHTML = json.html;
        main.focus();
      }
      if (json.titulo) document.title = json.titulo + ' · PagaEu';
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

  document.addEventListener('click', (evento) => {
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
    evento.preventDefault();
    const botao = evento.submitter;
    if (botao) botao.disabled = true;
    enviar(form, botao)
      .catch(() => {
        toastr.error('Não foi possível falar com o servidor.');
      })
      .finally(() => {
        if (botao && botao.isConnected) botao.disabled = false;
      });
  });

  window.addEventListener('popstate', () => {
    navegar(location.href, false).catch(() => {
      location.reload();
    });
  });

  mostrarFlash(document);
})();
