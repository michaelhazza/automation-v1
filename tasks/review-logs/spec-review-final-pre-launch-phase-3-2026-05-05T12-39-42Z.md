# Spec Review Final Report

**Spec:** `tasks/builds/pre-launch-phase-3/spec.md`
**Spec commit at start:** untracked (newly drafted, dated 2026-05-05)
**Spec commit at finish:** `56577989` (HEAD on main)
**Spec-context commit:** `5090dc99` (`docs/spec-context.md`)
**Iterations run:** 2 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 14 | 0 | 14 | 0 | 0 | 0 | none |
| 2 | 9  | 0 | 9  | 0 | 0 | 0 | none |

23 mechanical fixes applied across 2 iterations. Zero directional findings, zero rejections, zero items routed to `tasks/todo.md`.

---

## Mechanical changes applied (grouped by section)

### §1 framing
- "Four stale markers" count corrected to "five" (5 markers listed; 4 already closed + 1 closes when L1 ships).
- Wrong primitive citation `verify-workspace-actor-coverage.yml` removed; replaced with explicit "L5 adds a new `optimiser-cost-gate.yml` static gate" exception note.

### §2 verification log
- AC-ADV-10 and D15 rows: "Hygiene only" replaced with "No action — closure already in code; no `[OPEN]` marker exists / no marker to flip."

### §3 file inventory
- Added `server/index.ts` row (existing line ~535 boot-validation site) for L1 wiring.
- Named the new `validateWebhookSecretOrThrow()` validator function in env.ts row.
- Replaced non-existent `server/lib/__tests__/rateLimitKeys.test.ts` with existing `server/services/__tests__/rateLimitKeysPure.test.ts`.
- Replaced non-existent `server/middleware/__tests__/auth.requireSubaccountPermission.test.ts` (which referenced a non-existent test harness) with NEW `server/middleware/authPure.ts` + `server/middleware/__tests__/authPure.test.ts`.
- Added NEW `server/lib/__tests__/webhookSecretValidatorPure.test.ts` for L1.
- Added NEW `server/services/optimiser/__tests__/costGate.integration.test.ts` for L5 (the existing `verificationMatrix.test.ts` cannot host the live cost gate — it globally mocks env/db/LLM).
- Demoted L5's verificationMatrix.test.ts row to "remove placeholder describe.skip; comment pointing at new file."
- Pinned helper input names to `path`/`method` (was inconsistent at `reqPath`/`reqMethod`).
- Added `tasks/current-focus.md` row clarifying same-PR (not post-merge) update.

### §4.L1 — Webhook secret
- Fix block extended from 2 → 3 steps; step 2 explicitly wires `validateWebhookSecretOrThrow()` into `server/index.ts:535` next to existing `validateEncryptionKeyOrThrow()`.

### §4.L2 — Subaccount permission denial
- Refactored from "code block in middleware + non-existent jest spy harness" to "extract pure helper `decidePermissionDenialEvent` to NEW `server/middleware/authPure.ts`; middleware wires via one-line call." Pinned the helper module location (no more "or sibling — implementation choice"). Test is pure-function-only against the helper.

### §4.L3 — Login rate-limit buckets
- Self-contradiction removed: rationale now correctly states buckets are independent (either trip → 429), matching §8 contract; limits re-justified under that semantics.
- Test bullet path corrected to existing `rateLimitKeysPure.test.ts`.

### §4.L4 — Outcome measurement test
- Test cases rewritten to match actual `decideOutcomeMeasurement` signature (`{ action, accountId, postSnapshot?, postAssessment?, now }`). Four cases now map onto real inputs: window-not-elapsed, account-or-snapshot precondition, operator-alert exception, full-input happy path. Cited the function's actual signature line range.

