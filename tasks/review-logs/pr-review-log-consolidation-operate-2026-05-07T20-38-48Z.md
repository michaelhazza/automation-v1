```pr-review-log
# PR Review — consolidation-operate

**Files reviewed:** 38 (server + client + shared types + plan/handoff/docs).
**Run at:** 2026-05-07T20:38:48Z
**Branch:** ui-consolidation-operate (24 commits ahead of origin/main, not yet pushed)
**Base:** origin/main (79a95a52)
**Reviewer:** feature-coordinator inline (Opus equivalent, read-only walk over diff + spec + plan)

**Verdict:** APPROVED (0 blocking, 4 strong, 6 non-blocking)

---

## Blocking Issues

None. Conventions, security, correctness, contracts, three-tier model — all compliant.

## Strong Recommendations

- **S-1 — `fetchRunTrace` stub returns hard-coded empty array (`client/src/lib/api.ts`).** The wrapper exists but is never wired — `RunTraceEventRenderer.tsx:186-188` calls `api.get('/api/agent-runs/:id/trace-events')` directly and decodes its own response shape. Two outcomes: (a) drop the stub from `api.ts` (cleaner — the wrapper is dead code), OR (b) wire `RunTraceEventRenderer` to consume `fetchRunTrace` so the API surface is centralised like the other wrappers. Recommend (a) — the stub's `Promise.resolve({ events: [] })` cannot be revived later because the real endpoint emits `{ data: RunTraceToolCallProjection[] }`, NOT `{ events: RunTraceEvent[] }`. The two shapes (`RunTraceToolCallProjection` vs the discriminated `RunTraceEvent` union in `shared/types/operate.ts`) diverge — choose one. If keeping the discriminated union for future event types, document why and leave the stub; if dropping it, simplify the operate.ts types.

- **S-2 — `RunTraceEventRenderer` does not consume the `embedded` prop (`client/src/pages/operate/components/RunTraceEventRenderer.tsx:176`).** Prop named `_embedded` to silence the unused-vars lint. The C4 recursion-guard invariant in `RunTracePage.tsx:1-21` requires this prop be propagated forward — today the renderer has no run-id-link or "open in modal" affordance, so the prop is correctly unused. Comment at line 173-175 documents this. Strong rather than blocking because the comment is sufficient documentation today, but recommend hardening: a single test or runtime assertion that fires if a future contributor adds an affordance without checking `embedded`. E.g. an exported predicate `assertEmbeddedSafe(embedded)` that the renderer calls before rendering modal-launching elements. Alternatively, leave as-is and rely on the comment + spec-conformance check to catch regressions.

- **S-3 — Sidebar does not expose `/inbox` and `/activity` for workspace/org users (`client/src/config/sidebar.ts`).** Routes are reachable via direct URL but absent from sidebar nav (only `sys-activity` for system_admin). Spec §5 file inventory + plan §C8 explicitly call for adding rows under the Work group. Already routed to `tasks/todo.md` as OPER-DEF-2 by spec-conformance — flagging here for visibility. Suggested approach: add `staticRoute('/inbox')` and `staticRoute('/activity')` items to the Work group, gated to users with `subaccount.executions.view` / `subaccount.review.view` (or equivalent). Single-row-per-stream policy is preserved.

- **S-4 — InboxBand uses uniform `bg-slate-50 border-y` with no per-band color treatment (`client/src/pages/operate/components/InboxBand.tsx:67-70`).** Spec §4.6 calls for red (HIGH PRIORITY), amber (NEEDS ACTION), slate (PREVIOUS) left borders. Bands are functional and labeled — this is cosmetic. Already routed to `tasks/todo.md` as OPER-DEF-1 by spec-conformance — flagging here for visibility. Suggested approach: switch on `band` to render `border-l-4 border-l-{red-500|amber-500|slate-300}`.

## Non-Blocking Improvements

- **N-1 — Dynamic `await import()` of pure helper (`server/routes/agentRuns.ts:216`).** `const { projectForRole } = await import('../services/agentRunMessageServicePure.js');` runs on every request. Top-level static import would avoid the per-request resolution cost. Module is small so the actual delta is negligible, but idiomatic top-of-file imports are preferred. Switch to: `import { projectForRole } from '../services/agentRunMessageServicePure.js';` at file top.

- **N-2 — `IeeProgress.failureReason` declared but never read (`client/src/pages/operate/RunTracePage.tsx:38-43, 158`).** The interface declares the field; the polling logic stores the response into `setIeeProgress`; no UI surface renders it. Either render it inside the indigo IEE panel (line 275-289) so failure reasons surface to the operator, or drop it from the interface to avoid type drift.

- **N-3 — `deepCloneFunction` not needed; `useTileState` could be one-shot (`client/src/pages/operate/HomePage.tsx:81-92`).** The `load` closure is recreated on every render of HomePage and stored back into the tile state's setter. Since `load` is invoked exactly once per tile (in the mount-only `useEffect`), this is functionally correct but slightly verbose. Could be condensed to a single `useState` + plain async function. Cosmetic.

- **N-4 — Inbox approve/reject route trusts client-supplied `kind` (`server/routes/inbox.ts:198-202`).** Adversarial-reviewer flagged as worth-confirming WC-2.1 — safe due to the org+entityId WHERE predicate (UUIDs are unique-per-table so a wrong kind would 0-row UPDATE → alreadyApplied=true, not a privilege escalation). Hardening option: derive `kind` from a server-side lookup. Defer until a use-case demands it.

- **N-5 — Stale doc/comment references to deleted pages.** Several files retain comment references to `RunTraceViewerPage` or `DashboardPage`:
  - `client/src/components/HandoffCard.tsx:5` — "RunTraceViewerPage" in a comment
  - `client/src/components/runs/RunTraceView.tsx:2` — "extracted from RunTraceViewerPage"
  - `client/src/components/recommendations/AgentRecommendationsList.tsx:5` — "Used by DashboardPage"
  - `client/src/components/ExecutionPlanPane.tsx:4` — "Right-hand panel on RunTraceViewerPage"
  - `client/src/lib/runPlanView.ts:6`, `client/src/lib/statusBadge.tsx:5` — both reference RunTraceViewerPage
  - `client/src/pages/__tests__/{DashboardPageOptimiserSection,dashboardVersioning}.test.ts` — test files inline their helper logic; comments still point at the deleted page

  Plan §C8 acceptance criterion: `grep -r "DashboardPage|InboxPage|ActivityPage|RunTraceViewerPage" client/src` should return zero hits. The comment-only references are not functional regressions but are documentation drift. Worth a one-shot sweep: rename "extracted from RunTraceViewerPage" → "extracted from operate/RunTracePage", etc. Cheap to fix; not blocking.

- **N-6 — `client/src/pages/operate/RunTracePage.tsx` keeps the IEE polling logic intact (lines 110-209).** Faithful port from the deleted `RunTraceViewerPage`. The `subaccountIdFromQuery` parsing on line 118 is correct for the C8 redirect grammar (subaccount path-param is promoted to `?subaccountId=` query). No changes needed; calling out for completeness so future readers understand the polling lives here intentionally.

---

## Convention compliance summary

- **Routes**: all use `asyncHandler`; `authenticate` middleware present; no manual try/catch; no direct `db` access in route bodies (the new trace-events route reads `agentRuns` and `agentRunSnapshots` directly to do the org-precheck — acceptable per the existing pattern in this file).
- **Services**: errors thrown as `{ statusCode, message, errorCode? }`; org filters present; soft-delete filter (`isNull(table.deletedAt)`) present where applicable.
- **Client**: new pages use `lazy()` + `Suspense`; permissions-gated UI reads from auth helper; loading/empty/error states handled via PageShell + EmptyState + tile-level inline errors.
- **No new tables, no new migrations, no new permission keys** — spec §6 holds.
- **Static gates clean**: lint (0 errors / 865 baseline warnings), typecheck (clean), build:client (5.88s), build:server (clean).
- **Pure-function tests**: 145/145 passing across 6 files (activityServicePure, inboxServicePure, agentRunMessageServicePure, runTraceEmbeddedPure, operateRedirects + the .worktrees mirror).

---

## Doc-sync coverage check (preview — formal sweep follows)

- `architecture.md`: C9 commit `d091c0ff` updated.
- `KNOWLEDGE.md`: C9 commit `d091c0ff` appended operate-stream patterns.
- `DEVELOPMENT_GUIDELINES.md`: commit `86ae6451` added §8.30 (stable ref maps in React callbacks — pulled from C6 lessons).
- `docs/capabilities.md`, `docs/integration-reference.md`, `docs/frontend-design-principles.md`: out of scope (no capability/integration/UI-pattern shifts in this build).
```
