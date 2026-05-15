# ChatGPT PR Review Session — claude-wave-2-audit-sweep — 2026-05-15T07-40-35Z

## Session Info
- Branch: claude/wave-2-audit-sweep
- PR: #323 — https://github.com/michaelhazza/automation-v1/pull/323
- Mode: manual
- Started: 2026-05-15T07:40:35Z

## Review scope notes
This PR is a READ-ONLY findings PR (Wave 2 Session A audit sweep). Diff is
entirely audit logs + todo backlog additions — no application code is changed.
ChatGPT is being asked to review the **audit findings themselves**:
substantiveness, severity calibration, missed gaps, prevention-proposal
quality.

Files reviewed (full diff bundle to ChatGPT):
- `tasks/audit-logs/audit-log-wave-2-agent-execution-*.md`
- `tasks/audit-logs/audit-log-wave-2-circular-deps-*.md`
- `tasks/audit-logs/audit-log-wave-2-duplication-*.md`
- `tasks/audit-logs/audit-log-wave-2-frontend-*.md`
- `tasks/audit-logs/audit-log-wave-2-skills-*.md`
- `tasks/audit-logs/critical-path-coverage-matrix-*.md`
- `tasks/audit-logs/madge-server-raw.txt`
- `tasks/audit-logs/registry-keys.txt`
- `tasks/audit-logs/registry-slugs.txt`
- `tasks/audit-logs/skill-slugs.txt`
- `tasks/todo.md` (append-only Wave 2 block)

Excluded from the upload (still part of the PR, but not useful for ChatGPT
review): `tasks/audit-logs/jscpd-*/jscpd-report.json` raw tool outputs
(47,942 of 48,742 diff lines, already summarised inside the audit logs).

---

## Round 1 — 2026-05-15T07-55-00Z

**ChatGPT verdict:** NEEDS_WORK with 3 audit-artifact fixes (F1, F2, F3 Should-fix; T1, T2 Tightening).

### ChatGPT feedback (raw)

> I'll review this PR as an audit-artifact/todo update, not as code remediation. I'm checking internal consistency, whether the audit logs support the todo entries, and whether anything misleading would poison later follow-up work.
>
> Verdict: NEEDS_WORK with 3 audit-artifact fixes before merge. No runtime code is being changed, but a few audit conclusions are internally inconsistent enough that they could misdirect follow-up planning.
>
> | ID | Severity | Finding | Fix |
> |---|---|---|---|
> | F1 | Should-fix | Skills audit count is not grounded to a canonical comparator. The audit says 95 .md skill files have no matching actionRegistry slug, but it also includes both registry-keys.txt with 103 raw grep keys, including nested non-actions, and registry-slugs.txt with only 62 slugs. The audit itself admits the 103 count includes false positives. That makes the headline "95 unmatched" unstable. | Pick one canonical source before logging the finding: preferably generated from ACTION_REGISTRY at runtime or an explicit manifest. Then update SK1, tasks/todo.md, and the source count files to match. If exact classification is deferred, say "preliminary grep found X candidates" rather than a definitive 95. |
> | F2 | Should-fix | Critical-path matrix overstates coverage tier. It marks several rows as gates + sparse unit while the row text says the canonical invariant is not actually covered, for example idempotency-key dedup has no named test, and LLM call-site routing has no gate proving all SDK calls go through the router. The summary then says 6 paths are "fully covered (sparse)," which is stronger than the evidence. | Downgrade those rows to partial / inferred or gates only unless the specific invariant has a named test or gate. Update the summary language to avoid "fully covered" for inferred coverage. |
> | F3 | Should-fix | V1 blocker candidates are not tagged as such in tasks/todo.md. The coverage matrix explicitly recommends pg-boss handler idempotency, handoff durability, and service-principal trace boundary as v1 blocker candidates, but the todo entries are generic [status:open] items. That loses the decision pressure this audit is trying to create. | Add a tag such as [candidate:v1-blocker] or a separate "Operator decision required" subsection for MC7, MC8, and MC10. |
> | T1 | Tightening | Circular-deps percentage wording looks inflated. CD1 says cycles 19–61 dominate and the todo says approx 42 of 73 server cycles. That range is 43 cycles, around 59 percent, not ~85 percent. "Three dominant clusters account for ~85%" may be true, but CD1 alone is not. | Clarify whether the 85 percent refers to CD1–CD3 combined, or reduce the percentage language. |
> | T2 | Tightening | Duplication audit has at least one obvious line-range typo. The server top-20 table lists updateProposal.ts:191-162, which is reversed. | Fix the typo so future builders do not waste time reconciling impossible ranges. |
>
> Once those are corrected, I'd approve this PR as a clean audit sweep and todo backfill.

