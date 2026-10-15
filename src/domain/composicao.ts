export type LinhaRascunho = {
  itemId: string;
  origemCobrancaId: string;
  competenciaOrigemAno: number;
  competenciaOrigemMes: number;
  descricao: string;
  valorCentavos: number;
};

export type ItemComposicao = {
  id: string;
  descricao: string;
  valorCentavos: number;
  inicioAno: number;
  inicioMes: number;
  fimAno: number;
  fimMes: number;
};

export function itemCobreCompetencia(item: ItemComposicao, ano: number, mes: number): boolean {
  const inicio = item.inicioAno * 12 + item.inicioMes;
  const fim = item.fimAno * 12 + item.fimMes;
  const competencia = ano * 12 + mes;
  return inicio <= competencia && competencia <= fim;
}

function chaveLinha(itemId: string, ano: number, mes: number): string {
  return `${itemId}:${ano}:${mes}`;
}

export function comporLinhas(entrada: {
  novaCobrancaId: string;
  ano: number;
  mes: number;
  linhasAnterioresAbertas: LinhaRascunho[] | null;
  itens: ItemComposicao[];
}): LinhaRascunho[] {
  const linhas: LinhaRascunho[] = [];
  const vistas = new Set<string>();
  for (const linha of entrada.linhasAnterioresAbertas ?? []) {
    const chave = chaveLinha(linha.itemId, linha.competenciaOrigemAno, linha.competenciaOrigemMes);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    linhas.push({ ...linha });
  }
  for (const item of entrada.itens) {
    if (!itemCobreCompetencia(item, entrada.ano, entrada.mes)) continue;
    const chave = chaveLinha(item.id, entrada.ano, entrada.mes);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    linhas.push({
      itemId: item.id,
      origemCobrancaId: entrada.novaCobrancaId,
      competenciaOrigemAno: entrada.ano,
      competenciaOrigemMes: entrada.mes,
      descricao: item.descricao,
      valorCentavos: item.valorCentavos,
    });
  }
  return linhas;
}
