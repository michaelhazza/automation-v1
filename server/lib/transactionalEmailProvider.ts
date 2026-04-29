import { env } from './env.js';

export interface SendEmailOptions {
  from: string;
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: Array<{ name: string; content: string; contentType: string }>;
  messageId?: string; // provider idempotency key
}

export interface SendEmailProviderResult {
  messageId: string | null;
}

export async function sendThroughProvider(opts: SendEmailOptions): Promise<SendEmailProviderResult> {
  const from = `${opts.fromName} <${opts.from}>`;

  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
    const { Resend } = await import('resend');
    const resend = new Resend(env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.bodyText,
      html: opts.bodyHtml ?? undefined,
    });
    return { messageId: result.data?.id ?? null };
  }

  if (env.EMAIL_PROVIDER === 'sendgrid' && env.SENDGRID_API_KEY) {
    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(env.SENDGRID_API_KEY);
    await sgMail.default.send({
      from,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.bodyText,
      html: opts.bodyHtml ?? undefined,
    });
    return { messageId: null }; // SendGrid doesn't return a stable message ID synchronously
  }

  if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_HOST) {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    const info = await transporter.sendMail({
      from,
      to: opts.to.join(', '),
      cc: opts.cc?.join(', '),
      subject: opts.subject,
      text: opts.bodyText,
      html: opts.bodyHtml ?? undefined,
    });
    return { messageId: info.messageId ?? null };
  }

  // Dev fallback — log to console
  console.log(`[WORKSPACE-EMAIL] From: ${from}\nTo: ${opts.to.join(', ')}\nSubject: ${opts.subject}`);
  return { messageId: null };
}
