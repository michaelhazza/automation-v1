# Codebase Audit Report — full

| Field | Value |
|---|---|
| Audit framework version | 1.3 (2026-04-25) |
| Project | automation-v1 |
| Audited by | Claude Code (audit-runner) |
| Date | 2026-04-25 |
| Branch | claude/audit-runner-full-MwZlO |
| Starting commit SHA | edbd1230915177ff0559b3536e5e5c8e2d7f5715 |
| Final commit SHA | _pending_ |
| Layers run | Layer 1 areas: 1–9. Layer 2 modules: A–M (full sweep) |
| Subagents invoked | _pending_ — `pr-reviewer` after pass 2 |
| Linked review logs | _pending_ |

---

## Reconnaissance Map

Pre-filled context block from §2 of the framework, plus audit-specific addenda below.

### Framework context block re-validation (Rule 1, framework §2)

Stack facts spot-checked against `package.json` and on-disk paths:

| §2 claim | Verified | Evidence |
|---|---|---|
| `pg-boss ^9.0.3` canonical | OK | `package.json` deps |
| `drizzle-orm ^0.45.1` | OK | `package.json` deps |
| `react ^18.2.0` + `vite ^5.4.21` | OK | `package.json` deps |
| `@modelcontextprotocol/sdk ^1.29.0` | OK | `package.json` deps |
| `npm run lint` does not exist | OK | scripts block lacks `lint` |
| `npm run build:server` is canonical typecheck | OK | scripts block: `tsc -p server/tsconfig.json` |
| `withOrgTx` in `server/instrumentation.ts` | OK | `test -f` passes |
| `getOrgScopedDb` in `server/lib/orgScopedDb.ts` | OK | `test -f` passes |
| `client/src/main.tsx` entry | OK | `test -f` passes |
| **Gate scripts at `scripts/gates/*.sh`** | **STALE** | Gates live at `/home/user/automation-v1/scripts/verify-*.sh` (48 scripts directly under `scripts/`, no `scripts/gates/` subdirectory). Framework §2, §4, §6 Areas 1, 9, §8 Module I, §13 all reference `scripts/gates/*.sh`. |

**Action:** flagged to user. Framework version stays at 1.3 — audit-runner does not modify the framework mid-run (Rules section). Routed to pass 3 as a framework-doc-update finding.

### Audit-specific reconnaissance

| Item | Value |
|---|---|
| In-scope paths | `server/`, `client/`, `shared/`, `scripts/`, `docs/`, `tasks/`, `migrations/`, `package.json` (full repo) |
| Out-of-scope paths | `node_modules/`, `dist/`, `db-init/` data, `tests/trajectories/recordings/` (run output) |
| In-flight branches | `feat/clientpulse-ui-simplification` (PR #187 merge-ready), `claude/system-monitoring-agent-PXNGy` (PR #188 merge-ready), `bugfixes-april26` (PR #185 merge-ready). Multiple ChatGPT-deferred backlogs already in `tasks/todo.md`. |
| Open PRs touching same surface | PR #187 (frontend, drilldown), PR #188 (system monitoring), PR #185 (skill analyzer). Audit avoids those areas in pass 2. |
| Critical-path coverage assessment | `gates only` for most paths; `gates + sparse unit` for RLS context propagation, `briefArtefactLifecyclePure`, write-guard, lifecycle, rule-policy. Per Rule 9: any pass-2 fix on un-tested logic stays in pass 3. |
| Implicit external contracts identified (Rule 4) | Webhook payload formats (`server/routes/webhooks.ts`), pg-boss job names (`server/config/jobConfig.ts`), agent_runs JSON columns, skill markdown structure, three-tier agent contracts (`shared/types/`), portal API responses, `agent_run_llm_payloads` retention, skill `actionRegistry` slugs |
| State / side-effect systems identified (Rule 13) | pg-boss queue, webhook receivers, scheduled tasks (`scheduleCalendarServicePure.ts`), runCostBreaker, rateLimiter, withBackoff retry primitive, agent execution loop, memory/briefing extraction (`agentBriefingService.ts` + `agentBeliefs` schema), TTL columns / archival cutoffs |
| Protected files identified in scope | All of §4 — RLS plumbing, schema files, gate scripts, job handlers, webhook receivers, agent execution, skill registry, capabilities.md, KNOWLEDGE.md, all `.claude/agents/*.md`, all migrations |

---

## Pass 1 Findings

Findings are recorded per area / module. Each carries severity / confidence / justification / proposed fix / target pass.

