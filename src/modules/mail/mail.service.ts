import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor() {
    this.transporter = this.createTransporter();
  }

  private createTransporter(): Transporter | null {
    const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD } = process.env;

    if (!MAIL_HOST || MAIL_HOST === 'changeme') {
      this.logger.warn(
        'MAIL_HOST is not configured — falling back to console logging for outgoing emails.',
      );
      return null;
    }

    return createTransport({
      host: MAIL_HOST,
      port: Number(MAIL_PORT),
      auth: MAIL_USER
        ? {
            user: MAIL_USER,
            pass: MAIL_PASSWORD,
          }
        : undefined,
    });
  }

  async sendConfirmationEmail(email: string, token: string): Promise<void> {
    const confirmationLink = `${process.env.CLIENT_URL}/auth/confirm-email?token=${token}`;
    const subject = 'Confirm your sn-test account';
    const text = `Hi,\n\nPlease confirm your email address by opening the link below:\n${confirmationLink}\n\nIf you didn't create an account, you can ignore this email.`;

    if (!this.transporter) {
      this.logger.log(`[DEV] Confirmation email for ${email}:\n${text}`);
      return;
    }

    await this.transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject,
      text,
    });
  }
}
