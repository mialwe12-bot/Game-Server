import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class Mailer {
  private transporter: Transporter | null = null;
  /** In Tests werden Mails hier gesammelt statt verschickt. */
  public readonly outbox: MailMessage[] = [];

  constructor(private readonly config: Config) {
    if (config.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
      });
    }
  }

  get enabled(): boolean {
    return this.transporter !== null || this.config.NODE_ENV === 'test';
  }

  async send(msg: MailMessage): Promise<void> {
    if (this.config.NODE_ENV === 'test') {
      this.outbox.push(msg);
      return;
    }
    if (!this.transporter) throw new Error('SMTP ist nicht konfiguriert');
    await this.transporter.sendMail({ from: this.config.SMTP_FROM, ...msg });
  }
}
