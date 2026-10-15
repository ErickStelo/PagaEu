import type { App } from './app.ts';
import { carregarSegredoWebhook } from './configuracao.ts';
import { sincronizarPagamento } from './cobrancas.ts';
import { assinaturaConfere, lerAssinatura, montarManifesto } from './domain/assinatura.ts';
import { mensagemErro } from './texto.ts';

export async function receberWebhook(
  app: App,
  cabecalhos: { assinatura?: string; requestId?: string },
  url: URL,
  corpo: string,
): Promise<number> {
  const segredo = await carregarSegredoWebhook(app.pool);
  if (!segredo) return 401;
  const assinatura = lerAssinatura(cabecalhos.assinatura);
  if (!assinatura) return 401;
  let dataId = url.searchParams.get('data.id');
  let tipo = url.searchParams.get('type');
  try {
    const json = JSON.parse(corpo) as { type?: unknown; action?: unknown; data?: { id?: unknown } };
    if (typeof json.type === 'string') tipo = json.type;
    if (!dataId && json.data && (typeof json.data.id === 'string' || typeof json.data.id === 'number')) {
      dataId = String(json.data.id);
    }
    if (!tipo && typeof json.action === 'string' && json.action.startsWith('payment')) tipo = 'payment';
  } catch {
    dataId = dataId ?? null;
  }
  const manifesto = montarManifesto({ dataId, requestId: cabecalhos.requestId, ts: assinatura.ts });
  if (!assinaturaConfere(manifesto, segredo, assinatura.v1)) return 401;
  if (tipo && tipo !== 'payment') return 200;
  if (!dataId) return 200;
  try {
    await sincronizarPagamento(app, dataId, app.clock());
    return 200;
  } catch (erro) {
    console.error(`Falha no webhook: ${mensagemErro(erro)}`);
    return 500;
  }
}
