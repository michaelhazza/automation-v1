# Codebase Audit Report — Track A (RLS + agent-execution, post-refactor)

| Field | Value |
|---|---|
| Audit framework version | 1.4 |
| Project | automation-v1 |
| Audited by | Claude Code (main session, inline audit-runner playbook) |
| Date | 2026-05-14 |
| Branch | audit/track-rls-agent-exec |
| Starting commit SHA | 4b3c4f2f347e620db932962c2ae67894b491ee15 |
| Final commit SHA | bebbb75e (pass 2 fix) + subsequent log/todo/KNOWLEDGE commits |
| Mode | Targeted — RLS area + agent-execution area |
| Layers run | Layer 2 Modules I (RLS & Multi-tenancy) + K (Three-Tier Agent Invariants), informed by Layer 1 Areas 1, 5, 6, 9 as needed |
| Subagents invoked | None (audit-runner runs inline) |
| Linked review logs | _(filled when spec-conformance + pr-reviewer run)_ |

---

## Reconnaissance Map

### Operator brief

> Pre-v1 lockdown audit on `audit/full-pre-v1-lockdown-2026-05-14` is merged; four god-file splits (skillExecutor, workflowEngine, skillAnalyzerServicePure, agentExecutionService) have since landed on main. Three concurrent targeted audits on isolated branches; this is Track A — RLS first, then agent-execution.

### Context block validation (framework §2)

Spot-checked 2026-05-14:

| Item | Stated | Actual | Status |
|---|---|---|---|
| Vitest | `2.x` (`npm run test:unit` = `vitest run`) | `^2.1.9` | match |
| Drizzle | `^0.45.1` | `^0.45.1` | match |
| pg-boss | `^9.0.3` | `^9.0.3` | match |
| Lint command | `npm run lint` (`eslint flat config`) | `npm run lint` exists, `eslint .` | match |
| build:server | `tsc -p server/tsconfig.json` | `tsc -p server/tsconfig.json` | match |

No drift — proceeding.

### Resolved in-scope paths

The operator brief used stylised paths. Verified actual structure with `Glob`/`ls`:

**RLS area:**

- `server/db/schema/` — 229 table-per-file Drizzle modules (NOT a single `schema.ts`)
- `server/db/index.ts`, `server/db/rlsExclusions.ts`, `server/db/withPrincipalContext.ts`
- `server/config/rlsProtectedTables.ts` — 1357 lines, canonical manifest (§4 Protected)
- `migrations/*rls*.sql` — 19 RLS-related migrations (out of 451 total)
- `server/lib/orgScopedDb.ts` — `getOrgScopedDb`
- `server/instrumentation.ts` — `withOrgTx`
- `server/lib/agentRunVisibility.ts` — `canView` / `canViewPayload`
- `server/lib/agentRunPermissionContext.ts` — permission context
- `server/lib/agentRunEditPermissionMask.ts` + `…Pure.ts` — edit mask
- `server/services/permissionSetService.ts`, `server/services/permissionSeedService.ts` — permission services (`permissionsService.ts` does NOT exist as named in brief)
- Sample routes that read/write RLS-gated tables (selected via Grep)
- `shared/types/**` — tenant-scoped entity types

**Agent-execution area (post-split):**

- `server/services/agentExecutionService.ts` + `…Pure.ts`
- `server/services/agentExecutionLoop.ts`
- `server/services/agentExecutionEventEmitter.ts`
- `server/services/agentExecutionEventService.ts` + `…Pure.ts`
- `server/services/agentExecutionEventTaskSequencePure.ts`
- `server/services/agentExecutionTypes.ts`
- `server/services/skillExecutor.ts` + `…Pure.ts` + `…DelegationPure.ts`
- `server/routes/agents.ts`, `server/routes/agentRuns.ts` (NOT `runs.ts` as in brief)
- Agent run lifecycle: start, step, complete, error

### Out-of-scope (touched by other tracks or out-of-charter)

- pg-boss jobs + idempotency (Track B/C presumably)
- Webhooks adapter
- Skills registry / actionRegistry consistency
- Frontend / capabilities editorial

### Concurrent audits

Per operator: Track A (this), Tracks B + C run in parallel sessions on isolated branches. No collision expected within the in-scope paths above. Recording as cooperative parallel mode.

