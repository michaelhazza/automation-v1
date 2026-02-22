import { env } from '../lib/env.js';

export class EmailService {
  async sendInvitationEmail(to: string, token: string, orgName: string): Promise<void> {
    const inviteUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:5173'}/invite/accept?token=${token}`;
    const subject = `You've been invited to join ${orgName} on Automation OS`;
    const body = `You have been invited to join ${orgName} on Automation OS.\n\nAccept your invitation: ${inviteUrl}\n\nThis link expires in ${env.INVITE_TOKEN_EXPIRY_HOURS} hours.`;

    await this.send(to, subject, body);
  }

  async sendExecutionCompletionEmail(to: string, taskName: string, executionId: string, status: string): Promise<void> {
    const subject = `Automation OS: ${taskName} execution ${status}`;
    const body = `Your execution of "${taskName}" has ${status}.\n\nExecution ID: ${executionId}`;
    await this.send(to, subject, body);
  }

  private async send(to: string, subject: string, body: string): Promise<void> {
    if (env.EMAIL_PROVIDER === 'sendgrid' && env.SENDGRID_API_KEY) {
      const sgMail = await import('@sendgrid/mail');
      sgMail.default.setApiKey(env.SENDGRID_API_KEY);
      await sgMail.default.send({
        to,
        from: env.EMAIL_FROM,
        subject,
        text: body,
      });
    } else if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_HOST) {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
      await transporter.sendMail({
        from: env.EMAIL_FROM,
        to,
        subject,
        text: body,
      });
    } else {
      // Log to console when no email provider is configured
      console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${body}`);
    }
  }
}

export const emailService = new EmailService();
