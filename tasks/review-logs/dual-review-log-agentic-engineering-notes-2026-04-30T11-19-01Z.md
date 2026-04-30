# Dual Review Log — agentic-engineering-notes

**Files reviewed:** the merge-base diff `2ede173e..HEAD` on branch `claude/agentic-engineering-notes-WL2of` —
- `.claude/agents/adversarial-reviewer.md` (new)
- `.claude/agents/architect.md` (model-collapse pre-check)
- `CLAUDE.md` (verifiability heuristic § 4; adversarial-reviewer fleet row + invocation + pipeline step 4)
- `replit.md` (agent quick-start)
- `scripts/README.md` (new)
- `docs/README.md` (new)
- `tools/mission-control/server/lib/logParsers.ts` (`ReviewKind` + `FILENAME_REGEX_STD` extension)
- `tools/mission-control/server/lib/inFlight.ts` (`derivePhaseFromVerdict` + `NO_HOLES_FOUND`/`HOLES_FOUND` cases)
- `tools/mission-control/server/__tests__/logParsers.test.ts` (two new test cases)
- `tools/mission-control/server/__tests__/inFlight.test.ts` (two new test cases)
- `tasks/review-logs/README.md` (adversarial-reviewer registration + caller contract)

**Iterations run:** 3/3
**Timestamp:** 2026-04-30T11:19:01Z
**Commit at finish:** _(filled below after commit)_

---

## Iteration 1

### Codex output (summary)

Two `[P2]` findings:
1. `inFlight.ts:76-77` — Do not mark clean advisory reviews as merge-ready (`NO_HOLES_FOUND` → `MERGE_READY` masks unresolved correctness findings).
2. `adversarial-reviewer.md:4` — Agent told to auto-detect committed/staged/unstaged/untracked changes but tools list is `Read, Glob, Grep` (no Bash/git).

### Decisions

[REJECT] `tools/mission-control/server/lib/inFlight.ts:76-77` — "Do not mark clean advisory reviews as merge-ready"
  Reason: This finding directly contradicts the prior `pr-reviewer`'s S2 ruling (commit `f8995288`), which explicitly added `NO_HOLES_FOUND` to the green-family case to prevent a regression from `MERGE_READY` → `REVIEWING` when an adversarial pass runs cleanly after `pr-reviewer` is APPROVED. Codex's worry case (stale pr-review = CHANGES_REQUESTED hidden by a fresh adversarial = NO_HOLES_FOUND) is real but mitigated by the standard workflow: `pickLatestLogForSlug` returns the most recent log per build, and the standard fix-then-rerun-pr-reviewer cycle produces a newer pr-review log that wins. More fundamentally, `derivePhaseFromVerdict`'s docblock states it is "used when the build is not the active focus and therefore has no machine-block status of its own" — it is a heuristic for stale builds, not a merge gate. Merge is gated by GitHub PR status (CI), not this derived phase. `NO_HOLES_FOUND` is in the locked enum at `tasks/review-logs/README.md` § Verdict header convention with no semantic basis to treat it differently from `APPROVED` / `CONFORMANT` / `READY_FOR_BUILD`. Re-litigating S2 would invert a decision pr-reviewer already made and the implementation already shipped.

[ACCEPT] `.claude/agents/adversarial-reviewer.md:18-20` — "Give the agent a way to detect the diff"
  Reason: Real defect — the `## Input` section instructs the agent to "use the same auto-detection logic as `spec-conformance` (committed + staged + unstaged + untracked)" but the agent's declared tools (`Read, Glob, Grep`) cannot run `git diff` / `git status`. `pr-reviewer` (the immediately analogous read-only agent) handles this by codifying that the caller provides the changed-file set, with the same tool list. The fix is to align adversarial-reviewer's input contract with `pr-reviewer`'s posture rather than add `Bash` (which would weaken the read-only / least-privilege design that's a core security property of an adversarial reviewer). The spec § 4.2 wording is independently inconsistent with spec § 4.1 (declares no Bash) — that's spec-internal drift logged to `tasks/todo.md` as D4 for follow-up rather than re-opening this branch's spec doc.

### Changes implemented

- Edited `.claude/agents/adversarial-reviewer.md` § Input to: caller provides the changed-file set (same posture as `pr-reviewer`); explicit acknowledgement that the spec § 4.2 "auto-detection" wording is a known drift.
- Appended D4 to `tasks/todo.md` § "Deferred: agentic-engineering-notes follow-ups" capturing the spec § 4.2 alignment as a follow-up.

