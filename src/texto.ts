export function mensagemErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado';
}

export function redigir(texto: string, segredos: Array<string | null | undefined>): string {
  let limpo = texto;
  for (const segredo of segredos) {
    if (!segredo || segredo.length < 4) continue;
    limpo = limpo.split(segredo).join('[redigido]');
  }
  return limpo.slice(0, 500);
}

export function listaPortugues(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  if (itens.length === 2) return `${itens[0]} e ${itens[1]}`;
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`;
}

export function primeiroNome(nome: string): string {
  const parte = nome.trim().split(/\s+/)[0] ?? nome.trim();
  return parte.slice(0, 80);
}
