# crm.create_task

ClientPulse intervention primitive — creates a task on a CRM user's queue. Distinct from the internal board-level `create_task` skill — this one targets the connected CRM, not the Synthetos task board.

## Payload

- `contactId` (string, required) — related contact
- `assigneeUserId` (string, required) — CRM user receiving the task
- `title` (string, required)
- `notes` (string, optional) — freeform notes / call script
- `dueAt` (string, required) — ISO timestamp
- `priority` (enum, optional) — `low | med | high`

## Implementation

- Registration: `server/config/actionRegistry.ts`
- Validation: `server/skills/crmCreateTaskServicePure.ts`
- Dispatch: `server/services/adapters/apiAdapter.ts` → `GHL_ENDPOINTS['crm.create_task']`
- Idempotency: keyed on `(runId, toolCallId, args_hash)`