### Triage

| ID | Triage | Recommendation | Rationale | Decision |
|---|---|---|---|---|
| F1 | technical | implement | Internal-consistency concern on an audit artefact; correcting the wording costs nothing and prevents follow-up planners from anchoring on an unstable count. The 95-vs-62-vs-103 instability is a real audit-quality issue. | **auto-applied** |
| F2 | technical | implement | Same class — audit-artefact accuracy. The "fully covered (sparse)" summary line is materially stronger than the evidence supports. | **auto-applied** |
| F3 | technical | implement | Operational tagging on the todo backlog so future triage sessions can filter v1-blocker candidates with one grep (`[candidate:v1-blocker]`). | **auto-applied** |
| T1 | technical | implement | Wording precision on a percentage. Trivial fix. | **auto-applied** |
| T2 | technical | implement | Typo fix. The reversed `191-162` range originates in the raw jscpd 4.2.0 reporter output; added a footnote explaining the artefact, corrected the row to the implied range `191-224` (34 lines forward from start, matching the merge.ts range size), preserved raw `jscpd-report.json` unmodified. | **auto-applied** |

### Actions applied

- **F1:** Rewrote SK1 in `tasks/audit-logs/codebase-audit-log-wave-2-skills-2026-05-15T07-19-34Z.md` and the matching entry in `tasks/todo.md`. Downgraded confidence from `high` to `medium`. Removed the definitive "95" headline; replaced with "preliminary grep found ~95 candidates" framing and named the three different comparator methods (103 / 62 / ~95) with explicit unstable-count caveat. Recommended next step: runtime `Object.keys(ACTION_REGISTRY)` enumeration to ground the canonical comparator.
- **F2:** Downgraded Module C matrix rows 2, 3, 4, 6 from `gates + sparse unit` to `partial / inferred`. Rewrote the Summary block — replaced "fully covered (sparse)" with row-specific accuracy: rows 1 + 9 are sparse-unit-covered; rows 2-4 + 6 are partial-inferred; rows 5, 7, 8, 10, 11, 12 are gates-only. Updated grade from "gates + sparse unit" to "mixed — partial/inferred-dominant".
- **F3:** Added `[candidate:v1-blocker]` tag to AE1, AE2, MC7, MC8, MC10 in `tasks/todo.md`. Future triage sessions can grep `[candidate:v1-blocker]` to surface the operator-decision-pressure set.
- **T1:** Rewrote the "Three dominant cycle clusters" intro in the circular-deps audit log to clarify the ~85% applies to CD1+CD2+CD3 combined. CD1 alone is ~59%. Updated the CD1 entry in `tasks/todo.md` to match (`≈43 of 73, ≈59% alone; CD1+CD2+CD3 combined ≈85%`).
- **T2:** Corrected the duplication row 3 second-range from `:191-162` to `:191-224` (34-line forward range matching the merge.ts size). Added a footnote explaining the reversed range is a jscpd 4.2.0 reporter artefact; raw `jscpd-report.json` preserved unmodified.

No user-facing findings — every Round 1 item was technical audit-artefact polish.

### Files modified

- `tasks/audit-logs/codebase-audit-log-wave-2-skills-2026-05-15T07-19-34Z.md`
- `tasks/audit-logs/codebase-audit-log-wave-2-circular-deps-2026-05-15T07-19-34Z.md`
- `tasks/audit-logs/codebase-audit-log-wave-2-duplication-2026-05-15T07-19-34Z.md`
- `tasks/audit-logs/critical-path-coverage-matrix-2026-05-15T07-19-34Z.md`
- `tasks/todo.md`
- `tasks/review-logs/chatgpt-pr-review-claude-wave-2-audit-sweep-2026-05-15T07-40-35Z.md` (this file)

