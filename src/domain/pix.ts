export type DadosPixEstatico = {
  chave: string;
  recebedor: string;
  cidade: string;
  valorCentavos: number;
  txid: string;
};

const LIMITE_RECEBEDOR = 25;
const LIMITE_CIDADE = 15;
const LIMITE_TXID = 25;
const LIMITE_CHAVE = 77;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function textoEmv(texto: string, limite: number): string {
  return semAcento(texto)
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limite);
}

function campo(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`Campo ${id} do PIX passa de 99 caracteres.`);
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`;
}

function valorEmv(centavos: number): string {
  return `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function normalizarTxid(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return limpo || null;
}

export function txidCobranca(nome: string, ano: number, mes: number): string {
  const primeiro = textoEmv(nome.trim().split(/\s+/)[0] ?? '', LIMITE_TXID).toUpperCase();
  const competencia = `${String(mes).padStart(2, '0')}${ano}`;
  const prefixo = primeiro.slice(0, LIMITE_TXID - competencia.length);
  return `${prefixo || 'COBRANCA'}${competencia}`.slice(0, LIMITE_TXID);
}

export function gerarPixCopiaECola(dados: DadosPixEstatico): string {
  const chave = dados.chave.trim();
  if (!chave || chave.length > LIMITE_CHAVE) throw new Error('Chave PIX inválida.');
  if (!Number.isSafeInteger(dados.valorCentavos) || dados.valorCentavos <= 0) throw new Error('Valor do PIX inválido.');
  const recebedor = textoEmv(dados.recebedor, LIMITE_RECEBEDOR);
  const cidade = textoEmv(dados.cidade, LIMITE_CIDADE);
  if (!recebedor || !cidade) throw new Error('Recebedor e cidade do PIX são obrigatórios.');
  const txid = dados.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, LIMITE_TXID) || '***';
  const semCrc = [
    campo('00', '01'),
    campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave)),
    campo('52', '0000'),
    campo('53', '986'),
    campo('54', valorEmv(dados.valorCentavos)),
    campo('58', 'BR'),
    campo('59', recebedor),
    campo('60', cidade),
    campo('62', campo('05', txid)),
    '6304',
  ].join('');
  return `${semCrc}${crc16(semCrc)}`;
}
