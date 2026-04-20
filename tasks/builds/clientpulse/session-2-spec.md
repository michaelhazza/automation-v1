# Session 2 — ClientPulse pilot enablement + polish + Session 1 close-out

**Status:** Historical record. Session 2 shipped on branch `claude/clientpulse-session-2-arch-gzYlZ` (2026-04-20). See `tasks/builds/clientpulse/progress.md` for the authoritative close-out state; this spec is the design-intent reference.
**Predecessor:** Session 1 — `tasks/builds/clientpulse/session-1-foundation-spec.md` (shipped 2026-04-20, branch `claude/clientpulse-session-1-foundation`).
**Brief:** `tasks/builds/clientpulse/session-2-brief.md` (folded in + expanded).
**Effort estimate (at authoring):** ~4–5 weeks, one PR, 14 chunks. Actual: 12 commits, one branch, partial coverage of the original 14-chunk plan — see §12.1 annotations.

---

## Contents

0. Session goals + scope statement
1. Ship gates + contracts inherited from Session 1
2. Phase 6.1 — `apiAdapter` real CRM wiring + retry policy
3. Phase 6.2 — live-data pickers + editor modal rewire
4. Phase 6.3 — per-client drilldown page (minimal scope)
5. Phase 8.1 — outcome-weighted `recommendedActionType`
6. Phase 8.2 — Configuration Assistant dual-path UX copy (B6)
7. Phase 8.3 — `notify_operator` channel fan-out
8. Phase 8.4 — typed `InterventionTemplatesEditor`
9. Phase 8.5 — per-block "Ask the assistant" deep-links
10. Phase 8.6 — (conditional) wizard scan-frequency + alert-cadence controls
11. Session 1 carry-forward — create-org modal, typed Settings editors, panel extraction, resume window, integration test, `recordHistory` refactor
12. Work sequence + chunk breakdown + sanity gates
13. File inventory summary
14. Decisions log (Q1–Q5 locked, deferrals documented)

---

## §0. Session goals + scope statement

Session 2 was the final ClientPulse delivery session before pilot launch. It targeted three concurrent workstreams in one PR:

- **Pilot enablement** (Phase 6). Real CRM execution — the `apiAdapter.execute()` stub becomes a working GHL dispatcher; intervention editor modals get live-fetched pickers; operators get a per-client drilldown surface.
- **Pilot polish** (Phase 8). Outcome-weighted intervention recommendations; dual-path UX copy on the Configuration Assistant; `notify_operator` channel fan-out verified end-to-end; typed template editor replaces the JSON fallback; per-block assistant deep-links on the Settings page; conditional wizard controls for scan cadence.
- **Session 1 close-out** (D-chunks). The deliberately-deferred Session 1 items — create-org modal rebuild, typed Settings editors for the 9 non-template blocks, clean `<ConfigAssistantPanel>` extraction (replaces the Session 1 iframe MVP), 15-minute resume window enforcement on the client, integration test for ship gate S1-A4, and the `recordHistory` version-return refactor (pr-review N4).

**What actually landed** (per `progress.md` close-out, 2026-04-20):

- **Shipped in full:** B.1 (apiAdapter + retry classifier + precondition gate), B.2 (live-data pickers + 5 adapter routes), B.3 (drilldown page — minimal scope per Q5), C.1 (notify_operator fan-out), C.2 (outcome-weighted recommendation), C.3 (typed `InterventionTemplatesEditor` with per-actionType sub-editors + static merge-field vocabulary), C.4 (dual-path UX renderer + parser + per-block "Ask the assistant" deep-links), D.2 (9 typed Settings editors).
- **Shipped partial:** D.1 minimal (`createOrganisationFromTemplate` method only — hierarchy_templates seed + system-agent seeding + modal rebuild deferred), D.4 partial (`recordHistory` returns version — integration test deferred), B6 / Chunk 8 ConfigAssistantPage wire-up (landed in audit commit `6705192` after initial Chunk 8).
- **Deferred within Session 2:** C.5 (Chunk 9 — wizard scan-frequency + alert-cadence controls; Screen 3 of `OnboardingWizardPage` had diverged from the assumed config-defaults layout), D.3 (Chunk 12 — `<ConfigAssistantPanel>` extraction + hook-level 15-min window; popup remains iframe-wrapped + URL-param plumbing remains the resume-window enforcement path from Session 1), D.1 modal rebuild + `hierarchy_templates`/system-agent seeding, D.4 integration test (`organisationConfig.integration.test.ts`), merge-field vocabulary endpoint, on-call recipient role audit, OAuth refresh-on-expire for apiAdapter.
- **Long-term deferrals (§14):** D6 full subscription-tier runtime gating, custom intervention-type authoring beyond the 5 primitives, dedicated `ORG_PERMISSIONS.CONFIG_EDIT` split, runtime `operationalConfigSchema.parse()` on the effective-read hot path, manual replay runtime, segmented outcome charts, Slack webhook retries, per-subaccount outcome aggregation, picker "show more", JSON editor fallback removal, permission/auth context consolidation, server-side resume-window guardrail.

**Non-goals for Session 2:**

