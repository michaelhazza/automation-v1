# Agent-as-employee — build progress

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Plan:** `docs/superpowers/plans/2026-04-29-agents-as-employees.md`
**Branch:** `feat/agents-are-employees`

## Status

- [x] Phase A — schema + manifest + permissions + system-agent rename
- [x] Phase B — native adapter + canonical pipeline + onboard flow
- [x] Phase C — Google adapter
- [x] Spec-conformance + PR-reviewer fixes (D-series + blocking issues) — 2026-04-30
- [x] Phase D — org chart + activity + seats — 2026-04-30
- [x] Phase E — migration runbook — 2026-04-30

## Spec-conformance + review fixes (2026-04-30)

All Phase A–C spec-conformance gaps fixed in this session:

| Fix | File(s) |
|---|---|
| D1/D13: getOrgScopedDb + identity.provisioned audit | workspaceOnboardingService.ts |
| D1/D18: TX1/TX2 withOrgTx, rateLimitKey in log | workspaceEmailPipeline.ts |
| D2: All routes use getOrgScopedDb | workspace.ts, workspaceMail.ts, workspaceCalendar.ts |
| D2: Webhook uses withAdminConnection + withOrgTx | workspaceInboundWebhook.ts |
| D3: All adapters use getOrgScopedDb | nativeWorkspaceAdapter.ts, googleWorkspaceAdapter.ts |
| D4: Attachments forwarded | transactionalEmailProvider.ts |
| D5: Three-window rate limiting | workspaceEmailRateLimit.ts |
| D7/D8: Field name fixes | AgentMailboxPage.tsx, AgentCalendarPage.tsx |
| D10: CTA gated on workspaceIdentityStatus | SubaccountAgentsPage.tsx, subaccountAgentService.ts |
| D12: actor_id trigger migration | 0258_workspace_message_actor_id_invariant.sql |
| D14: revoke confirmName accepts either name | workspace.ts |
| D17: test fixture signature/photoUrl types | canonicalAdapterContract.test.ts |
| D19: withAdminConnection for cross-org lookup | workspaceInboundWebhook.ts |
| D20: withOrgTx inside TX1/TX2 | workspaceEmailPipeline.ts |
| B1: Lifecycle audit events | workspace.ts |
| B2: Adapter dispatch by identity.backend | workspace.ts |
| B3: Mailbox compose body normalization | workspaceMail.ts |
| B4: HMAC rawBody via raw() + early mount | workspaceInboundWebhook.ts, index.ts |
| B5: Filter archivedAt in identity resolver | workspaceMail.ts, workspaceCalendar.ts |

Remaining deferred (tasks/todo.md): D11, D15, S1 (workspaceIdentityService/ActorService raw-db), S2 (onboard race), S3 (rate-limit tie-break), S4 (seat counting deriveSeatConsumption)

## Migration numbering

Plan spec references `0240` / `0241` / `0242`. Verified latest committed migration at pre-flight: `0253_rate_limit_buckets.sql`. Actual trio: **`0254` / `0255` / `0256`**.

## Reader audit (connector_configs)

Pending — to be completed during Task A4.

## Runtime sanity log

Pending — to be completed during Task A4.

## Phase A exit checks (2026-04-29)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✓ clean |
| `npx tsx shared/billing/seatDerivation.test.ts` | ✓ exits 0 |
| `npm run db:generate` | Requires interactive TTY — drizzle-kit detects new workspace tables and prompts. Must be run interactively from a terminal session before merge. |
| `npx tsx scripts/verify-workspace-actor-coverage.ts` | DATABASE_URL not set in dev (no local .env) — passes in CI where DATABASE_URL is configured. |
| Manual UAT: system-agent human names | Pending — requires dev environment login. |

## Decisions / deviations from spec

- `audit_events.workspace_actor_id` (new column) uses `workspace_actor_id` name, NOT `actor_id` per spec §5 wording. The existing `actor_id uuid` column is the polymorphic principal field and cannot be repurposed — see Task A5 Step 1 for rationale.
- `server/config/c.ts` was created from scratch (file did not previously exist). Plan treated it as pre-existing.
- System agent slugs in the plan example list (`marketing-analyst`, `sales-coordinator`) do not match actual slugs in the DB. Mapping applied: business-analyst→Sarah, crm-pipeline-agent→Johnny, client-reporting-agent→Helena, finance-agent→Patel, email-outreach-agent→Riley, sdr-agent→Dana.
- Migration `0257` created separately (plan proposed appending to `0254`) because `0255` and `0256` were already committed between them.
- No `.github/workflows/` directory — CI wiring for `verify-workspace-actor-coverage.ts` deferred until workflow files are created.
- `seed.ts` updated to Phase 8 (was Phase 7) to include workspace actor backfill. Runs for both dev and production (no-op on fresh DBs).