### Critical-path coverage assessment

Per framework Rule 9 and §2: AutomationOS posture is **gates only / gates + sparse unit** by default. Specific to this run:

- RLS plumbing has named tests (`server/db/__tests__/rls.*` — to confirm during pass 1).
- agentRunVisibility / Permission context — sparse but present.
- Run lifecycle — relies on integration trajectories rather than focussed unit tests.

Trust posture: downgrade `high` to `medium` for any finding whose fix path lacks a named test on that exact line.

### Implicit external contracts (Rule 4)

In scope:

- `shared/types/agentExecution.ts` and equivalents — three-tier agent contract.
- `agent_runs.execution_log` persisted JSON shape.
- `agent_run_llm_payloads` payload shape.
- Run visibility rules (`agentRunVisibility.ts`).
- Permission context contract for service-principal vs user calls.

### State / side-effect systems identified (Rule 13)

- Agent execution loop — LLM call dispatcher + budget enforcement.
- Atomic lead-agent swap per subaccount.
- Skill cache (module-level), `server/lib/skillVisibility.ts`.
- pg-boss job hand-off (run completion enqueues downstream jobs).

### Protected files identified in scope (framework §4)

- `server/db/schema/**` (every file).
- `server/config/rlsProtectedTables.ts`.
- `migrations/*rls*.sql` + all migrations (append-only).
- `server/lib/agentRunPermissionContext.ts`.
- `server/lib/agentRunVisibility.ts`.
- `server/services/agentExecution*.ts`.
- `server/services/skillExecutor*.ts`.
- `scripts/gates/verify-rls-*.sh`, `verify-org-id-source.sh`, `verify-no-db-in-routes.sh`, `verify-subaccount-resolution.sh`.

---

## Pass 1 Findings

### Gate-script results (read-only sanity sweep)

| Gate | Result | Notes |
|---|---|---|
| `verify-rls-coverage.sh` | PASS — 0 violations | 449 files scanned |
| `verify-rls-contract-compliance.sh` | PASS — 0 violations | 2,041 files; allowlists `server/services/` (see F3) |
| `verify-rls-session-var-canon.sh` | PASS — 0 violations | 2,535 files |
| `verify-no-db-in-routes.sh` | PASS — 0 violations | 197 files |
| `verify-subaccount-resolution.sh` | PASS — 0 violations | 174 files |
| `verify-org-id-source.sh` | **WARN — 12 violations** (baseline 3) | See F1 |
| `verify-rls-protected-tables.sh` | silent exit 123 on Windows | See F2 |

Manifest cross-check (manual diff, framework Module I check 1+2):

- 194 schema tables declare `organisation_id`.
- 197 entries in `rlsProtectedTables.ts`.
- 0 schema tables with `organisation_id` are missing from the manifest after correcting per-table column detection.
- 7 manifest entries with no current `organisation_id`-bearing schema table → ALL legitimately accounted for (check2-exempt join tables for `connector_location_tokens`, `document_bundle_members`, `reference_document_versions`, `subaccount_baseline_metrics`; intentional pre/post-rename pairs for `org_budgets`, `workflow_engines`, `canonical_workflow_definitions`).

Manifest is clean. No new RLS coverage drift.

`allowRlsBypass: true` callsites: 11 production-code occurrences, all carry the required inline justification comment within +/-1 line (framework Module I check 3).

---

### RLS area — findings

