# Dual Review Log — consolidation-operate

**Files reviewed:** Full branch diff vs `main` (~6k LOC, 42 files; ui-consolidation-operate Phase 2 build)
**Iterations run:** 2/3
**Timestamp:** 2026-05-07T20:58:57Z
**Codex version:** codex-cli 0.125.0 (model: gpt-5.5)

---

## Iteration 1 — `codex review --base main`

Codex returned 3 [P2] (medium-severity) findings against the full branch diff.

### [REJECT] server/services/inboxService.ts:522-527 — Banded inbox omits `kind:'approval'` rows
**Codex finding:** "When there are pending approval actions (`actions.status='pending_approval'`), `/api/inbox` never returns them because the new banded listing only reuses `getUnifiedInbox`, which fetches tasks, review_items, and agent_runs. The approve/reject handlers support `kind:'approval'`, but those items are unreachable from the UI unless actions are included in this union before band derivation."

**Reason:** Pre-existing behaviour — not a regression introduced by this branch. The codebase before C2 already excludes `kind:'approval'` from `getUnifiedInbox` (see line 11 type `EntityType = 'task' | 'review_item' | 'agent_run'` and the explicit comment at line 727 documenting that approval-kind items are intentionally not emitted yet because `inbox_read_states` has no canonical entityId for them). C2 added the action handlers `approveItem` / `rejectItem` for `kind:'approval'` *forward-looking* but did NOT introduce the union gap Codex describes. Spec §4.2 lists `'approval'` in the InboxItem.kind enum aspirationally; the spec does not require this build to wire approval rows into the union — that requires defining the canonical entityId mapping in `inbox_read_states`, which is a follow-on chunk's worth of design. Logged as Phase 3 deferred item OPER-DEF-3.

### [ACCEPT] client/src/App.tsx:506 — Scoped redirect drops `subaccountId`
**Codex finding:** "When a user opens a scoped activity URL such as `/admin/subaccounts/:subaccountId/activity`, this redirects to plain `/activity`, and the new Activity page always calls the org endpoint. That drops the subaccount/system scope and shows the wrong activity feed; the redirect/page needs to preserve the scope."

**Reason:** Real, introduced by this branch. The C8 `operateRedirects.ts` helper exists exactly for this pattern (locked grammar, used by 3 existing redirects), but the activity scope redirect at App.tsx:506 was using a bare `<Navigate to="/activity" />` instead of going through the helper. Fixed by adding `AdminSubaccountActivityRedirect` mirroring `SubaccountAgentInboxRedirect` at lines 332-345 — promotes `subaccountId` per locked grammar, preserves search + hash. This makes the URL lossless at the redirect boundary even before downstream page-level URL-param wiring lands (Phase 3 follow-up — OPER-DEF-4).

### [REJECT] client/src/lib/api.ts:138 — `fetchInbox` doesn't forward `subaccountId`
**Codex finding:** "When `/subaccounts/:subaccountId/agent-inbox` redirects to `/inbox?subaccountId=...`, the page still loads the org-wide inbox because `fetchInbox` only sends `band` and `q`. The backend route already accepts `subaccountId`, so workspace-scoped inbox links now show items from all org inbox-enabled workspaces."

**Reason:** Real but adding `subaccountId` to the wrapper alone is dead code — `InboxPage.tsx` doesn't read `subaccountId` from URL search params today, so the wrapper change has nothing to call it with. The complete fix requires `useSearchParams` wiring in InboxPage + ActivityPage (read `subaccountId` from URL, thread into `fetchInbox` / `fetchActivity` calls, render workspace-scoped header chip). That's a real Phase 3 implementation chunk, not a 1-line dual-reviewer fix. Per dual-reviewer rule "less change is safer than a wrong change", reject the wrapper-only patch and route the full Phase 3 wiring as deferred item OPER-DEF-4 (covering both inbox + activity).

---

## Iteration 2 — `codex review --uncommitted`

Verified the App.tsx fix in isolation. Codex output: *"The change introduces a scoped activity redirect that preserves query/hash state and promotes the subaccount id consistently with the existing redirect helper. I did not find any discrete correctness issues in the modified code."*

Loop termination triggered — Codex returned no findings on iteration 2.

---

## Changes Made

- `client/src/App.tsx` — added `AdminSubaccountActivityRedirect` component (lines 348-368) mirroring the existing `SubaccountAgentInboxRedirect` pattern; replaced bare `<Navigate to="/activity" />` at line 506 with `<AdminSubaccountActivityRedirect />` so subaccount-scoped activity URLs preserve `subaccountId` as a query param per the C8 locked redirect grammar.

## Rejected Recommendations

- **inboxService approval-kind union gap** — pre-existing, intentional per code comments; spec §4.2 enum is forward-looking. Routed as `OPER-DEF-3` for Phase 3 follow-up.
- **fetchInbox subaccountId forwarding** — wrapper change without page-side URL-param consumption is dead code; full fix requires page-level wiring on both InboxPage and ActivityPage. Routed as `OPER-DEF-4` for Phase 3 follow-up.

---

## Post-fix gates

- `npm run lint` — 0 errors / 865 warnings (matches branch baseline; no new warnings introduced).
- `npm run typecheck` — clean.

---

**Verdict:** APPROVED (2 iterations, 1 redirect fix applied, 2 directional gaps deferred to Phase 3)
