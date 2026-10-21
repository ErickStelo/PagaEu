export type StatusCobranca = 'aberta' | 'paga' | 'cancelada';
export type StatusPix =
  | 'emitindo'
  | 'pendente'
  | 'aprovado'
  | 'cancelado'
  | 'expirado'
  | 'falha_emissao'
  | 'falha_cancelamento';

export type AcoesCobranca = {
  baixaManual: boolean;
  reabrir: boolean;
  cancelar: boolean;
  novoPix: boolean;
  invalidarPix: boolean;
  tentarEmissao: boolean;
};

export function acoesDisponiveis(entrada: {
  status: StatusCobranca;
  vigente: boolean;
  temAtivaPosterior: boolean;
  temPixAtivo: boolean;
  ultimoPix: StatusPix | null;
  quitadaPorCascata: boolean;
  competenciaPrincipal: boolean;
}): AcoesCobranca {
  const aberta = entrada.status === 'aberta';
  const paga = entrada.status === 'paga';
  return {
    baixaManual: aberta && entrada.vigente,
    reabrir: paga && entrada.competenciaPrincipal && !entrada.temAtivaPosterior && !entrada.quitadaPorCascata,
    cancelar: aberta && !entrada.temAtivaPosterior,
    novoPix:
      aberta &&
      entrada.vigente &&
      !entrada.temPixAtivo &&
      (entrada.ultimoPix === 'expirado' || entrada.ultimoPix === 'cancelado'),
    invalidarPix: entrada.temPixAtivo,
    tentarEmissao:
      aberta &&
      !entrada.temPixAtivo &&
      (entrada.ultimoPix === 'falha_emissao' || entrada.ultimoPix === 'emitindo'),
  };
}

export function mpPermiteCancelar(status: string): boolean {
  return status === 'pending' || status === 'in_process' || status === 'authorized';
}

export function reenvioPermitido(entrada: {
  status: StatusCobranca;
  tipo: 'cobranca' | 'confirmacao' | 'inadimplencia';
  canalSelecionado: boolean;
  temPixAtivo: boolean;
}): boolean {
  if (!entrada.canalSelecionado) return false;
  if (entrada.tipo === 'confirmacao') return entrada.status === 'paga';
  if (entrada.status !== 'aberta') return false;
  if (entrada.tipo === 'cobranca') return entrada.temPixAtivo;
  return true;
}
