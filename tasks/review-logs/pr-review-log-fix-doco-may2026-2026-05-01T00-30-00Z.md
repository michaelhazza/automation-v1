# PR Review — fix-doco-may2026

**Files reviewed:**
- `.claude/agents/chatgpt-pr-review.md`
- `.claude/agents/chatgpt-spec-review.md`
- `.claude/agents/feature-coordinator.md`
- `docs/doc-sync.md`
- `tasks/review-logs/README.md`
- `CLAUDE.md` (§ 11)
- `docs/capabilities.md` (Phase 2 drift fixes)
- `DEVELOPMENT_GUIDELINES.md` (Phase 2 drift fix)
- `tasks/brief-doc-sync-process-and-audit.md`
- `tasks/todo.md`

**Reviewed at:** 2026-05-01T00:30:00Z

**Verdict:** APPROVED (0 blocking, 3 strong, 4 non-blocking)

---

## Blocking Issues

No blocking issues found.

The five focal questions all check out:

1. **Doc-sync sweep instructions consistent across the three agents and `docs/doc-sync.md`** — yes. All three agents now point to `docs/doc-sync.md` as the canonical list rather than embedding their own copy. Identical verdict-rule wording (`yes (sections X, Y) | no (rationale required) | n/a`) in all four files. Identical "failure to update is a blocker — escalate, do not auto-defer" framing. The only intentional divergence is the spec-context.md carve-out (see #2).

2. **`spec-context.md` carve-out works correctly** — yes, applied consistently in three places:
   - `chatgpt-pr-review.md` — "The `docs/spec-context.md` entry applies to spec-review sessions only; skip it here."
   - `chatgpt-spec-review.md` — "All entries apply to spec-review sessions, including `docs/spec-context.md`."
   - `feature-coordinator.md` — "The `docs/spec-context.md` entry does not apply to feature pipelines; skip it."
   - `docs/doc-sync.md` — spec-context.md row in the table carries the "Spec-review sessions only" qualifier.
   - PR agent Final Summary and auto-commit list correctly omit spec-context.md; spec agent correctly includes it.

3. **Final Summary template consistent across README.md and the agent files** — yes. Field ordering is identical in all four sources (KNOWLEDGE → architecture → capabilities → integration-reference → CLAUDE/DEV_GUIDELINES → spec-context [spec only] → frontend-design-principles). README.md's table explicitly marks spec-context as `omit` for PR agent, matching the agent files.

4. **Automated mode diff fix is complete and correct** — yes. The exclusion set in the automated round 1 diff command is byte-identical to the manual round 1 set and the manual round N+1 set. Per-round automated invocations state "the same code-only diff command as round 1 (with identical exclusions)."

5. **No gaps where a reviewer could miss a doc-sync step** — the enforcement chain is tight: `CLAUDE.md § 11` cross-references `docs/doc-sync.md`, each finalisation flow has the sweep step inserted into its numbered sequence (PR step 6, spec step 5, feature-coordinator D.5), and each agent's Rules section marks doc sync as mandatory at finalisation with a missing-field blocks-finalisation note.

---

## Strong Recommendations

1. **Add a cross-reference from `docs/doc-sync.md` to `tasks/review-logs/README.md`.** The README points to `docs/doc-sync.md` but the reverse pointer is weak. Add a line near the top of `docs/doc-sync.md`: "Per-agent Final Summary contracts and verdict regex live in `tasks/review-logs/README.md` — this file is the scope/trigger source of truth; that file is the per-agent persistence contract."

2. **Test coverage — add a verification check for Final Summary field parity.** Someone adding a new reference doc to `docs/doc-sync.md` could forget to update the two agent templates and the README table. Suggested: `scripts/verify-doc-sync-parity.ts` — parse the Final Summary templates in both ChatGPT agents and assert they match the field list in `docs/doc-sync.md`.

3. **`feature-coordinator.md` D.5 lacks an explicit Final Summary template.** The PR and spec agents both have a `## Final Summary` log-format block. D.5 says "Record the verdicts in `tasks/builds/{slug}/progress.md` under a `## Doc Sync gate` heading" but does not specify the field shape. Add a 6-line snippet showing the expected `progress.md` block format.

---

## Non-Blocking Improvements

1. **`docs/doc-sync.md` placement** — lives at `docs/doc-sync.md` while CLAUDE.md, DEVELOPMENT_GUIDELINES.md, KNOWLEDGE.md live at root. Defensible; not worth moving now.

2. **`docs/doc-sync.md:49` wording** — "omitted from PR review logs; included in spec review logs" could be clearer: "applies to spec-review sessions only — omitted from PR review and feature-pipeline summaries."

3. **`chatgpt-pr-review.md` step 6 vs `chatgpt-spec-review.md` step 5 wording asymmetry** — PR agent says "skip it here"; spec agent says "All entries apply including spec-context.md". Optional: reword PR agent to "applies to spec-review sessions only — skip here" for symmetry.

4. **No KNOWLEDGE.md entry for the automated diff bug** — the finding that chatgpt-pr-review automated mode sent unfiltered diffs (1,719 files / ~7.7M tokens) to OpenAI is worth a Knowledge entry: "manual and automated paths must share the same exclusion set or they drift."

---

**Verdict:** APPROVED
