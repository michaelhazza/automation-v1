# ChatGPT Spec Review Session — development-lifecycle-governance-upgrade — 2026-05-14T03-57-57Z

## Session Info
- Spec: tasks/builds/development-lifecycle-governance-upgrade/spec.md
- Branch: claude/ai-driven-dev-lifecycle-FRqBd
- PR: #304 — https://github.com/michaelhazza/automation-v1/pull/304
- Mode: manual
- Started: 2026-05-14T03:57:57Z
- Finalised: 2026-05-14T04:40:00Z
- **Verdict:** APPROVED (3 rounds; ChatGPT returned APPROVED on Round 3 with two low-severity polish items, both auto-applied)

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

## Round 2 — 2026-05-14T04:25:00Z

### ChatGPT Feedback (raw)

> Round 2 Findings
>
> 1. **Stale file-count acceptance criterion still says 7–8 repo files** — Severity: high, Category: bug. §4.6 was correctly updated to 8–9 repo files, but §12 Self-consistency still says "The numeric counts in §4.6 (7–8 repo files in the merge diff) reconcile to the actual git diff at merge." This will create a false spec-conformance failure. Update §12 to 8–9 repo files.
>
> 2. **Cluster mutation rule still contains the old contradictory instruction in §7.4.2** — Severity: high, Category: bug. §7.1, §7.2, §7.4.1, §7.4.5, and §15 now correctly make docs/capabilities.md the live source of truth after Chunk 4. However §7.4.2 still says a new cluster must update "both §7.4.2 in this spec's successor (or via an ADR) AND the cluster list header in docs/capabilities.md." That conflicts with the new single-source rule. Replace that paragraph with a pointer to §7.4.5 only.
>
> 3. **Deferred current-focus.md note still references the old 7–8 file bound** — Severity: medium, Category: bug. §14 says deferring current-focus.md keeps the v1 merge diff bounded to the "7–8 repo files named in §4.6," but §4.6 is now 8–9. Update to 8–9 or avoid repeating the count and say "bounded to the §4.6 inventory."
>
> 4. **Chunk 3 behaviour summary omits the new revise soft gate** — Severity: medium, Category: improvement. §6.1 Step 3a and Chunk 3 acceptance now correctly define and test all four recommendation branches, including the revise pause-and-rerun loop. But Chunk 3's Behaviour still says only "Hard escalation on recommendation = stop or recommendation = merge with existing capability." Add one bullet for revise as a soft gate, so the behaviour summary matches the service contract and acceptance criteria.
>
> 5. **G5 says "n/a with reason," but the accepted format is stricter** — Severity: low, Category: clarity. G5 says MERGE_READY cannot be set without a yes or n/a with reason verdict. §6.2.1 restricts that to four exact n/a: strings. This is not a blocker, but tightening G5 to "one of the valid §6.2.1 verdict strings" would prevent loose phrasing from leaking into implementation.
>
> Overall verdict: CHANGES_REQUESTED

**Top themes (Round 2):** stale-reference cleanup from Round 1's edits — three findings (F2-1, F2-2, F2-3) are sections I missed updating during the F1/F4 fix sweeps; one (F2-4) is a section I missed during F8; one (F2-5) is a new clarity tightening. All five are continuations or low-severity wording — no new architectural issues surfaced.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F2-1 | §12 Self-consistency still says "7–8 repo files in §4.6" but §4.6 is now 8–9 | technical (continuation of Round 1 F1) | apply | auto (apply) | high | Per duplicate-findings rule: continuation of an already-decided finding (count cleanup). User pre-approved in Round 1 F1; no re-escalation needed |
| F2-2 | §7.4.2 closedness paragraph still says new cluster must update §7.4.2 + docs/capabilities.md (contradicts §7.4.5 single-source rule) | technical (continuation of Round 1 F4) | apply | auto (apply) | high | Same finding-class as F4 (cluster-list source-of-truth). Replaced paragraph with §7.4.5 pointer; "do not edit §7.4.2" guidance added |
| F2-3 | §14 current-focus.md deferral references old "7–8 repo files" count | technical (continuation of Round 1 F1) | apply | auto (apply) | medium | Same finding-class. Reworded to "§4.6 inventory" so the count is not duplicated and stays in one place |
| F2-4 | Chunk 3 Behaviour summary omits the new `revise` soft gate (continuation of Round 1 F8) | technical (continuation of Round 1 F8) | apply | auto (apply) | medium | Added soft-gate bullet + tie-break-rule bullet to Chunk 3 Behaviour for parity with §6.1 Step 3a contract |
| F2-5 | G5 says "n/a with reason" but §6.2.1 enumerates four exact `n/a:` strings | technical | apply | auto (apply) | low | New finding (not from Round 1). Tightened G5 to reference the eight valid §6.2.1 verdict strings |

