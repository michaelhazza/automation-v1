# crm.send_sms

ClientPulse intervention primitive — sends an SMS via the client's CRM.

## Payload

- `contactId` (string, required) — recipient contact
- `message` (string, required) — merge-field-aware template (GSM-7 / UCS-2 segment count enforced client-side)
- `fromNumber` (string, required) — authorised send-from number in E.164 format

## Implementation

- Registration: `server/config/actionRegistry.ts`
- Validation: `server/skills/crmSendSmsServicePure.ts`
- Dispatch: `server/services/adapters/apiAdapter.ts` → `GHL_ENDPOINTS['crm.send_sms']`
- Idempotency: keyed on `(runId, toolCallId, args_hash)`
