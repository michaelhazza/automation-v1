# Codebase Audit Report — Track A (RLS + agent-execution, post-refactor)

| Field | Value |
|---|---|
| Audit framework version | 1.4 |
| Project | automation-v1 |
| Audited by | Claude Code (main session, inline audit-runner playbook) |
| Date | 2026-05-14 |
| Branch | audit/track-rls-agent-exec |
| Starting commit SHA | 4b3c4f2f347e620db932962c2ae67894b491ee15 |
| Final commit SHA | _(filled at finish)_ |
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

_(populated by the running audit — see sections below as they are filled in)_