---

## Iteration 2

### Codex output (summary)

One new `[P2]` finding:
- `adversarial-reviewer.md:20` — Update caller docs to pass the diff. The CLAUDE.md invocation example (`adversarial-reviewer: hunt holes in the auth changes I just made`) and the `tasks/review-logs/README.md` caller-contract subsection (only described persistence) don't tell the caller to provide the changed-file set. A user following the documented invocation paths will hit an agent that can't discover the diff itself.

### Decisions

[ACCEPT] `CLAUDE.md:267` + `tasks/review-logs/README.md` § "Caller contracts per agent" → `### adversarial-reviewer` — "Update caller docs to pass the diff"
  Reason: Consistent with the iteration-1 fix. The agent's input contract changed but the caller-facing surfaces did not. Mirroring `pr-reviewer`'s convention (`pr-reviewer: review the changes I just made to [file list]` at CLAUDE.md:263) keeps the two read-only reviewer agents symmetric. The README caller-contract subsection should also state the input requirement explicitly so users invoking adversarial-reviewer don't have to re-derive it from the agent definition.

### Changes implemented

- Updated CLAUDE.md invocation example to `adversarial-reviewer: hunt holes in the changes I just made to [file list]  # read-only, user must explicitly ask; caller provides the changed-file set`.
- Added a `**Caller responsibility — input:**` paragraph to the `### adversarial-reviewer` subsection in `tasks/review-logs/README.md` describing the no-Bash design and the caller's obligation to list the changed files (committed + staged + unstaged + untracked).

---

## Iteration 3

### Codex output (summary)

One new `[P2]` finding:
- `tasks/review-logs/README.md:98` — Require diff context for shell-less reviewer. My iteration-2 wording said "paste relevant diff context if it is not already on disk for the agent to `Read`" — Codex correctly notes that `Read` only shows post-state and the agent cannot see deletions or distinguish newly introduced code from pre-existing code without the patch.

### Decisions

[ACCEPT] `tasks/review-logs/README.md:98` — partial. Tighten the wording rather than mandate diff context unconditionally
  Reason: Codex's core observation is correct — the conditional "if not already on disk" was misleading because `Read` doesn't substitute for the patch when deletions or partial modifications matter. However, mandating diff-context-always would diverge from `pr-reviewer`'s established (and not-flagged) caller-contract entry, which describes only persistence. The pragmatic fix is to drop the misleading conditional and explicitly note that the patch shows what `Read` cannot — keeping caller discretion for changes where the post-state fully describes intent (additive changes, new files) but defaulting to pasting the patch.

### Changes implemented

- Tightened the `**Caller responsibility — input:**` paragraph in `tasks/review-logs/README.md` to explicitly state that `Read` only shows post-state, deletions and the old half of modifications are invisible without the patch, and the default is to paste the diff/patch (with brief framing prose acceptable only when post-state fully describes intent).

---

## Changes Made

- `.claude/agents/adversarial-reviewer.md` — `## Input` section rewritten so the contract matches the agent's declared tools (caller provides changed-file set; spec § 4.2 drift acknowledged).
- `CLAUDE.md` — adversarial-reviewer invocation example aligned with `pr-reviewer`'s `[file list]` pattern; appended caller-input note.
- `tasks/review-logs/README.md` — `### adversarial-reviewer` subsection split into `**Caller responsibility — input:**` and `**Caller responsibility — persistence:**`; input paragraph mandates pasting the diff/patch (default-on, post-state-only acceptable for clearly-additive changes).
- `tasks/todo.md` — appended D4 to `## Deferred: agentic-engineering-notes follow-ups` capturing the spec § 4.2 alignment task.

## Rejected Recommendations

- **Iteration 1 — `inFlight.ts:76-77` "Do not mark clean advisory reviews as merge-ready":** rejected. This contradicts the prior pr-reviewer's S2 finding (already accepted and implemented in commit `f8995288`). The rejection rationale: `derivePhaseFromVerdict` is a heuristic for stale-build phase derivation, not a merge gate; `pickLatestLogForSlug` returns the freshest log per build so an unresolved CHANGES_REQUESTED is replaced by a newer pr-review log when the workflow is followed; merge is gated by GitHub PR / CI, not by the derived dashboard phase; `NO_HOLES_FOUND` is in the locked verdict enum and there is no semantic basis to single it out from `APPROVED` / `CONFORMANT`.

---

**Verdict:** APPROVED (3 iterations, 3 of 4 Codex findings accepted and applied; 1 rejected with documented rationale)
