# Spec Conformance Log — Re-verification

**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
**Spec commit at check:** `d630916873210ca039cf9cd3a8834f47f854883f`
**Branch:** `feat/clientpulse-ui-simplification`
**Base (merge-base with main):** `a596688ff5aa5669ee3a60290eb7bdf446a2024a`
**Branch HEAD at check:** `d630916873210ca039cf9cd3a8834f47f854883f`
**Scope:** Re-verification of the 5 directional gaps from prior run (`spec-conformance-log-clientpulse-ui-simplification-2026-04-24T06-55-22Z.md`). Caller confirmed: pre-PR conformance gate, all other REQs (1–41) already PASS in prior run and no code in those surfaces has changed since.
**Changed-code set:** 56 files since merge-base (unchanged in scope vs prior run + 2 files touched by fix commit `d6309168`: `client/src/components/Layout.tsx`, the spec file)
**Run at:** 2026-04-24T07:09:46Z

---

## Contents

- [Summary](#summary)
- [Re-verification — 5 previously-directional gaps](#re-verification--5-previously-directional-gaps)
  - [REQ 42 — resolvedUrl target for review:&lt;id&gt;](#req-42--resolvedurl-target-for-reviewid)
  - [REQ 43 — PendingHero onReject signature](#req-43--pendinghero-onreject-signature)
  - [REQ 44 — ?intent destination coverage](#req-44--intent-destination-coverage)
  - [REQ 45 — Layout.tsx breadcrumb default label](#req-45--layouttsx-breadcrumb-default-label)
  - [REQ 46 — §7.1 router transition manual QA](#req-46--71-router-transition-manual-qa)
- [Mechanical fixes applied](#mechanical-fixes-applied)
- [Directional / ambiguous gaps (routed to tasks/todo.md)](#directional--ambiguous-gaps-routed-to-taskstodomd)
- [Files modified by this run](#files-modified-by-this-run)
- [Next step](#next-step)

---

## Summary

**Re-verification scope:** the 5 directional gaps identified in the prior run. All other REQs (1–41) are treated as PASS-carried-forward — the caller confirms those surfaces have not changed since the prior conformance pass.

- Gaps re-verified:                  5
- PASS (gap closed):                 4
- PASS_WITH_DEFERRED_QA (ops-only):  1
- Still open (blocking):             0

**Verdict:** CONFORMANT

> All 5 directional gaps from the prior run are closed. Fixes in commit
> `d6309168` landed cleanly: one code change (Layout.tsx default breadcrumb
> label `"Pulse"` → `"Home"`) and three spec patches (resolvedUrl table row,
> `onReject` signature, §11 deferred entry for `?intent` non-review
> coverage). REQ 46 is a runtime-only manual-QA gate that does not block
> the code-vs-spec conformance verdict — its sole statically-verifiable
> check (grep) continues to pass.

---

## Re-verification — 5 previously-directional gaps

### REQ 42 — resolvedUrl target for `review:<id>`

**Prior verdict:** DIRECTIONAL_GAP. Spec §2.2 resolver table mapped `review:<id>` → `/admin/subaccounts/<subaccountId>/pulse`, but §7.1 retires that route (now redirects to `/`). Implementation resolved directly to `/clientpulse/clients/<subaccountId>` (the drilldown).

**Fix category:** spec patch (no code change required).

**Fix location:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md:147`.

**Current spec text (verified):**

```
| `review:<id>` | `/clientpulse/clients/<subaccountId>` (subaccount drilldown,
  when `subaccountId` present) or `null` — reconciled with §7.1 retirement
  of `/admin/subaccounts/<id>/pulse` |
```

**Implementation cross-check:** `server/services/pulseService.ts:88` — returns `/clientpulse/clients/${subaccountId}` for the `'review'` kind branch inside `_resolveUrlForItem`. Exact match with the now-patched spec row.

**Verdict: PASS.**

---

### REQ 43 — PendingHero onReject signature

**Prior verdict:** DIRECTIONAL_GAP. Spec §6.2.1 contract declared `onReject: (reviewItemId: string) => Promise<void>`. Implementation declared `onReject: (reviewItemId: string, comment: string) => Promise<void>` — the second parameter is required because the backend intervention-reject endpoint demands a non-empty `comment` (`COMMENT_REQUIRED` error code). A prior `reject(id, '')` bug was fixed during build (commit `6fd3769b`); the spec had not been updated to match.

**Fix category:** spec patch (no code change required).

**Fix locations:** `docs/superpowers/specs/…-spec.md:623` (signature) and `:629` (added rationale paragraph).

**Current spec text (verified):**

```
  onReject: (reviewItemId: string, comment: string) => Promise<void>;
```

Followed immediately (§6.2.1, line 629) by:

> **Reject flow — inline comment capture.** The backend intervention-reject endpoint requires a non-empty `comment` (the `COMMENT_REQUIRED` error code). PendingHero owns the comment-capture UI: the Reject button toggles open an inline textarea + Submit rejection button, and only then calls `onReject(reviewItemId, comment)` with the operator-supplied reason. Parents do not surface their own rejection modal for this flow.

**Implementation cross-check:** `client/src/components/clientpulse/PendingHero.tsx:11` — `onReject: (reviewItemId: string, comment: string) => Promise<void>;`. Call site at `:76`: `await onReject(id, rejectComment);`. Exact match.

**Verdict: PASS.**

### REQ 44 — `?intent` destination coverage

**Prior verdict:** DIRECTIONAL_GAP. Spec §2.2 declared a hard contract that *every* mode-2 destination page (review drilldown, task detail, run detail) must implement `?intent` detection. Implementation only wires `?intent` on `ClientPulseDrilldownPage` (reviews). `WorkspaceBoardPage` (tasks) and `AgentRunLivePage` (failed_run / run) do not. §11 Deferred Items did not cover this exception — the spec was self-inconsistent.

**Fix category:** spec patch — §11 deferral entry (no code change required; caller explicitly scoped this spec to drilldown-only `?intent` coverage).

**Fix location:** `docs/superpowers/specs/…-spec.md:848` (new §11 entry).

**Current spec text (verified):**

> **`?intent` auto-open on non-review destinations.** The `?intent=approve|reject` URL contract (§6.2.1, G16) is shipped only on `ClientPulseDrilldownPage` for `review:<id>` destinations. For `task:<id>` and `failed_run:<id>` destinations, the operator still reaches the target page via the resolvedUrl redirect but the auto-focus / auto-open behaviour is not wired (the `WorkspaceBoardPage` and `AgentRunLivePage` do not read `?intent`). G16's "at most one additional click" requirement holds for `review` today; extending it to `task` and `failed_run` requires per-page focus semantics (which button / field to focus, what the reject-equivalent is for a failed run) that are out of scope for this simplification pass. Ship when a concrete operator flow demands it.

**Spec self-consistency:** with this deferral recorded in §11 (the spec's own declared single source of truth for scope exceptions), the §2.2 "applies to ALL pages" contract is now explicitly narrowed — the coverage matches the implementation. The tension is documented, intentional, and scoped out of this spec.

**Verdict: PASS.**

---

### REQ 45 — Layout.tsx breadcrumb default label

**Prior verdict:** DIRECTIONAL_GAP. `client/src/components/Layout.tsx:867` rendered `<span …>Pulse</span>` when `breadcrumbs.length === 0` — a stale label since `/` now points at the home dashboard (not the retired `/admin/pulse` route). Low-urgency UX leakage from §7.1 retirement.

**Fix category:** one-line code change.

**Fix location:** `client/src/components/Layout.tsx:867`.

**Diff (from commit `d6309168`):**

```diff
             {breadcrumbs.length === 0
-              ? <span className="text-slate-900 font-semibold">Pulse</span>
+              ? <span className="text-slate-900 font-semibold">Home</span>
               : breadcrumbs.map((crumb, i) => (
```

**Verification read:** `Layout.tsx:867` now reads `<span className="text-slate-900 font-semibold">Home</span>`. Surrounding context (breadcrumb bar, subsequent `breadcrumbs.map(...)` call) is untouched — no collateral regression.

**Verdict: PASS.**

### REQ 46 — §7.1 router transition manual QA

**Prior verdict:** DIRECTIONAL_GAP. §7.1 defined five runtime checks (1 static grep + 4 manual browser checks: back-navigation from approval, deep-link redirect, subaccount-scoped redirect, no React error boundary on redirect paths). Only the static grep was statically verifiable; the other four require a browser pass.

**Fix category:** out-of-band runtime QA (caller acknowledged — "static grep checks pass").

**Static grep (re-run now):**

```
grep -rn "/admin/pulse" client/src/
```

Returns exactly one match: `client/src/App.tsx:345` — the `<Route path="/admin/pulse" element={<Navigate to="/" replace />} />` redirect registration. Zero link destinations remain in client source. This satisfies row 1 of the §7.1 transition-guarantees table.

**Remaining 4 checks (rows 2–5 of the table):** runtime-only; not statically verifiable. These are operational acceptance gates (G6 ship gate), not code-vs-spec conformance items. The code is structured correctly to make these checks pass (the redirect exists; there is no stale navigation target in the source); actually observing the browser behaviour is a separate QA pass.

**Spec-conformance charter boundary:** this agent verifies that implemented code matches the spec's named requirements. Manual runtime checks are out of scope for the agent — they belong to the G6 ship gate, which the caller runs as a human-in-the-loop step before PR creation.

**Verdict: PASS_WITH_DEFERRED_QA** — the code state satisfies the statically-verifiable check and is structured to support the runtime checks; the runtime checks themselves are ops-level and do not block the conformance verdict. Callout to reviewer: perform the 4 browser checks before merging (not blocking for PR creation; blocking for merge).

---

## Mechanical fixes applied

None in this re-verification run — the fixes under review were already applied in commit `d6309168` before this agent was invoked. This run is purely a confirmation pass.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None. All 5 previously-directional gaps are closed.

The `## Deferred from spec-conformance review — clientpulse-ui-simplification (2026-04-24)` section in `tasks/todo.md` (lines 672–701) documents the prior-run findings. Per the repo's append-only convention, those entries are left in place as historical record — they can be marked checked (`[x]`) now that this re-verification confirms closure. Not doing that as part of this run — the user closes the checkboxes when they triage the section.

---

## Files modified by this run

None. This is a read-only re-verification; no code or spec edits were made.

(The final log itself is the only new artifact.)

---

## Next step

**CONFORMANT — proceed to `pr-reviewer`.**

All 5 directional gaps are closed. No new gaps introduced. The branch is code-vs-spec conformant.

Remaining non-blocking items for the main session / caller:

1. REQ 46 runtime QA pass (4 browser checks from §7.1 transition-guarantees table) before merge. These are a G6 ship gate, not a conformance gate — the PR can be created and reviewed first.
2. Optionally mark the 5 checkboxes in `tasks/todo.md` *Deferred from spec-conformance review — clientpulse-ui-simplification (2026-04-24)* as resolved, pointing at this log as the closure record. Append-only rule still applies: tick the boxes, do not delete the section.

Run `pr-reviewer` on the full branch next. No re-run of `spec-conformance` needed — this run is the final conformance confirmation.