### §4.L5 — Optimiser cost gate
- Fix block expanded from 3 → 9 numbered steps across both iterations.
- Removes the `describe.skip` placeholder; implements in NEW dedicated `costGate.integration.test.ts` (no `vi.mock` blocks; `LIVE_LLM_COST_GATE` guard).
- Fixture seeding (5sa × 7d) and cost measurement (logger-spy on `optimiser.render.tokens_used`) specified concretely.
- Pinned the optimiser model resolver + per-token rate constants with named source URL + capture date + update path.
- Workflow path filter expanded beyond `optimiser/**` to include LLM/cost surfaces; `workflow_dispatch` for out-of-tree pricing changes.
- Workflow annotation in `::notice::` form for measured value visibility on PR check page.
- Secret-absence behaviour: FAILS the run with `::error::` and non-zero exit code (no silent pass).
- Branch-protection elevation called out as operator action — see §13.

### §4.H4 — Operator runbook
- Action description rewritten to enumerate all six conditional triggers (was 2-3): AC-CGPT-R3-3, AR-CGPT-R3-1, CHATGPT-R1-7, F3, DG-4, CHATGPT-R1-4.

### §9 — Execution-safety
- "Unique-constraint-to-HTTP mapping" subsection renamed to "Unique-constraint handling (job-level — no HTTP boundary)" since L4 is a pg-boss worker, not a route.

### §10 — Testing posture
- L1 promoted from "manual local boot, optional test" to "required pure-function test mirroring `encryptionKeyValidator.test.ts`."
- L2 / L3 / L4 test paths corrected.

### §11 — Doc-sync
- `tasks/current-focus.md` clarified as updated in this PR (sprint-pointer flip is part of the diff, not post-merge).

### §12 — Done definition
- L5 done-line softened from "merges are blocked" to "workflow fails the run when (a) cost ≥ $0.02/sa/day or (b) secrets unavailable on event." Branch-protection elevation called out as operator action (§13).
- `tasks/current-focus.md` framed as part of PR diff.

### §13 — Deferred items
- Added "Inclusion rule" paragraph: spec scopes to security/correctness; CHATGPT-R1-6 (architecture) and CHATGPT-R1-8 (UX design) explicitly remain in `tasks/todo.md`, not duplicated here.
- New "L5 branch-protection rule" deferred item for the operator-action handoff.

### §14 — Pre-review checklist
- "Net-new artifacts" line rewritten to enumerate the actual set (1 CI workflow + 1 new pure module + 3 new test files + 2 extensions).
- "Unique-constraint-to-HTTP mapping" line replaced with the job-level handling line.

---

## Rejected findings

None. All 23 findings across both iterations were accepted as mechanical.

---

## Directional and ambiguous findings (autonomously decided)

None. Codex did not surface any directional findings. The spec's framing (pre-production, pure-function-only testing, no feature flags, prefer existing primitives) was respected at draft time, and Codex's review focused on internal consistency, file-inventory drift, and load-bearing claims — all mechanical concerns. No items routed to `tasks/todo.md`.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and Codex's best-effort review. Codex did not surface any directional findings to adjudicate. However:

- The review did not re-verify the framing assumptions at the top of `.claude/agents/spec-reviewer.md`. If the product context has shifted since the spec was written, re-read the spec's §1 framing-alignment block before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. In particular: confirm that the pre-launch sweep's *scope* is right (the "five small items + hygiene" framing) — the reviewer did not adjudicate scope, only consistency.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- L5's per-token rate constants will go stale when the optimiser model changes. The spec documents the update path, but the rates themselves are real numbers that need to be filled in at implementation time using the published per-token pricing of the chosen model.

**Recommended next step:** read §1 (framing alignment) and §13 (deferred items + inclusion rule) one more time, confirm the scope shortlist matches current intent, then start implementation. The plan-breakdown step should expect the spec's natural seams (Chunk A: L1+L2+L3 security primitives; Chunk B: L4 pure test; Chunk C: L5 cost gate; Chunk D: H1+H2+H3+H4 hygiene) and may ship as one PR per §7's default.
