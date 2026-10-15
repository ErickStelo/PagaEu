export function normalizarCpf(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digitos)) return null;
  if (/^(\d)\1{10}$/.test(digitos)) return null;
  const verificador = (tamanho: number) => {
    let soma = 0;
    for (let indice = 0; indice < tamanho; indice += 1) {
      soma += Number(digitos[indice]) * (tamanho + 1 - indice);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  if (verificador(9) !== Number(digitos[9]) || verificador(10) !== Number(digitos[10])) return null;
  return digitos;
}

export function normalizarWhatsapp(entrada: string): string | null {
  let digitos = entrada.replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length < 12) digitos = `55${digitos}`;
  if (digitos.length < 12 || digitos.length > 15) return null;
  return digitos;
}

export function emailValido(entrada: string): boolean {
  const email = entrada.trim();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
