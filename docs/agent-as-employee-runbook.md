# Agent-as-employee — operations runbook

## Native backend setup

1. Configure your email provider (sendgrid / resend / smtp) via the existing EMAIL_PROVIDER env vars.
2. Set NATIVE_EMAIL_DOMAIN to the domain agents will email from (e.g. workspace.acme.com).
3. Configure the inbound webhook URL: POST /api/workspace/native/inbound. Set NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET.
4. Add SPF and DKIM DNS records per your provider's instructions.

## Google Workspace setup

(Filled in during Phase C.)