**Integrity check (post-edit, one-pass):** 0 issues found. Greps for stale references (`7–8`, `7-8`, `six fixed targets`, `two outcomes`, `§6.5`, `§7.4.2 in this spec`) all returned zero matches. Round 2 introduced no new forward references or contradictions.

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

### Applied (auto-applied technical, all 5 from Round 2 + 0 from integrity check)

- [auto] F2-1: §12 self-consistency count "7–8" → "8–9".
- [auto] F2-2: §7.4.2 closedness paragraph rewritten — points at §7.4.5 procedure as the only mutation path; explicit "do not edit §7.4.2" guidance.
- [auto] F2-3: §14 current-focus.md deferral count "7–8 repo files named in §4.6" → "§4.6 inventory".
- [auto] F2-4: Chunk 3 Behaviour summary gains tie-break-rules bullet (§6.1.1 multi-cluster/mixed-lifecycle) + Hard-gate clarification + new Soft-gate `revise` bullet.
- [auto] F2-5: G5 tightened to "one of the eight valid §6.2.1 verdict strings (four `yes:` + four `n/a:`)".

---

## Round 3 — 2026-05-14T04:35:00Z

### ChatGPT Feedback (raw)

> Nothing blocking. Still the same two low-severity polish items from the previous pass:
>
> 1. **G2 still omits the revise soft gate** — Severity: low, Category: clarity. §6.1 and Chunk 3 now clearly define revise as a pause-and-rerun soft gate, but G2 only mentions stop / merge-with-existing escalation. Not implementation-blocking, but G2 would be more complete if it said revise enters the soft revise loop.
>
> 2. **§12 G2 acceptance still omits the revise branch** — Severity: low, Category: clarity. Chunk 3 acceptance already requires dry-runs for all four branches, including revise, so coverage exists. §12 could mirror that by adding "revise triggers the §6.1 soft gate loop."
>
> I'd still call this APPROVED. These are polish-only and can be safely fixed inline or left for the plan author to preserve in implementation.

**Top themes (Round 3):** two final continuations of Round 1 F8 (revise soft gate) — the Goals row and the Acceptance Criteria row that I missed during the F8 sweep. Verdict: APPROVED. No new architectural issues.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F3-1 | G2 only mentions `stop` / `merge-with-existing` escalation; omits the `revise` soft gate | technical (continuation of Round 1 F8) | apply | auto (apply) | low | Same finding-class as F8. Goals row updated to mention all three escalation behaviours |
| F3-2 | §12 G2 acceptance row omits the `revise` branch (only mentions `stop` / `merge with existing capability`) | technical (continuation of Round 1 F8) | apply | auto (apply) | low | Same finding-class. Acceptance row updated for parity with G2 |

**Integrity check (post-edit):** 1 spot-check pass — grepped for `stop.*merge.*existing` to find any remaining "two-branch" phrasings. All matches now either (a) mention all three branches, (b) are inside the recommendation enum table itself (which lists all four values neutrally), or (c) appear in Chunk 3 Behaviour where the Hard-gate / Soft-gate split already ships as separate bullets (lines 561-562). 0 issues.

### Applied (auto-applied technical, all 2)

- [auto] F3-1: G2 verifiable assertion now reads "`stop` / `merge-with-existing` outcomes hard-escalate to the operator; `revise` outcome enters the §6.1 Step 3a Soft-gate pause-and-rerun loop until `proceed` is reached".
- [auto] F3-2: §12 G2 acceptance row now reads "`stop` / `merge with existing capability` outcomes hard-escalate to operator; `revise` outcome triggers the §6.1 Step 3a Soft-gate pause-and-rerun loop".

---

## Final Summary

### Consistency check (across all rounds)

Scanned all 23 final decisions (Round 1: 10 + 5 integrity; Round 2: 5; Round 3: 2) for contradictions across rounds. **0 inconsistencies found.** All decisions trended in the same direction — every finding was applied (4 user-approved + 19 auto-applied), zero rejections, zero deferrals. The R2 and R3 findings were all continuations of R1 decisions (count cleanup, source-of-truth consolidation, revise soft-gate documentation), so the trajectory is reinforcing rather than contradicting.

### Implementation readiness checklist

| Check | Status | Evidence |
|---|---|---|
| All inputs defined | ✅ | Every artefact in §7 names a Producer; §6.1.1 names Inputs / Sources / Decision criteria explicitly |
| All outputs defined | ✅ | Every artefact in §7 names a Consumer + has a worked example or schema (§7.1, §7.2, §7.3, §7.4, §7.5); §6.2.1 enumerates the 8 valid verdict strings |
| Failure modes covered | ✅ | Hard gate (stop / merge), Soft gate (revise pause-and-loop), missing-verdict block on `MERGE_READY`, owner-placeholder rejection, multi-cluster + mixed-lifecycle tie-break |
| Ordering guarantees explicit | ✅ | §6.1 order invariant (Step 3 → 3a → 4 → 5 → 6); §6.2 order invariant (Step 6 → 7 → 7a → 8 → 9 → 10); §10 dependency graph (Chunks 1→3, 4→5→6, 1-6→7) |
| No unresolved forward references | ✅ | R1 F2 fixed §6.5 → §7.4; R2 + R3 closed all stale "7-8" / "six fixed" / "stop/merge-only" references; integrity-check pass at finalisation greps clean |