| # | Finding | Severity | Confidence | Justification | Proposed fix | Pass |
|---|---|---|---|---|---|---|
| F1 | `verify-org-id-source.sh` regressed 9 violations vs baseline 3. 10 hits in `server/routes/portal.ts` (lines 46, 100, 126, 148, 184, 210, 231, 259, 295, 342) pass `req.user!.organisationId` to `resolveSubaccount(subaccountId, …)` — a DB lookup that can cross org boundaries for a system_admin who has switched orgs via the `X-Org-Id` header (auth.ts:142 sets `req.orgId` from the header). The other 2 (`auth.ts:231`, `clientErrors.ts:72`) are audit-logging payloads where the user's home org is arguably correct — assumed to be the legacy baseline. | medium | high — gate output is deterministic; mechanical fix; portal.ts edits localised | Replace `req.user!.organisationId` with `req.orgId!` in `server/routes/portal.ts` (10 lines). Defer auth/clientErrors review to F5 follow-up. | **2** |
| F2 | `scripts/verify-rls-protected-tables.sh` exits 123 with empty output on Git Bash for Windows. `bash -x` shows execution reaches the rename-map xargs/sed step then trips the EXIT trap. `set -euo pipefail` + an `xargs grep` with no matches likely returns a non-zero that the script then propagates. CI on Linux is unaffected, but local-dev gate run is opaque. | low | medium — observed behaviour reproducible; root cause not fully isolated | Wrap `xargs grep -hoE …` invocations with `\|\| true` to tolerate empty input, OR move the rename-map detection into a helper function with explicit zero-match handling. Defer — requires careful regression test on Linux. | 3 |
| F3 | `verify-rls-contract-compliance.sh` allowlists `server/services/` as a directory where raw `db` import is permitted. 231 of 526 service files use raw `db`; only 85 use `getOrgScopedDb()`. Services that hit tenant-scoped tables (e.g. `permissionSetService.listForOrg`, `agentExecutionService.executeRun`) do their `db.select(...)` calls OUTSIDE the ALS `withOrgTx` block and rely on the app-layer `where(eq(table.organisationId, orgId))` filter only. In prod, RLS-as-defence-in-depth depends on whether the app DB role enforces RLS — `tasks/todo.md` TI-008 tracks this as an open dev-side gap. | medium | medium — architectural; coverage gap rather than a specific vulnerability | Architectural; per-service migration to `getOrgScopedDb()` for tenant-scoped queries. Strengthen `verify-with-org-tx-or-scoped-db.sh` (already in `run-all-gates.sh`) to flag service-tier raw-db calls on tenant tables. | 3 |
| F4 | `agentExecutionService.executeRun` (the main run entrypoint, 2,807-LOC file) uses raw `db` for tenant-scoped reads at lines 477 (organisations kill-switch), 496 (subaccounts isOrgSubaccount check), 513 (agent_runs idempotency lookup), 540 (subaccountAgents controllerStyle lookup), and elsewhere. Compare to `resumeAgentRun` at line 2452 which uses `getOrgScopedDb('agentExecutionService.resumeAgentRun')`. Same file, mixed posture — the migration toward the scoped-DB pattern is incomplete. | medium | high — direct inspection; the mixed posture is visible at the function level | Migrate `executeRun` to `getOrgScopedDb()`. Wide blast radius — call sites must all run inside `withOrgTx` (HTTP routes do via auth middleware; pg-boss jobs do via `createWorker`; verify scheduled-task and recovery paths). | 3 |
| F5 | `server/routes/agents.ts:36` — `GET /api/agents` has `authenticate` but no `requireOrgPermission` middleware. The handler conditionally branches on `ownerScope === 'user'` and uses `hasOrgPermission(AGENTS_EDIT)` to choose between `listAllAgents` (admin) and `listAgents` (default). Any authenticated user — including a user with zero agent permissions — can call this endpoint and receive an org-scoped agent list. Other routes (`/api/agents/:id`) gate via `requireOrgPermission(AGENTS_VIEW)`. | low | medium — may be intentional product policy ("everyone sees their own owned agents"); not a confirmed gap | Either add `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` at the route level for consistency, OR add an inline comment documenting the intent (e.g. "everyone may list owned agents; AGENTS_VIEW gates the full-org view"). Requires product call. | 3 |

---

### Agent-execution area — findings

