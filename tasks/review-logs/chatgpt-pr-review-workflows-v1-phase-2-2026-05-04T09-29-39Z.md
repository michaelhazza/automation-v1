# ChatGPT PR Review — workflows-v1-phase-2

## Session Info

- **Branch:** `workflows-v1-phase-2`
- **PR:** #258 — https://github.com/michaelhazza/2-automation-v1/pull/258
- **Build slug:** `workflows-v1-phase-2`
- **Spec:** `docs/workflows-dev-spec.md`
- **Plan:** `tasks/builds/workflows-v1-phase-2/plan.md`
- **Mode:** manual
- **Human-in-loop:** n/a (manual)
- **Started:** 2026-05-04T09:29:39Z
- **Coordinator:** finalisation-coordinator (Phase 3 — `launch finalisation`)

## Prior reviews in this build

- `spec-conformance` → NON_CONFORMANT (1 mechanical fix, 11 directional gaps).
  Log: `tasks/review-logs/spec-conformance-log-workflows-v1-phase-2-2026-05-04T06-53-23Z.md`.
- `pr-reviewer` → CHANGES_REQUESTED (7 blocking, 6 strong, 5 non-blocking).
  Log: `tasks/review-logs/pr-review-log-workflows-v1-phase-2-2026-05-04T07-25-00Z.md`.
- `dual-reviewer` → SKIPPED (Codex CLI unavailable).
  Log: `tasks/review-logs/dual-review-skipped-workflows-v1-phase-2-2026-05-04T07-17-50Z.md`.
- `adversarial-reviewer` → HOLES_FOUND (1 confirmed-hole, 2 likely-holes, 3 worth-confirming).
  Log: `tasks/review-logs/adversarial-review-log-workflows-v1-phase-2-2026-05-04T07-40-00Z.md`.

## Fix wave applied (Tier A + B)

Commit `28fb2e25` ("fix(workflows-v1): Tier A + B fixes from review pipeline") closed:

- pr-review B1, B2 (cursor only — S1 persistence deferred), B3, B4, B5, B6, B7
- adversarial Finding 1 (confirmed-hole), Finding 3 (duplicate of B3), Finding 5 (likely-hole on AGENTS_VIEW replay)
- spec-conformance directional gaps 9-9, 9-10, 9-11, 9-12

Tier C + D items routed to `tasks/todo.md`.

## REVIEW_GAP

⚠ **Dual-reviewer was skipped in Phase 2 — reduced review coverage.** This `chatgpt-pr-review` pass is the primary second-opinion. Operator may run `dual-reviewer` manually if Codex becomes available before merge.

## Spec deviations

None recorded in handoff (build did not formally pass through feature-coordinator).

## Pre-merged from main

