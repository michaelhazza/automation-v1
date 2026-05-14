# ChatGPT Spec Review Session — development-lifecycle-governance-upgrade — 2026-05-14T03-57-57Z

## Session Info
- Spec: tasks/builds/development-lifecycle-governance-upgrade/spec.md
- Branch: claude/ai-driven-dev-lifecycle-FRqBd
- PR: #304 — https://github.com/michaelhazza/automation-v1/pull/304
- Mode: manual
- Started: 2026-05-14T03:57:57Z

---

## Round 1 — 2026-05-14T04:10:00Z

### ChatGPT Feedback (raw)

> I'll review it as an implementation-readiness pass, focusing on contradictions, missing enforcement contracts, edge cases, and places a builder could misread the intended scope.
>
> I've found one likely blocker already: tasks/todo.md is treated as a merge-time touched file in Chunk 4, but it is not counted in the locked repo-diff inventory. That creates a self-contradicting file-count gate.
>
> Findings
>
> 1. **tasks/todo.md is omitted from the repo-diff inventory despite being modified in Chunk 4** — Severity: critical, Category: bug. §4.2 and §4.6 lock the merge diff to 7 modified files plus optional docs/spec-template.md, but Chunk 4 explicitly lists tasks/todo.md as a touched file for one-time backfill entries. That means a compliant Chunk 4 implementation will violate the spec's own inventory/count gate. Fix by either adding tasks/todo.md to §4.2 and updating §4.6 to 8–9 repo files, or by making backfill TODO creation a runtime/manual follow-up outside this PR.
>
> 2. **Broken forward reference: G4 cites "§6.5-derived field set," but §6.5 does not exist** — Severity: high, Category: bug. Goal G4 says docs/capabilities.md becomes an Asset Register with the "§6.5-derived field set," but the actual schema is in §7.4. This is an unresolved forward reference in a goal-level acceptance claim. Replace with "§7.4-derived field set."
>
> 3. **Compound Learning target count is inconsistent: "six fixed targets" vs eight-value enum** — Severity: high, Category: bug. §5.5 says each pattern routes to "at most one of six fixed targets," while §6.2 and §7.5 define an eight-value enum, with only the agent-instruction sub-option constrained to six agents. This will confuse finalisation-coordinator implementation. Reword §5.5 and G6 to say "one of eight target values, with agent-instruction limited to six named agents."
>
> 4. **Cluster-list mutation rules contradict the single-source-of-truth rule** — Severity: high, Category: architecture. §7.1 says a new cluster requires extending §7.4.2 and docs/capabilities.md in the same PR, while §7.4.5 later says that once shipped, docs/capabilities.md becomes the canonical durable location and §7.4.2 is historical only. The implementation rule should consistently point future builds to docs/capabilities.md plus ADR/checklist updates, not to editing this spec's §7.4.2.
>
> 5. **Chunk 7 acceptance contains an impossible or misleading fallback** — Severity: medium, Category: bug. Chunk 7 says this build's Capability Registration verdict may be n/a: docs-only change if Chunk 4 has not shipped at finalisation. But the dependency graph requires Chunk 4 before Chunk 5, Chunk 5 before Chunk 6, and Chunks 1–6 before Chunk 7. Under the stated sequencing, Chunk 4 has shipped before finalisation of the full build. Remove the fallback or reframe it as only applying to partial/cherry-picked implementation, which the spec otherwise does not describe.
>
> 6. **Asset Register table format is under-specified for builders** — Severity: medium, Category: improvement. §7.4.1 defines fields in order, but does not provide the exact Markdown table header to place in docs/capabilities.md. Given the spec relies on human inspection and future grep-like checks, the exact header should be pinned as a code block. Otherwise builders may vary column names like Capability ID vs Capability ID / slug, making later checks brittle.
>
> 7. **Duplication / Strategy Check has ambiguous semantics for multi-cluster and mixed-lifecycle cases** — Severity: medium, Category: improvement. The duplication check compares cluster/outcome, but Affected Capability Area can contain multiple clusters, and lifecycle state is stored per capability row, not per cluster. The spec does not define what happens when one matching capability in a cluster is Growth and another is Sunset Candidate, or when different clusters produce different recommendations. Add a tie-break rule, such as "evaluate all matching rows, record closest match, and use the most conservative recommendation."
>
> 8. **revise is a non-blocking recommendation but lacks a required remediation loop** — Severity: medium, Category: improvement. stop and merge with existing capability halt and escalate, but revise does not. Since revise means partial overlap, it should either require operator acknowledgement before proceeding or require the coordinator to update intent.md and rerun Step 3a. As written, a partially overlapping build can continue without a defined revision action.
>
> 9. **Spec says "light static checks," but v1 explicitly adds no static checks** — Severity: low, Category: clarity. §1 says enforcement includes "light static checks," while §4.5, §4.6, §13, and §14 repeatedly state no new gate scripts or validation scripts. If the intended meaning is "existing static gates only," say that explicitly. Otherwise the implementation scope appears broader than the chunk plan.
>
> 10. **Open Questions section conflicts with implementation-ready status** — Severity: low, Category: style. §15 still has an open architect question about cluster-list completeness, but the spec ends by saying it is implementation-ready pending handoff. That is acceptable only if the question is explicitly non-blocking. Reword the question as "Chunk 4 backfill validation note" or mark it "non-blocking."
>
> Overall verdict: CHANGES_REQUESTED

