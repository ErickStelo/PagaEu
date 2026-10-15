export const FUSO = 'America/Sao_Paulo';

export type Partes = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function partesNoFuso(data: Date): Partes {
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const mapa = new Map(formato.formatToParts(data).map((parte) => [parte.type, parte.value]));
  let year = Number(mapa.get('year'));
  let month = Number(mapa.get('month'));
  let day = Number(mapa.get('day'));
  let hour = Number(mapa.get('hour'));
  const minute = Number(mapa.get('minute'));
  const second = Number(mapa.get('second'));
  if (hour === 24) {
    hour = 0;
    const ajustada = new Date(Date.UTC(year, month - 1, day + 1));
    year = ajustada.getUTCFullYear();
    month = ajustada.getUTCMonth() + 1;
    day = ajustada.getUTCDate();
  }
  return { year, month, day, hour, minute, second };
}

export function civilParaUtc(year: number, month: number, day: number, hour: number, minute: number, second: number): Date {
  const chute = Date.UTC(year, month - 1, day, hour, minute, second);
  const partes = partesNoFuso(new Date(chute));
  const comoUtc = Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second);
  return new Date(chute - (comoUtc - chute));
}

export function ultimoDiaDoMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function diaEfetivo(diaCadastrado: number, year: number, month: number): number {
  return Math.min(diaCadastrado, ultimoDiaDoMes(year, month));
}

export function somarDias(data: Date, dias: number): Date {
  const partes = partesNoFuso(data);
  const civil = new Date(Date.UTC(partes.year, partes.month - 1, partes.day + dias));
  return civilParaUtc(
    civil.getUTCFullYear(),
    civil.getUTCMonth() + 1,
    civil.getUTCDate(),
    partes.hour,
    partes.minute,
    partes.second,
  );
}

export function proximoMes(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

export function competenciaAnterior(a: { ano: number; mes: number }, b: { ano: number; mes: number }): boolean {
  return a.ano < b.ano || (a.ano === b.ano && a.mes < b.mes);
}

export function formatarCompetencia(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

export function formatarDataHora(data: Date): string {
  const partes = partesNoFuso(data);
  const dia = String(partes.day).padStart(2, '0');
  const mes = String(partes.month).padStart(2, '0');
  const hora = String(partes.hour).padStart(2, '0');
  const minuto = String(partes.minute).padStart(2, '0');
  return `${dia}/${mes}/${partes.year} ${hora}:${minuto}`;
}

export function formatarExpiracaoMp(data: Date): string {
  const partes = partesNoFuso(data);
  const comoUtc = Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second);
  const deslocamento = Math.round((comoUtc - data.getTime()) / 60_000);
  const sinal = deslocamento >= 0 ? '+' : '-';
  const absoluto = Math.abs(deslocamento);
  const horas = String(Math.floor(absoluto / 60)).padStart(2, '0');
  const minutos = String(absoluto % 60).padStart(2, '0');
  const ano = String(partes.year).padStart(4, '0');
  const mes = String(partes.month).padStart(2, '0');
  const dia = String(partes.day).padStart(2, '0');
  const hora = String(partes.hour).padStart(2, '0');
  const minuto = String(partes.minute).padStart(2, '0');
  const segundo = String(partes.second).padStart(2, '0');
  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}.000${sinal}${horas}:${minutos}`;
}

export function chaveDiaria(data: Date): string | null {
  const partes = partesNoFuso(data);
  if (partes.hour !== 9 || partes.minute !== 0) return null;
  return `${partes.year}-${String(partes.month).padStart(2, '0')}-${String(partes.day).padStart(2, '0')}`;
}

export function chaveHoraria(data: Date): string | null {
  const partes = partesNoFuso(data);
  if (partes.minute !== 0 || partes.hour === 9) return null;
  return `${partes.year}-${String(partes.month).padStart(2, '0')}-${String(partes.day).padStart(2, '0')}T${String(partes.hour).padStart(2, '0')}`;
}

export function diasInteirosDesde(inicio: Date, agora: Date): number {
  return Math.floor((agora.getTime() - inicio.getTime()) / 86_400_000);
}
