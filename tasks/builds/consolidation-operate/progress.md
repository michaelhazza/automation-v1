# consolidation-operate — Build Progress

**Branch:** `ui-consolidation-operate`
**Spec:** `tasks/builds/consolidation-operate/spec.md` (status: accepted; chatgpt-spec-review APPROVED BUILD WITH CONFIDENCE)
**Plan:** `tasks/builds/consolidation-operate/plan.md` (v1.3, 9 chunks C1–C9)
**Phase 2 completed:** 2026-05-07
**Branch state:** 27 commits ahead of `origin/main`, NOT yet pushed.

## Table of contents

1. What was built
2. Per-chunk commit map
3. Pipeline gate verdicts
4. Doc-sync verdicts
5. pr-reviewer Strong + Non-blocking disposition
6. Deferred items
7. adversarial-reviewer worth-confirming notes
8. Phase 3 next steps

---

## 1. What was built

Phase-2 stream A of the four-spec consolidation programme. Delivers the run-time observation and approvals surface:

- **Home page** (`client/src/pages/operate/HomePage.tsx`) — consolidated dashboard with KPIs, runs chart, recent activity widget. Replaces `DashboardPage.tsx`.
- **Inbox page** (`client/src/pages/operate/InboxPage.tsx`) — three priority bands (HIGH PRIORITY / NEEDS ACTION / PREVIOUS) with deriveBand-based JS classification over the `tasks + review_items + agent_runs + inbox_read_states` union.
- **Activity page** (`client/src/pages/operate/ActivityPage.tsx`) — `<SortableTable>` with multi-select filters, server-resolved filterOptions, drawer + modal interactions, severity legend.
- **Run-trace page** (`client/src/pages/operate/RunTracePage.tsx`) — full-page mode plus `?embedded=1` flag for iframe-embedded modal use; role-aware masking projection over LLM/tool events.

Backend extensions (additive — no new tables, no migrations, no new permission keys):

- `/api/activity` — cursor-paged list, multi-select filters (AND-across-keys / OR-within-key), sortKey + sortDir, filterOptions counts (faceted: pre-pagination, current scope + q applied, dimension-being-counted excluded). Server: `server/services/activityService.ts` + `activityServicePure.ts`.
- `/api/inbox?band=...` — band-derivation listing reusing `getUnifiedInbox`. Action endpoints `POST /:id/{approve,reject,archive}` with state-based idempotency. Server: `server/services/inboxService.ts` + `inboxServicePure.ts`.
- `/api/agent-runs/:id/trace-events` — role-aware masking projection (`projectForRole`) over LLM call args/results. Read-path only. Server: `server/services/agentRunMessageServicePure.ts`.

Router redirects (locked C8 grammar — `client/src/lib/operateRedirects.ts`):
- `/admin/runs/:runId` → `/run-trace/:runId`
- `/admin/subaccounts/:saId/runs/:runId` → `/run-trace/:runId?subaccountId=:saId`
- `/admin/agent-inbox` → `/inbox`
- `/subaccounts/:saId/agent-inbox` → `/inbox?subaccountId=:saId`
- `/admin/subaccounts/:saId/activity` → `/activity?subaccountId=:saId` *(added during dual-reviewer iteration)*
- `/admin/activity` → `/`

---

## 2. Per-chunk commit map

| Chunk | Scope | Commits | Status |
|---|---|---|---|
| C1 | `/api/activity` extension (cursor + filters + sort + filterOptions) | `a7677d9c`, `57fce012`, `7b1d2119` | done |
| C2 | `/api/inbox?band=` + action endpoints + idempotency | `756a06ef`, `b3644820`, `5a7a0576` | done |
| C3 | `shared/types/operate.ts` + api.ts wrappers | `3412b17a`, `264288da` | done |
| C4 | RunTracePage rewrite + embedded-mode flag | `c799fad0`, `586aeb4a` | done |
| C5 | ActivityPage + ActivityRow + ActivityDetailModal + SeverityLegend | `0dfd36ea`, `ad43a67a`, `2ca821f5` | done |
| C5b | Run-trace masking projection + RunTraceEventRenderer | `eeb57b49`, `25800416`, `3e334693` | done |
| C6 | InboxPage with three priority bands + InboxBand + InboxItemCard | `e09d371f`, `904437e8` | done |
| C7 | HomePage with isolated KPIs, runs chart, recent activity | `3e8057eb`, `3a2f77ec` | done |
| C8 | Router wiring, sidebar config, delete old pages, redirect tests | `3fb64acf`, `f4a96b21` | done |
| C9 | Doc-sync (architecture + KNOWLEDGE) + DEV-GUIDELINES §8.30 | `d091c0ff`, `86ae6451` | done |

Post-chunk commits: `a0de762a` (spec-conformance fixes), `c3760d6d` (adversarial + pr-reviewer log bundle), `aaff20a4` (dual-reviewer App.tsx scope-preserving redirect + log).

---

## 3. Pipeline gate verdicts