**Top themes (Round 1):** spec-internal consistency drift between Domain Model / Goals and Data Contracts (3 findings), inventory / count gate contradictions (1 finding, the headline blocker), missing remediation procedures for ambiguous gate outcomes (2 findings), under-specified contracts for builders (2 findings), reference / clarity hygiene (2 findings).

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | `tasks/todo.md` touched by Chunk 4 backfill but missing from §4.2 inventory and §4.6 count | technical-escalated (critical) | apply | user-approved (apply) | critical | Real self-contradiction in the inventory-lock gate; user approved adding `tasks/todo.md` to §4.2 + bumping §4.6 to 8-9 + cleaning §4.3 split |
| F2 | G4 cites non-existent §6.5; schema is at §7.4 | technical-escalated (high) | apply | user-approved (apply) | high | Pure forward-reference typo |
| F3 | §5.5 says "six fixed targets" but §6.2/§7.5 define eight-value enum | technical-escalated (high) | apply | user-approved (apply) | high | Contract drift; §6.2/§7.5 are load-bearing definitions and win |
| F4 | §7.1 tells future builds to extend §7.4.2 + `docs/capabilities.md`; §7.4.5 says §7.4.2 is historical post-ship | technical-escalated (high) | apply | user-approved (apply) | high | Aligns §7.1 with the post-ship single-source-of-truth rule |
| F5 | Chunk 7 acceptance fallback (`n/a: docs-only change`) is unreachable under the dependency graph + one-PR-per-feature-branch rule | technical | apply | auto (apply) | medium | Dropped the unreachable fallback |
| F6 | §7.4.1 lists fields in order but does not pin the exact Markdown table header | technical | apply | auto (apply) | medium | Added a verbatim 12-column header code block beneath §7.4.1 |
| F7 | Duplication / Strategy Check has no tie-break rule for multi-cluster or mixed-lifecycle cases | technical | apply | auto (apply) | medium | Added most-conservative-wins collapse + worst-toward-Sunset state rule + recording requirement to §6.1.1 |
| F8 | `revise` recommendation has no remediation loop (only `stop` and `merge` halt) | technical | apply | auto (apply) | medium | Added Soft-gate `revise` pause-and-loop procedure to §6.1 Step 3a row |
| F9 | §1 mentions "light static checks" but §4.5/§4.6/§13/§14 say no new validation scripts | technical | apply | auto (apply) | low | Clarified §1 to say "existing static gates" only; no new gates introduced |
| F10 | §15 has an open architect question but the spec also says it is implementation-ready | technical | apply | auto (apply) | low | Marked Q1 as non-blocking; reframed as a Chunk 4 backfill verification note |

**Integrity check (post-edit, one-pass):** 5 issues found, all technical / mechanical, all auto-applied.

| INT# | Issue | Decision |
|------|-------|----------|
| INT-1 | §4.6 obligation count said "3 distinct write obligations" but enumerated 4 | auto (apply) — fixed count to 4 |
| INT-2 | Chunk 3 acceptance dry-runs only covered `stop` and `proceed`; revise + merge branches now have distinct behaviours that need walkthroughs | auto (apply) — extended to all four branches |
| INT-3 | §7.2 Lifecycle Declaration `Capability cluster` row source still cited §7.4.2 directly; conflicts with F4 fix | auto (apply) — updated source to `docs/capabilities.md` (seeded from §7.4.2) |
| INT-4 | §7.4.1 Cluster row Source still cited "from §7.4.2 closed list"; same conflict as INT-3 | auto (apply) — updated source to `docs/capabilities.md` (seeded from §7.4.2) |
| INT-5 | §11 Backwards-Compatibility invariant listed §4.2 paths but did not include `tasks/todo.md` after F1 added it | auto (apply) — added `tasks/todo.md` to the invariant's path list |

Integrity check: 5 issues found this round (auto: 5, escalated: 0).

### Applied (auto-applied technical + user-approved escalated + integrity-check)

User-approved (4 escalated findings):
- [user] F1: Added `tasks/todo.md` row to §4.2; updated §4.6 file count to 8-9; reworked §4.3 to remove the duplicated Chunk 4 portion (only per-build Step 7a writes remain runtime).
- [user] F2: Replaced "§6.5-derived" with "§7.4-derived" in G4.
- [user] F3: Reworded §5.5 and G6 to reflect the eight-value §7.5 enum, with `agent-instruction` constrained to six named agents.
- [user] F4: §7.1 Affected Capability Area now points at `docs/capabilities.md` (live) + the §7.4.5 cluster mutation procedure; §7.4.2 explicitly named as historical reference post-Chunk-4-ship.

Auto-applied technical (6 findings):
- [auto] F5: Removed the unreachable `n/a: docs-only change` fallback from Chunk 7 acceptance; clarified the verdict.
- [auto] F6: Added the pinned 12-column Markdown table header code block below §7.4.1.
- [auto] F7: Added multi-cluster + mixed-lifecycle tie-break rules to §6.1.1.
- [auto] F8: Added the Soft-gate `revise` pause-and-loop procedure to §6.1 Step 3a row.
- [auto] F9: Reworded §1 to clarify enforcement is "markdown + coordinator instructions + doc-sync verdicts only".
- [auto] F10: Marked §15 Q1 as non-blocking; reframed as a Chunk 4 backfill verification note.

Integrity-check (5 mechanical, all auto):
- [auto] INT-1: §4.6 obligation count corrected from 3 to 4.
- [auto] INT-2: Chunk 3 acceptance dry-run list extended to all four recommendation branches.
- [auto] INT-3: §7.2 Lifecycle Declaration `Capability cluster` source updated.
- [auto] INT-4: §7.4.1 Cluster row source updated.
- [auto] INT-5: §11 invariant path list updated to include `tasks/todo.md`.

---
