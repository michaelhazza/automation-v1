# Spec Conformance Log

**Spec:** `tasks/builds/home-dashboard-reactivity/spec.md` (paired plan: `docs/superpowers/plans/2026-04-27-home-dashboard-reactivity.md`)
**Spec commit at check:** `c849c5349aa0bfd34843447dbbc9ce0862c09e59` (HEAD of `create-views`)
**Branch:** `create-views`
**Base:** `399f3864b5187d2be99ca9f9807793699560ece7` (merge-base with `main`)
**Scope:** Re-verification after follow-up fix commit `c849c534`. The two NON_CONFORMANT directional gaps from the prior run (`spec-conformance-log-home-dashboard-reactivity-2026-04-27T20-57-33Z.md`) are re-checked, plus a regression sweep (single-item approve/reject paths and the §4.2 pre-merge coverage check). All 32 previously-PASS items outside the touched files remain in force — re-extracting them is unnecessary because the fix commit only modified `server/routes/reviewItems.ts` and `server/services/reviewService.ts`.
**Changed-code set (this commit only):** 2 files (`server/routes/reviewItems.ts`, `server/services/reviewService.ts`). Two non-code files (`tasks/todo.md`, prior log) excluded per playbook.
**Run at:** 2026-04-27T21:13:34Z
**Prior log:** `tasks/review-logs/spec-conformance-log-home-dashboard-reactivity-2026-04-27T20-57-33Z.md`

---

## Summary

- Requirements re-extracted:  3 (the 2 prior DIRECTIONAL_GAPs + 1 §4.2 pre-merge coverage sweep)
- PASS:                       3
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