| # | Finding | Severity | Confidence | Justification | Proposed fix | Pass |
|---|---|---|---|---|---|---|
| F6 | God-files persist after the operator-stated split:<br>• `server/services/skillExecutor.ts` = **6,133 LOC** (4× soft cap 1,500; 2.4× hard cap 2,500 — framework §6 Area 10)<br>• `server/services/agentExecutionService.ts` = **2,807 LOC** (over hard cap)<br>• `server/services/agentExecutionLoop.ts` = 1,415 LOC (over soft cap)<br>The `*Pure.ts` companions landed (`agentExecutionServicePure.ts` 608 LOC, `skillExecutorPure.ts` 99 LOC, `skillExecutorDelegationPure.ts` 171 LOC), but the main files remain large. | medium | high — `wc -l` is deterministic | Further splits — Area 10 rule: splits are NEVER pass-2 in an audit, always pass-3. Recommended next: extract `executeRun` into a per-phase set of pure helpers; isolate handoff logic from `skillExecutor.ts` into its own module. | 3 |
| F7 | `server/services/skillExecutor.ts:4302` — single raw `db.update(tasks)` write to a tenant-scoped table. Carries a `guard-ignore-next-line` annotation citing prior `taskService.updateTask` org verification. The trust chain is fragile: `taskService.updateTask` closes its own tx; the immediately-following `db.update` opens a fresh unscoped tx that bypasses the original org verification's tx context. In prod with RLS-enforcement role, this write would silently match zero rows. | medium | medium — same root cause as F3; defence relies on RLS enforcement at the prod role | Migrate to `getOrgScopedDb()` and pass the active tx through. Defer to the F3 / F4 cluster. | 3 |
| F8 | `server/routes/agentRuns.ts:54-55` — manual idempotency key fallback `manual:${agentId}:${subaccountId}:${userId}:${taskId??'heartbeat'}:${Math.floor(Date.now()/10000)}` quantises to 10-second buckets. Two distinct intentional triggers within the same 10s window (e.g. user clicks "Run" twice fast on different tasks where `taskId` is unset → both default to 'heartbeat') would collide and the second deduplicates against the first. Mitigation: caller supplies an explicit `idempotencyKey` to disambiguate. | low | medium — observed pattern; impact is rare and recoverable (user retries) | Document the 10-second-bucket trade-off in code; consider including a request-scoped UUID rather than time-bucketing for the default key. Defer — requires product judgement on retry semantics. | 3 |
| F9 | `server/routes/agents.ts` and `server/routes/agentRuns.ts`: lifecycle permission gates verified — `authenticate` + `requireOrgPermission(AGENTS_EDIT)` on every run-start endpoint; `resolveSubaccount(subaccountId, req.orgId!)` invoked correctly; `req.orgId!` used uniformly (no `req.user!.organisationId` slips here). No findings. | — | — | No issue — recording as completed check, not a finding. | — |

---

## Prevention Proposals

Aggregated across F1–F8 (framework §11). Every prevention is pass 3 per Rule 16; the prevention column controls what gets routed to `tasks/todo.md` under `## Prevention proposals from codebase audit`.

| # | Target | Leverage tier | Proposed addition | Closes findings | Severity blocked | Notes |
|---|---|---|---|---|---|---|
| P1 | `gate` | 1 (block at write time) | Tighten `verify-org-id-source.sh` default exit code from 2 (warning) to 1 (blocking) for any post-baseline regression. Currently new code can warn-and-merge without flipping CI red. Pairs with a baseline freeze: any future increase requires explicit baseline bump in the same commit. | F1 | medium | Baseline file already exists at `scripts/guard-baselines.json`. Requires `run-all-gates.sh` audit-style behaviour, not full strict mode. |
| P2 | `gate` | 1 | Make the existing `verify-with-org-tx-or-scoped-db.sh` aware of service-tier raw-db query patterns on tenant-scoped tables — flag any `db.(select\|insert\|update\|delete)(<RLS_PROTECTED_TABLE>)` inside `server/services/` that does not have a sibling `getOrgScopedDb()` call in the same function scope. Allowlist via `guard-ignore`. | F3, F4, F7 | medium-high | Gate exists; the check needs widening. Avoids the false-negative caused by the `server/services/` directory allowlist in `verify-rls-contract-compliance.sh`. |
| P3 | `gate` | 1 | Add a Windows-portable harness test (CI Linux only is fine — the goal is the script behaving the same on both OSes). For each `scripts/verify-*.sh`, run on a freshly-cloned repo and assert exit ∈ {0, 1, 2} AND non-empty stdout. Catches scripts that silently die under `set -euo pipefail` + Git Bash quirks. | F2 | low | Cheap to add; runs in <1 min. |
| P4 | `DEVELOPMENT_GUIDELINES.md` | 2 (convention at design time) | Add a §-style rule: "Services that read or write tenant-scoped tables MUST use `getOrgScopedDb()` for the active tx handle. Raw `db.X()` calls are allowed only inside `withAdminConnection(...)` blocks or for tables in `rls-not-applicable-allowlist.txt`." | F3, F4, F7 | medium | Companion to P2 — the gate enforces, the doc explains. |
| P5 | `architecture.md` | 2 | Document the mixed posture in `agentExecutionService.ts`: `executeRun` runs on raw `db` (pre-migration), `resumeAgentRun` runs on `getOrgScopedDb`. State the target and link to the F4 todo entry. Prevents future maintainers from assuming the file is fully migrated. | F4 | medium | One paragraph. |
| P6 | `KNOWLEDGE.md` | 3 (lesson via context) | Pattern entry: "audit run found god-files persisting after a 'split' commit — `skillExecutor.ts` was claimed split but is still 6,133 LOC. Splits should produce a single PR that drops the original file under its hard cap, not just adds a `*Pure.ts` companion." | F6 | medium | Captures the observation; behavioural change is product-level. |

