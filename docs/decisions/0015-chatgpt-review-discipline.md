# ADR-0015: ChatGPT review loops — convergence and diff-misreading discipline

**Status:** accepted
**Date:** 2026-05-13
**Domain:** review pipeline, chatgpt-pr-review, chatgpt-spec-review
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

The `chatgpt-pr-review` and `chatgpt-spec-review` agents drive iterative external review via ChatGPT-web. Six-plus PRs (#187, #218, #226, #232, #234, #242, #249, #254) have surfaced two recurring failure modes that consistently waste review-loop time when not policed up front: (1) ChatGPT misreading unified-diff `-` / `+` markers as "both lines coexist in HEAD", producing "duplicate code" / "double join" / "duplicate import" findings that do not exist in the file; (2) ChatGPT re-raising previously-adjudicated round-N rejections in round-N+1 under variant framing, hoping the rephrasing changes the outcome. Without a documented discipline, the operator either chases ghosts (wasting half a review loop) or opens speculative round-3+ sessions that produce zero new signal. Originating KNOWLEDGE entries: L666 `2026-04-24 Gotcha — ChatGPT reviewers hallucinate "duplicate line" bugs`, L338 `2026-04-23 Pattern — ChatGPT PR-review re-raises previously-adjudicated items under variant framing`, L1610 `[2026-04-29] Correction — ChatGPT (and likely other LLMs) frequently misread unified diff format in PR review`.

## Decision

We will codify three rules for every `chatgpt-pr-review` and `chatgpt-spec-review` session:

1. **Grep-verify every diff-citing claim before action.** Any ChatGPT finding that cites a file, line, symbol, or "duplicate" / "still present" pattern in a diff is treated as suspect-by-default. The reviewer's first action is `Read` or `grep -c <pattern> <file>`. If grep returns 1 (and the claim was "duplicate"), the finding is auto-rejected with `reason: 'diff misreading — verified single occurrence in HEAD'`. If grep returns 0 (and the claim was "still present"), the finding is auto-rejected with `reason: 'diff misreading — line was removed in this PR'`. Cost of grep is ~1 second; cost of unwinding a hallucinated fix is much higher.

2. **Round-over-round re-raises of prior rejections are auto-rejected with reference to the prior round.** A round that produces only variant-reframings of prior rejections is a CONVERGENCE signal, not a new round of signal. The verdict text cites the prior round's item number explicitly (e.g. `"Re-raise of R1 #2 under variant framing — spec §4.2 already pins bundle_version; no new information"`). Theme vocabulary: `regression` (re-raise of a prior round's rejected item), distinct from `scope` (new speculative polish) or `architecture` (a genuinely new structural concern).

3. **Close after 2 unproductive rounds.** When 2 consecutive rounds produce 0 new valid findings AND the failure mode is structural (diff misreading, scope confusion, hallucination), close the session. Do NOT push for round 3+. The model is not gaining new context between rounds; persistence does not improve signal. The terminal close signal is when ChatGPT itself opens a round with both "ship with confidence" framing AND an explicit "do not run another round" instruction.

## Consequences

- **Positive:**
  - Eliminates wasted operator cycles chasing hallucinated duplicates.
  - Prevents round-3+ spirals that produce zero new signal.
  - Re-raises become a measured convergence signal, not a separate triage exercise.
  - Review-session quality improves as the operator's effort routes to genuine findings.
- **Negative:**
  - A real bug that ChatGPT happens to cite in a "duplicate" framing must be grep-verified before action — slight added per-finding cost.
  - The "close after 2 unproductive rounds" rule may close a session that would have produced one genuine finding on round 3 — assessed as an acceptable trade for the alternative (operator burnout, alert fatigue on the review loop itself).
- **Neutral:**
  - Discipline is enforced by `.claude/agents/chatgpt-pr-review.md` and `.claude/agents/chatgpt-spec-review.md`; no runtime guard.

## Alternatives considered

- **Trust ChatGPT findings by default and only verify on operator suspicion** — rejected. Six-plus PRs of evidence show false-positive rate is non-zero and structurally recurring. Default-trust amplifies the cost.
- **Cap review rounds at 2 always** — rejected. Some specs / PRs do produce genuine round-3 findings (rare, but real). The convergence-signal rule is sensitive to content (variant reframing vs new substance), not just round count.
- **Build a programmatic diff-misreading detector that pre-screens ChatGPT findings** — deferred. Would require parsing ChatGPT prose, mapping cited line ranges to HEAD, and producing pre-filtered findings — out of scope for current review-loop tooling. Could become viable if the failure mode persists across model versions.

## When to revisit

When ChatGPT (or whichever external review model the fleet uses) demonstrably stops misreading unified diffs at the rate documented here (6+ occurrences across PRs #187 / #218 / #226 / #232 / #234 / #242 / #249 / #254). Track the rate in `tasks/review-logs/*.md` regression-theme counts; a sustained quarter at <1 occurrence per PR justifies relaxing rule 1.

## References

- Originating KNOWLEDGE entries:
  - L111 `2026-04-17 Gotcha — Rebase with merge conflicts can leave duplicate code visible in PR diff`
  - L119 `2026-04-17 Gotcha — GitHub unified diff format is commonly misread as "both lines present"`
  - L338 `2026-04-23 Pattern — ChatGPT PR-review re-raises previously-adjudicated items under variant framing`
  - L666 `2026-04-24 Gotcha — ChatGPT reviewers hallucinate "duplicate line" bugs by reading unified diffs as final state`
  - L1610 `[2026-04-29] Correction — ChatGPT (and likely other LLMs) frequently misread unified diff format`
  - L1818 `[2026-05-01] Pattern — ChatGPT PR-review diff misreading: treat "" claims as needing grep verification`
  - L1912 `[2026-05-03] Pattern — ChatGPT diff-misreading: grep-verify every cited line before triaging`
- Agent files: `.claude/agents/chatgpt-pr-review.md`, `.claude/agents/chatgpt-spec-review.md`
- Review logs: `tasks/review-logs/chatgpt-pr-review-*.md`