Plus regression sweep (single approve/reject emits, REQ #11 + #12 from prior log): unchanged, still PASS.

**Verdict:** CONFORMANT

---

## Requirements re-verified (full checklist)

| # | Category | Spec section | Requirement | Verdict |
|---|---|---|---|---|
| REQ #13 | behavior | §5.1 ("action: 'new' path") | Server emits `dashboard.approval.changed` with `action: 'new'` on review item creation. Payload shape `{ action, subaccountId: string \| null }`. | PASS |
| REQ #37a | behavior | §5.1 (broad-reading: "after a successful approve") | Bulk-approve route emits `dashboard.approval.changed` once per request after `reviewService.bulkApprove` succeeds, with `action: 'approved'` and `subaccountId: null`. | PASS |
| REQ #37b | behavior | §5.1 (broad-reading: "after a successful reject") | Bulk-reject route emits `dashboard.approval.changed` once per request after `reviewService.bulkReject` succeeds, with `action: 'rejected'` and `subaccountId: null`. | PASS |
| REQ #35 | behavior | §4.2 (pre-merge coverage check) | `grep -r "emitOrgUpdate.*'dashboard\." server/` returns only events from the §4.2 table. | PASS — 12 matches across 5 files, all map to declared §4.2 events |

---

## Verification evidence

### REQ #13 — `action: 'new'` emit on review item creation

`server/services/reviewService.ts:64-67`:
```typescript
emitOrgUpdate(action.organisationId, 'dashboard.approval.changed', {
  action: 'new',
  subaccountId: action.subaccountId ?? null,
});
```

- Wire event name + room (`org:${orgId}` via `emitOrgUpdate`) match §4.2.
- Payload shape matches §4.3: `{ action: 'new' | 'approved' | 'rejected', subaccountId: string | null }`.
- Placed inside `createReviewItem` AFTER the DB insert returns the persisted row (`[item]` is destructured at line 36-47), so the emit fires only on successful creation. Generation invariant (§6.1's "after data writes") satisfied — analogous to the read-side `serverTimestamp` rule.
- Single call site closes all 6 caller paths of `createReviewItem` (per commit message: `flowExecutorService`, `skillExecutor` × 2, `configUpdateOrganisationService`, `clientPulseInterventionContextService`, plus the service itself). No per-caller drift risk.
- `emitOrgUpdate` import already present at line 8 — no import gap.

### REQ #37a — Bulk approve emit

`server/routes/reviewItems.ts:300-314`:
```typescript
if (approvable.length > 0) {
  const bulkResult = await reviewService.bulkApprove(approvable, req.orgId!, req.user!.id);
  if (bulkResult.succeeded.length > 0) {
    emitOrgUpdate(req.orgId!, 'dashboard.approval.changed', {
      action: 'approved',
      subaccountId: null,
    });
  }
}
```

- Single emit per request (not per-item) is sound: §6.3 per-group coalescing collapses rapid emits into one refetch + one trailing refetch on the dashboard, so per-item emits would be wasteful — once-per-bulk is the correct cardinality.
- Gated on `bulkResult.succeeded.length > 0` — avoids a noop emit when every item failed (correct: §5.1 trigger language is "after a successful approve").
- `subaccountId: null` is valid per §4.3 (`string | null`); rationale (bulk batches may span subaccounts) is sound, and §4.3 payload-not-trusted rule means the dashboard never reads this field for state — only as informational metadata.
- Placed AFTER `await reviewService.bulkApprove(...)` returns. No ordering bug: emit fires only after the persisted writes complete.
- `emitOrgUpdate` import already present at line 10 — no import gap.

### REQ #37b — Bulk reject emit

`server/routes/reviewItems.ts:343-353`:
```typescript
const result = await reviewService.bulkReject(ids, req.orgId!, req.user!.id);
if (result.succeeded.length > 0) {
  emitOrgUpdate(req.orgId!, 'dashboard.approval.changed', {
    action: 'rejected',
    subaccountId: null,
  });
}
res.json(result);
```

- Same pattern as bulk-approve (single emit per request, gated on `succeeded.length > 0`). Verdict and reasoning mirror REQ #37a.
- `action: 'rejected'` matches §4.3 enum.
- Placed BEFORE `res.json(result)` — fine: `emitOrgUpdate` is synchronous fire-and-forget; no await means no response delay.

### REQ #35 — §4.2 pre-merge coverage sweep

`grep -rn "emitOrgUpdate.*'dashboard\." server/` returns 12 matches:

| File | Count | Event |
|---|---|---|
| `server/routes/reviewItems.ts` | 4 | `dashboard.approval.changed` (single approve L177, single reject L229, bulk approve L309, bulk reject L347) |
| `server/services/reviewService.ts` | 1 | `dashboard.approval.changed` (createReviewItem L64, action: 'new') |
| `server/services/agentRunFinalizationService.ts` | 1 | `dashboard.activity.updated` (L382) |
| `server/services/workflowEngineService.ts` | 5 | `dashboard.activity.updated` (L766, L887, L2733, L3164, L3330) |
| `server/services/reportService.ts` | 1 | `dashboard.client.health.changed` (L124) |

All 12 emits map cleanly to events declared in the §4.2 table. No off-table events introduced. The §11 paired `dashboard:update` event uses a different separator and is intentionally outside this regex's scope (it's a documented co-existing event, not a §4.2 row).

### Regression sweep — single approve/reject emits unchanged

The fix commit (`c849c534`) only touched two files. The single approve/reject emits at `reviewItems.ts:176-180` and `:228-232` are unchanged from the prior PASS verdict (REQ #11 / #12). Spot-read confirms they still match §4.3 payload contract. All other previously-PASS files (DashboardPage, FreshnessIndicator, all server response-envelope routes, etc.) are unmodified — no regression vector.

---

## Mechanical fixes applied

None. All 3 re-verified requirements pass without modification.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None. Both prior directional gaps closed by the fix commit. The "Deferred from spec-conformance review — home-dashboard-reactivity (2026-04-27)" section in `tasks/todo.md` already records the closure (lines 1098-1100, written by the fix-commit author).

---

## Files modified by this run

This run did not modify any spec-implementation files (zero MECHANICAL fixes applied).

Files modified BY THIS RUN:
- `tasks/review-logs/spec-conformance-log-home-dashboard-reactivity-2026-04-27T21-13-34Z.md` (this log)

---

## Implementation files re-verified (not modified)

Server (touched by fix commit `c849c534`):
- `server/routes/reviewItems.ts` — bulk-approve and bulk-reject emits added (REQ #37a, #37b)
- `server/services/reviewService.ts` — `action: 'new'` emit added in `createReviewItem` (REQ #13)

All other files from prior log untouched in this commit.

---

## Next step

CONFORMANT — no gaps. Both prior directional gaps closed cleanly. Proceed to `pr-reviewer` on the expanded changed-code set (the fix commit added two source files that the prior `pr-reviewer` run did not see, so a fresh `pr-reviewer` pass is the right next move). After `pr-reviewer` clears, the branch is ready for merge per the standard pipeline.
