import { randomUUID } from 'node:crypto';
import type { App } from './app.ts';
import { consultar, type Consultavel } from './db.ts';
import { emailValido } from './domain/documento.ts';
import { urlHttpRemotaPermitida } from './domain/url.ts';
import {
  DADOS_FICTICIOS,
  TEMPLATES_PADRAO,
  preencherTemplate,
  validarTemplate,
  variaveisDoCenario,
  type Canal,
  type TipoMensagem,
} from './domain/template.ts';
import { urlNotificacao } from './env.ts';
import type { CredenciaisEvolution } from './evolution.ts';
import type { SmtpConfig } from './gateways.ts';
import { confereHash, gerarHash } from './senha.ts';

type LinhaConfig = {
  usuario_painel: string;
  senha_painel_hash: string;
  email_dono: string;
  mp_access_token: string | null;
  mp_webhook_secret: string | null;
  smtp_host: string | null;
  smtp_porta: number | null;
  smtp_usuario: string | null;
  smtp_senha: string | null;
  smtp_remetente_nome: string | null;
  smtp_remetente_email: string | null;
  smtp_criptografia: 'nenhuma' | 'starttls' | 'tls_implicito' | null;
  evolution_url: string | null;
  evolution_instance: string | null;
  evolution_api_key: string | null;
  evolution_teste_em: Date | null;
  evolution_teste_ok: boolean | null;
  evolution_teste_motivo: string | null;
  pix_provedor: ProvedorPix;
  pix_chave: string | null;
  pix_recebedor: string;
  pix_cidade: string;
  pix_conciliacao_ate: Date | null;
  conciliacao_intervalo_minutos: number;
};

export const INTERVALOS_CONCILIACAO_MINUTOS = [0, 15, 30, 60, 360, 1440] as const;
export type IntervaloConciliacaoMinutos = (typeof INTERVALOS_CONCILIACAO_MINUTOS)[number];

export function intervaloConciliacaoValido(valor: number): boolean {
  return (INTERVALOS_CONCILIACAO_MINUTOS as readonly number[]).includes(valor);
}

export const ROTULOS_INTERVALO_CONCILIACAO: Record<IntervaloConciliacaoMinutos, string> = {
  0: 'Desligada (só manual e webhook do Mercado Pago)',
  15: 'A cada 15 minutos',
  30: 'A cada 30 minutos',
  60: 'A cada 1 hora',
  360: 'A cada 6 horas',
  1440: 'A cada 24 horas',
};

export type ProvedorPix = 'mercadopago' | 'nativo';

export type PixConfig = {
  provedor: ProvedorPix;
  chave: string;
  recebedor: string;
  cidade: string;
};

const LIMITE_CHAVE_PIX = 77;
const LIMITE_RECEBEDOR_PIX = 25;
const LIMITE_CIDADE_PIX = 15;

export type ConfigPublica = {
  usuario: string;
  emailDono: string;
  mpAccessTokenDefinido: boolean;
  mpWebhookSecretDefinido: boolean;
  smtpHost: string;
  smtpPorta: string;
  smtpUsuario: string;
  smtpSenhaDefinida: boolean;
  smtpRemetenteNome: string;
  smtpRemetenteEmail: string;
  smtpCriptografia: string;
  evolution: {
    url: string;
    instancia: string;
    chaveDefinida: boolean;
    ultimoTesteEm: Date | null;
    ultimoTesteOk: boolean | null;
    ultimoTesteMotivo: string | null;
  };
  pix: PixConfig;
  conciliacaoIntervaloMinutos: IntervaloConciliacaoMinutos;
  conciliacaoUltimaEm: Date | null;
  urlNotificacao: string;
};

export async function carregarIntervaloConciliacaoMinutos(cliente: Consultavel): Promise<IntervaloConciliacaoMinutos> {
  const minutos = (await linha(cliente)).conciliacao_intervalo_minutos;
  return intervaloConciliacaoValido(minutos) ? (minutos as IntervaloConciliacaoMinutos) : 60;
}

