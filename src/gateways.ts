export type ResultadoEnvio = { ok: true } | { ok: false; motivo: string };

export type PagamentoRemoto = {
  id: string;
  status: string;
  statusDetail: string | null;
  valorCentavos: number;
  dateApproved: Date | null;
};

export type EntradaPix = {
  idempotencyKey: string;
  transactionAmount: number;
  description: string;
  payerEmail: string;
  payerFirstName: string;
  payerCpf: string | null;
  dateOfExpiration: string;
  notificationUrl: string;
  externalReference: string;
};

export type PixCriado = {
  ok: true;
  id: string;
  status: string;
  statusDetail: string | null;
  qrCode: string;
  ticketUrl: string | null;
};

export type PixRecebidoMp = {
  id: string;
  valorCentavos: number;
  txid: string | null;
  dateApproved: Date;
};

export type MercadoPagoGateway = {
  criar(token: string, entrada: EntradaPix): Promise<PixCriado | { ok: false; motivo: string }>;
  consultar(token: string, id: string): Promise<{ ok: true; pagamento: PagamentoRemoto } | { ok: false; motivo: string }>;
  cancelar(
    token: string,
    id: string,
  ): Promise<{ ok: true; status: string; statusDetail: string | null } | { ok: false; statusCode: number; errorCode: number | null; motivo: string }>;
  buscarPixRecebidos(
    token: string,
    inicio: Date,
    fim: Date,
  ): Promise<{ ok: true; entradas: PixRecebidoMp[] } | { ok: false; motivo: string }>;
};

export type EvolutionGateway = {
  enviarTexto(numero: string, texto: string): Promise<ResultadoEnvio>;
  testarConexao(): Promise<{ ok: boolean; motivo: string }>;
};

export type SmtpConfig = {
  host: string;
  porta: number;
  usuario: string | null;
  senha: string | null;
  remetenteNome: string | null;
  remetenteEmail: string;
  criptografia: 'nenhuma' | 'starttls' | 'tls_implicito';
};

export type CorreioGateway = {
  enviar(config: SmtpConfig | null, mensagem: { to: string; subject: string; text: string }): Promise<ResultadoEnvio>;
};
