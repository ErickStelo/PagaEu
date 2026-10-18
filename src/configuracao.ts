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
};

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
  urlNotificacao: string;
};

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
};

export async function salvarConfiguracao(app: App, entrada: EntradaConfig): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const atual = await linha(app.pool);
  const usuario = entrada.usuario.trim();
  const email = entrada.emailDono.trim();
  if (usuario.length < 1 || usuario.length > 80) return { ok: false, aviso: 'Informe o usuário do painel.' };
  if (!emailValido(email)) return { ok: false, aviso: 'E-mail do dono inválido.' };
  const trocaSenha = entrada.senhaNova.trim().length > 0;
  const trocaEmail = email !== atual.email_dono;
  const trocaUsuario = usuario !== atual.usuario_painel;
  const trocaMpToken = entrada.mpAccessToken.trim().length > 0;
  const trocaWebhook = entrada.mpWebhookSecret.trim().length > 0;
  const trocaSmtpSenha = entrada.smtpSenha.trim().length > 0;
  const trocaSmtpHost = entrada.smtpHost.trim() !== (atual.smtp_host ?? '').trim();
  const trocaSmtpPorta = entrada.smtpPorta.trim() !== String(atual.smtp_porta ?? '').trim() && entrada.smtpPorta.trim().length > 0;
  const trocaSmtpUsuario = entrada.smtpUsuario.trim() !== (atual.smtp_usuario ?? '').trim();
  const evolutionUrl = entrada.evolutionUrl.trim();
  const evolutionInstance = entrada.evolutionInstance.trim();
  const trocaEvolutionUrl = evolutionUrl !== (atual.evolution_url ?? '').trim();
  const trocaEvolutionInstancia = evolutionInstance !== (atual.evolution_instance ?? '').trim();
  const trocaEvolutionChave = entrada.evolutionApiKey.trim().length > 0;
  const trocaIntegracao = trocaMpToken
    || trocaWebhook
    || trocaSmtpSenha
    || trocaSmtpHost
    || trocaSmtpPorta
    || trocaSmtpUsuario
    || trocaEvolutionUrl
    || trocaEvolutionInstancia
    || trocaEvolutionChave;
  if ((trocaSenha || trocaEmail || trocaUsuario || trocaIntegracao)
    && !(await confereHash(entrada.senhaAtual, atual.senha_painel_hash))) {
    return { ok: false, aviso: 'A senha atual não confere.' };
  }
  const criptografia = entrada.smtpCriptografia;
  if (criptografia !== 'nenhuma' && criptografia !== 'starttls' && criptografia !== 'tls_implicito') {
    return { ok: false, aviso: 'Escolha a criptografia do SMTP.' };
  }
  const porta = entrada.smtpPorta.trim() ? Number(entrada.smtpPorta) : null;
  if (entrada.smtpHost.trim() && (!porta || !Number.isInteger(porta) || porta < 1 || porta > 65535)) {
    return { ok: false, aviso: 'Porta SMTP inválida.' };
  }
  if (entrada.smtpRemetenteEmail.trim() && !emailValido(entrada.smtpRemetenteEmail)) {
    return { ok: false, aviso: 'E-mail do remetente inválido.' };
  }
  if (evolutionUrl && !urlHttpRemotaPermitida(evolutionUrl)) {
    return { ok: false, aviso: 'URL do Evolution inválida ou não permitida.' };
  }
  if ((evolutionUrl || evolutionInstance || entrada.evolutionApiKey.trim()) && (!evolutionUrl || !evolutionInstance)) {
    return { ok: false, aviso: 'Informe a URL e a instância do Evolution juntas.' };
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
      atualizado_em = $16
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