export async function lerUltimaConciliacaoAutomatica(cliente: Consultavel): Promise<Date | null> {
  const linhas = await consultar<{ atualizado_em: Date }>(
    cliente,
    `SELECT atualizado_em FROM agendamento WHERE nome = 'conciliacao'`,
  );
  return linhas[0]?.atualizado_em ?? null;
}

async function linha(cliente: Consultavel): Promise<LinhaConfig> {
  const linhas = await consultar<LinhaConfig>(cliente, 'SELECT * FROM configuracao WHERE id = 1');
  const atual = linhas[0];
  if (!atual) throw new Error('Configuração do painel não encontrada.');
  return atual;
}

export async function carregarTokenMp(cliente: Consultavel): Promise<string | null> {
  const atual = await linha(cliente);
  return atual.mp_access_token?.trim() || null;
}

export async function carregarSegredoWebhook(cliente: Consultavel): Promise<string | null> {
  const atual = await linha(cliente);
  return atual.mp_webhook_secret?.trim() || null;
}

export async function carregarEvolution(cliente: Consultavel): Promise<CredenciaisEvolution | null> {
  const atual = await linha(cliente);
  const url = atual.evolution_url?.trim() ?? '';
  const instance = atual.evolution_instance?.trim() ?? '';
  const apiKey = atual.evolution_api_key?.trim() ?? '';
  if (!url || !instance || !apiKey) return null;
  return { url, apiKey, instance };
}

function pixDaLinha(atual: LinhaConfig): PixConfig {
  return {
    provedor: atual.pix_provedor,
    chave: atual.pix_chave?.trim() ?? '',
    recebedor: atual.pix_recebedor,
    cidade: atual.pix_cidade,
  };
}

export async function carregarPix(cliente: Consultavel): Promise<PixConfig> {
  return pixDaLinha(await linha(cliente));
}

const SOBREPOSICAO_CONCILIACAO_MS = 2 * 60 * 60 * 1000;
const JANELA_INICIAL_CONCILIACAO_MS = 35 * 24 * 60 * 60 * 1000;

export async function janelaConciliacaoPix(
  cliente: Consultavel,
  agora: Date,
): Promise<{ inicio: Date; fim: Date }> {
  const atual = await linha(cliente);
  const fim = agora;
  const inicio = atual.pix_conciliacao_ate
    ? new Date(atual.pix_conciliacao_ate.getTime() - SOBREPOSICAO_CONCILIACAO_MS)
    : new Date(agora.getTime() - JANELA_INICIAL_CONCILIACAO_MS);
  return { inicio, fim };
}

export async function marcarConciliacaoPix(cliente: Consultavel, ate: Date): Promise<void> {
  await cliente.query('UPDATE configuracao SET pix_conciliacao_ate = $1 WHERE id = 1', [ate]);
}

export async function importarEvolutionLegado(
  pool: Consultavel,
  legado: { url: string; apiKey: string; instance: string },
): Promise<void> {
  if (!legado.url && !legado.apiKey && !legado.instance) return;
  await pool.query(
    `UPDATE configuracao SET
      evolution_url = COALESCE(NULLIF(TRIM(evolution_url), ''), $1),
      evolution_instance = COALESCE(NULLIF(TRIM(evolution_instance), ''), $2),
      evolution_api_key = COALESCE(NULLIF(TRIM(evolution_api_key), ''), $3)
     WHERE id = 1`,
    [legado.url || null, legado.instance || null, legado.apiKey || null],
  );
}

export async function carregarSmtp(cliente: Consultavel): Promise<SmtpConfig | null> {
  const atual = await linha(cliente);
  if (!atual.smtp_host || !atual.smtp_remetente_email || !atual.smtp_criptografia || !atual.smtp_porta) return null;
  return {
    host: atual.smtp_host,
    porta: atual.smtp_porta,
    usuario: atual.smtp_usuario,
    senha: atual.smtp_senha,
    remetenteNome: atual.smtp_remetente_nome,
    remetenteEmail: atual.smtp_remetente_email,
    criptografia: atual.smtp_criptografia,
  };
}

