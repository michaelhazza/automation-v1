# Codebase Audit Report — full

| Field | Value |
|---|---|
| Audit framework version | v1.3 (`docs/codebase-audit-framework.md`, calibrated 2026-04-25) |
| Project | automation-v1 |
| Audited by | Claude Code (audit-runner agent, inline mode) |
| Date | 2026-04-25 |
| Mode | Full |
| Branch | `claude/audit-runner-full-MwZlO` (caller-supplied; framework default shape is `audit/full-<date>`) |
| Starting commit SHA | `88dcbee402e47c45cc2228d5757feb610d3f0da4` |
| Final commit SHA | _(TBD at completion)_ |
| Layers run | Layer 1 areas 1–9. Layer 2 modules A–M. |
| Sub-agents invoked | None (inline mode per agent definition). |
| Linked review logs | `pr-reviewer` / `spec-conformance` to be run by caller post-audit. |

---

## Framework §2 stale-fact check

Re-validating §2 context block against repo state:

| §2 fact | Status | Notes |
|---|---|---|
| npm package manager | OK | `package-lock.json` present. |
| ES modules | OK | `"type": "module"` in `package.json`. |
| TypeScript `^5.3.3` | OK | Matches `package.json` devDependencies. |
| Express `^4.18.2` | OK | Matches. |
| React `^18.2.0` | OK | Matches. |
| Vite `^5.4.21` | OK | Matches. |
| Drizzle `^0.45.1` | OK | Matches. |
| pg-boss `^9.0.3` | OK | Matches. |
| Langfuse `^3.38.6` | OK | Matches. |
| Tailwind `^4.2.2` | OK | Matches. |
| `npm run build:server` typecheck | OK | Script exists. |
| `npm run test:gates` | OK | Script exists. |
| `server/instrumentation.ts` (`withOrgTx`) | OK | Path exists. |
| `server/lib/orgScopedDb.ts` (`getOrgScopedDb`) | OK | Path exists. |
| `server/lib/agentRunVisibility.ts` | OK | Path exists. |
| `scripts/gates/*.sh` gate location | **STALE** | Gates live at `scripts/verify-*.sh` directly, not under `scripts/gates/`. `scripts/run-all-gates.sh` calls them via `$SCRIPT_DIR/verify-*.sh`. This affects §2 and §4 path references. Recorded as FW-1 finding below. |

**Conclusion.** Framework §2 is largely accurate but path references to `scripts/gates/*.sh` are wrong (twice in §2, once in §4 Protected Files, once in Module I). Verbatim on framework edits is Pass-3 per Scope Guard + the framework-updating rules in §10. Recorded as a framework-documentation finding.

---

## Reconnaissance Map

| Item | Value |
|---|---|
| In-scope paths | `server/` (1,028 ts/tsx), `client/` (282 ts/tsx), `shared/` (19 ts/tsx). Plus all `docs/*.md`, `scripts/*.sh`/`.ts`, `server/skills/*.md` for context |
| Out-of-scope paths | `dist/`, `node_modules/`, `migrations/` (sealed), `_deprecated_iee/`, `tests/trajectories/` (advisory reference) |
| In-flight branches | `feat/clientpulse-ui-simplification` (PR #187, merge-ready), `claude/system-monitoring-agent-PXNGy` (PR #188, merge-ready), `bugfixes-april26` (PR #185, merge-ready). Any collision with these is immediate pass-3 per Rule 15 |
| Open PRs on same surface | #185, #187, #188 — all awaiting merge. Audit must not touch the same files |
| Critical-path coverage assessment | `gates + sparse unit`. Per framework §2 "treat coverage as low for Rule 9 trust-model purposes unless the specific path being changed has named test coverage" |
| Implicit external contracts identified (Rule 4) | Webhook payload/signing (`server/routes/webhooks.ts`, `webhookAdapter.ts`), pg-boss job payloads (`server/jobs/`, `server/config/jobConfig.ts`), persisted JSON columns (`agent_runs.execution_log`, `geo_audit.dimension_scores`, `agent_run_llm_payloads`), skill markdown structure + `actionRegistry` entries, three-tier agent contracts (`shared/types/agentExecution.ts`), portal `/portal/<slug>/*` APIs, visibility rules (`server/lib/agentRunVisibility.ts`, `agentRunPermissionContext.ts`) |
| State / side-effect systems identified (Rule 13) | Shared mutable state in `server/lib/` caches (skill text, model registry, prompt prefix), pg-boss queue, webhook receivers, `scheduled_tasks` cron, `runCostBreaker.ts`, `rateLimiter.ts`, `withBackoff.ts`, agent execution loop, memory + briefing extraction, TTL/retention (`llm_requests_archive`, tiered payload retention) |
| Protected files identified in scope | All of `server/db/schema/*.ts`, `migrations/*.sql` (sealed), `server/config/rlsProtectedTables.ts`, `server/instrumentation.ts` (`withOrgTx`), `server/lib/orgScopedDb.ts` (`getOrgScopedDb`), `server/lib/agentRunVisibility.ts`, `server/lib/agentRunPermissionContext.ts`, `server/jobs/*` (pg-boss), `server/config/actionRegistry.ts`, `server/config/jobConfig.ts`, `server/config/universalSkills.ts`, `server/config/modelRegistry.ts`, `server/lib/skillVisibility.ts`, `server/lib/withBackoff.ts`, `server/lib/rateLimiter.ts`, `server/lib/runCostBreaker.ts`, `server/skills/*.md`, `server/adapters/*`, `server/routes/webhooks.ts`, `server/routes/webhookAdapter.ts`, `server/services/webhookAdapterService.ts`, `server/lib/webhookDedupe.ts`, `server/services/agentExecution*.ts`, all `scripts/verify-*.sh` (CI law), `docs/capabilities.md`, `docs/frontend-design-principles.md`, `.claude/agents/*`, `.claude/hooks/*.js` |

---

## Pass 1 Findings

_(Populated per area / module below as audit proceeds.)_
