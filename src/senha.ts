import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function gerarHash(segredo: string): Promise<string> {
  const sal = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(segredo, sal, 32)) as Buffer;
  return `scrypt$${sal}$${hash.toString('hex')}`;
}

export async function confereHash(segredo: string, armazenado: string): Promise<boolean> {
  const partes = armazenado.split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt' || !partes[1] || !partes[2]) return false;
  const calculado = (await scryptAsync(segredo, partes[1], 32)) as Buffer;
  const esperado = Buffer.from(partes[2], 'hex');
  if (calculado.length !== esperado.length) return false;
  return timingSafeEqual(calculado, esperado);
}