export async function lerConfigPublica(app: App): Promise<ConfigPublica> {
  const atual = await linha(app.pool);
  return {
    usuario: atual.usuario_painel,
    emailDono: atual.email_dono,
    mpAccessTokenDefinido: Boolean(atual.mp_access_token),
    mpWebhookSecretDefinido: Boolean(atual.mp_webhook_secret),
    smtpHost: atual.smtp_host ?? '',
    smtpPorta: atual.smtp_porta ? String(atual.smtp_porta) : '',
    smtpUsuario: atual.smtp_usuario ?? '',
    smtpSenhaDefinida: Boolean(atual.smtp_senha),
    smtpRemetenteNome: atual.smtp_remetente_nome ?? '',
    smtpRemetenteEmail: atual.smtp_remetente_email ?? '',
    smtpCriptografia: atual.smtp_criptografia ?? 'starttls',
    evolution: {
      url: atual.evolution_url ?? '',
      instancia: atual.evolution_instance ?? '',
      chaveDefinida: Boolean(atual.evolution_api_key),
      ultimoTesteEm: atual.evolution_teste_em,
      ultimoTesteOk: atual.evolution_teste_ok,
      ultimoTesteMotivo: atual.evolution_teste_motivo,
    },
    pix: pixDaLinha(atual),
    conciliacaoIntervaloMinutos: await carregarIntervaloConciliacaoMinutos(app.pool),
    conciliacaoUltimaEm: await lerUltimaConciliacaoAutomatica(app.pool),
    urlNotificacao: app.env.publicUrl ? urlNotificacao(app.env.publicUrl) : '',
  };
}

export type EntradaConfig = {
  usuario: string;
  emailDono: string;
  senhaAtual: string;
  senhaNova: string;
  mpAccessToken: string;
  mpWebhookSecret: string;
  smtpHost: string;
  smtpPorta: string;
  smtpUsuario: string;
  smtpSenha: string;
  smtpRemetenteNome: string;
  smtpRemetenteEmail: string;
  smtpCriptografia: string;
  evolutionUrl: string;
  evolutionInstance: string;
  evolutionApiKey: string;
  pixProvedor: string;
  pixChave: string;
  pixRecebedor: string;
  pixCidade: string;
  conciliacaoIntervaloMinutos: string;
};

function validarPix(entrada: PixConfig): string | null {
  if (entrada.provedor === 'nativo' && !entrada.chave) return 'Informe a chave PIX para usar o PIX nativo.';
  if (entrada.chave.length > LIMITE_CHAVE_PIX) return `A chave PIX pode ter no máximo ${LIMITE_CHAVE_PIX} caracteres.`;
  if (!entrada.recebedor || entrada.recebedor.length > LIMITE_RECEBEDOR_PIX) {
    return `Informe o nome do recebedor (até ${LIMITE_RECEBEDOR_PIX} caracteres).`;
  }
  if (!entrada.cidade || entrada.cidade.length > LIMITE_CIDADE_PIX) {
    return `Informe a cidade do recebedor (até ${LIMITE_CIDADE_PIX} caracteres).`;
  }
  return null;
}

export type ResultadoSalvarConfig = { ok: true } | { ok: false; aviso: string; campo?: string };