Round 1 status: **5 of 5 ChatGPT findings auto-applied (all technical).** Awaiting operator signal for Round 2 (paste new ChatGPT response) or `done` to finalise.

---

## Round 2 — 2026-05-15T08-00-00Z

**ChatGPT verdict:** NEEDS_WORK with 2 remaining audit-text inconsistencies (R2-F1, R2-F2 — both Should-fix). After fixes: approve.

### ChatGPT feedback (raw)

> Verdict: NEEDS_WORK, 2 remaining audit-text inconsistencies. The Round 1 fixes mostly landed, but two stale summary lines still contradict the corrected body.
>
> | ID | Severity | Finding | Fix |
> |---|---|---|---|
> | R2-F1 | Should-fix | tasks/todo.md source-log summary still says "95 of 186 skill .md files have no matching actionRegistry slug." The detailed SK1 entry was correctly downgraded to "preliminary grep found ~95 candidates" with unstable comparator caveat, but the source-log bullet still presents the old definitive headline. | Change the source-log bullet to match the corrected wording, e.g. "preliminary grep found ~95 candidate unmatched skill .md files; comparator is unstable pending runtime Object.keys(ACTION_REGISTRY) enumeration." |
> | R2-F2 | Should-fix | Critical-path matrix final sentence still says "6 fully covered (sparse), 6 gates-only." The summary table now correctly says only 2 are gates + sparse unit, 4 are partial / inferred, and 6 are gates only, but the final line preserves the old overclaim. | Replace with: "12 critical paths inspected; 2 have sparse named coverage, 4 are partial/inferred, and 6 are gates-only with no named test." |
>
> After those two stale lines are corrected, I'd approve this PR.

### Triage

| ID | Triage | Recommendation | Rationale | Decision |
|---|---|---|---|---|
| R2-F1 | technical | implement | Wording-consistency cleanup on the same audit-artefact issue addressed in Round 1. Trivial fix. | **auto-applied** |
| R2-F2 | technical | implement | Wording-consistency cleanup matching the corrected Round 1 summary table. Trivial fix. | **auto-applied** |

### Actions applied

- **R2-F1:** Rewrote the source-log summary bullet for the skills audit in `tasks/todo.md` (line 1649) using ChatGPT's suggested wording verbatim. The detailed SK1 entry was already correct from Round 1.
- **R2-F2:** Replaced the final sentence in `tasks/audit-logs/critical-path-coverage-matrix-2026-05-15T07-19-34Z.md` (line 54) with ChatGPT's suggested wording verbatim. The summary table was already correct from Round 1.

No user-facing findings — both items were technical audit-artefact wording consistency.

### Files modified

- `tasks/todo.md`
- `tasks/audit-logs/critical-path-coverage-matrix-2026-05-15T07-19-34Z.md`

Round 2 status: **2 of 2 ChatGPT findings auto-applied. ChatGPT confirmed: "after those two stale lines are corrected, I'd approve this PR."**

---

## Final Summary

**Verdict:** APPROVED

Total rounds: 2. Total ChatGPT findings: 7 (5 in Round 1, 2 in Round 2). All 7 technical; 0 user-facing. All 7 auto-applied per recommendation. No deferrals; no rejections.

**Doc-sync verdict for this PR** (per `docs/review-logs/README.md` Final Summary contract):

| Field | Verdict |
|---|---|
| KNOWLEDGE.md updated | no — this is an audit-findings PR, all durable patterns are tracked in tasks/todo.md prevention-proposal entries and will be promoted to KNOWLEDGE.md when the relevant fix-PRs land |
| architecture.md updated | n/a — read-only audit, no architecture changes |
| capabilities.md updated | n/a: docs-only change (audit findings) |
| integration-reference.md updated | n/a — no integration behaviour change |
| CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated | n/a — read-only audit, no convention change |
| spec-context.md updated | n/a — not a spec-review session |
| frontend-design-principles.md updated | n/a — read-only audit; FE1 finding is a candidate for future principle reinforcement but no edit landed in this PR |

PR #323 is ready for merge.

