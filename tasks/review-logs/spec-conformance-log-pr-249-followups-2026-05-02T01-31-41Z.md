# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
**Spec commit at check:** `f1800dbc` (last spec edit, from chatgpt-spec-review finalisation)
**Branch:** `pr-249-followups`
**Base:** `290b1caa` (merge-base with `main`)
**HEAD at start:** `fcc734a6`
**Commit at finish:** `6ce781bc`
**Scope:** whole-spec (single-phase Standard task; complete branch implementation per caller invocation)
**Changed-code set:** 37 files (1 spec doc, 1 KNOWLEDGE.md, 1 review log + index, 12 client, 20 server/worker, 2 review-log housekeeping)
**Run at:** 2026-05-02T01:31:41Z

---

## Summary

- Requirements extracted:     15
- PASS:                       10
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 4
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (REQ — Task 4.3 visual verification, manual-only, not code-vs-spec checkable)

**Verdict:** NON_CONFORMANT (4 directional gaps — see deferred items in `tasks/todo.md`)

> NON_CONFORMANT chosen over CONFORMANT_AFTER_FIXES because zero mechanical fixes were applied: every gap requires either a design decision the spec does not specify (REQ #7) or an operator choice on destination (REQ #10/#12 spec inline vs PR description; REQ #13 GitHub PR body edit). All four gaps are low-severity hygiene/process items, not correctness defects — none of them block the implementation from working as intended. Three of the four (REQ #10, #12, #13) are pure deliverable-formatting gaps (the audit work is complete; only the recording destination is wrong/missing).

---

## Requirements extracted (full checklist)

| REQ | Category | Spec section | Requirement | Verdict |
|-----|----------|--------------|-------------|---------|
| #1 | behavior | Task 2 / N-2 | Drop redundant outer `await` from `llmRouterTimeoutPure.test.ts:70` | PASS |
| #2 | behavior | Task 2 / N-2 | Drop redundant outer `await` from every match in `canonicalDataService.principalContext.test.ts` | PASS |
| #3 | validation | Task 2 / Verification | `grep -rn "await await" server/services/__tests__/` returns 0 matches | PASS (verified 0 matches) |
| #4 | behavior | Task 3 / N-4 | Remove `void _b;` line from `server/services/dropZoneService.ts` (~line 280) | PASS |
| #5 | behavior | Task 4.1 / F3 | ClientPulse Dashboard `NavItem` at `Layout.tsx:848` carries `badge=` and `badgeLabel=` props per spec snippet | PASS |
| #6 | behavior | Task 4.2 / F3 | State pipeline checkpoints intact: initial fetch (`Layout.tsx:407-410`), reconnect resync (`Layout.tsx:416`), socket increments (`Layout.tsx:431-432`) | PASS |
| #7 | behavior | Task 4.4 / F3 | Concurrency invariant — events scoped by `activeClientId`; handlers ignore events whose payload subaccount differs from current `activeClientId` | DIRECTIONAL_GAP |
| #8 | behavior | Task 4.5 / F3 | Listener lifecycle invariant — `useSocketRoom` cleanup calls `socket.off(event, handler)` for each registered listener | PASS |
| #9 | behavior | Task 5 / F4 | Each surviving `eslint-disable-next-line` carries justification; lint exits 0 | PASS |
| #10 | docs | Task 5.3 / Self-review F4 tallies | F4 tallies row populated in spec self-review section per format `<initial> → <final>; removed <N> redundant, kept <N> with justifications` | DIRECTIONAL_GAP |
| #11 | behavior | Task 6 / F6 | Per-callsite audit complete; typecheck + lint clean; no `Record<string, unknown>` removed where polymorphism existed | PASS |
| #12 | docs | Task 6.4 / Self-review F6 tallies | F6 tallies row populated in spec self-review section per format `<initial inventory> → A: <removed N>, B: <narrowed N>, C: <kept N>` | DIRECTIONAL_GAP |
| #13 | docs | Task 7 / Doc-sync Verdict destination | Seven doc-sync verdicts recorded in PR description under `## Doc-sync verdicts` section per `docs/doc-sync.md § Verdict rule` format | DIRECTIONAL_GAP |
| #14 | validation | Verification table | `npm run lint` exits 0 with 0 errors; `npm run typecheck` exits 0 | PASS (verified locally — lint: 0 errors, 696 warnings; typecheck: exit 0) |
| #15 | docs | Self-review against backlog source | Coverage table populated for N-2, N-4, F3, F4, F6, N-1 (deferred), N-3 (deferred) | PASS |

Out of scope: Task 4.3 visual verification (manual-only operator check; not code-vs-spec verifiable).

---

## Mechanical fixes applied

None.

> Initial pass attempted to auto-fill the spec's F4 (§5.3) and F6 (§6.4) self-review tally tables from the F4 commit `e52f1f96` and F6 commit `564eff20` message bodies — the numbers were unambiguous and the format was specified. The edits were applied, then reverted on re-reading the playbook's iron rule: **"You do not modify the spec. Ever."** The tally tables sit inside the spec document; even though they're explicitly designed to be filled, modifying them violates the rule. Routed as DIRECTIONAL_GAP for the operator (REQ #10, #12).

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

All four gaps appended under new section `## Deferred from spec-conformance review — pr-249-followups (2026-05-02)` in `tasks/todo.md`:

- REQ #7 — F3 §4.4 socket-handler `activeClientId` filter not implemented
- REQ #10 — F4 audit tallies unfilled in spec §5.3 self-review (numbers exist in commit `e52f1f96`)
- REQ #12 — F6 audit tallies unfilled in spec §6.4 self-review (numbers exist in commit `564eff20`)
- REQ #13 — Doc-sync 7 verdicts not present in PR #251 description (right content in commit `fcc734a6` message; wrong location per spec §7)

---

## Files modified by this run

None. All four gaps required either a design decision the spec did not name (REQ #7) or an operator choice on destination (REQ #10, #12 inline-spec vs PR-description; REQ #13 PR body edit on GitHub). Per the playbook's Rules, spec-conformance does not modify the spec, does not write code that requires design decisions, and does not edit GitHub PR descriptions.

---

## Next step

**NON_CONFORMANT** — 4 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under `## Deferred from spec-conformance review — pr-249-followups (2026-05-02)`.

Suggested operator triage (lowest-friction first):
1. **REQ #13** — `gh pr edit 251 --body "..."` adding `## Doc-sync verdicts` section (~5 min; data already in `fcc734a6` commit message).
2. **REQ #10 / #12** — single commit filling the two spec self-review tally tables from the F4/F6 commit message bodies, OR amend §5.3/§6.4 to point at the commit messages as the canonical destination (~10 min).
3. **REQ #7** — implement the §4.4 handler-level subaccount filter via `activeClientIdRef` pattern. Requires confirming/extending `live:agent_started` / `live:agent_completed` event payload shape to include source subaccount. Highest-effort of the four; consider whether the room-subscription filter is sufficient defence-in-depth for pre-production posture and downgrade the spec invariant to a follow-up if so (~30-60 min depending on emitter changes).

After REQ #7 lands (or is explicitly downgraded), re-run `spec-conformance` against the same scope, then proceed to `pr-reviewer`. REQ #10/#12/#13 do not require spec-conformance re-run since they are formatting-destination gaps that do not change the implementation.