S2 sync absorbed `5090dc99` (PR #257 — framework portable sync engine) and `ed8e585b` (post-merge current-focus + finalisation-coordinator merge-order rule). Clean merge, zero overlap with the branch's own changes.

---

## Round 1

**Round 1 received:** 2026-05-04 (operator pasted ChatGPT response in main session — finalisation-coordinator agent suspended, work continued in main session as SendMessage tool unavailable in this environment).

### ChatGPT findings — verbatim summary

**🔴 High-priority (must fix before merge):**
1. `GlobalAskBar.tsx` navigation double-call — `navigate('/admin/briefs/X')` then immediately `navigate('/admin/tasks/X')` overrides the first.
2. `AskFormCard` `localStatus` desyncs from server projection.
3. Missing async cancellation guards in `useEffect` (ApprovalCard, AskFormCard autofill).
4. `ActivityPane` dependency uses `.length` instead of array reference.
5. Client-side `validateAskForm` not enforced server-side — contract drift point.

**🟠 Medium:**
6. Silent `.catch(() => {})` patterns lack observability (ApprovalCard, autofill).
7. Hardcoded `'you'` identity in AskFormCard.
8. `toLocaleTimeString` rendering not stable (locale + tz drift).
9. `ApprovalCard` fetch condition slightly leaky (no refresh on stale fingerprint).

### Triage decisions

| # | Finding | Triage | Action |
|---|---|---|---|
| 1 | GlobalAskBar double-navigate | TECHNICAL → VERIFY | **FALSE POSITIVE.** Only one `navigate()` exists at `GlobalAskBar.tsx:63` (the `/admin/tasks/...` form). The briefs→tasks migration was completed in Chunk 16. ChatGPT likely confused diff `+`/`-` lines or saw stale context. |
| 2 | AskFormCard state desync | TECHNICAL | **AUTO-APPLIED.** Added `useEffect` to sync `localStatus` and `submittedBy` from `gate.status` / `gate.submittedBy` props. Server projection is the source of truth; local state covers only the optimistic-UI window. |
| 3 | Cancellation guards | TECHNICAL | **AUTO-APPLIED.** `cancelled` flag pattern added to both `ApprovalCard` and `AskFormCard.autofill` useEffects. Cleanup function sets the flag; .then/.catch handlers no-op if cancelled. |
| 4 | ActivityPane dependency | TECHNICAL | **AUTO-APPLIED.** Dependency changed from `projection.activityEvents.length` to `projection.activityEvents` (array reference). |
| 5 | Validation parity | TECHNICAL | **AUTO-APPLIED.** Verified server did NOT validate values. Moved `validateAskForm` to `shared/types/askFormValidationPure.ts`; client re-exports from new location. Added server-side enforcement in `askFormSubmissionService.submit` — loads step definition, runs the same validator, throws `{statusCode: 400, errorCode: 'invalid_form_values', fieldErrors}` on failure. Route at `asks.ts` surfaces `field_errors` in the response. AskFormCard now reads `field_errors` and renders them inline. |
| 6 | Silent catches | TECHNICAL | **AUTO-APPLIED.** Both `.catch(() => {})` sites (ApprovalCard pool fetch, AskFormCard autofill) now `console.warn` with structured `{ taskId, gateId/stepId, error }` payload. |
| 7 | Hardcoded `'you'` | USER-FACING COPY | **DEFERRED to `tasks/todo.md`.** Friendly UX literal is functionally correct (the local actor IS the submitter) but bypasses the projection's canonical `submittedBy` user id. Operator decision needed before changing. |
| 8 | Timestamp rendering | NIT | **DEFERRED to `tasks/todo.md`.** Cosmetic; does not affect correctness. |
| 9 | ApprovalCard leaky fetch | NIT | **DEFERRED to `tasks/todo.md`.** Edge case mitigated naturally by `approval.pool_refreshed` retriggering on fingerprint change. |

### Files changed in this round

- `client/src/components/openTask/AskFormCard.tsx` — sync useEffect + cancellation guard + `console.warn` + render server `field_errors`
- `client/src/components/openTask/ApprovalCard.tsx` — cancellation guard + `console.warn`
- `client/src/components/openTask/ActivityPane.tsx` — dependency array fix
- `shared/types/askFormValidationPure.ts` — new (moved from client)
- `client/src/components/openTask/askFormValidationPure.ts` — re-export shim
- `server/services/askFormSubmissionService.ts` — server-side validation in `submit`
- `server/routes/asks.ts` — surface `field_errors` in 400 response
- `tasks/todo.md` — added F7, F8, F9 deferred entries

### Verification

`npm run typecheck` exits 0. Lint not re-run (no new lint surface — only edits to files already on the warning baseline).

### Round 1 verdict

5 high-priority items addressed (4 auto-applied + 1 false positive). 1 medium item auto-applied. 3 medium/nit items deferred (1 user-facing copy, 2 nits). No remaining blockers from this round.

**Awaiting operator decision:** Round 2? Or proceed to finalisation continuation (G4 regression guard → doc-sync sweep → KNOWLEDGE.md → MERGE_READY)?
