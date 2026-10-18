export type Canal = 'email' | 'whatsapp';
export type TipoMensagem = 'cobranca' | 'confirmacao' | 'inadimplencia';

export const CORPO_COBRANCA = `Olá, {nome}. Cobrança de {competencia}.

{itens}

Total: R$ {total}
Este PIX vale por {validade_dias} dias, até {vence_em}.

PIX copia e cola:
{copia_e_cola}`;

const CORPO_CONFIRMACAO = `Olá, {nome}. O pagamento da cobrança de {competencia} foi confirmado em {pago_em}.

{itens}

Total: R$ {total}
Competências quitadas: {competencias_quitadas}`;

const CORPO_INADIMPLENCIA = `Olá, {nome}. A cobrança de {competencia} continua em aberto.

{itens}

Total: R$ {total}
O PIX venceu em {vence_em}. Já se passaram {dias_vencido} dias.`;

export type TemplatePadrao = {
  canal: Canal;
  tipo: TipoMensagem;
  assunto: string | null;
  corpo: string;
};

export const TEMPLATES_PADRAO: TemplatePadrao[] = [
  { canal: 'whatsapp', tipo: 'cobranca', assunto: null, corpo: CORPO_COBRANCA },
  { canal: 'email', tipo: 'cobranca', assunto: 'Cobrança de {competencia}', corpo: CORPO_COBRANCA },
  { canal: 'whatsapp', tipo: 'confirmacao', assunto: null, corpo: CORPO_CONFIRMACAO },
  { canal: 'email', tipo: 'confirmacao', assunto: 'Pagamento recebido — {competencia}', corpo: CORPO_CONFIRMACAO },
  { canal: 'whatsapp', tipo: 'inadimplencia', assunto: null, corpo: CORPO_INADIMPLENCIA },
  { canal: 'email', tipo: 'inadimplencia', assunto: 'Cobrança em atraso — {competencia}', corpo: CORPO_INADIMPLENCIA },
];

const VARIAVEIS: Record<TipoMensagem, string[]> = {
  cobranca: ['nome', 'competencia', 'itens', 'total', 'copia_e_cola', 'validade_dias', 'vence_em'],
  confirmacao: ['nome', 'competencia', 'itens', 'total', 'pago_em', 'competencias_quitadas'],
  inadimplencia: ['nome', 'competencia', 'itens', 'total', 'vence_em', 'dias_vencido'],
};

export function variaveisDoCenario(tipo: TipoMensagem): string[] {
  return [...VARIAVEIS[tipo]];
}

export function extrairVariaveis(texto: string): string[] {
  return [...texto.matchAll(/\{([a-z_]+)\}/g)].map((achado) => achado[1] ?? '');
}

export function validarTemplate(
  canal: Canal,
  tipo: TipoMensagem,
  assunto: string | null,
  corpo: string,
): string | null {
  const permitidas = new Set(VARIAVEIS[tipo]);
  const textos = [corpo, assunto ?? ''];
  for (const texto of textos) {
    for (const nome of extrairVariaveis(texto)) {
      if (!permitidas.has(nome)) return `Variável não permitida: {${nome}}`;
    }
  }
  if (!corpo.trim()) return 'O texto não pode ficar vazio.';
  if (canal === 'email' && !assunto?.trim()) return 'O e-mail precisa de assunto.';
  return null;
}

export function preencherTemplate(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{([a-z_]+)\}/g, (original, nome: string) => variaveis[nome] ?? original);
}

export const DADOS_FICTICIOS: Record<string, string> = {
  nome: 'Maria Exemplo',
  competencia: '03/2026',
  itens: 'Aluguel (03/2026) — R$ 1.000,00\nInternet (03/2026) — R$ 150,00',
  total: '1.150,00',
  copia_e_cola: '00020126580014BR.GOV.BCB.PIX0136exemplo',
  validade_dias: '10',
  vence_em: '10/04/2026 09:00',
  dias_vencido: '5',
  pago_em: '02/06/2026 11:20',
  competencias_quitadas: '03/2026, 04/2026 e 05/2026',
};
