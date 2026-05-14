# Codebase Audit Report — pre-v1-lockdown

| Field | Value |
|---|---|
| Audit framework version | v1.3 + PR #301 (Area 10) + PR #303 (Rule 16) — see `docs/codebase-audit-framework.md` |
| Project | automation-v1 |
| Audited by | Claude Code (main session) |
| Date | 2026-05-14 |
| Branch | audit/full-pre-v1-lockdown-2026-05-14 |
| Starting commit SHA | 34eda8967d508e76ebe4aa63f5765e1de9526228 |
| Final commit SHA | (pass 1 only — branch state may grow as log + progress file commit) |
| Mode | Full audit, exclusive (operator declined `parallel` flag) |
| Layers run | Layer 1 Areas 1–10. Layer 2 Modules I, J, K, L, M, C. Skipped Modules A, B, D, E, F, G, H per operator instruction |
| Subagents invoked | None — playbook mandates direct execution |
| Linked review logs | (none yet — pass 2 / pr-reviewer not run in this session) |
| Pass gate posture | Operator requested **Pass 1 only**. STOP at findings gate. Do not interpret silence as confirmation. |

---

## Reconnaissance Map

Pre-filled context block from §2 of the framework, with audit-specific addenda below.

### §2 context-block staleness — surfaced before pass 1

Per the playbook ("If §2 appears stale vs current `package.json` / repo state, surface that to the user"), the following §2 entries are stale on the current framework head (34eda896):

| §2 row | Stale value | Actual value | Evidence |
|---|---|---|---|
| Test framework | "None canonical — bare `tsx` runners under `server/**/__tests__/` (NO Vitest, NO Jest)" | Vitest is the canonical runner | `package.json` line 38: `"test:unit": "vitest run"`; `@vitest/coverage-v8@^2.1.9` installed (line 111); `docs/testing-conventions.md` confirms |
| Lint command | "**None defined** (`npm run lint` does not exist — do not invent it)" | `npm run lint` exists and runs eslint | `package.json` line 19: `"lint": "eslint ."`; line 20: `"lint:fix": "eslint . --fix"`; eslint deps lines 95, 115–116, 122 |
| Test commands | lists `npm test` (gates → qa → unit) — accurate | accurate, but Vitest now the runner under the hood | n/a |

Routed to `tasks/todo.md` as Module D doc-drift finding (`docs/codebase-audit-framework.md` §2 must be updated alongside the Vitest migration that already shipped).

### Audit-specific addenda

| Item | Value |
|---|---|
| In-scope paths | `server/`, `client/`, `shared/` (full audit) |
| Out-of-scope paths | `node_modules/`, `dist/`, `migrations/` (sealed), generated files |
| In-flight branches | `claude/personal-assistant-post-merge-audit` (originating branch — clean), `origin/audit/full-codebase-2026-04-25` (stale from prior full audit — artifacts shipped via `audit-remediation`) |
| Open PRs touching same surface | Personal Assistant V2 plan locked on originating branch (no code changes yet — Phase 2 stopped at plan gate) |
| Critical-path coverage assessment | `gates only` for most areas; `gates + sparse unit` for RLS context propagation, idempotency, agentRunVisibility |
| Implicit external contracts identified | Portal client API `/portal/<slug>/*`; webhook adapter intake (Slack, HubSpot, GHL, Stripe, Teamwork, GitHub, Gmail); MCP tool surface; pg-boss job payload shapes; three-tier agent execution contract; `actionRegistry` slugs |
| State / side-effect systems identified | pg-boss queue, withBackoff retry, runCostBreaker, rateLimiter, webhookDedupe, agentExecutionService, memoryWeeklyDigestJob, scheduleCalendarServicePure, prompt-prefix cache |
| Protected files in scope | All per framework §4 — flagged at finding time |

---

## Pass 1 Findings

(Sections appended as each area / module completes.)

---

## Prevention Proposals

(Aggregated after all areas walked.)

---

## Pass 2 Changes Applied

(N/A — pass 2 not executed in this run.)

---

## Pass 3 Items (Awaiting Human Decision)

Cross-listed in `tasks/todo.md` under `## Deferred from codebase audit — 2026-05-14` (added at findings gate).

---

## Patterns Captured to KNOWLEDGE.md

(Appended after findings gate.)

---

## Summary

(Filled at findings gate.)

---

## Post-audit actions required

(Listed at findings gate.)

---

## Recommended Next Steps

(Listed at findings gate.)