export async function salvarConfiguracao(app: App, entrada: EntradaConfig): Promise<ResultadoSalvarConfig> {
  const atual = await linha(app.pool);
  const usuario = entrada.usuario.trim();
  const email = entrada.emailDono.trim();
  if (usuario.length < 1 || usuario.length > 80) return { ok: false, aviso: 'Informe o usuário do painel.', campo: 'usuario' };
  if (!emailValido(email)) return { ok: false, aviso: 'E-mail do dono inválido.', campo: 'email_dono' };
  const trocaSenha = entrada.senhaNova.trim().length > 0;
  if (trocaSenha && !entrada.senhaAtual.trim()) {
    return { ok: false, aviso: 'Informe a senha atual para definir uma senha nova.', campo: 'senha_atual' };
  }
  if (trocaSenha && !(await confereHash(entrada.senhaAtual, atual.senha_painel_hash))) {
    return { ok: false, aviso: 'A senha atual não confere.', campo: 'senha_atual' };
  }
  const evolutionUrl = entrada.evolutionUrl.trim();
  const evolutionInstance = entrada.evolutionInstance.trim();
  if (entrada.pixProvedor !== 'mercadopago' && entrada.pixProvedor !== 'nativo') {
    return { ok: false, aviso: 'Escolha como o PIX será gerado.', campo: 'pix_provedor' };
  }
  const pix: PixConfig = {
    provedor: entrada.pixProvedor,
    chave: entrada.pixChave.trim(),
    recebedor: entrada.pixRecebedor.trim(),
    cidade: entrada.pixCidade.trim(),
  };
  const criptografia = entrada.smtpCriptografia;
  if (criptografia !== 'nenhuma' && criptografia !== 'starttls' && criptografia !== 'tls_implicito') {
    return { ok: false, aviso: 'Escolha a criptografia do SMTP.', campo: 'smtp_criptografia' };
  }
  const porta = entrada.smtpPorta.trim() ? Number(entrada.smtpPorta) : null;
  if (entrada.smtpHost.trim() && (!porta || !Number.isInteger(porta) || porta < 1 || porta > 65535)) {
    return { ok: false, aviso: 'Porta SMTP inválida.', campo: 'smtp_porta' };
  }
  if (entrada.smtpRemetenteEmail.trim() && !emailValido(entrada.smtpRemetenteEmail)) {
    return { ok: false, aviso: 'E-mail do remetente inválido.', campo: 'smtp_remetente_email' };
  }
  if (evolutionUrl && !urlHttpRemotaPermitida(evolutionUrl)) {
    return { ok: false, aviso: 'URL do Evolution inválida ou não permitida.', campo: 'evolution_url' };
  }
  if ((evolutionUrl || evolutionInstance || entrada.evolutionApiKey.trim()) && (!evolutionUrl || !evolutionInstance)) {
    const campo = !evolutionUrl ? 'evolution_url' : 'evolution_instance';
    return { ok: false, aviso: 'Informe a URL e a instância do Evolution juntas.', campo };
  }
  const avisoPix = validarPix(pix);
  if (avisoPix) {
    const campo = avisoPix.includes('chave') ? 'pix_chave' : avisoPix.includes('cidade') ? 'pix_cidade' : 'pix_recebedor';
    return { ok: false, aviso: avisoPix, campo };
  }
  const conciliacaoMinutos = Number(entrada.conciliacaoIntervaloMinutos);
  if (!intervaloConciliacaoValido(conciliacaoMinutos)) {
    return { ok: false, aviso: 'Escolha um intervalo de consulta automática válido.', campo: 'conciliacao_intervalo_minutos' };
  }
  const hash = trocaSenha ? await gerarHash(entrada.senhaNova.trim()) : atual.senha_painel_hash;
  await app.pool.query(
    `UPDATE configuracao SET
      usuario_painel = $1,
      senha_painel_hash = $2,
      email_dono = $3,
      mp_access_token = $4,
      mp_webhook_secret = $5,
      smtp_host = $6,
      smtp_porta = $7,
      smtp_usuario = $8,
      smtp_senha = $9,
      smtp_remetente_nome = $10,
      smtp_remetente_email = $11,
      smtp_criptografia = $12,
      evolution_url = $13,
      evolution_instance = $14,
      evolution_api_key = $15,
      atualizado_em = $16,
      pix_provedor = $17,
      pix_chave = $18,
      pix_recebedor = $19,
      pix_cidade = $20,
      conciliacao_intervalo_minutos = $21
     WHERE id = 1`,
    [
      usuario,
      hash,
      email,
      entrada.mpAccessToken.trim() || atual.mp_access_token,
      entrada.mpWebhookSecret.trim() || atual.mp_webhook_secret,
      entrada.smtpHost.trim() || null,
      porta,
      entrada.smtpUsuario.trim() || null,
      entrada.smtpSenha.trim() || atual.smtp_senha,
      entrada.smtpRemetenteNome.trim() || null,
      entrada.smtpRemetenteEmail.trim() || null,
      entrada.smtpHost.trim() ? criptografia : atual.smtp_criptografia,
      evolutionUrl || null,
      evolutionInstance || null,
      entrada.evolutionApiKey.trim() || atual.evolution_api_key,
      app.clock(),
      pix.provedor,
      pix.chave || null,
      pix.recebedor,
      pix.cidade,
      conciliacaoMinutos,
    ],
  );
  return { ok: true };
}