**All 5 checks pass. Spec is implementation-ready.** Proceed to architect plan authoring.

### Final counts (rounds 1-3 + integrity-check)

- Rounds: **3** (ChatGPT verdict per round: CHANGES_REQUESTED → CHANGES_REQUESTED → APPROVED)
- ChatGPT findings: **17** (R1: 10, R2: 5, R3: 2)
- Integrity-check findings: **6** (R1: 5, R2: 0, R3: 1 spot-check pass with 0 issues)
- **Total decisions: 23**
- Auto-accepted (technical): **19 applied** | 0 rejected | 0 deferred
- User-decided (technical-escalated, all R1): **4 applied** | 0 rejected | 0 deferred
- Index write failures: **0** (clean)

### Doc sync sweep

This spec is a self-contained planning document — it proposes restructuring `docs/capabilities.md` and editing process docs (`CLAUDE.md`, `architecture.md`) at Chunks 4 and 7 of implementation, but the spec itself ships no changes to those docs. The implementation chunks will trigger doc-sync verdicts at their respective finalisations.

| Doc | Verdict | Rationale |
|---|---|---|
| `architecture.md` | n/a | No agent fleet, service boundary, route, RLS, or schema change in this spec; Chunk 7 of implementation will update agent-fleet / lifecycle pointers |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | n/a | No build-discipline / convention / pipeline change at spec-author time; Chunk 7 of implementation will update CLAUDE.md lifecycle prose |
| `docs/capabilities.md` | n/a | Spec proposes restructuring it at Chunk 4; restructuring lands then, not now |
| `docs/integration-reference.md` | n/a | No integration / OAuth / scope / skill change |
| `docs/spec-context.md` | n/a | No framing-assumption change (testing posture, primitives, rollout model unchanged); `last_reviewed_at: 2026-05-11` is < 60 days old, no staleness bump needed |
| `docs/frontend-design-principles.md` | n/a | No UI |
| `KNOWLEDGE.md` | yes (1 new pattern) | Added: "Pattern: When fixing a load-bearing count or canonical-source reference in a spec, grep the entire spec for every instance — local Edit alone leaves stale references in adjacent sections" |
| `docs/decisions/` | n/a | This spec extends the canonical pipeline (`2026-04-30-dev-pipeline-coordinators-spec.md`); the pipeline ADR is the authoritative architectural decision and is unchanged |
| `docs/context-packs/` | n/a | No anchor changes in `architecture.md` |
| `references/test-gate-policy.md` | n/a | No test-gate posture change |
| `references/spec-review-directional-signals.md` | n/a | No `spec-reviewer` directional signal repeated > 2 times |
| `docs/incident-response.md` | n/a | No incident-response change |
| `docs/testing-transition-plan.md` | n/a | No testing-transition trigger change |
| `CONTRIBUTING.md` | n/a | No lint-suppression / disable-pattern change |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | n/a | This is a repo-specific spec (not a framework-level change to the agent fleet itself) |

All verdicts substantiated; doc-sync gate clean.

### KNOWLEDGE.md pattern extraction

**1 new pattern** added to KNOWLEDGE.md — a generalisation of the §18 / §18b pattern (line 919) covering load-bearing-value cleanup more broadly. See KNOWLEDGE.md `## Pattern: Spec-edit grep sweep — load-bearing values (counts, canonical sources, escalation enums) leave stale references unless explicitly grepped`.

### Deferred items routed to `tasks/todo.md`

**None this session.** Zero auto-defers, zero user-defers across all 3 rounds. The spec's own §14 Deferred Items section captures spec-level deferrals (architectural choices to revisit) — those are already in the spec body and do not need to be re-routed via this session log.

### Notable
- ChatGPT caught the headline blocker (R1 F1: `tasks/todo.md` count contradiction) that 3 prior `spec-reviewer` (Codex) iterations missed. Two evaluators in series catch a wider class than one evaluator running 3 times.
- The duplicate-findings memory rule fired on R2 and R3, auto-applying 7 continuation findings (3 from R2 + 2 from R3 = 5 ChatGPT findings + 2 cross-round continuations) without re-escalation. Saved ~7 user prompts.
- Round 1 integrity-check found 5 issues my round-1 edits introduced — would have surfaced as R2 findings if not caught.
