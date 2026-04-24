# crm.fire_automation

ClientPulse intervention primitive — fires a CRM workflow / automation on a contact. Review-gated by default; dispatched via `apiAdapter.execute()` against the GHL `/hooks/workflows/{workflowId}/subscribe` endpoint.

## Payload

- `workflowId` (string, required) — target automation ID
- `contactId` (string, required) — recipient contact
- `scheduleHint` (enum, optional) — `immediate | delay_24h | scheduled`
- `scheduledFor` (string, optional) — ISO timestamp when `scheduleHint === 'scheduled'`

## Implementation

- Registration: `server/config/actionRegistry.ts`
- Validation: `server/skills/crmFireAutomationServicePure.ts`
- Dispatch: `server/services/adapters/apiAdapter.ts` → `GHL_ENDPOINTS['crm.fire_automation']`
- Idempotency: keyed on `(runId, toolCallId, args_hash)` per `actionService.buildActionIdempotencyKey`
- Retries: `apiAdapterClassifierPure` governs retryable vs terminal outcomes; `actions.max_retries` caps the retry count
