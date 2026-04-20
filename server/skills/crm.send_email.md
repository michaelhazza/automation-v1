# crm.send_email

ClientPulse intervention primitive — sends an email via the client's CRM with merge-field resolution + sensitive-path review gating.

## Payload

- `contactId` (string, required) — recipient contact
- `subject` (string, required) — merge-field-aware template
- `body` (string, required) — merge-field-aware template
- `fromAddress` (string, required) — authorised send-from address (validated via `crmLiveDataService.listFromAddresses`)
- `replyToAddress` (string, optional)

## Implementation

- Registration: `server/config/actionRegistry.ts`
- Validation: `server/skills/crmSendEmailServicePure.ts`
- Dispatch: `server/services/adapters/apiAdapter.ts` → `GHL_ENDPOINTS['crm.send_email']`
- Merge-field resolution: `server/services/mergeFieldResolverPure.ts` (V1 grammar)
- Idempotency: keyed on `(runId, toolCallId, args_hash)`