- Any behavioural change to the intervention state machine, idempotency-key pattern, or audit-trail shape. Session 1 locked those; Session 2 builds on top without reopening them.
- New intervention primitives beyond the 5 already registered (`crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `notify_operator`).
- Runtime schema validation on the effective-config read path (deferred per Session 1 §10.3).

---

## §1. Ship gates + contracts inherited from Session 1

### §1.1 Session 2 ship gates

Gate matrix with shipped status. "Verification" column describes the evidence that actually landed (typecheck baselines + pure-function tests; no integration or E2E tests ship for this codebase per `docs/spec-context.md` — manual-smoke references below were the authoring-time intent and did not materialise as artefacts).

| Gate | Status | Surface | Evidence |
|------|--------|---------|----------|
| **S2-6.1** | passed | `apiAdapter.execute()` dispatches all 5 `crm.*` action types against the connected GHL workspace; retries honour `actionDefinition.retryPolicy` per the Q2 response-code map | Pure classifier 10/10 (`apiAdapterClassifierPure.test.ts`); migration 0185 pre-documents `replay_of_action_id`; precondition gate (four checks per §2.6) live |
| **S2-6.2** | passed | Each of the 5 intervention editor modals fetches its picker data live via the new adapter endpoints; free-text ID fallback removed | Typecheck baseline held; 5 new routes + `crmLiveDataService` + 4 editor rewires; `LiveDataPicker` component shipped |
| **S2-6.3** | passed | `/clientpulse/clients/:subaccountId` drilldown mounts, renders intervention history with outcome badges, signal panel, band transitions (90-day), and a contextual "Open Configuration Assistant" trigger | `drilldownOutcomeBadgePure.test.ts` 11/11; 4 new routes + page + 4 components |
| **S2-8.1** | passed | `buildInterventionContext.recommendedActionType` returns an outcome-weighted signal when ≥ N outcome rows exist for the `(org_id, template_slug, band_before)` key; falls back to priority-based when data is sparse | `recommendedInterventionPure.test.ts` 8/8; aggregation query + `recommendedReason` surfaced on response |
| **S2-8.2 / B6** | partial | Configuration Assistant chat renders distinct "routed to review queue" vs "applied immediately" affordances on sensitive vs non-sensitive paths | `ConfigUpdateToolResult` renderer + `parseConfigUpdateToolResult` parser landed in Chunk 8; `ConfigAssistantPage` wire-up landed in audit commit `6705192` (Fix 2) |
| **S2-8.3** | passed | `notify_operator` fans out to all three channels (in-app, email, Slack) within one worker tick; missing provider paths built as needed | `notifyOperatorFanoutServicePure.test.ts` 8/8; 3 channel adapters + skillExecutor rewire; Slack webhook read from `organisations.settings.slackWebhookUrl` |
| **S2-8.4** | passed | Typed `InterventionTemplatesEditor` replaces the Session 1 JSON editor; existing templates round-trip without data loss | List+edit form + 5 per-actionType sub-editors + round-trip module + `MergeFieldPicker` (static vocabulary) |
| **S2-8.5** | passed | Per-block "Ask the assistant" button present on each of the Settings-page block cards; clicking opens the popup seeded with the relevant path prompt | `configAssistantPrompts.buildBlockContextPrompt` + button on every block card |
| **S2-8.6** | deferred | Scan frequency + alert cadence editable from the wizard Screen-3; persisted to the effective config; visible in the Settings page | Schema fields present; wizard Step 3 structure had diverged — UI wiring deferred to Session 3 |
| **S2-D.1** | partial | Create-organisation modal exposes the system-template picker + tier toggle + live preview pane; `organisationService.createOrganisationFromTemplate` seeds the new org per spec §11.1.1 (operational_config_override stays NULL, appliedSystemTemplateId set, creation-event config_history row written) | Service method + creation-event audit row landed + POST route branch wired in audit commit `6705192`; modal rebuild + `hierarchy_templates`/system-agent seeding deferred; `organisations.tier` column not added |
| **S2-D.2** | passed | Typed form editors replace the Session 1 JSON editor for all 9 non-template Settings blocks | 9 editors + `ArrayEditor` + `NormalisationFieldset`; Settings page dispatches on `block.path`; JSON fallback preserved |
| **S2-D.3** | deferred | `<ConfigAssistantPanel>` component extracted; popup embeds the panel directly instead of the Session 1 iframe wrapper; 15-minute resume window enforced on the client via `updatedAfter` query param | Deferred to Session 3; Session 1 URL-param plumbing (`updatedAfter` on iframe src → page → `GET /api/agents/:id/conversations`) remains in place and structurally honours contract (k) |
| **S2-D.4** | partial | `server/routes/__tests__/organisationConfig.integration.test.ts` integration test lands (the 8-case matrix described in Session 1 plan §5.2); `configHistoryService.recordHistory` returns the version it wrote when called with a `tx` argument | `recordHistory` returns `Promise<number>`; `SELECT MAX(version)` read-back removed from `configUpdateOrganisationService`; integration test file deferred pending DB-fixture layer |

### §1.2 Contracts inherited verbatim from Session 1

All contracts (a)–(v) from `session-1-foundation-spec.md` §1.3, the `InterventionEnvelope` type from §1.5, and the §1.6 lifecycle invariants carry forward unchanged. Session 2 builds on top of these — no re-opening, no re-wording.

Specifically relevant to Session 2:

- **(b)** Interventions are `actions` rows + `intervention_outcomes` rows; no new tables.
- **(m)** Linear state machine: `proposed → (approved | rejected | blocked) → executing → (completed | failed | skipped)`; `blocked` + `skipped` terminal with enum reasons in `actions.errorJson`.
- **(n)** Config gating is pure; execute never mutates config during execution; re-validate for drift then apply the already-validated merge in a single transaction.
- **(o)** Canonical idempotency key pattern: `clientpulse:intervention:{source}:{subaccountId|orgId}:{templateSlug|actionType}:{correlation}`. Session 2 does not introduce new trigger sources; keys stay structural.
- **(p)** Atomicity boundaries: action insert vs review_items; config write + config_history atomic; execution vs status transition separate with stale-run reconciliation; outcome insertion eventual.
- **(q)** Every log / event / audit row carries `actionId` as first-class correlation key.
- **(r)** Replayability: every decision function lives in a `*Pure.ts` module.
- **(s)** Retry vs replay — Session 2 documents the `replay_of_action_id` column on the schema (pre-documentation only; runtime wiring deferred per §14 Q4).
- **(t)** Internal state writes first, external side effects last, audit never skipped. Critical for Phase 6.1 (apiAdapter).
- **(u)** External side-effect preconditions — approved + validated + idempotency-locked + timeout-budget-remaining — **before any adapter call**. Phase 6.1 is the first session where this contract actually gates real external calls; until now `apiAdapter` was a stub.
- **(v)** Deterministic ordering under concurrency: PG advisory lock per subaccount for serial execute of approved actions; config-history advisory lock per org.

### §1.3 New contract nuances introduced by Session 2

Session 2 does not add new top-level contracts. It does refine two existing ones:

- **(u) preconditions — retry-classification contract.** The adapter must honour `actionDefinition.retryPolicy` by classifying every provider response via a pure function `classifyAdapterOutcome(response)` returning `'retryable' | 'terminal_success' | 'terminal_failure'`. The classifier's rules are Q2 in §14 — the 429/502/503/timeout → retryable and 401/403/404/422 → terminal mapping. Classifier is pure; the decision function lives in `server/services/adapters/apiAdapterClassifierPure.ts` and is test-locked.

- **(s) replay schema pre-documentation.** A new `replay_of_action_id uuid NULL REFERENCES actions(id)` column ships on the `actions` table in a Session 2 migration, documented in the schema but never written. Enforces spec-level traceability ("replay produces a new action that points at the original") without committing to a runtime that the pilot feedback hasn't shaped yet.

### §1.4 Lifecycle invariants advanced in Session 2

| Invariant | Session 2 surface |
|---|---|
| **Every intervention produces exactly one terminal outcome** | Preserved. Phase 6.1 makes the state machine actually cross the wire for the first time; the `measureInterventionOutcomeJob` path is unchanged. |
| **Every intervention is traceable via `action.id`** | Preserved + extended — Phase 6.1 adds structured adapter logs keyed on `actionId`; Phase 6.3 drilldown surfaces the `actionId` chain per subaccount. |
| **Proposer → approver → executor atomic** | Phase 6.1 closes the "executor" leg with real external side effects for the first time. Per (u), every adapter call is preceded by the four preconditions; failed preconditions transition the action to `blocked` with `errorJson.blockedReason`. |

---

---

## §2. Phase 6.1 — `apiAdapter` real CRM wiring + retry policy

### §2.1 The problem being solved

`server/services/adapters/apiAdapter.ts` is the Phase-1A stub that every approved `crm.*` action eventually routes through. Its `execute()` method currently returns `{ ok: false, errorCode: 'not_implemented' }`, which means: the proposer proposes, the operator approves, the execution machinery enqueues — but no external side effect ever fires. Pilot cannot launch until this adapter actually dispatches to GHL.

Per contract (t) in §1.2: **internal state writes first, external side effects last, audit never skipped.** Session 2 is the first session where the adapter actually crosses the wire. Contract (u)'s four preconditions (approved + validated + idempotency-locked + timeout-budget-remaining) apply to every call.

### §2.2 Adapter responsibilities

The adapter owns:

1. **Dispatch** — route the action to the correct GHL endpoint based on `actionType` + `payloadJson`.
2. **Idempotency** — honour the caller-supplied `idempotencyKey` (already present on `actions.idempotency_key`). GHL's REST API accepts an `Idempotency-Key` header on write endpoints; the adapter forwards this verbatim so GHL dedupes on retry.
3. **Retry** — classify every response via the pure `classifyAdapterOutcome` function; retryable outcomes re-enqueue with exponential backoff bounded by `actionDefinition.retryPolicy.maxRetries`.
4. **Outcome reporting** — return a discriminated union that the execution engine consumes to transition `actions.status` (`completed` vs `failed` vs `blocked`).
5. **Structured logging** — every dispatch + every classifier decision emits a log line keyed on `actionId` per contract (q).

The adapter does NOT own:

- Pre-approval validation (that's the proposer's job; contract (n) pure).
- `actions.status` transitions (the execution engine owns those; the adapter returns the intended transition, the engine applies it under the advisory lock per contract (v)).
- Config-history writes (that's the config-write service; adapter never touches `config_history`).

### §2.3 The `classifyAdapterOutcome` pure function

**New file: `server/services/adapters/apiAdapterClassifierPure.ts`.**

Per Q2 in §14 — the retry-response-code map is:

```typescript
export type AdapterOutcomeClassification =
  | { kind: 'terminal_success' }
  | { kind: 'retryable'; reason: 'rate_limit' | 'gateway' | 'network_timeout' }
  | { kind: 'terminal_failure'; reason: 'auth' | 'not_found' | 'validation' | 'other' };

export function classifyAdapterOutcome(
  response: { status: number } | { networkError: true; timedOut: boolean },
): AdapterOutcomeClassification;
```

Rules (pure, no I/O):

| Response | Classification |
|----------|----------------|
| 2xx | `{ kind: 'terminal_success' }` |
| 429 | `{ kind: 'retryable', reason: 'rate_limit' }` |
| 502, 503 | `{ kind: 'retryable', reason: 'gateway' }` |
| Network timeout | `{ kind: 'retryable', reason: 'network_timeout' }` |
| 401, 403 | `{ kind: 'terminal_failure', reason: 'auth' }` |
| 404 | `{ kind: 'terminal_failure', reason: 'not_found' }` |
| 422 | `{ kind: 'terminal_failure', reason: 'validation' }` |
| Other 5xx (500, 504, 599) | Retry ONCE via `retryPolicy.maxRetries`, then classifier returns `terminal_failure` with `reason: 'other'`. Implementation note: the classifier itself doesn't track attempt count — that lives in the adapter's outer loop. The classifier always returns `retryable` for 5xx-other; the adapter's `retryPolicy` cap enforces the "retry once" semantics. |
| Other 4xx | `{ kind: 'terminal_failure', reason: 'other' }` |

Pure test file `apiAdapterClassifierPure.test.ts` — ~10 cases covering each branch + the "other 5xx respects retryPolicy.maxRetries" interaction.

### §2.4 The five endpoint mappings

For each of the 5 intervention primitives, the adapter dispatches to a specific GHL endpoint. Endpoints live in a constants table `server/services/adapters/ghlEndpoints.ts` (new):

| `actionType` | GHL endpoint | Method | Required payload fields |
|--------------|--------------|--------|-------------------------|
| `crm.fire_automation` | `/hooks/workflows/{workflowId}/subscribe` | POST | `workflowId`, `contactId` |
| `crm.send_email` | `/contacts/{contactId}/emails` | POST | `contactId`, `subject`, `body`, `fromAddress`, `replyToAddress?` |
| `crm.send_sms` | `/contacts/{contactId}/sms` | POST | `contactId`, `message`, `fromNumber` |
| `crm.create_task` | `/contacts/{contactId}/tasks` | POST | `contactId`, `assigneeUserId`, `title`, `notes?`, `dueAt`, `priority?` |
| `notify_operator` | Internal — no GHL call | — | Fan-out lives in Phase 8.3 (`notifyOperatorFanoutService`); adapter short-circuits and returns `terminal_success`. |

Endpoint URLs are constructed against the org's configured GHL base URL (stored on `integration_connections.base_url`). Auth header uses the stored OAuth access token per the existing `ghlOAuthService.getValidToken(orgId)` helper.

### §2.5 Adapter contract + signatures

`server/services/adapters/apiAdapter.ts` (rewrite):

```typescript
export type AdapterExecuteResult =
  | { ok: true; providerResponseSummary: string }
  | { ok: false; errorCode: 'AUTH' | 'NOT_FOUND' | 'VALIDATION' | 'RATE_LIMITED' | 'GATEWAY' | 'NETWORK_TIMEOUT' | 'OTHER'; message: string; retryable: boolean };

export async function execute(params: {
  action: ActionRow;          // row from `actions` table
  payload: Record<string, unknown>;
  organisationId: string;
  subaccountId: string | null;
}): Promise<AdapterExecuteResult>;
```

The execution engine consumes the result as follows:

- `{ ok: true }` → transition `actions.status → completed`, set `executed_at = now()`.
- `{ ok: false, retryable: true }` → re-enqueue per `retryPolicy` with exponential backoff; if retries exhausted, transition to `failed`.
- `{ ok: false, retryable: false }` → transition to `failed` with `errorJson.errorCode` set.

### §2.6 Precondition gate (contract (u))

Before the adapter function issues the HTTP call, the execution engine runs four checks:

1. `actions.status === 'approved'` (proposer → approve → executor chain intact).
2. `actions.metadata_json.validationDigest === validationDigest(actions.payload_json)` (re-validation; drift → `blocked` with `blockedReason: 'drift_detected'`).
3. Advisory lock acquired per `(organisation_id, subaccount_id)` per contract (v) (lock → `blocked` with `blockedReason: 'concurrent_execute'`).
4. Timeout budget remaining: `action.metadata_json.timeoutBudgetMs ?? DEFAULT_ADAPTER_TIMEOUT_MS`. If the previous retry burned the budget, → `blocked` with `blockedReason: 'timeout_budget_exhausted'`.

The four preconditions live in the execution engine, not the adapter — the adapter's job is the provider-layer work. The engine's `executionLayerService.executeAction()` is the single caller; it runs the `checkPreconditions()` gate before dispatching through `adapterRegistry`. (An earlier working name for this caller was `executeApprovedActionsJob` — the execution-layer service is where the logic landed.)

### §2.7 Files — Phase 6.1 additions

| Path | Change | Shipped |
|------|--------|---------|
| `server/services/adapters/apiAdapter.ts` | **REWRITE** — from Phase-1A stub to real dispatcher; 5 endpoint branches; retry-classifier consumption; structured logging. | yes |
| `server/services/adapters/apiAdapterClassifierPure.ts` | **NEW** — pure `classifyAdapterOutcome` function. | yes |
| `server/services/adapters/ghlEndpoints.ts` | **NEW** — the 5 endpoint mappings (URL template + method + required fields). | yes |
| `server/services/adapters/__tests__/apiAdapterClassifierPure.test.ts` | **NEW** — 10 cases covering each classification branch. | yes |
| `server/services/adapters/__tests__/apiAdapter.integration.test.ts` | **NEW** — integration test against a mocked GHL sandbox. | **deferred** — nock-based integration tests are outside the static-gates + pure-function testing posture (`docs/spec-context.md`). Coverage ships via the pure classifier + typecheck baseline. |
| `server/services/executionLayerService.ts` | **MODIFY** — `checkPreconditions()` + `executeAction()` implement the §2.6 four precondition checks; dispatch through `adapterRegistry`; consume the adapter's `ExecutionResult` discriminated union. (Spec's earlier working name `executeApprovedActionsJob.ts` did not survive — precondition-gate logic lives in the execution-layer service.) | yes |
| `server/services/ghlOAuthService.ts` | **MODIFY (audit at kickoff)** — confirm `getValidToken(orgId)` exists with refresh-on-expire semantics. | **deferred** — adapter reads `integration_connections.access_token` directly; refresh-on-expire wiring deferred to Session 3. |
| `server/config/limits.ts` | **MODIFY** — add `DEFAULT_ADAPTER_TIMEOUT_MS = 30_000` constant. | yes |

### §2.8 Open questions for §2

1. **Per-endpoint payload validation.** The adapter re-validates the payload shape against a zod schema keyed by `actionType` before the dispatch. This is defence-in-depth — the proposer already validates — but catches a corrupted-metadata scenario. Should the per-endpoint zod schemas live in `apiAdapter.ts` (co-located with dispatch) or next to the primitive's `*ServicePure.ts` (co-located with validation)? **Recommended default:** next to the primitive (e.g. `crmFireAutomationServicePure.ts` already exports `validateFireAutomationPayload`); the adapter imports and calls each.

2. **Audit the execution engine's concurrency model.** Contract (v) pins "PG advisory lock per subaccount for serial execute." Verify at chunk kickoff that `executionLayerService.executeAction` takes the lock (it does per Phase 4 ship-gates, but Session 2 is the first session that exercises real external side effects under that lock — worth confirming).

---

---

## §3. Phase 6.2 — live-data pickers + editor modal rewire

### §3.1 The problem being solved

The 5 intervention editor components shipped in Phase 4 accept free-text IDs for automation workflows, contacts, assignee users, from-addresses, and from-numbers. Pilot operators won't know these IDs by heart — the UX needs searchable pickers backed by live GHL data. All 5 mockups on the branch already show the target design.

### §3.2 New read-only adapter endpoints

Five new subaccount-scoped GET endpoints. Auth: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`. All take a `?q=<search>` parameter for prefix matching and return capped result sets (50 rows max, per spec-consistent defence-in-depth cap matching Session 1's `listConversations` cap).

| Route | Purpose | Response shape |
|-------|---------|----------------|
| `GET /api/clientpulse/subaccounts/:id/crm/automations?q=<search>` | List available workflow automations for the `crm.fire_automation` picker | `[{ id, name, status, lastRunAt? }]` |
| `GET /api/clientpulse/subaccounts/:id/crm/contacts?q=<search>` | List contacts for the email / SMS / task pickers | `[{ id, firstName, lastName, email?, phone?, tags? }]` |
| `GET /api/clientpulse/subaccounts/:id/crm/users?q=<search>` | List GHL users for the task `assigneeUserId` picker | `[{ id, firstName, lastName, email, role? }]` |
| `GET /api/clientpulse/subaccounts/:id/crm/from-addresses` | List authorised email-send-from addresses for the org | `[{ address, displayName?, verified: boolean }]` |
| `GET /api/clientpulse/subaccounts/:id/crm/from-numbers` | List authorised SMS-send-from numbers for the subaccount | `[{ phoneE164, capabilities: ('sms'\|'voice')[], labelled?: string }]` |

Contract (l) applies to inbound fields that these routes accept for filtering — `actionType`-shaped params should route through `resolveActionSlug` if any appear, but the routes above only accept search strings + no action-type filters, so the contract is structurally satisfied without per-route code.

### §3.3 Service layer

**New file: `server/services/crmLiveDataService.ts`.**

Each endpoint maps to a service method that calls into a new GHL adapter read helper:

```typescript
export const crmLiveDataService = {
  async listAutomations(subaccountId: string, orgId: string, search?: string): Promise<CrmAutomation[]>;
  async listContacts(subaccountId: string, orgId: string, search?: string): Promise<CrmContact[]>;
  async listUsers(subaccountId: string, orgId: string, search?: string): Promise<CrmUser[]>;
  async listFromAddresses(subaccountId: string, orgId: string): Promise<CrmFromAddress[]>;
  async listFromNumbers(subaccountId: string, orgId: string): Promise<CrmFromNumber[]>;
};
```

The service:

- Resolves the subaccount's GHL `locationId` via `canonicalSubaccountScopes` (existing table).
- Fetches the OAuth token via `ghlOAuthService.getValidToken(orgId)`.
- Calls GHL's REST API against the resolved location.
- Normalises the response shape (GHL returns `firstName`, some use `name` — we canonicalise).
- Caches results in Redis for 60 seconds keyed on `(orgId, subaccountId, endpoint, searchQuery)` to avoid hammering GHL on every keystroke in the picker.

### §3.4 Client-side picker component

**New: `client/src/components/clientpulse/pickers/LiveDataPicker.tsx`.**

A reusable searchable-dropdown component:

```typescript
interface LiveDataPickerProps<T> {
  endpoint: string;                                      // e.g. '/api/clientpulse/subaccounts/abc/crm/contacts'
  queryParam?: string;                                   // defaults to 'q'
  renderItem: (item: T) => React.ReactNode;
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  onSelect: (item: T) => void;
  placeholder?: string;
  preloadOnFocus?: boolean;                              // for endpoints without search (from-addresses, from-numbers)
}
```

Behaviour:

- Debounced search (200ms) before hitting the endpoint.
- Keyboard nav: ↑/↓ through results, Enter to select, Esc to close.
- Loading spinner during fetch; empty state when results are empty; error banner on failure.
- `preloadOnFocus=true` variant loads the full set on open for small finite sets (from-addresses, from-numbers).

### §3.5 Editor modal rewires

Each of the 5 editors currently has a free-text `<input>` for its ID field. Replace with `<LiveDataPicker>`:

| Editor | Picker fields |
|--------|---------------|
| `FireAutomationEditor` | 1 picker: `automationId` (calls `/crm/automations`) |
| `EmailAuthoringEditor` | 2 pickers: `contactId` (calls `/crm/contacts`), `fromAddress` (calls `/crm/from-addresses` with `preloadOnFocus`) |
| `SendSmsEditor` | 2 pickers: `contactId`, `fromNumber` (calls `/crm/from-numbers` with `preloadOnFocus`) |
| `CreateTaskEditor` | 2 pickers: `contactId`, `assigneeUserId` (calls `/crm/users`) |
| `OperatorAlertEditor` | 0 pickers — the recipients field already uses an internal user picker that's not CRM-backed. No change in this chunk. |

Removed: every `<input type="text">` for ID fields; the free-text fallback disappears. Operators can still paste an ID into the search box and the picker will match-and-select (deliberate UX — power users can skip the dropdown).

### §3.6 Files — Phase 6.2 additions

| Path | Change |
|------|--------|
| `server/routes/clientpulseInterventions.ts` | **MODIFY** — add the 5 new GET routes. |
| `server/services/crmLiveDataService.ts` | **NEW** — orchestration + normalisation. |
| `server/services/adapters/ghlReadHelpers.ts` | **NEW** — low-level GHL read calls (list-automations, list-contacts, list-users, list-from-addresses, list-from-numbers). |
| `client/src/components/clientpulse/pickers/LiveDataPicker.tsx` | **NEW** — reusable picker. |
| `client/src/components/clientpulse/FireAutomationEditor.tsx` | **MODIFY** — use LiveDataPicker. |
| `client/src/components/clientpulse/EmailAuthoringEditor.tsx` | **MODIFY** — 2 pickers. |
| `client/src/components/clientpulse/SendSmsEditor.tsx` | **MODIFY** — 2 pickers. |
| `client/src/components/clientpulse/CreateTaskEditor.tsx` | **MODIFY** — 2 pickers. |

### §3.7 Caching + rate-limit posture

GHL's REST API is rate-limited per location. The 60-second Redis cache mitigates this, but the picker also needs a backoff if GHL returns 429:

- `crmLiveDataService` catches 429 responses, returns `{ rateLimited: true, retryAfterSeconds: <value> }`.
- `LiveDataPicker` surfaces a "Too many requests — please retry in N seconds" banner and disables the input until the window elapses.
- No action auto-retries on 429 — this is a human-driven picker, not an automated dispatch.

### §3.8 Open questions for §3

1. **Debounce window.** 200ms is a reasonable default but could be tuned to 300–500ms if GHL's API is slow. Resolve at kickoff by timing a typical response.
2. **Max-result cap.** 50 rows per picker. If operators have orgs with >50 contacts matching a prefix, the picker needs a "show more" affordance. Cap is documented; implementation is "load 50, show 'showing first 50 matches'" footer. Deferred to post-pilot if feedback requires.

---

---

## §4. Phase 6.3 — per-client drilldown page (minimal scope)

### §4.1 Scope decision (Q5 locked)

Per §14 Q5: **minimal scope** for Session 2. The drilldown ships:

- Intervention history (table) with outcome badges
- Latest signal panel (top signals contributing to current risk score)
- Band transitions (last 90 days) — `BandTransitionsTable` over the `client_pulse_churn_assessments` history
- "Open Configuration Assistant" contextual trigger (seeded with subaccount-aware prompt)
- "Propose intervention" button (opens the existing `ProposeInterventionModal` scoped to this subaccount)

Deferred to post-pilot (not in Session 2):

- Segmented outcome charts (success rate by template over time)
- Signal-overlay timeline (health score + signal contributions on one timeline)
- Custom intervention-type filters
- Per-action drill-into (click a history row → full action detail page)

Rationale: pilot operators haven't used a drilldown surface yet. Ship what's structurally required (history + signal panel + contextual triggers) and let real usage shape the rich surfaces post-pilot.

### §4.2 Route + page structure

Route: `/clientpulse/clients/:subaccountId` — authenticated, `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`.

Page layout:

```
┌──────────────────────────────────────────────────────────┐
│  Header: <SubaccountName>   • Band: atRisk    [Propose]  │
│          Health score: 38 (↓4 in 7d)                     │
│                                  [Open Config Assistant] │
├──────────────────────────────────────────────────────────┤
│  Signal Panel                                            │
│  • Top signals contributing to score                     │
│  • Last updated timestamp                                │
├──────────────────────────────────────────────────────────┤
│  Band Transitions (last 90d)                             │
│  • Simple table: from → to, at <timestamp>               │
├──────────────────────────────────────────────────────────┤
│  Intervention History                                    │
│  • Table: actionType | proposed_at | status | outcome    │
│  • Outcome badge: +Δ healthy, -Δ at-risk, band changed   │
│  • Row click → action detail modal (read-only)           │
└──────────────────────────────────────────────────────────┘
```

### §4.3 API endpoints

Three new read endpoints + one existing endpoint re-used:

| Route | Purpose | Returns |
|-------|---------|---------|
| `GET /api/clientpulse/subaccounts/:id/drilldown-summary` | Header fields (band, health score, delta) | `{ band, healthScore, healthScoreDelta7d, lastAssessmentAt }` |
| `GET /api/clientpulse/subaccounts/:id/signals` | Latest signal panel | `{ signals: [{ slug, contribution, label, lastSeenAt }], lastUpdatedAt }` |
| `GET /api/clientpulse/subaccounts/:id/band-transitions?windowDays=90` | Band transition table | `{ transitions: [{ fromBand, toBand, changedAt, triggerReason? }] }` |
| `GET /api/clientpulse/subaccounts/:id/interventions?limit=50` | Intervention history table | `{ interventions: [{ actionId, actionType, proposedAt, executedAt, status, outcome? }] }` |

Intervention history query is a read-side view over `actions` + `intervention_outcomes` left-joined, filtered to the 5 intervention `actionType` values, scoped to the subaccount.

### §4.4 Outcome-badge derivation (pure)

**New file: `server/services/drilldownOutcomeBadgePure.ts`.**

```typescript
export type OutcomeBadge =
  | { kind: 'band_improved'; fromBand: string; toBand: string }
  | { kind: 'band_worsened'; fromBand: string; toBand: string }
  | { kind: 'score_improved'; delta: number }
  | { kind: 'score_worsened'; delta: number }
  | { kind: 'neutral' }
  | { kind: 'pending'; reason: 'no_snapshot' | 'window_open' | 'operator_alert_no_signal' }
  | { kind: 'failed' };

export function deriveOutcomeBadge(
  action: { status: string; actionType: string },
  outcome: { bandBefore?: string; bandAfter?: string; scoreDelta?: number; executionFailed?: boolean } | null,
): OutcomeBadge;
```

Pure test file `drilldownOutcomeBadgePure.test.ts` — ~10 cases covering each badge shape + `notify_operator` no-signal branch + the execution-failed branch.

### §4.5 Contextual "Open Configuration Assistant" trigger

Per Session 1 contract (k): the popup opens from any page via `useConfigAssistantPopup().openConfigAssistant(prompt)`. Drilldown's button calls with a subaccount-aware prompt:

```typescript
const prompt = `I'm looking at ${subaccount.name}. Their current band is ${band} and health score is ${healthScore}. What operational-config adjustments should I consider?`;
openConfigAssistant(prompt);
```

### §4.6 Files — Phase 6.3 additions

| Path | Change |
|------|--------|
| `server/routes/clientpulseDrilldown.ts` | **NEW** — 4 new GET routes (summary, signals, band-transitions, interventions). |
| `server/services/drilldownService.ts` | **NEW** — orchestration; reads from `client_pulse_health_snapshots`, `client_pulse_churn_assessments`, `actions`, `intervention_outcomes`. |
| `server/services/drilldownOutcomeBadgePure.ts` | **NEW** — pure badge derivation. |
| `server/services/__tests__/drilldownOutcomeBadgePure.test.ts` | **NEW** — ~10 cases. |
| `client/src/pages/ClientPulseDrilldownPage.tsx` | **NEW** — the page. |
| `client/src/components/clientpulse/drilldown/SignalPanel.tsx` | **NEW** — signal panel card. |
| `client/src/components/clientpulse/drilldown/BandTransitionsTable.tsx` | **NEW** — transitions table. |
| `client/src/components/clientpulse/drilldown/InterventionHistoryTable.tsx` | **NEW** — history table with outcome badges. |
| `client/src/components/clientpulse/drilldown/OutcomeBadge.tsx` | **NEW** — renders each `OutcomeBadge` shape. |
| `client/src/App.tsx` | **MODIFY** — register the `/clientpulse/clients/:subaccountId` route. |
| `client/src/pages/ClientPulseDashboardPage.tsx` | **MODIFY** — high-risk client rows deep-link into the drilldown via `/clientpulse/clients/:subaccountId`. |
| `server/index.ts` | **MODIFY** — register `clientpulseDrilldownRouter`. |

### §4.7 Resolutions

1. **Band-transition window.** Default 90 days, configurable via query param. Pilot can tune; no config surface for this (not operationally interesting beyond the default).
2. **Outcome-badge "pending" window.** An intervention proposed < `measurementWindowHours` ago (default 24h) shows `pending` badge. After the window, if no snapshot exists → `pending: no_snapshot`; otherwise the real badge derives.
3. **Intervention-history pagination.** First 50 rows; "load more" button appends the next 50. No virtualised list (pilot scale doesn't require it).

---

---

## §5. Phase 8.1 — outcome-weighted `recommendedActionType`

### §5.1 The problem being solved

`buildInterventionContext` (shipped in Phase 4) sets `recommendedActionType` to the highest-priority eligible template. That's a reasonable default when no outcome data exists, but once the system accumulates `intervention_outcomes` rows per org per template per band, the recommendation should reflect what actually worked — not just what was prioritised highest in the config.

### §5.2 The decision rule (pure)

**New file: `server/services/recommendedInterventionPure.ts`.**

```typescript
export interface OutcomeAggregate {
  templateSlug: string;
  bandBefore: string;
  trials: number;                // count of intervention_outcomes rows
  improvedCount: number;         // rows where bandChanged=true && not execution_failed
  avgScoreDelta: number;         // mean score delta where signal exists
}

export interface TemplateCandidate {
  slug: string;
  priority: number;              // from operational_config.interventionTemplates
  actionType: string;
}

export function pickRecommendedTemplate(params: {
  candidates: TemplateCandidate[];        // templates eligible in the current band
  outcomes: OutcomeAggregate[];           // aggregated per (templateSlug, bandBefore)
  currentBand: string;
  minTrialsForOutcomeWeight: number;      // default 5 — below this, falls back to priority
}): { pickedSlug: string; reason: 'outcome_weighted' | 'priority_fallback' | 'no_candidates' };
```

Rules (pure, no I/O):

1. **No candidates:** return `{ pickedSlug: '', reason: 'no_candidates' }`. Caller decides how to surface (currently: `recommendedActionType = null`).
2. **Sparse data (all candidates' trials < `minTrialsForOutcomeWeight`):** pick the highest-priority candidate. Tie-break on lexicographic slug. Return `reason: 'priority_fallback'`.
3. **Outcome-weighted:** for each candidate with trials ≥ N, compute a score = `(improvedCount / trials) * 100 + avgScoreDelta`. Tie-break on trials descending, then priority, then slug. Candidates with < N trials participate at their priority rank but lose to any candidate with sufficient outcome data. Return `reason: 'outcome_weighted'`.

The pure function accepts pre-aggregated outcomes — the DB query that aggregates them lives in `interventionContextService.ts`.

### §5.3 Data source

Aggregated from `intervention_outcomes` rows for `(organisation_id = orgId, subaccount_id = subId OR null for org-level, intervention_type_slug = template.actionType, band_before = currentBand)`. The aggregation query lives in `interventionContextService.ts`:

```sql
SELECT
  template_slug,
  band_before,
  COUNT(*) AS trials,
  SUM(CASE WHEN band_changed AND NOT execution_failed THEN 1 ELSE 0 END) AS improved_count,
  AVG(score_delta) FILTER (WHERE score_delta IS NOT NULL) AS avg_score_delta
FROM intervention_outcomes
WHERE organisation_id = $1
  AND band_before = $2
GROUP BY template_slug, band_before;
```

The `template_slug` column already exists on `intervention_outcomes` per Phase 4.5 schema; `band_before` + `band_changed` + `execution_failed` were added in migration 0178. `score_delta` column: **audit at chunk kickoff** — if missing, add in the Session 2 schema migration. Pre-recommendation: assume present (Phase 4 shipped it per the B2 ship gate); confirm at kickoff.

### §5.4 Integration point

`server/services/clientPulseInterventionContextService.ts` — `buildInterventionContext()`:

Before (Phase 4):
```typescript
const eligible = templates.filter((t) => t.targets.includes(currentBand));
const recommendedActionType = eligible[0]?.actionType ?? null;
```

After (Session 2):
```typescript
const eligible = templates.filter((t) => t.targets.includes(currentBand));
const outcomes = await aggregateOutcomesByTemplate(orgId, currentBand);
const picked = pickRecommendedTemplate({
  candidates: eligible.map((t) => ({ slug: t.slug, priority: t.priority, actionType: t.actionType })),
  outcomes,
  currentBand,
  minTrialsForOutcomeWeight: 5,
});
const recommendedActionType = picked.pickedSlug
  ? eligible.find((t) => t.slug === picked.pickedSlug)?.actionType ?? null
  : null;
const recommendedReason = picked.reason;
```

`recommendedReason` lands on the response body so the `ProposeInterventionModal` can show "Recommended (outcome-weighted)" vs "Recommended (priority fallback)" — transparency for operators.

### §5.5 Config knob

`operationalConfig.interventionDefaults.minTrialsForOutcomeWeight: number` — a new non-sensitive leaf defaulting to 5. Non-sensitive: changing it doesn't compromise governance, operators can tune. Added to the `ALLOWED_CONFIG_ROOT_KEYS` + Session 1 Settings-page editor for `interventionDefaults`.

### §5.6 Files — Phase 8.1 additions

| Path | Change |
|------|--------|
| `server/services/recommendedInterventionPure.ts` | **NEW** — pure decision function. |
| `server/services/__tests__/recommendedInterventionPure.test.ts` | **NEW** — ~8 cases covering each branch (no candidates, sparse, outcome-weighted, tie-breaks). |
| `server/services/clientPulseInterventionContextService.ts` | **MODIFY** — add `aggregateOutcomesByTemplate`; consume `pickRecommendedTemplate`; surface `recommendedReason` on the response. |
| `server/services/operationalConfigSchema.ts` | **MODIFY** — add `minTrialsForOutcomeWeight` leaf (default 5) to the `interventionDefaults` block. |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | **MODIFY** — render "Recommended (outcome-weighted)" vs "Recommended (priority fallback)" badge next to the suggested action. |

### §5.7 Resolutions

1. **Subaccount-scoped vs org-scoped aggregation.** Aggregate at org level (subaccount_id = null OR specific subaccount). Rationale: pilot-scale data volume — a single subaccount rarely has 5+ outcome rows for a given template/band combination; org-level aggregation gets signal faster. Document on the spec; pilot can tune if signals turn out too noisy.
2. **`score_delta` sign convention.** Positive = improvement (score went up). Align with existing `intervention_outcomes.score_delta` column semantics.
3. **Staleness window.** No staleness filter in Session 2 — all outcomes for the org/band combo aggregate. Post-pilot addition: "outcomes from the last 90 days only" becomes a tunable.

---

---

## §6. Phase 8.2 — Configuration Assistant dual-path UX copy (B6)

### §6.1 The problem being solved

Today's Configuration Assistant shows the same "Applied" confirmation copy whether a config change hit the review queue (sensitive path) or committed inline (non-sensitive path). Operators need to see the difference — a sensitive change is pending approval and hasn't taken effect yet; a non-sensitive change is already live.

This closes ship gate **B6** (Configuration Assistant dual-path UX copy) from the original `clientpulse-ghl-gap-analysis.md` spec.

### §6.2 The two response shapes + copy

The `applyOrganisationConfigUpdate` service already returns a discriminated union with two relevant branches:

| Service response | Chat copy | Affordances |
|------------------|-----------|-------------|
| `{ committed: true, configHistoryVersion, classification: 'non_sensitive' }` | **"Applied."** Followed by: "`<path>` is now `<new value>`. This change is live and recorded as `config_history` version `<n>`." | Link: "View history →" → `/admin/config-history?entityType=organisation_operational_config&entityId=<orgId>`. No approve/reject buttons. |
| `{ committed: false, actionId, classification: 'sensitive', requiresApproval: true }` | **"Sent to review queue."** Followed by: "This is a sensitive config change — `<path>` requires operator approval before it takes effect. Your proposal is queued as action `<actionId-slice(0,8)>`. Approve it from the review queue to apply." | Link: "Open review queue →" → `/admin/review-queue?focus=<actionId>`. No "Applied" banner. |
| `{ committed: false, errorCode: ... }` | **"Couldn't apply this change."** Followed by the error message from the service. | Retry button; link to the Settings page for manual editing. |

### §6.3 Client-side rendering

The Configuration Assistant page already renders tool-result messages per message type. Extend the tool-result renderer for `config_update_organisation_config` to:

1. Inspect the JSON body of the tool result.
2. Branch on `committed` + `classification`.
3. Render the matching copy block + affordances.

**New file: `client/src/components/config-assistant/toolResultRenderers/ConfigUpdateToolResult.tsx`.**

```typescript
interface Props {
  result: unknown;  // the raw JSON from the tool-result message
}

export default function ConfigUpdateToolResult({ result }: Props) {
  const parsed = parseConfigUpdateResult(result);
  switch (parsed.kind) {
    case 'applied_inline': return <AppliedInlineBlock {...parsed} />;
    case 'queued_for_review': return <QueuedForReviewBlock {...parsed} />;
    case 'error': return <ErrorBlock {...parsed} />;
    case 'unknown': return <JsonFallback value={result} />;
  }
}
```

Pure parser `parseConfigUpdateResult` lives in the same file's internal helper (or as a tiny `parseConfigUpdateToolResultPure.ts` if we want to test-lock it — **recommended:** test-lock it, since the result shape is the public contract).

### §6.4 Parser — no client-side unit test

Per the project's testing posture (`docs/spec-context.md`: `frontend_tests: none_for_now`), the `parseConfigUpdateToolResult` helper does not get a pure-function unit-test file. The parser rules are enforced by TypeScript's discriminated-union exhaustiveness check. **Shipped:** the parser is exported from `ConfigUpdateToolResult.tsx` alongside the renderer (rather than in a separate `client/src/lib/` module), which keeps the parser-renderer contract co-located.

### §6.5 Server-side: classification already surfaced

No server changes needed for §6. `applyOrganisationConfigUpdate` already returns the discriminated union with the right shape. §6 is client-only.

### §6.6 Files — Phase 8.2 additions

| Path | Change |
|------|--------|
| `client/src/components/config-assistant/toolResultRenderers/ConfigUpdateToolResult.tsx` | **NEW** — renderer + internal parser. |
| `client/src/pages/ConfigAssistantPage.tsx` | **MODIFY** — when the tool-result message's `tool === 'config_update_organisation_config'`, render via `<ConfigUpdateToolResult>` instead of the generic JSON renderer. |

### §6.7 Resolutions

1. **What if the service returns a shape the renderer doesn't recognise?** Fall back to the JSON view — better than a blank card. Logged via `console.warn` so we catch shape drift in dev.
2. **Does the popup need a separate renderer?** No — the popup embeds the page (or the panel post-D.3), so the renderer runs inside the page's message list either way.

---

---

## §7. Phase 8.3 — `notify_operator` channel fan-out

### §7.1 The problem being solved

`notify_operator` (the Session-1-renamed platform primitive) acknowledges approval at execute-time but defers actual channel delivery to "a future phase" (per `skillExecutor.ts` line 93's current stub: `return { queued: true, channels: payload.channels };`). Pilot operators need alerts to actually arrive in-app, email, and Slack.

### §7.2 Kickoff audit (Q3 locked → audit-then-ship)

Per §14 Q3: at chunk kickoff, audit the existing notifications worker(s) to determine which of the three channels already have delivery paths. Specifically:

| Channel | Audit question | If present | If missing |
|---------|----------------|-----------|-----------|
| In-app | Does a `notifications` table + UI read surface exist? (Likely yes — the review-queue already surfaces notifications.) | Consume. | Unlikely to be missing; flag as blocker if so. |
| Email | Does `emailService.sendTransactional` exist + is it wired to a provider (SES, Resend, SendGrid)? | Consume. | Add thin wrapper around the existing invite-email infrastructure (`organisationService` uses it for invites). |
| Slack | Does any existing Slack integration exist? (Session 1 audit found `slackConversations` table + `users.slack_user_id` column — conversation surface exists but fan-out is TBD.) | Consume. | Build minimal path: POST to Slack webhook per configured org-level Slack integration. |

The audit happens at chunk kickoff; findings land on the chunk's work list. If all three channels already work, the chunk collapses to verification + the fan-out orchestrator.

### §7.3 The fan-out orchestrator

**New file: `server/services/notifyOperatorFanoutService.ts`.**

```typescript
export interface FanoutResult {
  channel: 'in_app' | 'email' | 'slack';
  status: 'delivered' | 'skipped_not_configured' | 'failed';
  errorMessage?: string;
}

export async function fanoutOperatorAlert(params: {
  organisationId: string;
  subaccountId: string | null;
  actionId: string;
  payload: OperatorAlertPayload;   // validated already at proposal-time
}): Promise<FanoutResult[]>;
```

Behaviour:

1. Resolve the recipient user IDs from `payload.recipients` (preset like `on_call` or explicit `userIds`).
2. For each requested channel in `payload.channels`:
   - Check org's availability for that channel (via `getAvailableChannels(orgId)`).
   - If available → dispatch.
   - If unavailable → record `skipped_not_configured`.
3. Return the array of per-channel results. Caller (the action handler) records this on `actions.metadata_json.fanoutResults` for audit.

The orchestrator is called from the `notify_operator` approval-execute path in `skillExecutor.ts`:

```typescript
case 'notify_operator': {
  const { fanoutOperatorAlert } = await import('./notifyOperatorFanoutService.js');
  const results = await fanoutOperatorAlert({
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    actionId: (ctx as unknown as { actionId?: string }).actionId ?? '',
    payload,
  });
  return { queued: true, channels: payload.channels, fanoutResults: results };
}
```

### §7.4 Channel adapters

Three thin adapters in `server/services/notifyOperatorChannels/`:

| Path | Purpose |
|------|---------|
| `inAppChannel.ts` | Originally specified as INSERT into `notifications` (one row per recipient). **Shipped behaviour:** returns `skipped_not_configured` with `recipientCount: 0` — no INSERT. The review-queue row written upstream in the propose → approve → execute chain serves as the interim in-app surface; per-user notification writes + WebSocket push deferred to Session 3. |
| `emailChannel.ts` | Call `emailService.sendTransactional({ to, subject, body })`. Subject = `payload.title`; body = `payload.message` + a link to the review queue. |
| `slackChannel.ts` | POST to the org's configured Slack webhook. **Shipped behaviour:** webhook URL read from `organisations.settings.slackWebhookUrl`; `organisationSecrets` path deferred. Payload shape: Slack blocks with title + message + link. |

Channel availability lookup:

```typescript
export async function getAvailableChannels(orgId: string): Promise<{ inApp: true; email: boolean; slack: boolean }> {
  // In-app is always available — the notifications table is universal.
  const emailAvailable = await isEmailConfigured(orgId);  // check org's from-address config
  const slackAvailable = await isSlackConfigured(orgId);  // check organisations.settings.slackWebhookUrl
  return { inApp: true, email: emailAvailable, slack: slackAvailable };
}
```

**Shipped note:** `deriveChannelAvailability` in `availabilityPure.ts` resolves email availability from `organisations.settings.emailFromAddress` and Slack availability from `organisations.settings.slackWebhookUrl`. The `organisationSecrets` path originally imagined for Slack did not land.

### §7.5 Files — Phase 8.3 additions

| Path | Change |
|------|--------|
| `server/services/notifyOperatorFanoutService.ts` | **NEW** — orchestrator. |
| `server/services/notifyOperatorChannels/inAppChannel.ts` | **NEW (placeholder stub)** — returns `skipped_not_configured`; INSERT-into-`notifications` implementation deferred to Session 3 (see §7.4 Shipped behaviour). |
| `server/services/notifyOperatorChannels/emailChannel.ts` | **NEW (thin wrapper)** — calls existing `emailService`. |
| `server/services/notifyOperatorChannels/slackChannel.ts` | **NEW** — Slack webhook POST. |
| `server/services/notifyOperatorChannels/availabilityPure.ts` | **NEW** — pure helpers for channel-availability derivation from config + secrets. |
| `server/services/skillExecutor.ts` | **MODIFY** — the `notify_operator` case calls `fanoutOperatorAlert`, returns fan-out results. |
| `server/services/__tests__/notifyOperatorFanoutServicePure.test.ts` | **NEW** — pure tests for channel-selection + skip-when-unavailable + result-aggregation logic. ~8 cases. |

### §7.6 Resolutions

1. **Failure semantics.** A per-channel failure does NOT fail the whole fan-out. Results are recorded in `actions.metadata_json.fanoutResults`; operators can see which channels delivered via the drilldown's action detail (or the review-queue detail view).
2. **Retries.** Each channel has its own retry posture. In-app insert rarely fails; email uses `emailService`'s existing retry; Slack webhook POSTs do NOT retry in Session 2 (deferred if pilot feedback shows Slack flakiness).
3. **Preset recipient groups.** `payload.recipients.kind === 'preset'` with `value: 'on_call'` was originally specified to resolve to "users with on-call role for this org." **Shipped behaviour:** the on-call role audit deferred; the `on_call` preset currently falls back to all org members. Revisit when a dedicated on-call role (or flag on existing roles) is defined.

---

---

## §8. Phase 8.4 — typed `InterventionTemplatesEditor`

### §8.1 The problem being solved

Session 1 shipped `InterventionTemplatesJsonEditor` — a raw JSON textarea with server-side schema validation. That's fine for power users but risky for the median operator: a missed comma is a save-time error, and there's no discoverability for the field set. Pilot needs a typed form editor.

### §8.2 Field inventory

From `operationalConfigSchema.ts` + the Phase 4 intervention-template shape, each template has:

| Field | Type | Editor widget |
|-------|------|---------------|
| `slug` | string (slug-cased, unique within templates array) | Text input with slugify-on-blur + uniqueness check |
| `label` | string (human-readable) | Text input |
| `description` | string (optional) | Textarea |
| `gateLevel` | enum `'auto' \| 'review'` | Radio group |
| `actionType` | enum of 5 intervention primitives | Dropdown |
| `targets` | array of `'healthy' \| 'watch' \| 'atRisk' \| 'critical'` | Multi-select checkbox group |
| `priority` | int 0–100 | Number input |
| `measurementWindowHours` | int 1–168 | Number input |
| `defaultReason` | string | Text input |
| `payloadDefaults` | object (shape depends on `actionType`) | Nested sub-form, per-actionType (see §8.3) |

### §8.3 Per-actionType payloadDefaults sub-forms

The payload shape varies by `actionType`. Each has its own sub-editor:

| `actionType` | Default fields surfaced |
|--------------|-------------------------|
| `crm.fire_automation` | `workflowId?` (optional default), `scheduleHint` dropdown |
| `crm.send_email` | `subjectTemplate`, `bodyTemplate` (with merge-field picker), `fromAddress?` |
| `crm.send_sms` | `messageTemplate` (with merge-field picker), `fromNumber?` |
| `crm.create_task` | `titleTemplate`, `priority` dropdown, `dueInDays` number |
| `notify_operator` | `title`, `message`, `severity` dropdown, `channels` multi-select |

Merge-field picker (used in email/SMS sub-editors): a dropdown of supported merge tokens (`{{contact.firstName}}`, `{{subaccount.name}}`, `{{healthScore}}`, etc.) — populated from the existing `mergeFieldResolver` vocabulary. Operators click the chip; it inserts at the cursor position.

### §8.4 Editor component structure

**New: `client/src/components/clientpulse-settings/editors/InterventionTemplatesEditor.tsx`.**

List-of-templates UI:

```
┌───────────────────────────────────────────────────────────┐
│  Intervention Templates                                   │
│                                                   [+ Add] │
├───────────────────────────────────────────────────────────┤
│  □ check_in_healthy                        gateLevel: auto│
│    Notify on healthy → watch transition                   │
│    [Edit] [Duplicate] [Delete]                            │
├───────────────────────────────────────────────────────────┤
│  □ send_retention_email                 gateLevel: review │
│    Send retention email when churn risk peaks             │
│    [Edit] [Duplicate] [Delete]                            │
└───────────────────────────────────────────────────────────┘
```

Clicking "Edit" expands the row into the typed form with all the fields from §8.2 + the actionType-specific sub-form from §8.3. Save/Cancel at the bottom; dirty-state indicator.

Per-template save POSTs to `/api/organisation/config/apply` with `path: 'interventionTemplates'` + the full updated array (the Session 1 service does wholesale-array-replace on the `interventionTemplates` root, per spec §6.3). Since `interventionTemplates` is sensitive per the registry, the save routes through review queue — shown via the §6 dual-path UX.

### §8.5 Round-trip contract

**Critical invariant (ship gate S2-8.4):** every template loaded from `effective.interventionTemplates` must round-trip through the typed editor without data loss. Specifically:

- Fields unknown to the typed editor (shouldn't exist per schema, but defence-in-depth) are preserved verbatim in the save payload.
- Optional fields absent in the template are not materialised as `undefined` in the save payload (preserves sparse override semantics).
- Array order is preserved.

**New pure file: `client/src/components/clientpulse-settings/editors/interventionTemplateRoundTripPure.ts`.**

```typescript
export function serialiseTemplateForSave(template: TemplateFormState): InterventionTemplate;
export function deserialiseTemplateForEdit(template: InterventionTemplate): TemplateFormState;
```

Typescript enforces via discriminated unions on `actionType`. No pure-test file for client-side code per Session 1 convention; exhaustiveness check is the gate.

### §8.6 Replacing the Session 1 JSON editor

The Session 1 `InterventionTemplatesJsonEditor` stays in-tree as a fallback per-block — if the new typed editor fails to parse (should never happen but defence-in-depth), the block card offers a "Use JSON editor" toggle. After the pilot has validated the typed editor, the JSON fallback can be removed in a follow-up.

### §8.7 Files — Phase 8.4 additions

| Path | Change |
|------|--------|
| `client/src/components/clientpulse-settings/editors/InterventionTemplatesEditor.tsx` | **NEW** — main typed editor. |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/FireAutomationDefaultsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/SendEmailDefaultsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/SendSmsDefaultsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/CreateTaskDefaultsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/NotifyOperatorDefaultsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/MergeFieldPicker.tsx` | **NEW** — chip-insertion helper. |
| `client/src/components/clientpulse-settings/editors/interventionTemplateRoundTripPure.ts` | **NEW** — serialiser + deserialiser. |
| `client/src/pages/ClientPulseSettingsPage.tsx` | **MODIFY** — `interventionTemplates` block renders `<InterventionTemplatesEditor>` by default; "Use JSON editor" toggle preserves the Session 1 fallback. |

### §8.8 Resolutions

1. **Merge-field vocabulary source.** Original design: the typed editor would read the merge-field vocabulary from a new endpoint `GET /api/clientpulse/subaccounts/:id/merge-field-vocabulary` resolving to the Phase-4 `mergeFieldResolver`'s known tokens. **Shipped behaviour:** `MergeFieldPicker` uses a static token list checked into the component; the dynamic endpoint is deferred to Session 3. Pilot operators can propose new tokens via the Configuration Assistant.
2. **Template uniqueness validation.** `slug` must be unique within the array. Validated client-side on save + server-side (spec §2.6 — existing schema constraint).
3. **Default template seed.** New orgs inherit `interventionTemplates` from the adopted system template (spec §7.2 step 3). The typed editor's "Add" button creates an empty template with `actionType: 'crm.fire_automation'` as the default (most common pilot use case).

---

---

## §9. Phase 8.5 — per-block "Ask the assistant" deep-links

### §9.1 The problem being solved

Session 1 §10.7 deferred "per-block contextual deep-links" from the Settings page. Each of the 10 block cards should have an "Ask the assistant to change this" button that opens the Configuration Assistant popup seeded with a path-aware prompt.

Contract (j) is already in place — the Configuration Assistant and the Settings page are equal surfaces; this chunk just adds the second-surface entry point on the card level.

### §9.2 The button + seeded prompt

Per block card (10 total — the 9 non-template blocks from §11.2 + the `InterventionTemplatesEditor` from §8):

```
┌──────────────────────────────────────────────────┐
│  Alert limits              [overridden]  [Reset] │
│  Max alerts per run, per account per day…        │
│                      [Edit] [Ask the assistant →]│
├──────────────────────────────────────────────────┤
│  { alertLimits current JSON }                    │
└──────────────────────────────────────────────────┘
```

Clicking "Ask the assistant →" calls:

```typescript
const prompt = `I want to change the ${block.title.toLowerCase()} settings. The current values are:\n\n${JSON.stringify(effectiveValue, null, 2)}\n\nWhat should I consider?`;
openConfigAssistant(prompt);
```

### §9.3 Implementation

**Modify:** `client/src/pages/ClientPulseSettingsPage.tsx` — `BlockCard` component gets a new header button next to "Edit":

```tsx
<button onClick={() => openAssistantWithBlockContext(block, effectiveValue)}>
  Ask the assistant →
</button>
```

`openAssistantWithBlockContext` is a small helper imported from `client/src/lib/configAssistantPrompts.ts` (new):

```typescript
export function openAssistantWithBlockContext(
  block: { path: string; title: string },
  effectiveValue: unknown,
  openConfigAssistant: (prompt: string) => void,
): void;
```

Or — cleaner — the helper returns the prompt string; the component passes it directly to `openConfigAssistant`.

### §9.4 Files — Phase 8.5 additions

| Path | Change |
|------|--------|
| `client/src/pages/ClientPulseSettingsPage.tsx` | **MODIFY** — add "Ask the assistant" button to each `<BlockCard>` header. |
| `client/src/lib/configAssistantPrompts.ts` | **NEW** — small helper that builds the prompt from block + effective value. |

### §9.5 Resolutions

1. **Prompt shape is locked.** A consistent prompt shape across all 10 blocks makes the assistant's job easier (the agent learns the pattern). Don't let per-block prompts drift — the helper enforces consistency.
2. **Button placement.** Per-block header, right side. Not at the bottom of the card (bottom is reserved for Save/Cancel in edit mode).

---

---

## §10. Phase 8.6 — wizard scan-frequency + alert-cadence controls (deferred)

### §10.1 Shipped status — deferred to Session 3

Session 2 did **not** ship C.5. The authoring-time plan was to re-add scan-frequency + alert-cadence controls to wizard Screen 3 conditional on schema-field presence. At kickoff both schema fields were present (`scanFrequencyHours` + `alertLimits.*`), but the current `OnboardingWizardPage` Step 3 shows sync progress, not the config-defaults screen this chunk assumed; the assumed Screen-3 structure had diverged.

**Decision:** UI wiring deferred to Session 3. Schema remains ready — see `progress.md` "Deferred within Session 2" entry.

The §§10.2–10.5 material below is preserved as archived design intent for Session 3 pickup; it does not describe shipped code.

### §10.2 The wizard Screen-3 controls (if shipped)

Screen 3 of the onboarding wizard currently shows the churn-band cutoffs summary (per Session 1 §7.3 after iter-5 directional finding 5.1 dropped scan/alert controls). This chunk re-adds them:

```
  Screen 3 — Configure key defaults
  
  ┌── Churn bands ─────────────────────────────┐
  │  (existing summary view from Session 1)    │
  └────────────────────────────────────────────┘
  
  ┌── Scan frequency ──────────────────────────┐
  │  How often should ClientPulse pull signals?│
  │  ( ) Every 1 hour                          │
  │  (•) Every 4 hours (recommended)           │
  │  ( ) Every 12 hours                        │
  │  ( ) Every 24 hours                        │
  └────────────────────────────────────────────┘
  
  ┌── Alert cadence ───────────────────────────┐
  │  Max alerts sent per account per day       │
  │  [ 3 ]                                     │
  │                                            │
  │  Max alerts per scan run                   │
  │  [ 20 ]                                    │
  └────────────────────────────────────────────┘
```

The Scan frequency radio group writes `scanFrequencyHours: 4`.
The Alert cadence inputs write to `alertLimits.maxAlertsPerAccountPerDay` + `alertLimits.maxAlertsPerRun`.

### §10.3 Save behaviour

On Next:

- Only the fields the operator actually changed (dirty-leaf tracking) are POSTed to `/api/organisation/config/apply` — one POST per leaf.
- Non-sensitive paths (`scanFrequencyHours` if added non-sensitive) commit inline.
- Sensitive paths (`alertLimits.*` — already in the registry) queue for review. The wizard advances regardless; the operator resolves the queue later.

### §10.4 Files — Phase 8.6 additions (conditional)

| Path | Change |
|------|--------|
| `migrations/NNNN_operational_config_scan_frequency.sql` | **NEW (conditional)** — iff schema field missing + user authorises schema extension at kickoff. |
| `server/services/operationalConfigSchema.ts` | **MODIFY (conditional)** — add missing schema fields. |
| `client/src/pages/OnboardingWizardPage.tsx` | **MODIFY** — Screen 3 includes the two control blocks. |

### §10.5 Resolutions

1. **If schema extension is needed, is it in-scope?** Yes, if ≤ 20 LOC + one migration + one `ALLOWED_CONFIG_ROOT_KEYS` entry. Otherwise defer and flag as blocker. Document at kickoff audit output.
2. **Non-sensitive vs sensitive.** `scanFrequencyHours` is non-sensitive (changes frequency, not governance). `alertLimits.*` is sensitive (per Session 1 registry). Behaviour matches the existing Settings page.

---

---

## §11. Session 1 carry-forward

Four deliberately-deferred Session 1 items land in Session 2, grouped into D-chunks. Each closes a specific Session 1 deferral documented in `tasks/builds/clientpulse/progress.md`.

### §11.1 D.1 — Create-organisation modal rebuild + `createOrganisationFromTemplate` (minimal)

**Closes (partially):** Session 1 spec §7.1 + §7.2; Session 1 ship gate S1-7.1 (deferred portion).

#### §11.1.1 The server-side `createOrganisationFromTemplate` service method (shipped minimal)

**Shipped:** `organisationService.createOrganisationFromTemplate({ name, slug, plan, adminEmail, adminFirstName?, adminLastName?, systemTemplateId, templateSlug? })` exported from `server/services/organisationService.ts`. Name drift from original spec: spec drafted as `createFromTemplate`; implementation landed as `createOrganisationFromTemplate`.

**Shipped minimal behaviour (Chunk 10 + audit-commit `6705192` Fix 3):**

1. INSERT the `organisations` row with `applied_system_template_id = systemTemplateId`.
2. Leave `organisations.operational_config_override` as `NULL` — the effective config resolves via deep-merge with the system template's defaults.
3. Create the org-admin user row + invite email (existing organisation-creation path).
4. Write a `config_history` creation-event row: `entity_type = 'organisation_operational_config'`, `entity_id = <new organisationId>`, `change_source = 'system_sync'`, creation-event payload.

**Deferred to Session 3 (originally steps 3–4 of the full 6-step transaction):**

- `hierarchy_templates` row seed (default Subaccount Blueprint) with `operational_config_seed` populated from the template's `operational_defaults`.
- System-agent seeding (e.g. `portfolio-health-agent`) linked to the new org.

**Integration test (ship gate S2-D.1):** originally specified as `organisationServiceCreateFromTemplate.test.ts` (DB-fixture backed). Did not ship. The minimal service method is covered via typecheck + manual exercise; the full 4-invariant assertion set returns to scope with the remaining template-aware seeding.

#### §11.1.2 The client-side modal rebuild (deferred)

**Status:** deferred to Session 3. `client/src/pages/SystemOrganisationsPage.tsx` retains the Session 1 minimal create-org modal (`name` + `slug` fields). The target state below is archived design intent for Session 3:

- **Template picker cards.** Each card: template name + short description + agent count + blueprint count + operational-defaults summary + required integrations. Populated from `GET /api/system/organisation-templates`.
- **Tier toggle.** Radio group: Monitor / Operate / internal. Value stored on `organisations.tier`.
- **Live preview pane.** Right-hand pane updates on template selection.
- **Confirm button** calls `POST /api/organisations` (existing route; see §11.1.4) with `systemTemplateId` — minimum route branching landed in audit commit `6705192` Fix 3.

#### §11.1.3 Tier column (deferred — not shipped in Session 2)

Audit at Chunk 10 kickoff found `organisations.tier` missing. Per `progress.md` close-out and spec §14 Q1 deferral, the tier column is "consumed by future D6 tier-gating (deferred per §14 Q1)" — no migration in Session 2. When D6 tier-gating becomes in-scope, ship `tier text NOT NULL DEFAULT 'operate'` with `CHECK (tier IN ('monitor', 'operate', 'internal'))` alongside the modal rebuild.

#### §11.1.4 Files — D.1

| Path | Change | Shipped |
|------|--------|---------|
| `server/services/organisationService.ts` | **MODIFY** — add `createOrganisationFromTemplate` method (minimal: stamp + creation-event). | yes (audit commit `6705192` Fix 3 wired the POST route) |
| `server/routes/organisations.ts` | **MODIFY** — `POST /api/organisations` branches on `req.body.systemTemplateId` and routes through `createOrganisationFromTemplate` when present; backwards-compat path (no `systemTemplateId`) unchanged. | yes |
| `server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` | **NEW** — integration test per §11.1.1. | **deferred** |
| `migrations/NNNN_organisations_tier.sql` | **NEW (conditional)** — add `tier` column if missing. | **deferred** |
| `server/db/schema/organisations.ts` | **MODIFY (conditional)** — add `tier` field. | **deferred** |
| `client/src/pages/SystemOrganisationsPage.tsx` | **MODIFY** — extend create-org modal per §11.1.2. | **deferred** |

Note: the original spec also listed `server/routes/systemOrganisations.ts` as the route surface; the shipped route change actually landed on the already-existing `server/routes/organisations.ts` (`POST /api/organisations`).

### §11.2 D.2 — Typed Settings editors for 9 non-template blocks

**Closes:** Session 1 §6.2 (typed editors for every block except `InterventionTemplatesJsonEditor` which is §8's surface).

#### §11.2.1 The 9 blocks + their editors

Per Session 1 spec §6.2 editor inventory:

| Block | Editor component | Key fields |
|-------|------------------|------------|
| `healthScoreFactors` | `HealthScoreFactorsEditor` | Array of factor rows (metricSlug + label + weight slider + normalisation). Sum-validator: weights must sum to 1.0 ± 0.001. |
| `churnRiskSignals` | `ChurnRiskSignalsEditor` | Array of signal rows (slug + type enum + weight + condition + thresholds). |
| `churnBands` | `ChurnBandsEditor` | 4 band range pickers (healthy/watch/atRisk/critical) with 0–100 range sliders; overlap + gap check. |
| `interventionDefaults` | `InterventionDefaultsEditor` | Numeric inputs: cooldownHours, cooldownScope enum, defaultGateLevel enum, maxProposalsPerDayPerSubaccount, maxProposalsPerDayPerOrg, + §5's new `minTrialsForOutcomeWeight`. |
| `alertLimits` | `AlertLimitsEditor` | maxAlertsPerRun, maxAlertsPerAccountPerDay, batchLowPriority toggle. |
| `staffActivity` | `StaffActivityEditor` | countedMutationTypes array, excludedUserKinds multi-select, automationUserResolution (strategy + threshold + cacheMonths), lookbackWindowsDays, churnFlagThresholds. |
| `integrationFingerprints` | `IntegrationFingerprintsEditor` | seedLibrary read-only list + scanFingerprintTypes multi-select + unclassifiedSignalPromotion thresholds. |
| `dataRetention` | `DataRetentionEditor` | Per-resource retention days (nullable = unlimited). |
| `onboardingMilestones` | `OnboardingMilestonesEditor` | Array of milestone rows (slug + label + targetDays + signal). |

#### §11.2.2 Shared primitives

Each editor consumes the Session 1 shared primitives (`OverrideBadge`, `ManuallySetIndicator`, `ResetToDefaultButton`, `differsFromTemplate`). The `ProvenanceStrip` at the page level already works.

New shared primitive for array-type editors:

**New: `client/src/components/clientpulse-settings/shared/ArrayEditor.tsx`** — reusable add/remove/reorder row helper consumed by `HealthScoreFactorsEditor`, `ChurnRiskSignalsEditor`, `StaffActivityEditor`'s `countedMutationTypes`, `OnboardingMilestonesEditor`.

#### §11.2.3 Save behaviour

Each editor's Save button POSTs to `/api/organisation/config/apply` with `path: '<block-path>'` + the wholesale block value (per Session 1 spec §6.3 — replace-wholesale on block roots). Per-field edits within a block accumulate locally until Save.

Sum-constraint validation (healthScoreFactors weights sum to 1.0) runs client-side on blur + server-side on save. Client-side validation is convenience; server is the system-of-record.

#### §11.2.4 Files — D.2

One new file per editor (9 components) + the shared `ArrayEditor.tsx` + a `NormalisationFieldset.tsx` helper for the `healthScoreFactors` normalisation sub-form.

| Path | Change |
|------|--------|
| `client/src/components/clientpulse-settings/editors/HealthScoreFactorsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/ChurnRiskSignalsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/ChurnBandsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/InterventionDefaultsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/AlertLimitsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/StaffActivityEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/IntegrationFingerprintsEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/DataRetentionEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/editors/OnboardingMilestonesEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/shared/ArrayEditor.tsx` | **NEW** |
| `client/src/components/clientpulse-settings/shared/NormalisationFieldset.tsx` | **NEW** |
| `client/src/pages/ClientPulseSettingsPage.tsx` | **MODIFY** — per-block rendering picks the typed editor per `block.path`; JSON fallback toggle retained. |

### §11.3 D.3 — `<ConfigAssistantPanel>` extraction + 15-minute resume window (deferred)

**Status:** deferred to Session 3 (see `progress.md` "Chunks deferred within Session 2"). Spec §11.3.4 already noted that "Contract (k) is structurally honoured today" via the Session 1 URL-param plumbing, and the panel extraction is a ~500-line refactor of the `ConfigAssistantPage` message pipeline that the Session 2 scope could not absorb. The popup continues to iframe-wrap the full Configuration Assistant page and stamps `updatedAfter = now − 15min` into the iframe `src`, which the page forwards to `GET /api/agents/:id/conversations?updatedAfter=…&limit=1&order=updated_desc`. The effect on the operator is the same; the cleanup is cosmetic.

**Retained below as archived design intent for Session 3.** `ConfigAssistantPanel.tsx` does not exist in the shipped tree. `ConfigAssistantPopup.tsx` still mounts an iframe; `ConfigAssistantPage.tsx` still reads the `updatedAfter` URL param; `useConfigAssistantPopup.tsx` still plumbs the param through to the iframe src.

#### §11.3.1 Extract `<ConfigAssistantPanel>` from `ConfigAssistantPage`

Session 1's popup wrapped the full `ConfigAssistantPage` in an iframe to ship fast. The clean extraction lands here:

**New: `client/src/components/config-assistant/ConfigAssistantPanel.tsx`** — the extracted reusable child.

Props (per Session 1 spec §5.7):

```typescript
interface ConfigAssistantPanelProps {
  conversationId: string | null;
  initialPrompt?: string;
  onConversationReady?: (conversationId: string) => void;
  onPlanPreview?: (plan: PlanPreview) => void;
  onPlanComplete?: (summary: PlanSummary) => void;
  compactMode?: boolean;   // popup: true · page: false
}
```

The panel owns: chat message list rendering, the composer, session load, plan-preview-execute UX. It does NOT own: page-level nav chrome, the full-page route mount.

#### §11.3.2 Refactor `ConfigAssistantPage` to mount the panel

`client/src/pages/ConfigAssistantPage.tsx` collapses to a thin wrapper:

```tsx
export default function ConfigAssistantPage() {
  const { conversationId } = useParams();
  return (
    <div className="page-shell">
      <PageHeader title="Configuration Assistant" />
      <ConfigAssistantPanel conversationId={conversationId ?? null} compactMode={false} />
    </div>
  );
}
```

#### §11.3.3 Refactor `ConfigAssistantPopup` to mount the panel

`client/src/components/config-assistant/ConfigAssistantPopup.tsx` loses the iframe:

```tsx
export default function ConfigAssistantPopup() {
  const { open, initialPrompt, activeConversationId, closeConfigAssistant } = useConfigAssistantPopup();
  if (!open) return null;
  return (
    <div role="dialog" className="…">
      <div className="…">
        <Header onClose={closeConfigAssistant} />
        <ConfigAssistantPanel
          conversationId={activeConversationId}
          initialPrompt={initialPrompt}
          compactMode={true}
        />
      </div>
    </div>
  );
}
```

#### §11.3.4 Tighten the 15-minute resume window

**Status update (Session 1 close-out, commit `35519cd`):** Session 1 already enforces the 15-minute window via URL-param plumbing — the popup stamps `updatedAfter=<now-15min>` into the iframe `src`; `ConfigAssistantPage` forwards it to `GET /api/agents/:id/conversations?updatedAfter=...&limit=1&order=updated_desc`. When no conversation is inside the window, the page's empty-list fallback creates a fresh conversation. Contract (k) is structurally honoured today.

D.3 does NOT re-implement the window — it replaces the URL-param plumbing with direct hook-level enforcement now that the panel is a React component rather than an iframe target. The clean shape:

On `openConfigAssistant(prompt?)`:

1. Read `sessionStorage.getItem('configAssistant.activeConversationId')`.
2. If set, fetch `GET /api/agents/<configAssistantAgentId>/conversations?updatedAfter=<15-min-ago-iso>&limit=1&order=updated_desc`.
3. If the response includes the stored conversationId → resume it (set `activeConversationId` on context).
4. Otherwise → create fresh (null `activeConversationId`; panel creates on first message).

`<ConfigAssistantPanel>` consumes `conversationId` from props; the parent (page or popup) decides resume-vs-fresh. The Session 1 URL-param reader in `ConfigAssistantPage` is removed as part of the page's collapse to a thin wrapper (§11.3.2) — the full-page route doesn't need the popup-only `updatedAfter` param once the panel owns conversation selection.

**Kickoff audit:** confirm the Session 1 URL-param reader still exists in `ConfigAssistantPage.tsx` — it's expected to go away cleanly when the panel extraction lands.

#### §11.3.5 Files — D.3

| Path | Change |
|------|--------|
| `client/src/components/config-assistant/ConfigAssistantPanel.tsx` | **NEW** — extracted shared panel. |
| `client/src/pages/ConfigAssistantPage.tsx` | **MODIFY** — thin page wrapper. |
| `client/src/components/config-assistant/ConfigAssistantPopup.tsx` | **MODIFY** — drop iframe; mount the panel. |
| `client/src/hooks/useConfigAssistantPopup.tsx` | **MODIFY** — wire the 15-minute resume window using `updatedAfter` + `limit=1`. |

### §11.4 D.4 — Integration test + `recordHistory` version refactor (partial)

**Closes (partially):** pr-review N4 (redundant version read-back) — shipped. Session 1 S1-A4 deferred integration test — still deferred.

#### §11.4.1 Integration test for `/api/organisation/config` (deferred)

**Originally: `server/routes/__tests__/organisationConfig.integration.test.ts`.** Did not ship; deferred pending a first-class DB-fixture layer in the test infrastructure (per `progress.md` close-out). Note: §1.1 previously referenced this test as `organisationConfig.test.ts`; the canonical filename is `organisationConfig.integration.test.ts`.

Covers the 8-case matrix from Session 1 plan §5.2:

1. POST non-sensitive path → 200 `{ committed: true, configHistoryVersion, ... }`.
2. POST sensitive path → 200 `{ committed: false, requiresApproval: true, actionId }`.
3. POST invalid body (empty `path`) → 400 `{ errorCode: 'INVALID_BODY' }`.
4. POST invalid path (unknown root) → 400 `{ errorCode: 'INVALID_PATH' }`.
5. POST schema-invalid value → 400 `{ errorCode: 'SCHEMA_INVALID' }`.
6. POST sum-constraint violation → 400 `{ errorCode: 'SUM_CONSTRAINT_VIOLATED' }`.
7. POST sensitive path without resolvable agent → 400 `{ errorCode: 'AGENT_REQUIRED_FOR_SENSITIVE' }`.
8. GET → 200 with `{ effective, overrides, systemDefaults, appliedSystemTemplateId, appliedSystemTemplateName }`; assert `overrides` is raw sparse JSON, `systemDefaults` null when `appliedSystemTemplateId` is null.

DB-fixture-backed; uses the existing test-db setup.

#### §11.4.2 `recordHistory` returns version

**Modify:** `server/services/configHistoryService.ts` — `recordHistory` returns the version it wrote when called with a `tx` argument. Eliminates the redundant `SELECT MAX(version)` in `configUpdateOrganisationService.commitOverrideAndRecordHistory`.

Before:
```typescript
await recordHistory({ … }, tx);  // returns void
const [row] = await tx.select({ v: max(configHistory.version) }).from(configHistory).where(…);
const version = Number(row?.v ?? 0);
```

After:
```typescript
const version = await recordHistory({ … }, tx);  // returns the version
```

The advisory lock is still held inside `recordHistory` so the version is stable.

#### §11.4.3 Files — D.4

| Path | Change | Shipped |
|------|--------|---------|
| `server/routes/__tests__/organisationConfig.integration.test.ts` | **NEW** — integration test. | **deferred** |
| `server/services/configHistoryService.ts` | **MODIFY** — `recordHistory` returns `Promise<number>` (version) when called with `tx`. | yes |
| `server/services/configUpdateOrganisationService.ts` | **MODIFY** — consume the returned version; remove the redundant `SELECT MAX`. | yes |

---

---

## §12. Work sequence + chunk breakdown + sanity gates

### §12.1 Chunk sequence + landed status (14 chunks planned, serialised)

Serialised deliberately — no parallelism. Later chunks consume primitives introduced earlier (B.2 consumes B.1's adapter base; D.3's panel extraction would have consumed the A.4 popup mount; D.2's typed editors consume the provenance primitives; etc.). Reordering would break the dependency chain.

**Landed column key:** `yes` = shipped fully; `partial` = shipped with documented deferrals; `deferred` = did not ship in Session 2 — carried into Session 3 backlog.

| # | Chunk | Scope | Dependency | Landed |
|---|-------|-------|------------|--------|
| 1 | **Architect pass** (this spec → `tasks/builds/clientpulse/session-2-plan.md`) | Locks §§1–14 of the plan against this spec. No code. | — | yes (commit `170f560`) |
| 2 | **B.1** — `apiAdapter` real GHL wiring | Classifier pure module + retry-honoring dispatcher + 5 endpoint mappings + precondition gate. | Chunk 1. | yes (commit `47cb21c`) |
| 3 | **B.2** — Live-data pickers + editor modal rewire | 5 new adapter routes + `LiveDataPicker` component + 4 editor rewires. | Chunk 2 (shares GHL read helpers). | yes (commit `6757a22`) |
| 4 | **B.3** — Drilldown page (minimal) | 4 new routes + drilldown service + outcome-badge pure + page components. | Chunk 3 (picker component re-used). | yes (commit `456938d`) |
| 5 | **C.1** — `notify_operator` channel fan-out | Kickoff audit → orchestrator + 3 channel adapters + skillExecutor rewire. | Chunk 2 (execution-engine precondition gate is shared). | yes (commit `6bd3211`); on-call role audit deferred |
| 6 | **C.2** — Outcome-weighted recommendation | Pure decision function + aggregation query + context-service rewire + new config leaf. | Chunk 4. | yes (commit `35b596f` + `6705192` Fix 1 persisted `minTrialsForOutcomeWeight` leaf) |
| 7 | **C.3** — Typed `InterventionTemplatesEditor` | List editor + per-actionType sub-editors + merge-field picker + round-trip helpers. | Chunk 5. | yes (commit `b2ddfcb`); merge-field-vocabulary endpoint deferred, static vocabulary shipped |
| 8 | **C.4** — Dual-path UX copy + per-block deep-links | §6's tool-result renderer + §9's `openAssistantWithBlockContext` helper. | Chunks 1, 7. | yes (commit `c259bcd` + `6705192` Fix 2 wired renderer into `ConfigAssistantPage`) |
| 9 | **C.5** — (conditional) wizard scan/alert cadence | Schema audit → controls + POST wiring. | Chunk 7. | **deferred** — Screen 3 structure in `OnboardingWizardPage` had diverged from the assumed config-defaults layout; schema fields present, UI wiring deferred to Session 3 |
| 10 | **D.1** — Create-org modal rebuild + `createOrganisationFromTemplate` | Service method + integration test + modal rebuild. | None — independent surface. | **partial** (commit `59d02f2` + `6705192` Fix 3) — service method + POST route branch landed; `hierarchy_templates`/system-agent seeding, integration test, modal rebuild, `organisations.tier` column deferred |
| 11 | **D.2** — Typed Settings editors for 9 blocks | 9 editor components + shared primitives. | Chunk 7 (shares `ArrayEditor`). | yes (commit `d16b0c6`) |
| 12 | **D.3** — Panel extraction + 15-min resume window | Extract panel; refactor page + popup; wire resume window. | Chunk 8. | **deferred** — Session 1 URL-param plumbing structurally honours contract (k); extraction is ~500-LOC refactor out of Session 2 scope |
| 13 | **D.4** — Integration test + `recordHistory` refactor | Test file + service-method signature change + callsite update. | None — service-layer tidy. | **partial** (commit `b5ba824`) — `recordHistory` returns `Promise<number>` + callsite consumes; integration test deferred |
| 14 | **Housekeeping + pr-reviewer + dual-reviewer** | Final review loop; docs sync; `progress.md` Session 2 entry; PR open. | All other chunks. | partial (close-out commit `0bea207` + audit-follow-ups `6705192`); `dual-reviewer` not run — only on explicit user request per CLAUDE.md |

### §12.2 Review gates

- **After Chunk 1 (architect pass):** optional `spec-reviewer` run on `session-2-plan.md`. Only if user explicitly asks and Codex CLI is local. Do NOT auto-invoke.
- **After Chunk 4 (end of Phase 6):** architect review-pass on B-chunks alone. Cheap sanity check that the adapter + pickers + drilldown landed coherently before Phase 8 polish begins.
- **After Chunk 9 (end of Phase 8):** architect review-pass on C-chunks. Confirm the polish-phase surface area is cohesive before Session 1 carry-forward chunks start.
- **After Chunk 13 (before PR open):** full `pr-reviewer` pass on the combined Session 2 diff. Caller persists the log to `tasks/pr-review-log-clientpulse-session-2-<timestamp>.md` per CLAUDE.md contract.
- **Before merge:** final `pr-reviewer` re-run if fix commits landed. Repeat until clean.
- **`dual-reviewer`:** only if user explicitly requests AND session is local. Never auto-invoke.

### §12.3 Sanity gates between chunks

Run after every chunk (same posture as Session 1):

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs the 43-error baseline (baseline may shift slightly as Session 1 blockers fix landed; confirm at Session 2 kickoff).
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs the 11-error baseline.
- Relevant `npx tsx server/.../*Pure.test.ts` — all pass.
- `npm run lint` on touched files.
- `node scripts/verify-integration-reference.mjs` — zero blocking errors after any chunk that touches `docs/integration-reference.md`.

### §12.4 Migration numbering (shipped reality)

Session 1 used `0180–0182` and `0184` (Session 1's Chunk A.1 migration `0183` does not exist in the numbered sequence — the Session 1 close-out skipped it after a last-minute re-slot, and `0184_skill_analyzer_execution_lock_token.sql` is a platform-side migration unrelated to ClientPulse). Session 2 shipped a single migration at `0185`:

| Session 2 migration | Purpose | Chunk | Shipped |
|---|---|---|---|
| `0185_actions_replay_of_action_id.sql` | Pre-document the `replay_of_action_id` column on `actions` per contract (s); column stays NULL until a Session 3 runtime ships | B.1 (Chunk 2) | yes |
| `NNNN_intervention_outcomes_score_delta.sql` | **Conditional** — only if the kickoff audit finds `score_delta` missing | C.2 (Chunk 6) | not shipped — audit at kickoff confirmed `score_delta` already present |
| `NNNN_operational_config_scan_frequency.sql` | **Conditional** — only if §10 audit finds the schema field missing | C.5 (Chunk 9) | not shipped — chunk deferred (see §10.1); schema field was already present regardless |
| `NNNN_organisations_tier.sql` | **Conditional** — only if D.1 kickoff audit finds `tier` column missing | D.1 (Chunk 10) | not shipped — chunk partial, tier column deferred with the modal rebuild |

All migrations ship with `_down/` rollback pairs per Session 1 convention.

### §12.5 Rollback posture

Session 2 ships real external side effects for the first time (B.1 adapter + fan-out channels). Rollback posture per surface:

- **Adapter rollback** — if B.1 needs to roll back post-deploy, revert the `apiAdapter.ts` rewrite; the stub returns `not_implemented` again; approved actions queue but don't fire. Pilot pauses; no data loss.
- **Picker rollback** — editor rewires revert via `git revert`; the free-text ID fallback returns. Pickers cached in Redis evict on TTL.
- **Fan-out rollback** — revert `skillExecutor.ts`'s `notify_operator` case to the stub; delivered notifications stay in their respective channels; in-flight fan-outs may deliver to some channels and skip others. Acceptable.
- **Settings-page editor rollback** — the JSON editor fallback stays in-tree per §8.6; reverting the typed editor falls back cleanly.
- **Schema migrations** — rollbacks are reversible per the `_down/` pairs. `replay_of_action_id` drop is clean (column never written); `score_delta` + `scan_frequency` drops are reversible if pre-production framing holds.

### §12.6 Pre-production framing reminder

Per `docs/spec-context.md`: `live_users: no`, `rollout_model: commit_and_revert`. Session 2 is still inside the pre-production envelope — data loss on rollback within the first release cycle is acceptable. The first live-user pilot (post-merge) is what shifts framing.

---

---

## §13. File inventory summary

Aggregated inventory across all chunks. `Shipped` column reflects the Session 2 close-out state. Files listed as "deferred" are retained so Session 3 picks them up without re-deriving the inventory.

### §13.1 Server — new files

| Path | Purpose | Shipped |
|------|---------|---------|
| `migrations/0185_actions_replay_of_action_id.sql` | Pre-document replay column per contract (s) | yes |
| `migrations/_down/0185_actions_replay_of_action_id.sql` | Rollback | yes |
| `migrations/NNNN_intervention_outcomes_score_delta.sql` | **Conditional** | not needed — `score_delta` already present |
| `migrations/NNNN_operational_config_scan_frequency.sql` | **Conditional** | deferred — chunk deferred |
| `migrations/NNNN_organisations_tier.sql` | **Conditional** | deferred — chunk partial |
| `server/services/adapters/apiAdapterClassifierPure.ts` | Pure retry classifier (§2.3) | yes |
| `server/services/adapters/ghlEndpoints.ts` | 5 endpoint mappings (§2.4) | yes |
| `server/services/adapters/ghlReadHelpers.ts` | Low-level read calls (§3.3) | yes |
| `server/services/crmLiveDataService.ts` | Picker orchestration (§3.3) | yes |
| `server/routes/clientpulseDrilldown.ts` | 4 drilldown GETs (§4.3) | yes |
| `server/services/drilldownService.ts` | Drilldown read orchestration (§4.6) | yes |
| `server/services/drilldownOutcomeBadgePure.ts` | Pure badge derivation (§4.4) | yes |
| `server/services/recommendedInterventionPure.ts` | Outcome-weighted pick (§5.2) | yes |
| `server/services/notifyOperatorFanoutService.ts` | Fan-out orchestrator (§7.3) | yes |
| `server/services/notifyOperatorChannels/inAppChannel.ts` | Thin in-app wrapper | yes |
| `server/services/notifyOperatorChannels/emailChannel.ts` | Thin email wrapper | yes |
| `server/services/notifyOperatorChannels/slackChannel.ts` | Slack webhook POST | yes |
| `server/services/notifyOperatorChannels/availabilityPure.ts` | Pure channel-availability derivation | yes |

### §13.2 Server — modifications

| Path | What changes | Shipped |
|------|--------------|---------|
| `server/services/adapters/apiAdapter.ts` | **REWRITE** — stub → real dispatcher (§2.5) | yes |
| `server/services/executionLayerService.ts` | Precondition gate (§2.6) — `checkPreconditions()` + `executeAction()` | yes |
| `server/services/ghlOAuthService.ts` | **Conditional audit** — ensure `getValidToken(orgId)` exists with refresh-on-expire | deferred — adapter reads `access_token` directly |
| `server/config/limits.ts` | Add `DEFAULT_ADAPTER_TIMEOUT_MS = 30_000` | yes |
| `server/routes/clientpulseInterventions.ts` | 5 new picker GETs (§3.2) + `requireOrgPermission(AGENTS_VIEW)` (audit fix 4) | yes |
| `server/services/skillExecutor.ts` | `notify_operator` case calls fan-out (§7.3) | yes |
| `server/services/clientPulseInterventionContextService.ts` | Aggregate outcomes; consume `pickRecommendedTemplate` (§5.4); read `minTrialsForOutcomeWeight` from org config | yes |
| `server/services/operationalConfigSchema.ts` | Add `minTrialsForOutcomeWeight` leaf (§5.5, audit fix 1) | yes; `scanFrequencyHours` addition not needed — pre-existing |
| `server/services/orgConfigService.ts` | Extend `InterventionDefaults` interface for `minTrialsForOutcomeWeight` | yes (audit fix 1) |
| `server/services/organisationService.ts` | Add `createOrganisationFromTemplate` method (§11.1) | yes (minimal — see §11.1.1) |
| `server/services/configHistoryService.ts` | `recordHistory` returns version when called with tx (§11.4.2) | yes |
| `server/services/configUpdateOrganisationService.ts` | Consume returned version; drop redundant SELECT (§11.4.2) | yes |
| `server/routes/organisations.ts` | `POST /api/organisations` branches through `createOrganisationFromTemplate` when `systemTemplateId` present (§11.1.4, audit fix 3) | yes |
| `server/index.ts` | Register `clientpulseDrilldownRouter` | yes |
| `server/db/schema/organisations.ts` | **Conditional** — add `tier` column | deferred |
| `server/db/schema/actions.ts` | Add `replayOfActionId` field | yes |
| `server/skills/crm.fire_automation.md`, `crm.send_email.md`, `crm.send_sms.md`, `crm.create_task.md` | Stub skill docs matching capability-taxonomy entries | yes (audit fix 5) |

### §13.3 Server — new test files

| Path | Purpose | Shipped |
|------|---------|---------|
| `server/services/adapters/__tests__/apiAdapterClassifierPure.test.ts` | §2.3, 10 cases | yes |
| `server/services/adapters/__tests__/apiAdapter.integration.test.ts` | §2.7, GHL sandbox via nock | deferred — outside static-gates + pure-function testing posture |
| `server/services/__tests__/drilldownOutcomeBadgePure.test.ts` | §4.4, 11 cases | yes |
| `server/services/__tests__/recommendedInterventionPure.test.ts` | §5.2, 8 cases | yes |
| `server/services/__tests__/notifyOperatorFanoutServicePure.test.ts` | §7.5, 8 cases | yes |
| `server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` | §11.1.1, DB-fixture integration | deferred |
| `server/routes/__tests__/organisationConfig.integration.test.ts` | §11.4.1, 8-case matrix | deferred — pending DB-fixture layer |

### §13.4 Client — new files

| Path | Purpose | Shipped |
|------|---------|---------|
| `client/src/components/clientpulse/pickers/LiveDataPicker.tsx` | Reusable searchable dropdown (§3.4) | yes |
| `client/src/pages/ClientPulseDrilldownPage.tsx` | Drilldown page (§4.6) | yes |
| `client/src/components/clientpulse/drilldown/SignalPanel.tsx` | Signal panel card | yes |
| `client/src/components/clientpulse/drilldown/BandTransitionsTable.tsx` | Transitions table | yes |
| `client/src/components/clientpulse/drilldown/InterventionHistoryTable.tsx` | History table | yes |
| `client/src/components/clientpulse/drilldown/OutcomeBadge.tsx` | Badge renderer | yes |
| `client/src/components/config-assistant/toolResultRenderers/ConfigUpdateToolResult.tsx` | Dual-path renderer (§6.3) — also exports `parseConfigUpdateToolResult` | yes |
| `client/src/components/config-assistant/ConfigAssistantPanel.tsx` | Extracted panel (§11.3.1) | deferred — D.3 not shipped |
| `client/src/components/clientpulse-settings/editors/InterventionTemplatesEditor.tsx` | Typed template editor (§8.4) | yes |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/*.tsx` | 5 sub-editors (§8.7) | yes (all 5) |
| `client/src/components/clientpulse-settings/editors/MergeFieldPicker.tsx` | Merge field chip inserter (static vocabulary) | yes |
| `client/src/components/clientpulse-settings/editors/interventionTemplateRoundTripPure.ts` | Round-trip serialiser (§8.5) | yes |
| `client/src/components/clientpulse-settings/editors/HealthScoreFactorsEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/ChurnRiskSignalsEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/ChurnBandsEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/InterventionDefaultsEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/AlertLimitsEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/StaffActivityEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/IntegrationFingerprintsEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/DataRetentionEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/editors/OnboardingMilestonesEditor.tsx` | (§11.2) | yes |
| `client/src/components/clientpulse-settings/shared/ArrayEditor.tsx` | Reusable add/remove/reorder (§11.2.2) | yes |
| `client/src/components/clientpulse-settings/shared/NormalisationFieldset.tsx` | Normalisation sub-form helper | yes |
| `client/src/lib/configAssistantPrompts.ts` | Prompt builder helper (§9.3) | yes |

### §13.5 Client — modifications

| Path | What changes | Shipped |
|------|--------------|---------|
| `client/src/components/clientpulse/FireAutomationEditor.tsx` | 1 picker (§3.5) | yes |
| `client/src/components/clientpulse/EmailAuthoringEditor.tsx` | 2 pickers (§3.5) | yes |
| `client/src/components/clientpulse/SendSmsEditor.tsx` | 2 pickers (§3.5) | yes |
| `client/src/components/clientpulse/CreateTaskEditor.tsx` | 2 pickers (§3.5) | yes |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | Render `recommendedReason` badge (§5.6) | yes |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Deep-link to drilldown (§4.6) | yes |
| `client/src/pages/ConfigAssistantPage.tsx` | Thin wrapper over `<ConfigAssistantPanel>` (§11.3.2) | deferred — page continues to own the message pipeline; renderer wire-up landed via audit fix 2 |
| `client/src/components/config-assistant/ConfigAssistantPopup.tsx` | Drop iframe; mount panel (§11.3.3) | deferred — iframe remains the popup body |
| `client/src/hooks/useConfigAssistantPopup.tsx` | Wire 15-min resume window (§11.3.4) | partial — Session 1 URL-param plumbing retained; hook-level enforcement deferred |
| `client/src/pages/ClientPulseSettingsPage.tsx` | Per-block typed editor rendering; "Ask the assistant" button per block (§9.3, §11.2.4) | yes |
| `client/src/pages/OnboardingWizardPage.tsx` | **Conditional** — Screen 3 scan/alert controls (§10.2) | deferred — Step 3 structure diverged from assumed config-defaults layout |
| `client/src/pages/SystemOrganisationsPage.tsx` | Create-org modal rebuild (§11.1.2) | deferred |
| `client/src/App.tsx` | Register `/clientpulse/clients/:subaccountId` route | yes |

### §13.6 Docs

| Path | What changes |
|------|--------------|
| `architecture.md` | Update the "ClientPulse Intervention Pipeline" section to reflect real adapter dispatch; update "Configuration Assistant" subsection for panel extraction |
| `docs/capabilities.md` | Customer-facing changelog entry per editorial rules; no provider names in customer-facing sections |
| `docs/integration-reference.md` | GHL integration block: expand `skills_enabled` to reflect real dispatch per action_type |
| `docs/configuration-assistant-spec.md` | Dual-path UX copy contract documented |
| `CLAUDE.md` | "Current focus" pointer updated to Session 2; "Key files per domain" rows updated for new adapter, fan-out, drilldown |
| `tasks/builds/clientpulse/progress.md` | Session 2 entry after PR opens |

### §13.7 Size estimate

- Server net-new: ~20 files, ~2500 LOC.
- Server modifications: ~14 files, ~800 LOC touched.
- Client net-new: ~25 files, ~3500 LOC.
- Client modifications: ~13 files, ~600 LOC touched.
- Tests net-new: ~7 files, ~1500 LOC.
- Docs: ~6 files, ~400 LOC touched.

Total ~8300 LOC across ~85 files. Roughly 2× Session 1's footprint; consistent with the 4–5 week estimate.

---

---

## §14. Decisions log

### §14.1 Q1–Q5 locked at kickoff (user-confirmed, 2026-04-20)

| Q | Decision | Rationale (user-facing one-liner) | Spec location |
|---|----------|-----------------------------------|---------------|
| Q1 | Subscription tier gating (D6) | **Defer to post-pilot.** Pilot's one agency is Operate-tier by default; a tier-check middleware built before a Monitor-tier customer exists is code we'd refactor the minute that customer appears. | §14.3 |
| Q2 | Adapter retry strategy | **Retryable: 429, 502, 503, network timeout. Terminal: 401, 403, 404, 422. Other 5xx: retry once then terminal.** Matches industry-standard REST-API retry shape. | §2.3 |
| Q3 | Channel fan-out — audit first or build net-new? | **Kickoff audit, ship only missing paths.** Zero-risk; if all three channels work, P8.3 collapses to verification. | §7.2 |
| Q4 | Manual replay (`replay_of_action_id`) in Session 2? | **Defer. Pre-document the column but do not wire runtime.** Pilot feedback is the trigger for replay UX. | §1.3 + §12.4 |
| Q5 | Drilldown scope | **Minimal: history + outcome badges + signal panel + band transitions (90-day) + contextual assistant trigger.** Pilot hasn't used drilldown; ship structural surface and iterate. | §4.1 |

### §14.2 Scope-expansion decisions (Session 1 carry-forward folded in)

User-confirmed 2026-04-20: all four Session 1 deferred items (D.1–D.4) fold into Session 2 as one PR. Raises effort estimate from the brief's ~2–2.5 weeks to ~4–5 weeks. Trade-off: bigger PR, longer review, but avoids a fragmented Session 2.5 cleanup sprint and unblocks pilot launch with a single merge.

### §14.3 Deferred items (shipping after Session 2)

These are documented as post-pilot deferrals. Spec does NOT promise them for Session 2:

1. **D6 full tier-gating runtime** (Q1 above).
2. **Custom intervention-type authoring beyond the 5 primitives.** Operators can edit existing intervention templates; they can't define new `actionType` primitives. Post-pilot decision tied to real usage patterns.
3. **Dedicated `ORG_PERMISSIONS.CONFIG_EDIT` split.** Inherits `AGENTS_EDIT` per Session 1 §4.10 decision.
4. **Runtime `operationalConfigSchema.parse()` on effective-read hot path.** Deferred per Session 1 §4.5 iter-5 finding 5.2 — adding validation to every read is a posture change that needs a repair migration for legacy rows.
5. **Manual replay runtime** (Q4 above). Schema pre-documented; runtime later.
6. **Segmented outcome charts + signal-overlay timeline on drilldown** (Q5 above). Minimal drilldown ships first; richer visualisations post-pilot.
7. **Slack webhook retries.** Ship without retry; if pilot shows Slack flakiness, add retry posture.
8. **Subaccount-scoped outcome aggregation for recommendations.** §5.7 — Session 2 aggregates at org level; per-subaccount aggregation post-pilot if signals noisy.
9. **Picker "show more" affordance** (§3.8 Q2). 50-row cap; expand if pilot operators have >50 matches.
10. **JSON editor fallback removal** (§8.6). Typed `InterventionTemplatesEditor` ships; JSON fallback stays until pilot validates the typed surface.
11. **Global permission / auth context.** Session 1's `useOnboardingRedirect` fetches `/api/my-permissions` inline alongside `/api/onboarding/status`. `Layout.tsx` already fetches the same permission set for nav-gate decisions. Consolidating the fetch into a single app-level React context (e.g. `PermissionContext`) would eliminate the duplicate network round-trip and give every consumer a uniform `hasPermission(key)` helper. Flagged by the Session 1 third-round review as non-blocking; worth a small follow-up chunk post-pilot rather than mid-Session 2. Not in the current §12.1 chunk list — will shape into a D.5 if the user wants it folded in, otherwise ships as its own small PR after Session 2 merges.
12. **Server-side 15-minute resume-window enforcement.** Session 1 + Session 2 both enforce the resume window on the client (spec contract (k)). A hardened posture would add a server-side guardrail on `GET /api/agents/:id/conversations` that caps `updatedAfter` to a minimum of `now - 15min` regardless of what the client sends, so a modified client can't resume a stale conversation outside the spec window. Low-priority; adds server complexity for a low-risk client-trust attack surface. Revisit if the Configuration Assistant ever holds sensitive state that a stale resume could compromise.

### §14.4 Items deliberately left as chunk-kickoff audits (non-blocking)

Per Session 1 §10.8 convention — small discovery tasks the implementer does at the start of the relevant chunk:

- **Chunk 2 (B.1):** confirm `ghlOAuthService.getValidToken(orgId)` exists with refresh-on-expire semantics (§2.7).
- **Chunk 2 (B.1):** confirm `executionLayerService.executeAction` takes the PG advisory lock per contract (v) (§2.8 Q2).
- **Chunk 5 (C.1):** audit `notifications` + `emailService` + Slack integration coverage (§7.2).
- **Chunk 5 (C.1):** resolve `on_call` preset recipient group — existing role or new role? (§7.6 Q3).
- **Chunk 6 (C.2):** confirm `intervention_outcomes.score_delta` column exists (§5.3).
- **Chunk 7 (C.3):** confirm the merge-field vocabulary endpoint `/api/clientpulse/subaccounts/:id/merge-field-vocabulary` exists or add it (§8.8 Q1).
- **Chunk 9 (C.5):** confirm whether `scanFrequencyHours` + `alertCadence.*` schema fields exist; decide in-scope vs defer (§10.1).
- **Chunk 10 (D.1):** confirm `organisations.tier` column exists; if missing, add in a migration (§11.1.3).

### §14.5 Re-opening locked Session 1 decisions

Session 2 **does not re-open** any Session 1 §10 decisions. The contracts (a)–(v), the `InterventionEnvelope` type, and the §1.6 invariants are inherited verbatim.

If a Session 2 implementation discovery reveals that a Session 1 contract is wrong (e.g. contract (h) turns out to require a different read-chain shape than what Session 1 landed + the pr-review fix patched), the finding is surfaced as an "Open question for the user" rather than silently overridden. The user decides whether to re-open.

### §14.6 Historical record

Session 2 shipped on branch `claude/clientpulse-session-2-arch-gzYlZ` between 2026-04-20 commits `170f560` (architect pass) and `6705192` (audit follow-ups). The authoritative close-out state lives in `tasks/builds/clientpulse/progress.md` under the "Session 2 — real CRM wiring + drilldown + polish" entry. The companion architect plan is `tasks/builds/clientpulse/session-2-plan.md`. Deferred chunks (C.5, D.3) + partial chunks (D.1, D.4) and the documented follow-up items carry into the Session 3 backlog.

**End of Session 2 spec (historical record).**

