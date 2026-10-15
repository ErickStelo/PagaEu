import { diaEfetivo, proximoMes, type Partes } from './calendar.ts';

export type PlanoDia = {
  diaCobranca: number;
  diaPendente: number | null;
  pendenteAno: number | null;
  pendenteMes: number | null;
  avisos: string[];
};

export function planejarTrocaDeDia(entrada: {
  hoje: Partes;
  diaAtual: number;
  diaNovo: number;
  temCobrancaAtivaNoMes: boolean;
}): PlanoDia {
  if (entrada.diaNovo === entrada.diaAtual) {
    return {
      diaCobranca: entrada.diaAtual,
      diaPendente: null,
      pendenteAno: null,
      pendenteMes: null,
      avisos: [],
    };
  }
  if (entrada.temCobrancaAtivaNoMes) {
    const seguinte = proximoMes(entrada.hoje.year, entrada.hoje.month);
    return {
      diaCobranca: entrada.diaAtual,
      diaPendente: entrada.diaNovo,
      pendenteAno: seguinte.year,
      pendenteMes: seguinte.month,
      avisos: [
        `O dia novo vale a partir de ${String(seguinte.month).padStart(2, '0')}/${seguinte.year}.`,
      ],
    };
  }
  const efetivo = diaEfetivo(entrada.diaNovo, entrada.hoje.year, entrada.hoje.month);
  if (efetivo < entrada.hoje.day) {
    return {
      diaCobranca: entrada.diaNovo,
      diaPendente: null,
      pendenteAno: null,
      pendenteMes: null,
      avisos: [
        'O dia informado já passou neste mês. Este mês não será gerado automaticamente. O dia novo vale a partir do mês seguinte. Use Gerar cobrança se quiser cobrar este mês.',
      ],
    };
  }
  const avisos: string[] = [];
  const passouDasNove = entrada.hoje.hour > 9 || (entrada.hoje.hour === 9 && entrada.hoje.minute > 0);
  if (efetivo === entrada.hoje.day && passouDasNove) {
    avisos.push('O horário das 09:00 já passou hoje. Este mês não será gerado automaticamente. Use Gerar cobrança.');
  }
  return {
    diaCobranca: entrada.diaNovo,
    diaPendente: null,
    pendenteAno: null,
    pendenteMes: null,
    avisos,
  };
}
