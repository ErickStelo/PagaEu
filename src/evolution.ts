import type { EvolutionGateway } from './gateways.ts';
import { mensagemErro, redigir } from './texto.ts';

export type CredenciaisEvolution = {
  url: string;
  apiKey: string;
  instance: string;
};

type Instancia = { name: string; token: string };

function listarInstancias(payload: unknown): Instancia[] {
  const listas: unknown[] = [];
  if (Array.isArray(payload)) listas.push(payload);
  else if (payload && typeof payload === 'object') {
    for (const valor of Object.values(payload as Record<string, unknown>)) {
      if (Array.isArray(valor)) listas.push(valor);
    }
  }
  const achadas: Instancia[] = [];
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      if (!item || typeof item !== 'object') continue;
      const registro = item as Record<string, unknown>;
      const name = registro.name ?? registro.Name;
      const token = registro.token ?? registro.Token;
      if (typeof name === 'string' && typeof token === 'string') achadas.push({ name, token });
    }
  }
  return achadas;
}

export function criarEvolution(credenciais: () => CredenciaisEvolution): EvolutionGateway {
  let tokenEmMemoria: { instancia: string; token: string } | null = null;

  async function buscarToken(forcar: boolean): Promise<{ ok: true; token: string } | { ok: false; motivo: string }> {
    const atual = credenciais();
    if (!atual.url || !atual.apiKey || !atual.instance) {
      return { ok: false, motivo: 'Evolution Go não configurado' };
    }
    if (!forcar && tokenEmMemoria && tokenEmMemoria.instancia === atual.instance) {
      return { ok: true, token: tokenEmMemoria.token };
    }
    try {
      const resposta = await fetch(`${atual.url}/instance/all`, {
        headers: { apikey: atual.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        return { ok: false, motivo: redigir(`Falha ao listar instâncias (${resposta.status}).`, [atual.apiKey]) };
      }
      const instancia = listarInstancias(corpo).find((item) => item.name === atual.instance);
      if (!instancia) return { ok: false, motivo: 'instância não encontrada' };
      tokenEmMemoria = { instancia: atual.instance, token: instancia.token };
      return { ok: true, token: instancia.token };
    } catch (erro) {
      return { ok: false, motivo: redigir(mensagemErro(erro), [atual.apiKey]) };
    }
  }

  async function postar(token: string, numero: string, texto: string): Promise<Response> {
    const atual = credenciais();
    return fetch(`${atual.url}/send/text`, {
      method: 'POST',
      headers: {
        apikey: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number: numero, text: texto }),
      signal: AbortSignal.timeout(15_000),
    });
  }

  return {
    async enviarTexto(numero, texto) {
      const atual = credenciais();
      const primeiro = await buscarToken(false);
      if (!primeiro.ok) return primeiro;
      try {
        let resposta = await postar(primeiro.token, numero, texto);
        if (resposta.status === 401) {
          const renovado = await buscarToken(true);
          if (!renovado.ok) return renovado;
          resposta = await postar(renovado.token, numero, texto);
        }
        if (resposta.status === 200) return { ok: true };
        const corpo = await resposta.text();
        return {
          ok: false,
          motivo: redigir(corpo || `Falha no WhatsApp (${resposta.status}).`, [atual.apiKey, primeiro.token, tokenEmMemoria?.token]),
        };
      } catch (erro) {
        return { ok: false, motivo: redigir(mensagemErro(erro), [atual.apiKey, tokenEmMemoria?.token]) };
      }
    },
    async testarConexao() {
      tokenEmMemoria = null;
      const resultado = await buscarToken(true);
      return resultado.ok ? { ok: true, motivo: 'Instância encontrada.' } : { ok: false, motivo: resultado.motivo };
    },
  };
}
