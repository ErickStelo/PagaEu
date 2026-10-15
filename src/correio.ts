import nodemailer from 'nodemailer';
import type { CorreioGateway, SmtpConfig } from './gateways.ts';
import { mensagemErro, redigir } from './texto.ts';

export function criarCorreio(): CorreioGateway {
  return {
    async enviar(config, mensagem) {
      if (!config?.host || !config.remetenteEmail) {
        return { ok: false, motivo: 'SMTP não configurado' };
      }
      try {
        const transporte = nodemailer.createTransport({
          host: config.host,
          port: config.porta,
          secure: config.criptografia === 'tls_implicito',
          requireTLS: config.criptografia === 'starttls',
          ignoreTLS: config.criptografia === 'nenhuma',
          auth: config.usuario ? { user: config.usuario, pass: config.senha ?? '' } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
        });
        const from = config.remetenteNome
          ? `"${config.remetenteNome.replace(/"/g, '')}" <${config.remetenteEmail}>`
          : config.remetenteEmail;
        await transporte.sendMail({
          from,
          to: mensagem.to,
          subject: mensagem.subject,
          text: mensagem.text,
        });
        return { ok: true };
      } catch (erro) {
        return { ok: false, motivo: redigir(mensagemErro(erro), [config.senha]) };
      }
    },
  };
}
