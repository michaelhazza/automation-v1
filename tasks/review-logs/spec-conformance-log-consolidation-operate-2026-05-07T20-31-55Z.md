# Spec Conformance Log

**Spec:** `tasks/builds/consolidation-operate/spec.md`
**Plan:** `tasks/builds/consolidation-operate/plan.md` (v1.3)
**Spec commit at check:** `86ae6451`
**Branch:** `ui-consolidation-operate`
**Base:** `79a95a52614a9b39531141422875f1bf67f334cb`
**Scope:** all-of-spec (whole-branch invocation, all 9 chunks C1–C9 marked complete)
**Changed-code set:** 38 files
**Run at:** 2026-05-07T20:31:55Z
**Run by:** feature-coordinator inline (post-build phase, all chunks committed)

## Table of contents

- Summary
- Requirements extracted (full checklist)
- Mechanical fixes applied
- Directional / ambiguous gaps (routed to tasks/todo.md)
- Files modified by this run
- Next step

## Summary

- Requirements extracted: 31
- PASS: 29
- MECHANICAL_GAP fixed: 0
- DIRECTIONAL_GAP deferred: 2
- AMBIGUOUS deferred: 0
- OUT_OF_SCOPE skipped: 0

**Verdict:** CONFORMANT_AFTER_FIXES (no mechanical fixes applied; two named-in-spec UX items deferred — non-blocking, neither affects contracts or runtime correctness)

## Requirements extracted (full checklist)

### §4.1 — Activity API

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1.1 | `GET /api/activity` accepts opaque base64 cursor (createdAt, id) | PASS | `server/routes/activity.ts:17-34` decodeCursor / encodeCursor |
| 1.2 | Multi-select type/status/actor/subaccount/severity filters; AND-across, OR-within | PASS | `activityService.ts:758-769` filterByActor + filterBySubaccount |
| 1.3 | sortKey/sortDir wins over legacy sort enum when both present | PASS | `activity.ts:43-50` precedence + `activityService.ts:785-793` resolveDisplaySort |
| 1.4 | Cursor invariant — secondary tiebreaker always `id`; canonical walk `createdAt DESC, id ASC` | PASS | `activityService.ts:241-267` buildCursorPredicate JSDoc + line 771-783 |
| 1.5 | Cursor mismatch returns page 1 silently, never 400 | PASS | `activity.ts:24-27` decodeCursor returns undefined on parse error |
| 1.6 | Sort stability: every sort includes `id` secondary key | PASS | `activityServicePure.ts:281-315` sortActivityItems applies idAsc in every branch |
| 1.7 | Response envelope `{ items, nextCursor, filterOptions }` | PASS | `activityService.ts:802-916` listActivityItems |
| 1.8 | Faceted-search semantics — counts ignore active filter on the dimension being counted | PASS | `activityServicePure.ts:218-279` aggregateFilterOptions + applyFiltersExcluding |
| 1.9 | filterOptions runs over RLS-filtered, merged set BEFORE pagination | PASS | `activityService.ts:840-867` aggregator before slice with locked-invariant comment |
| 1.10 | `triggerSource` non-nullable on every ActivityItem (`'unknown'` fallback) | PASS | `activityService.ts:336, 588-593, 730` + `activityServicePure.ts:44-53` mapInternalTriggerToSource |
| 1.11 | Cache-Control: private, no-store on activity endpoint | PASS | `activity.ts:96, 118, 139` setHeader on all three scope variants |

### §4.2 — Inbox priority bands + actions

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 2.1 | `GET /api/inbox?band=` with derivation in JS over union | PASS | `inbox.ts:153-177` route + `inboxService.ts:511-551` listInboxByBand + `inboxServicePure.ts:48-78` deriveBand |
| 2.2 | Action endpoints approve/reject/archive (snooze deferred per plan resolved gaps) | PASS | `inbox.ts:190-282`; no `/snooze` route emitted |
| 2.3 | State-based idempotency — second call returns 200 alreadyApplied=true | PASS | `inboxService.ts:562-625` approveItem; review_items WHERE reviewStatus IN ('pending','edited_pending'); actions WHERE status='pending_approval' |
| 2.4 | `inbox_action_not_applicable` returned for non-applicable kind/action combos | PASS | `inbox.ts:209-211, 247-249` 400 with errorCode |
| 2.5 | Reject reason persistence: actions.rejectionComment for approval kind; review_items audit-trail-only | PASS | `inboxService.ts:670-697` rejectItem |

