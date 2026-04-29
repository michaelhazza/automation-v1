# Agent-as-employee — operations runbook

## Native backend setup

1. Configure your email provider (sendgrid / resend / smtp) via the existing EMAIL_PROVIDER env vars.
2. Set NATIVE_EMAIL_DOMAIN to the domain agents will email from (e.g. workspace.acme.com).
3. Configure the inbound webhook URL: POST /api/workspace/native/inbound. Set NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET.
4. Add SPF and DKIM DNS records per your provider's instructions.

## Google Workspace setup

### Prerequisites

The service account must have domain-wide delegation granted in the Google Admin console. The following OAuth scopes must be authorised:

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/admin.directory.user` | Create, suspend, unsuspend users via Admin SDK |
| `https://www.googleapis.com/auth/admin.directory.user.readonly` | Verify user state |
| `https://www.googleapis.com/auth/gmail.send` | Send outbound email as the agent |
| `https://www.googleapis.com/auth/gmail.readonly` | Fetch inbound email |
| `https://www.googleapis.com/auth/gmail.modify` | Mark messages read |
| `https://www.googleapis.com/auth/calendar` | Create events, update RSVP status |

### Steps

1. In Google Cloud Console, create a service account for Automation OS.
2. Download the JSON key file (or copy the JSON).
3. In Google Admin Console → Security → API Controls → Domain-wide Delegation, add the service account client ID and the scopes above.
4. Set env vars:
   - `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` — path to the JSON key file, or inline JSON string.
   - `GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER` — email of a Workspace super-admin used for impersonation.
5. In Automation OS, navigate to the subaccount's Workspace tab, select "Google Workspace", enter the customer's primary domain, and click "Connect Google Workspace".
6. Verify: onboard an agent. Confirm the user appears in Google Admin → Directory → Users.

### Troubleshooting

- **403 from Admin SDK**: The service account lacks delegation or the scope list is incomplete.
- **403 from Gmail**: The agent's email address is not yet propagated (Google can take up to 5 min after user creation). Retry the operation.
- **Identity provisioning collision (409)**: The Google user already exists with that email. Check if a previous onboarding attempt left a partial state in Google Admin.