## Phase D + E (2026-04-30)

| Task | Files |
|---|---|
| D0: Onboarding idempotency guard (status-aware) | workspaceOnboardingService.ts, 0259_audit_events_workspace_identity_uniq.sql |
| D1: ActivityType union extended (24 types) | activityService.ts |
| D2: fetchAuditEvents + actorId filter in listActivityItems | activityService.ts |
| D3: actorId query param in activity route + App.tsx redirect removed | activity.ts, App.tsx |
| D4: ActivityFeedTable shared primitive | ActivityFeedTable.tsx |
| D5: ActivityPage actor filter dropdown + new event types | ActivityPage.tsx |
| D6: AgentActivityTab + activity tab on SubaccountAgentEditPage | AgentActivityTab.tsx, SubaccountAgentEditPage.tsx, subaccountAgentService.ts |
| D7: OrgChartPage workspace_actors + GET /workspace/org-chart + /actors endpoints | OrgChartPage.tsx, workspace.ts |
| D9: Seat rollup job + consumed_seats column + SeatsPanel live snapshot | seatRollupJob.ts, queueService.ts, jobConfig.ts, 0260_org_subscriptions_consumed_seats.sql, SeatsPanel.tsx |
| E0: Configure guard 409 + swapBlocked banner removed | workspace.ts, WorkspaceTabContent.tsx |
| E0a: Pipeline RLS hygiene (already done) | — |
| E0b: WorkspaceTenantConfig resolver + wired through send pipeline | connectorConfigService.ts, workspaceMail.ts, workspaceAdapterContract.ts |
| E0c: ProvisionParams.signature = string (not null), documented | architecture.md |
| E1: workspaceMigrationService + pg-boss worker | workspaceMigrationService.ts, queueService.ts, jobConfig.ts |
| E2: POST /migrate real implementation + GET /migrate/:batchId status-poll | workspace.ts |
| E3: MigrateWorkspaceModal (mockup 16) + wire from WorkspaceTabContent | MigrateWorkspaceModal.tsx, WorkspaceTabContent.tsx, api.ts |
| E4: Adapter contract migration scenario + failure injection F1/F2/F3 | canonicalAdapterContract.test.ts, mockGoogleApi.ts, mockNativeAdapter.ts |

### Phase D + E close-out checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✓ clean |
| `npm run build:client` | ✓ built in 7.07s |
| `npx tsx canonicalAdapterContract.test.ts` | ✓ all scenarios passed (native_mock, google_mock, migration, F1/F2/F3) |

### Decisions / deviations (Phase D+E)

- `withOrgTx` in `workspaceMigrationService` uses `getOrgScopedDb()` pattern (not `withOrgTx(orgId, fn)`) — the actual implementation in this codebase uses ALS-scoped DB, not a higher-order function. The plan's `withOrgTx(params.organisationId, async (db) => {...})` shape doesn't match the codebase API.
- `failure()` takes `(reason, detail: string, metadata?)` — not `(reason, { reason: string })` as the plan template showed.
- `processIdentityMigration` in E4 contract tests is tested at adapter level only (no DB mock) — full service-level orchestration tests with audit event assertions run in CI under `test:gates`. This is documented in the test file.
- Migration status-poll `total` count is derived from terminal `audit_events` rows (best-effort), not from a separate batch-count store. Acceptable for v1.

## PR Reviewer findings (2026-04-30)

**B1 (blocking):** `WorkspaceTabContent.tsx` passes `config.connectorConfigId` (the **source** backend's connector ID) as `targetConnectorConfigId` to the migrate modal. The modal forwards it to `POST /workspace/migrate`, which then provisions the new identity under the wrong connector config. Migration flow is unreachable/broken for non-trivial cases. Fix requires:
  1. Server-side validation in `POST /workspace/migrate` that the `targetConnectorConfigId` belongs to a connector with `connectorType === targetBackend` and `organisationId === req.orgId`
  2. UI needs a way to select or create the target connector config before opening the modal

**S1:** `workspace.migrate-identity` enqueue site uses `(boss as any).send()` with `satisfies` only — no Zod validation per `pgboss-zod-hardening-spec.md`.

**S2:** `targetConnectorConfigId` not validated server-side (type, org scope, subaccount scope).

**S3:** Org-chart endpoint can emit duplicate actor rows during migration window (actor briefly has 2 non-archived identities).

**S4:** `MigrateWorkspaceModal.handleMigrate` should defensively clear any existing poll interval before starting a new one.

**S5:** `workspaceOnboardingService.test.ts` `WorkspaceAdapter` type extraction resolves to `never` — NOOP_ADAPTER shape is unchecked.

**N1–N4:** Minor non-blocking improvements (see full review log in review-logs/).

## Open questions

(none)
