import type { IncomingMessage } from 'node:http';

const BLOQUEIO_MS = 15 * 60 * 1000;
const MAX_FALHAS = 8;
const REENVIO_COOLDOWN_MS = 5 * 60 * 1000;

type Estado = {
  falhas: number;
  bloqueadoAte: number;
  ultimoEnvioCodigoMs: number;
};

const estados = new Map<string, Estado>();

export function reiniciarLimites(): void {
  estados.clear();
}

export function ipDoPedido(req: IncomingMessage): string {
  const encaminhado = req.headers['x-forwarded-for'];
  if (typeof encaminhado === 'string') {
    const primeiro = encaminhado.split(',')[0]?.trim();
    if (primeiro) return primeiro;
  }
  return req.socket.remoteAddress ?? 'desconhecido';
}

function estado(chave: string): Estado {
  let atual = estados.get(chave);
  if (!atual) {
    atual = { falhas: 0, bloqueadoAte: 0, ultimoEnvioCodigoMs: 0 };
    estados.set(chave, atual);
  }
  return atual;
}

export function verificarTentativa(chave: string, agoraMs: number): { permitido: boolean; aguardarMs: number } {
  const atual = estado(chave);
  if (atual.bloqueadoAte > agoraMs) {
    return { permitido: false, aguardarMs: atual.bloqueadoAte - agoraMs };
  }
  return { permitido: true, aguardarMs: 0 };
}

export function registrarFalha(chave: string, agoraMs: number): void {
  const atual = estado(chave);
  if (atual.bloqueadoAte > agoraMs) return;
  atual.falhas += 1;
  if (atual.falhas >= MAX_FALHAS) {
    atual.bloqueadoAte = agoraMs + BLOQUEIO_MS;
    atual.falhas = 0;
  }
}

export function registrarSucesso(chave: string): void {
  estados.delete(chave);
}

export function aguardarReenvioCodigoMs(chave: string, agoraMs: number): number {
  const ultimo = estado(`reenvio:${chave}`).ultimoEnvioCodigoMs;
  if (!ultimo) return 0;
  const restante = ultimo + REENVIO_COOLDOWN_MS - agoraMs;
  return restante > 0 ? restante : 0;
}

export function podeReenviarCodigo(chave: string, agoraMs: number): boolean {
  return aguardarReenvioCodigoMs(chave, agoraMs) === 0;
}

export function registrarEnvioCodigoLogin(chave: string, agoraMs: number): void {
  estado(`reenvio:${chave}`).ultimoEnvioCodigoMs = agoraMs;
}