### §4.3 — Run-trace embedded mode

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 3.1 | `?embedded=1` toggles a frontend boolean read once on mount | PASS | `RunTracePage.tsx:56-58` parseEmbeddedFlag invoked via useRef |
| 3.2 | Embedded mode hides chrome; renders `.run-layout` at `100vh` | PASS | `RunTracePage.tsx:304-315` |
| 3.3 | Iframe sandbox: `allow-scripts allow-same-origin allow-forms` | PASS | `RunTraceModal.tsx:49` |
| 3.4 | Recursion guard — embedded run-trace cannot launch another modal/iframe | PASS | `RunTracePage.tsx:1-21` invariant comment + RunIdDisplay plain text |
| 3.5 | Truthy parser accepts `embedded=1` and `embedded=true` only | PASS | `runTraceEmbeddedPure.ts:16-20` |

### §4.4 — Activity modal payload

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 4.1 | Home widget AND Activity modal render from a shared `ActivityItem` shape | PASS | `HomePage.tsx:32, 252` imports from shared/types/operate; `ActivityRow` consumed by both |

### §4.5 — Cross-page workspace switching

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 5.1 | WorkspaceBadge clickable on activity table, drawer, modal, run-trace embedded header | PASS | `RunTracePage.tsx:251-257`, `ActivityPage.tsx:144-148, 237-241` |

### §4.6 — Inbox priority-band UX

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 6.1 | Three bands rendered in spec order | PASS | `InboxPage.tsx:45` BAND_ORDER + `InboxBand.tsx:22-26` BAND_LABELS |
| 6.2 | Default expanded for high+needs_action; collapsed for previous | PASS | `InboxBand.tsx:55-56` defaultExpanded |
| 6.3 | Sticky band header `position: sticky; top: 0` | PASS | `InboxBand.tsx:68` style |
| 6.4 | Per-band visual treatment (red/amber/slate left borders) | DIRECTIONAL_GAP | `InboxBand.tsx` uses `bg-slate-50 border-y` only — no per-band color. Functional/labeled but visual treatment differs from spec §4.6. Routed to `tasks/todo.md`. |
| 6.5 | Action buttons top-right; date label bottom-right | PASS | `InboxItemCard.tsx:208-267, 312-321` |

### §4.7 — Page-level full-text search

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 7.1 | SearchBox 200ms debounce wired to `q` on Inbox + Activity | PASS | `InboxPage.tsx:151-156` + `ActivityPage.tsx:411-417` |
| 7.2 | Latest-request-wins stale-response guard | PASS | `ActivityPage.tsx:343, 350` requestSeqRef + `InboxPage.tsx:64, 75, 85` per-band seqCounters |
| 7.3 | "Clear filters" CTA clears BOTH q AND column filters via tableResetNonce remount (no direct localStorage writes) | PASS | `ActivityPage.tsx:372-378, 435, 439` key + persistKey both bumped |

### §4.8 — Run-trace masking projection

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 8.1 | Backend determines visible fields by role; frontend never branches on role | PASS | `agentRuns.ts:175-225` projectForRole called server-side; renderer only matches the literal `'<redacted>'` |
| 8.2 | Redaction token literal `'<redacted>'`; never null, never absent | PASS | `agentRunMessageServicePure.ts:120` REDACTION_TOKEN const + renderer type union |
| 8.3 | `truncated: true` only when field is visible-but-partial | PASS | `agentRunMessageServicePure.ts:170-180` outputTruncated only set in user-tier visible branch |
| 8.4 | Mask-precedence-over-truncation | PASS | `agentRunMessageServicePure.ts:168-181` user-tier input is REDACTION_TOKEN with no truncated flag |
| 8.5 | Cache-Control: private, no-store on the trace-events endpoint | PASS | `agentRuns.ts:218-220` setHeader with locked-invariant comment |

### §4.9 — Activity / Run-trace event metadata

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 9.1 | `triggerSource` field on every ActivityItem (additive — emit BOTH triggerType + triggerSource) | PASS | Same as REQ 1.10 |
| 9.2 | Severity legend per-user localStorage key `activitySeverityLegendSeen:{userId}` | PASS | `SeverityLegend.tsx:35-37` storageKey includes userId prefix |

