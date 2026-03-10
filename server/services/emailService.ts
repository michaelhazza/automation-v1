import { env } from '../lib/env.js';

const APP_BASE_URL = env.APP_BASE_URL;

function brandedHtml(title: string, preheader: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1e293b;padding:28px 40px;">
              <span style="font-size:22px;font-weight:700;color:#f8fafc;letter-spacing:-0.5px;">Automation OS</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                This email was sent by Automation OS. If you did not expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export class EmailService {
  async sendInvitationEmail(to: string, token: string, orgName: string): Promise<void> {
    const inviteUrl = `${APP_BASE_URL}/invite/accept?token=${token}`;
    const subject = `You've been invited to join ${orgName} on Automation OS`;

    const bodyHtml = `
      <h2 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1e293b;">You're invited!</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
        You have been invited to join <strong>${orgName}</strong> on Automation OS.
        Click the button below to accept your invitation and set up your account.
      </p>
      <div style="margin:28px 0;">
        <a href="${inviteUrl}" style="display:inline-block;padding:13px 28px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
          Accept Invitation
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;color:#2563eb;word-break:break-all;">
        ${inviteUrl}
      </p>
      <p style="margin:0;font-size:13px;color:#94a3b8;">
        This invitation expires in ${env.INVITE_TOKEN_EXPIRY_HOURS} hours.
      </p>
    `;

    const textBody = `You have been invited to join ${orgName} on Automation OS.\n\nAccept your invitation: ${inviteUrl}\n\nThis link expires in ${env.INVITE_TOKEN_EXPIRY_HOURS} hours.`;

    await this.send(to, subject, textBody, brandedHtml(subject, `You've been invited to join ${orgName}.`, bodyHtml));
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const resetUrl = `${APP_BASE_URL}/reset-password?token=${token}`;
    const subject = 'Reset your Automation OS password';

    const bodyHtml = `
      <h2 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1e293b;">Reset your password</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
        We received a request to reset the password for your Automation OS account.
        Click the button below to choose a new password.
      </p>
      <div style="margin:28px 0;">
        <a href="${resetUrl}" style="display:inline-block;padding:13px 28px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
          Reset Password
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;color:#2563eb;word-break:break-all;">
        ${resetUrl}
      </p>
      <p style="margin:0;font-size:13px;color:#94a3b8;">
        This link expires in ${env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS} hour(s).
        If you did not request a password reset, you can safely ignore this email.
      </p>
    `;

    const textBody = `Reset your Automation OS password.\n\nVisit: ${resetUrl}\n\nThis link expires in ${env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS} hour(s).\n\nIf you did not request a password reset, ignore this email.`;

    await this.send(to, subject, textBody, brandedHtml(subject, 'Reset your Automation OS password.', bodyHtml));
  }

  async sendExecutionCompletionEmail(to: string, taskName: string, executionId: string, status: string): Promise<void> {
    const subject = `Automation OS: ${taskName} execution ${status}`;

    const statusColor = status === 'completed' ? '#16a34a' : '#dc2626';
    const bodyHtml = `
      <h2 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1e293b;">Execution ${status}</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
        Your execution of <strong>${taskName}</strong> has
        <span style="color:${statusColor};font-weight:600;">${status}</span>.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0;font-size:13px;color:#64748b;">
          <strong>Execution ID:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:12px;">${executionId}</code>
        </p>
      </div>
    `;

    const textBody = `Your execution of "${taskName}" has ${status}.\n\nExecution ID: ${executionId}`;

    await this.send(to, subject, textBody, brandedHtml(subject, `Your task execution has ${status}.`, bodyHtml));
  }

  async sendDataSourceSyncAlert(
    to: string,
    agentName: string,
    sourceName: string,
    errorMsg: string,
    agentEditUrl: string
  ): Promise<void> {
    const subject = `Automation OS: Data source sync failed — ${agentName}`;
    const bodyHtml = `
      <h2 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1e293b;">Data source sync failed</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
        A data source for agent <strong>${agentName}</strong> failed to sync. The agent is currently
        serving the last successfully cached version of this data.
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0 0 8px;font-size:13px;color:#374151;"><strong>Source:</strong> ${sourceName}</p>
        <p style="margin:0;font-size:13px;color:#dc2626;"><strong>Error:</strong> ${errorMsg}</p>
      </div>
      <div style="margin:28px 0;">
        <a href="${agentEditUrl}" style="display:inline-block;padding:13px 28px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
          Review Agent Settings
        </a>
      </div>
      <p style="margin:0;font-size:13px;color:#94a3b8;">
        You will receive at most one alert per hour per data source while the issue persists.
        A recovery notification will be sent automatically once the source is reachable again.
      </p>
    `;
    const textBody = `Data source sync failed for agent "${agentName}".\n\nSource: ${sourceName}\nError: ${errorMsg}\n\nReview agent settings: ${agentEditUrl}`;
    await this.send(to, subject, textBody, brandedHtml(subject, `Sync failed for ${sourceName}.`, bodyHtml));
  }

  async sendDataSourceSyncRecovery(
    to: string,
    agentName: string,
    sourceName: string,
    agentEditUrl: string
  ): Promise<void> {
    const subject = `Automation OS: Data source recovered — ${agentName}`;
    const bodyHtml = `
      <h2 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1e293b;">Data source recovered</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
        Good news — the data source <strong>${sourceName}</strong> for agent <strong>${agentName}</strong>
        is syncing successfully again.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0;font-size:13px;color:#166534;">The agent is now serving fresh data from this source.</p>
      </div>
      <div style="margin:28px 0;">
        <a href="${agentEditUrl}" style="display:inline-block;padding:13px 28px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
          View Agent
        </a>
      </div>
    `;
    const textBody = `Data source "${sourceName}" for agent "${agentName}" has recovered and is syncing successfully.\n\nView agent: ${agentEditUrl}`;
    await this.send(to, subject, textBody, brandedHtml(subject, `${sourceName} is syncing again.`, bodyHtml));
  }

  private async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
      const { Resend } = await import('resend');
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.EMAIL_FROM,
        to,
        subject,
        text,
        html,
      });
    } else if (env.EMAIL_PROVIDER === 'sendgrid' && env.SENDGRID_API_KEY) {
      const sgMail = await import('@sendgrid/mail');
      sgMail.default.setApiKey(env.SENDGRID_API_KEY);
      await sgMail.default.send({
        to,
        from: env.EMAIL_FROM,
        subject,
        text,
        ...(html ? { html } : {}),
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
        text,
        ...(html ? { html } : {}),
      });
    } else {
      // Log to console when no email provider is configured
      console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${text}`);
    }
  }
}

export const emailService = new EmailService();