No prevention-proposal entries marked "not feasible".

---

## Pass 2 Changes Applied

### F1 — `server/routes/portal.ts` org-id-source mechanical fix

**Change intent.** This area modifies 1 file, affecting 1 route module, with low risk profile. Primary concern: closing the `verify-org-id-source.sh` regression by replacing `req.user!.organisationId` with `req.orgId!` at 10 call sites.

| Fix | Classification | Confidence | Justification | Files Modified |
|---|---|---|---|---|
| Replace `req.user!.organisationId` → `req.orgId!` at lines 46, 100, 126, 148, 184, 210, 231, 259, 295, 342 (10 sites) | bug fix (closes a documented org-switching bypass for system_admin) | high | (1) gate-script output is deterministic — 12 → 2 violations confirmed post-fix; (2) localised to a single file; (3) `req.orgId` is set by the authenticate middleware (`server/middleware/auth.ts:142`) to `payload.organisationId` for normal users and to the validated `X-Org-Id` header for system_admin org-switching — semantics-preserving for normal users, semantics-correcting for admins; (4) downstream consumer (`resolveSubaccount`) signature is `(subaccountId: string, organisationId: string)` — identical type. | `server/routes/portal.ts` |

#### Validation Results

| Check | Exact Command | Outcome |
|---|---|---|
| Server typecheck | `npm run typecheck:server` | 2 pre-existing errors in unrelated files (`configDocumentGeneratorService.ts:76` missing `docx`, `configDocumentParserService.ts:101` missing `mammoth`). Pre-existence confirmed via `git stash && npm run typecheck:server` — same errors. **N/A — pre-existing, not introduced by this change.** |
| Client build | `npm run build:client` | N/A — no client/ files changed |
| Static gates | `npm run test:gates` | Not run locally — CI-only per `references/test-gate-policy.md`. Specific gate `verify-org-id-source.sh` ran: violations 12 → 2 (below baseline 3). |
| Targeted unit tests | `npx vitest run …` | N/A — no test files authored or modified in this change |
| Lint | `npx eslint server/routes/portal.ts` | PASS — no output |
| Skill visibility | `npm run skills:verify-visibility` | N/A — no skill files changed |
| Playbooks | `npm run playbooks:validate` | N/A — no `server/lib/workflow/` files changed |

Commit: `bebbb75e — audit: F1 — portal.ts org-id-source mechanical fix`.

---

## Pass 3 Items (Awaiting Human Decision)

Cross-listed in `tasks/todo.md` under `## Deferred from codebase audit — 2026-05-14 (Track A: RLS + agent-execution)`.

| Item | Area | Severity | Confidence | Reason for Escalation | Recommendation |
|---|---|---|---|---|---|
| F2 | RLS gate tooling | low | medium | Root cause not fully isolated — needs Linux regression test | Investigate `xargs grep` portability; wrap with `\|\| true` |
| F3 | RLS coverage / Module I | medium | medium | Architectural — 231 service files touched; per-service work | Pair with P2 / P4 prevention work |
| F4 | Agent-execution / Module I | medium | high | Architectural — wide blast radius across `executeRun` call sites | Migrate to `getOrgScopedDb()` with call-site audit |
| F5 | Agent-execution / Module A | low | medium | Requires product call on intent | Either gate route, or document intent |
| F6 | God-files / Area 10 | medium | high | Per framework Area 10, splits are NEVER pass 2 | Per-phase decomposition of `executeRun` + handoff extraction |
| F7 | Skill executor / Module I | medium | medium | Same root cause as F3 / F4 | Migrate to `getOrgScopedDb()` |
| F8 | Agent-execution / idempotency | low | medium | Product judgement on retry semantics | Document trade-off; consider UUID default |