export async function testarSmtp(app: App, destino: string): Promise<{ ok: boolean; motivo: string }> {
  const email = destino.trim();
  if (!emailValido(email)) return { ok: false, motivo: 'Informe um e-mail de teste válido.' };
  const smtp = await carregarSmtp(app.pool);
  if (!smtp) return { ok: false, motivo: 'SMTP não configurado. Salve host, porta, remetente e senha antes.' };
  const resultado = await app.correio.enviar(smtp, {
    to: email,
    subject: 'Teste PagaEu',
    text: 'Este é um e-mail de teste enviado pelo painel PagaEu. Se você recebeu, o SMTP está funcionando.',
  });
  return resultado.ok ? { ok: true, motivo: `E-mail de teste enviado para ${email}.` } : { ok: false, motivo: resultado.motivo };
}

export async function testarEvolution(app: App): Promise<{ ok: boolean; motivo: string }> {
  const resultado = await app.evolution.testarConexao();
  await app.pool.query(
    `UPDATE configuracao
     SET evolution_teste_em = $1, evolution_teste_ok = $2, evolution_teste_motivo = $3
     WHERE id = 1`,
    [app.clock(), resultado.ok, resultado.motivo],
  );
  return resultado;
}

export type TemplateLinha = {
  canal: Canal;
  tipo: TipoMensagem;
  assunto: string | null;
  corpo: string;
};

export async function listarTemplates(app: App): Promise<TemplateLinha[]> {
  return consultar<TemplateLinha>(app.pool, 'SELECT canal, tipo, assunto, corpo FROM template ORDER BY tipo, canal');
}

export async function salvarTemplate(
  app: App,
  canal: Canal,
  tipo: TipoMensagem,
  assunto: string | null,
  corpo: string,
): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const erro = validarTemplate(canal, tipo, canal === 'email' ? assunto : null, corpo);
  if (erro) return { ok: false, aviso: erro };
  const salvo = await app.pool.query(
    `UPDATE template SET assunto = $1, corpo = $2 WHERE canal = $3 AND tipo = $4`,
    [canal === 'email' ? assunto?.trim() ?? null : null, corpo, canal, tipo],
  );
  if (!salvo.rowCount) return { ok: false, aviso: 'Template não encontrado.' };
  return { ok: true };
}

export async function restaurarTemplate(app: App, canal: Canal, tipo: TipoMensagem): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const padrao = TEMPLATES_PADRAO.find((item) => item.canal === canal && item.tipo === tipo);
  if (!padrao) return { ok: false, aviso: 'Template não encontrado.' };
  await app.pool.query('UPDATE template SET assunto = $1, corpo = $2 WHERE canal = $3 AND tipo = $4', [
    padrao.assunto,
    padrao.corpo,
    canal,
    tipo,
  ]);
  return { ok: true };
}

export function preverTemplate(canal: Canal, tipo: TipoMensagem, assunto: string | null, corpo: string): { ok: true; assunto: string; corpo: string } | { ok: false; aviso: string } {
  const erro = validarTemplate(canal, tipo, canal === 'email' ? assunto : null, corpo);
  if (erro) return { ok: false, aviso: erro };
  return {
    ok: true,
    assunto: assunto ? preencherTemplate(assunto, DADOS_FICTICIOS) : '',
    corpo: preencherTemplate(corpo, DADOS_FICTICIOS),
  };
}

export function variaveisTemplate(tipo: TipoMensagem): string[] {
  return variaveisDoCenario(tipo);
}

export function idAleatorio(): string {
  return randomUUID();
}
