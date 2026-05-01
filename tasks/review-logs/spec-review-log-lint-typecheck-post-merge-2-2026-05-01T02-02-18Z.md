# Spec-review log — lint-typecheck-post-merge — Iter 2

- Spec: `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
- Spec commit at start: `c2c6ff00`
- Codex output: `tasks/review-logs/.codex-output-iter2-2026-05-01T02-02-18Z.txt`

## Codex findings — adjudication

| # | Section | Verdict | Reason |
|---|---|---|---|
| 1 | Task 6.1 / Verification — `npx js-yaml` validation | ACCEPT (mechanical) | `package.json` declares `yaml` (v2.8.3), not `js-yaml`. The `npx js-yaml` command would download a different package on the fly. Replace with a Node-based check using the installed `yaml` dep. |
| 2 | Goal vs Task 7 — "close out deferred test items" | ACCEPT (mechanical) | Goal still says "close out deferred test items" but Task 7 now defers F14/F28. Internal contradiction. Update goal to "route deferred test items to `tasks/todo.md`". |
| 3 | Task 7 — duplicate-rows risk in `tasks/todo.md` | ACCEPT (mechanical) | Verified: F14/F28 exist twice in todo.md (lines 2157-2158 from PR #246 chatgpt routing; lines 2175-2176 from Iter 1). Spec's "add two new rows" instruction is non-idempotent. Fix spec wording AND collapse the duplicate in todo.md (keep the richer Iter 1 entry, remove the older sparse one). |
| 4 | Task 5.3 — incomplete SystemPrincipal literal + wrong test framework prose | ACCEPT (mechanical) | Verified: `SystemPrincipal` requires `id`, `subaccountId: null`, `teamIds`, `isSystemPrincipal: true` (per `principal/types.ts:30-37`). Iter 1 example was missing `id` and `teamIds`. Also: the test file imports from `vitest` (line 11), not "tsx-style assertions". Fix both: complete the literal AND correct the framework prose. |
| 5 | Task 5.1 — narrower than cited contract | REJECT | Codex suggests Task 5.1 should also align `ActionDefinition.idempotency?: IdempotencyContract` and consumers. But that field is OPTIONAL (`?:`) and the v7.1 spec at line 690 keeps it optional — there are no current consumers in `server/config/actionRegistry.ts` registry entries (the source spec is itself a future-state spec, not yet implemented in the registry). The Iter 1 task already commits to bringing the standalone interface in line. Expanding scope to "verify and align consumers" pulls v7.1 implementation work into a lint-cleanup spec, which would directionally bloat the spec. The narrower scope is intentional and correct for this spec. |
| 6 | Task 6 — "mandatory blocking" enforcement boundary | ACCEPT (mechanical) | Codex is right that "mandatory blocking checks" is ambiguous: the spec adds an unconditional CI job, but doesn't say whether GitHub branch-protection / required-status-check configuration is in scope. Pin the boundary explicitly: workflow-level blocking is in scope; branch-protection config is out of scope for this spec. |
| 7 | Tasks 1-4/6.1/Verification — Unix tooling not declared | REJECT | Same reason as Iter 1 Finding #1: the spec's frontmatter explicitly says `superpowers:subagent-driven-development` / `executing-plans` is the execution path, both of which run via Bash tool inside Claude Code per CLAUDE.md `<env>` block (`Shell: bash`). The Bash assumption is the documented runtime convention; declaring it in every spec would be noise. |
| 8 | Task 3 — error-count drift across artifacts | REJECT | Codex flags "~127 vs 127 vs 123" as a baseline trust issue. The "~127" is a soft estimate ("These are mechanical — use `!` assertions"); the "127, 35 files" line in the self-review table is a different snapshot timing. Counts naturally drift because Task 2's production fixes can cascade; that's why Task 3.8 says "may differ slightly from inventory after earlier fixes" and Task 3.9 closes the loop with "must be 0". Normalising hard counts across three artifacts adds maintenance burden without changing the implementation outcome — when the implementer reaches each step, they re-measure. Reject as low-value perfectionism. |
| 9 | Task 8.3 — non-blocking review routing target | ACCEPT (mechanical) | Codex is right: `## PR Review deferred items / PR #<N>` doesn't match the actual heading shape in todo.md (which uses `## PR Review deferred items` then `### PR #<N>`). Pin the literal heading shape. |

## Rubric findings (added by reviewer pass)

None new this round — Codex caught the file-inventory drift (#3), the contradiction (#2), and the contract gap (#4) that the rubric pass would also have raised.

## Mechanical edits to apply

1. **Task 6.1 / Verification** — replace `npx js-yaml ... > /dev/null && echo valid` with `node -e "const fs=require('fs');const yaml=require('yaml');try{yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('valid');}catch(e){console.error(e.message);process.exit(1);}"` (uses the installed `yaml` dep, no `/dev/null`, works in any shell).
2. **Goal** — change "close out deferred test items" to "route deferred test items to `tasks/todo.md`".
3. **Task 7** — change "add two new rows" to "ensure two rows exist; update in place if already present; do not duplicate". Also: remove the older duplicate F14/F28 rows at todo.md lines 2157-2158 (already routed; collapse onto the richer Iter 1 entry at lines 2175-2176).
4. **Task 5.3** — fix the SystemPrincipal literal to include all required fields per `principal/types.ts:30-37`; correct the prose from "tsx-style assertions, not vitest" to "vitest-style assertions runnable via `npx tsx`".
5. **Task 6 intro / 6.1** — add an explicit boundary line: "Scope: workflow-level blocking job. Out of scope: GitHub branch-protection / required-status-check configuration — that's a repo-admin concern, not a code change."
6. **Task 8.3** — pin the literal heading shape: `## PR Review deferred items` followed by `### PR #<N>` rather than `## PR Review deferred items / PR #<N>`.

## Step 7 — Autonomous decisions for directional / ambiguous findings

None this round. All 9 findings classify cleanly as mechanical-accept or mechanical-reject; no testing-posture / framing / rollout-model conflicts surfaced.

## Iteration 2 Summary

- Mechanical findings accepted:  6 (Codex #1, #2, #3, #4, #6, #9)
- Mechanical findings rejected:  3 (Codex #5 — directional scope creep; #7 — env mismatch repeat; #8 — low-value perfectionism)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (filled by Step 8b)