---

## Patterns Captured to KNOWLEDGE.md

| Pattern title | Trigger | KNOWLEDGE.md entry |
|---|---|---|
| `verify-rls-contract-compliance.sh` allowlists `server/services/` and lets raw-`db` queries on tenant tables slip through | F3 / F4 / F7 finding cluster — gate gives a false sense of coverage | `[2026-05-14] Pattern — verify-rls-contract-compliance.sh allowlists server/services/ and lets raw-db queries on tenant tables slip through` |
| Mixed scoped-vs-raw DB posture inside a single service file is the signal of an incomplete migration, not a stable design | F4 finding — `agentExecutionService.ts` mixed posture | `[2026-05-14] Pattern — Mixed scoped-vs-raw DB posture inside a single service file is the signal of an incomplete migration, not a stable design` |
| God-files persist after a "split" commit — the `*Pure.ts` companion landed; the main file did not shrink | F6 finding — `skillExecutor.ts` still 6,133 LOC | `[2026-05-14] Pattern — God-files persist after a "split" commit — the *Pure.ts companion landed; the main file did not shrink` |

---

## Summary

| Field | Value |
|---|---|
| Overall Status | PASS (pass 2 fix landed cleanly; pass 3 deferred per operator brief) |
| Critical findings | 0 |
| High findings | 0 |
| Medium findings | F1, F3, F4, F6, F7 — 5 |
| Low findings | F2, F5, F8 — 3 |
| Fixes applied (pass 2) | 1 (F1 — 10 mechanical edits in 1 file) |
| Files modified | 1 (`server/routes/portal.ts`) |
| Items deferred to pass 3 (symptom fixes, in `tasks/todo.md`) | 7 (F2, F3, F4, F5, F6, F7, F8) |
| Prevention proposals (root-cause fixes, in `tasks/todo.md`) | 6 — breakdown: `gate` × 3 (P1, P2, P3) + `DEVELOPMENT_GUIDELINES.md` × 1 (P4) + `architecture.md` × 1 (P5) + `KNOWLEDGE.md` × 1 (P6) |
| KNOWLEDGE.md entries appended | 3 (RLS gate allowlist gap, mixed-posture service file, god-file post-split persistence) |
| Checkpoint tags created | none (single pass-2 commit, no per-area tagging needed for this audit shape) |
| Linked `pr-reviewer` log | _(filled when run)_ |
| Linked `spec-conformance` log | _(filled when run)_ |
| Linked `dual-reviewer` log | not requested |

---

## Post-audit actions required

The caller (this main session) runs the following before declaring the audit complete:

1. `spec-conformance: verify the audit branch audit/track-rls-agent-exec against its spec` — treat as a sanity check (no spec exists for this audit; the framework `docs/codebase-audit-framework.md` is the implicit contract).
2. `pr-reviewer: review the audit branch audit/track-rls-agent-exec. Files changed in pass 2: server/routes/portal.ts. Audit log: tasks/review-logs/codebase-audit-log-rls-agent-exec-2026-05-14T13-14-38Z.md.`

No spec-driven contract was touched by pass-2 changes — `spec-conformance` is run as a sanity check only.

---

## Recommended Next Steps

- Open the PR titled `audit: track A — RLS + agent-execution (post-refactor)` after `pr-reviewer` returns.
- Coordinate with Tracks B and C to merge in series (per framework parallel-mode preconditions §parallel mode — pass-2 PRs merged sequentially).
- Schedule a follow-up sprint to address the F3 / F4 / F7 cluster (services using raw `db` on tenant-scoped tables). Pair with P2 prevention work so the gate catches future regressions.
- Decide product policy on F5 (`GET /api/agents` permission gate) and apply the chosen fix.
- Decide product policy on F8 (manual-run idempotency key 10-second bucket).
- Plan further god-file decomposition for F6 — start with `agentExecutionService.executeRun` per-phase split.


