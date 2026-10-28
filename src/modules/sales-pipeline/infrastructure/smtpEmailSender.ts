/**
 * SMTP e-posta göndericisi (nodemailer). Kimlik bilgileri bootstrap'tan değer olarak gelir;
 * loglarda alıcı adresi maskelenir (logger). Hata fırlatır; çağıran (LeadNotifier) yutar ve loglar.
 */
import nodemailer from "nodemailer";
import type { Logger, SmtpConfig } from "../../shared/kernel";
import type { EmailMessage, EmailSender } from "../application";

export function createSmtpEmailSender(
  config: SmtpConfig,
  auth: { user: string; pass: string },
  logger: Logger,
): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: auth.user ? auth : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const from = config.from || auth.user;
  return {
    async send(m: EmailMessage) {
      const info = await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
      logger.debug("smtp gönderildi", { messageId: info.messageId, to: m.to });
    },
  };
}

/** SMTP yapılandırılmamışken: göndermez, loglar (yerel geliştirme). */
export function loggingEmailSender(logger: Logger): EmailSender {
  return {
    async send(m) {
      logger.info("e-posta (SMTP kapalı, gönderilmedi)", { to: m.to, subject: m.subject });
    },
  };
}
