# ChatGPT PR Review — closed-loop-skill-improvement

**PR:** #353 https://github.com/michaelhazza/automation-v1/pull/353
**Branch:** claude/review-mockup-suggestions-tVf84
**Build slug:** closed-loop-skill-improvement
**Build class:** Major
**Mode:** MANUAL
**Started:** 2026-05-18T09:35:06Z
**Verdict:** APPROVED (Round 4)

---

## Context

Phase 2 reviewers were skipped (feature-coordinator exited uncleanly). chatgpt-pr-review served
as primary second-opinion pass for: adversarial-reviewer, reality-checker, dual-reviewer,
chatgpt-plan-review.

Spec deviations carried into review:
- 15 directional schema gaps (§7 Data Model) — accepted post-merge per operator decision
- Migration numbers renumbered twice during S2 (0370→0372→0374, 0371→0373→0375) due to
  collisions with PRs #349 (browser-hardening-primitives) and #351 (memory-tiered-consolidation)

---

## Round 1

**Diff:** `.chatgpt-diffs/pr353-round1-code-diff.diff`

### Findings

| # | Severity | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|---|
| F1 | 🔴 Blocking | `verify-resolver-runid-invariant.sh` bypassable by multiline formatting | technical | IMPLEMENT | grep `[^)]*` misses multiline-formatted calls; multiline-aware scan via `tr` collapse required |
| F2 | 🟡 Should-fix | `failure:post-mortem` idempotency contract weaker than comments — no explicit singletonKey | technical | IMPLEMENT | Wire singletonKey through pgBossTxSend; pass `failure-post-mortem:{judgementId}` at dispatch |
| F3 | 🟡 Should-fix | `detectRollback()` ignores inconclusive for fix_proposed | product policy | IMPLEMENT | Operator: "do all as recommended" — inconclusive on fix_proposed = conservative suspend |
| F4 | 💭 Consider | gitignore rca-samples glob only covers flat `*.json` | technical | IMPLEMENT | Widen to `**` to cover nested paths and non-JSON artefacts |
| F5 | 💭 Consider | `expectedVerdictForTag()` has no exhaustiveness enforcement | technical | IMPLEMENT | Switch to exhaustive `switch` with `never` assertion |

**Commit:** `d11e5ea0` — fix(closed-loop): chatgpt-pr-review R1 — 5 findings (F1+F2+F3+F4+F5)

---

## Round 2

**Diff:** `.chatgpt-diffs/pr353-round2-code-diff.diff`

### Findings

| # | Severity | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|---|
| F1 | 🔴 Blocking | `rlsProtectedTables.ts` policyMigration still references 0370 (should be 0374) | technical | IMPLEMENT | 7 entries updated 0370→0374; RLS contract/coverage checks would fail on old filename |
| F2a | 🟡 Should-fix | Migration file headers still say 0370/0371 | technical | IMPLEMENT | Updated 0374_skill_amendments_phase_1 header + 0375_extend_llm_request_enums header |
| F2b | 💭 Consider | Prototype shows "System"/"System tier" language in subaccount skill detail | technical | REJECT | False-positive — text not present in any `prototypes/closed-loop-skill-improvement/*.html` file; ChatGPT cannot see HTML files and hallucinated this finding |

**Commit:** `31d8dcda` — fix(closed-loop): chatgpt-pr-review R2 — migration renumber cleanup (F1+F2)

---

## Round 3

**Diff:** `.chatgpt-diffs/pr353-round3-code-diff.diff`

### Findings

| # | Severity | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|---|
| F1 | 🔴 Blocking | `failure:post-mortem` dispatched with `skillSlug: qualityCheckSlug` — wrong entity name in telemetry | technical | IMPLEMENT | Amendment routing is correct (driven by resolvedSkillId from snapshot), but all log payloads showed quality-check name not skill name. Payload renamed to `qualityCheckSlug`; skill slug resolved post-snapshot from systemSkills/skills table as `resolvedSkillSlug` |
| F2 | 🟡 Should-fix | `rlsProtectedTables.ts` section comment still says `0370` | technical | IMPLEMENT | Updated section comment to `0374` |
| F2b | 💭 Consider | Prototype System/org tier language (repeated) | — | REJECT | Same false-positive as Round 2 |

**Commit:** `2833d1f2` — fix(closed-loop): chatgpt-pr-review R3 — F1+F2 skillSlug + stale comment

---

## Round 4

**Diff:** `.chatgpt-diffs/pr353-round4-code-diff.diff`

**Verdict: APPROVED**

> "I don't see any new substantive findings in the Round 4 delta based on the fixes applied.
> Final state looks internally consistent: qualityCheckSlug vs resolved runtime skillSlug separation
> is now correct and removes the mis-association risk. Post-snapshot resolution pattern preserves
> snapshot integrity while still attaching amendments to the correct skill. Migration
> references/comments now consistently align on 0374. Rejected 'System tier' finding remains
> a valid rejection. No additional blocking or should-fix issues surfaced."

---

## Final Summary

**Verdict:** APPROVED after 4 rounds
**Findings:** 9 total — 8 IMPLEMENT, 1 REJECT (false-positive)
**Commits:** d11e5ea0, 31d8dcda, 2833d1f2

**docs/capabilities.md verdict:** `yes: create new capability record`
(Closed-Loop Skill Improvement — new capability surface: amendment pipeline, morning queue,
regression replay, peer review, freeze switches — see doc-sync sweep)

**KNOWLEDGE.md patterns extracted:** see Step 7

**tasks/todo.md items closed:** see Step 8