| Gate | Verdict | Detail | Log |
|---|---|---|---|
| **G2** (lint + typecheck) | PASS | `npm run lint` 0 errors / 865 pre-existing warnings; `npm run typecheck` clean | n/a (gate output) |
| **spec-conformance** | CONFORMANT_AFTER_FIXES | 31 reqs → 29 PASS, 2 DIRECTIONAL_GAP (deferred) | `tasks/review-logs/spec-conformance-log-consolidation-operate-2026-05-07T20-31-55Z.md` |
| **adversarial-reviewer** | NO_HOLES_FOUND | 0 confirmed, 0 likely, 3 worth-confirming notes (WC-1.1, WC-1.2, WC-2.1) | `tasks/review-logs/adversarial-review-log-consolidation-operate-2026-05-07T20-36-46Z.md` |
| **pr-reviewer** | APPROVED | 0 blocking, 4 strong (S-1..S-4), 6 non-blocking | `tasks/review-logs/pr-review-log-consolidation-operate-2026-05-07T20-38-48Z.md` |
| **dual-reviewer** | APPROVED | 2 iterations, Codex 3 [P2] findings → 1 accepted, 2 rejected/deferred | `tasks/review-logs/dual-review-log-consolidation-operate-2026-05-07T20-58-57Z.md` |
| **Doc-sync gate** | PASS | C9 sweep covers all triggered docs; verdicts table below | (verdict table below) |

---

## 4. Doc-sync verdicts (per `docs/doc-sync.md` registry)

- `architecture.md` — yes (Key files per domain table — 9 operate-surface rows; HandoffCard / ExecutionPlanPane / dashboard reactivity / WebSocket rooms / Optimiser scan / delegation-graph references all migrated to `client/src/pages/operate/RunTracePage.tsx` and `client/src/pages/operate/HomePage.tsx`)
- `docs/capabilities.md` — n/a (no add/remove/rename of product capability, agency capability, skill, or integration; existing references are abstract product prose unaffected by file moves)
- `docs/integration-reference.md` — n/a (no scope/skill/status/OAuth/MCP/capability-slug/alias change)
- `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` — yes (DEV-GUIDELINES §8.30 added — stable ref maps in React callbacks; CLAUDE.md unchanged — no fleet/pipeline/locked-rule change)
- `CONTRIBUTING.md` — n/a (no lint-suppression / `// reason:` policy change)
- `docs/frontend-design-principles.md` — no — no new UI hard rule, pattern, or worked example introduced; only consolidated existing pages against existing primitives
- `KNOWLEDGE.md` — yes (5 entries — inbox union naming gotcha, triggerType/triggerSource dual-emit, masking is read-path only, aggregateFilterOptions pre-pagination, cursor walk fixed-direction with display-only sortDir)
- `docs/spec-context.md` — n/a (spec-review sessions only)
- `docs/decisions/` — no — no durable architectural choice locked in this build; consolidation programme decisions live in foundation
- `docs/context-packs/` — no — no architecture.md anchor IDs renamed (only file path values inside table cells)
- `references/test-gate-policy.md` — n/a (no test-gate posture change; build follows `static_gates_primary` per `docs/spec-context.md`)
- `references/spec-review-directional-signals.md` — no — no recurring scope/sequencing/posture call surfaced >2 times by spec-reviewer
- `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` — n/a (repo-specific work; no agent-fleet/conventions layer change)

---

## 5. pr-reviewer Strong + Non-blocking disposition

**Strong items (4):**
- **S-1 — `fetchRunTrace` stub returns hard-coded `{ events: [] }`** while `RunTraceEventRenderer` calls the real endpoint directly. Disposition: documented as deferred (deliberate forward-looking stub). Phase 3 follow-up if discriminated-union `RunTraceEvent` shape needs to converge with server's `RunTraceToolCallProjection`.
- **S-2 — `RunTraceEventRenderer` does not consume `_embedded` prop.** Disposition: documented (lines 173-175 + JSDoc explain prop is propagated forward but not currently used; future affordance must check `embedded`). Comment is sufficient.
- **S-3 — Sidebar does not expose `/inbox` and `/activity`** for workspace/org users. Disposition: routed to `tasks/todo.md` as **OPER-DEF-2**.
- **S-4 — InboxBand uniform color treatment** vs spec §4.6 per-band borders. Disposition: routed to `tasks/todo.md` as **OPER-DEF-1**. Cosmetic.

**Non-blocking items (6):** logged in pr-review log; not separately tracked. Phase 3 chatgpt-pr-review will surface any worth elevating during the merge-ready pass.

---

## 6. Deferred items (Phase 3 / Phase 4 backlog)

- **OPER-DEF-1** — InboxBand per-band color treatment (cosmetic; spec §4.6 directional gap)
- **OPER-DEF-2** — Sidebar Inbox + Activity nav rows for workspace/org users
- **OPER-DEF-3** — Banded inbox does not surface `kind:'approval'` rows (pre-existing union gap; needs `inbox_read_states` entityId mapping for approval-kind)
- **OPER-DEF-4** — InboxPage and ActivityPage do not consume `?subaccountId=` URL param (page-level URL-param wiring — redirect now preserves the scope per locked C8 grammar)

All entries live in `tasks/todo.md` with full rationale and suggested approach.

---

## 7. adversarial-reviewer worth-confirming notes (advisory)

- **WC-1.1, WC-1.2** — defense-in-depth observations on the masking projection
- **WC-2.1** — defense-in-depth observation on cursor-stability under rapid filter churn

Phase 1 advisory; non-blocking. Phase 3 chatgpt-pr-review may elevate any worth pursuing.

---

## 8. Phase 3 next steps

See `tasks/builds/consolidation-operate/handoff.md` for the full Phase 3 (FINALISATION) checklist. Summary: S2 sync from origin/main → G4 regression guard → push branch → `gh pr create` → launch `chatgpt-pr-review` in a fresh Claude Code session via the `final-review` skill → full doc-sync sweep → KNOWLEDGE.md pattern extraction → MERGE_READY.