### §4.10 — Confirmation dialogs on destructive actions

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 10.1 | Inbox archive: no confirmation | PASS | `InboxItemCard.tsx:159-174` direct call with comment |
| 10.2 | Inbox reject: inline reason input (not a modal) | PASS | `InboxItemCard.tsx:269-303` rejectOpen branch renders textarea inline |
| 10.3 | No bulk multi-select | PASS | No checkbox state in InboxItemCard or ActivityPage |

### §5 — File inventory

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 11.1 | Files created: 4 operate pages + 7 components + shared/types/operate.ts + plan.md | PASS | git ls-files confirms all 13 |
| 11.2 | Files modified: activity.ts/activityService.ts/inbox.ts/inboxService.ts/agentRunMessageServicePure.ts/App.tsx | PASS | All in branch diff |
| 11.3 | Sidebar: add Inbox + Activity rows under Work group | DIRECTIONAL_GAP | `client/src/config/sidebar.ts` has Home wired but no `/inbox` or `/activity` workspace/org rows (only `sys-activity` for system_admin). Routes reachable via direct URL but not exposed in sidebar nav. Routed to `tasks/todo.md`. |
| 11.4 | Files deleted: DashboardPage.tsx, InboxPage.tsx, ActivityPage.tsx, RunTraceViewerPage.tsx | PASS | C8 commit `3fb64acf` deleted all four |

### §6 — Permissions / RLS / Idempotency

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 12.1 | No new permission keys; existing requirePermission chains | PASS | `activity.ts` uses ORG/SUBACCOUNT EXECUTIONS_VIEW + requireSystemAdmin; `inbox.ts` uses authenticate (existing pattern) |
| 12.2 | No new tenant-scoped tables / no migrations | PASS | git diff has zero migrations/schema changes |
| 12.3 | Inbox actions state-based; concurrency loss returns 200 alreadyApplied | PASS | Same as REQ 2.3 |
| 12.4 | Cost MTD KPI gated to org_admin / system_admin | PASS | `HomePage.tsx:175, 228, 363` isOrgAdmin gate |

### §8 — Pure-function test coverage

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 13.1 | activityServicePure.test.ts extended | PASS | 36 tests pass |
| 13.2 | inboxServicePure.test.ts created | PASS | 34 tests pass |
| 13.3 | runTraceEmbeddedPure.test.ts created | PASS | 9 tests pass |
| 13.4 | agentRunMessageServicePure.test.ts extended for §4.8 masking | PASS | 37 tests pass; mask-vs-truncate precedence covered |
| 13.5 | operateRedirects.test.ts created (locked redirect grammar) | PASS (bonus) | 11 tests pass — not spec-mandated but plan §C8 acceptance |

## Mechanical fixes applied

None. Both directional gaps are UX/cosmetic; routing them to `tasks/todo.md` rather than auto-fixing — auto-fix would extend scope into design choices (color palette, sidebar permission gating).

## Directional / ambiguous gaps (routed to tasks/todo.md)

| ID | REQ | One-liner | Suggested approach |
|---|---|---|---|
| OPER-DEF-1 | 6.4 | InboxBand uses `bg-slate-50 border-y` only — no per-band color (spec §4.6 calls for red/amber/slate left borders) | Add `band` switch on `<InboxBand>` to render `border-l-4 border-l-red-500/border-l-amber-500/border-l-slate-300` per band. Cosmetic — not a contract change. |
| OPER-DEF-2 | 11.3 | Sidebar config has no `/inbox` or `/activity` nav rows for workspace/org users | Add two `staticRoute('/inbox')` + `staticRoute('/activity')` items to the Work group in `client/src/config/sidebar.ts`, gated to users with the inbox-read / activity-view permissions. Routes already reachable via URL. |

## Files modified by this run

None (no mechanical fixes applied). The deferred entries are appended to `tasks/todo.md`.

## Next step

CONFORMANT_AFTER_FIXES — proceed to `pr-reviewer`. The spec/contract surface is correctly implemented; deferred UX items are non-blocking per plan §10 and the cross-cutting risks table. The two routed deferred entries (sidebar nav rows, per-band borders) can be picked up in a follow-up post-merge.
