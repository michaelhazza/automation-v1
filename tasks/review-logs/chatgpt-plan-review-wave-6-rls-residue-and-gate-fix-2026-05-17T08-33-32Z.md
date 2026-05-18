# chatgpt-plan-review — wave-6-rls-residue-and-gate-fix

**Date:** 2026-05-17
**Plan:** tasks/builds/wave-6-rls-residue-and-gate-fix/plan.md
**Mode:** manual
**Spec (locked):** tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md (commit 82064baf)
**Branch:** claude/wave-6-rls-residue-and-gate-fix

---

## Round 1 — 2026-05-17T08:33:32Z

### ChatGPT Feedback (raw)

> Plan review complete. Strong plan overall. I found 2 should-fix issues before execution.
>
> 🟡 F1 — Chunk 1 verification violates the plan's own "CI-only gate" rule
>
> Executor notes explicitly say:
>
> > whole-repo verification scripts (scripts/verify-*.sh, scripts/run-all-*.sh) are CI-only.
>
> But Chunk 1 verification later requires:
>
> > Local Windows operator runs
> > bash scripts/verify-with-org-tx-or-scoped-db.sh
>
> That directly contradicts the execution policy.
>
> Fix options:
> - Preferred: carve out an explicit exception in Executor notes:
>   > Exception: bug-affected portability gates being actively repaired in Chunks 1-2 MAY be run locally for parity validation.
> - Or move the Windows execution requirement into an operator/manual validation note outside chunk verification.
>
> 🟡 F2 — Chunk 1 baseline ratchet wording can create an impossible CI state
>
> Chunk 1 says:
> > guard-baselines.json key with-org-tx-or-scoped-db ratchets from 1108 to the post-fix Linux honest count read from CI evidence on the fix branch
>
> But earlier in the same chunk:
> > Linux CI reports baseline count matches guard-baselines.json value; CI gate run passes.
>
> Sequencing ambiguity: CI cannot pass until baseline is updated, but the baseline integer is sourced from CI output after the fix branch runs.
>
> Fix: add one explicit sequencing sentence to Chunk 1:
> > Expected sequence:
> > (1) run the fixed gate once to discover the honest Linux count,
> > (2) ratchet guard-baselines.json to that value,
> > (3) rerun CI and confirm the gate passes.
>
> No further structural issues found. The chunk graph, WF1 deployment ordering, Tier-2 audit sweep, and blocked-callsite escalation path are all solid.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Executor-notes vs Chunk 1 verification contradiction (CI-only gate rule) | technical | apply (carve-out exception in Executor notes per ChatGPT's preferred option) | auto (apply) | should-fix | Pure plan-text consistency fix. The build genuinely DOES require local Windows execution of the gate-under-repair for parity-evidence per spec §6.1; the executor-notes blanket rule should not contradict the chunk-level requirement. A narrow time-bounded exception (Chunks 1+2 only, only for gates under repair, only for parity-evidence purposes) preserves the broader CI-only invariant while permitting the necessary local execution. |
| F2 — Chunk 1 baseline ratchet sequencing ambiguity (single-pass green CI implication) | technical | apply (add explicit discover → ratchet → re-run sequence) | auto (apply) | should-fix | Pure sequencing-clarification fix. The plan was implicitly correct (CI is the source of truth for the integer) but the wording could deadlock a literalist builder. The added sentence pins the two-CI-run workflow explicitly, references the F1 atomicity rule so both commits ship as one landing unit, and notes the happy-path no-op case where the estimated value matches. |

### Applied (auto-applied technical)
- [auto] §Executor notes — Added an exception paragraph: "Exception — bug-affected portability gates under active repair (Chunks 1 + 2 only)" carving out the narrow allowance for local execution of gates under repair, with explicit scope limits ("only the gate(s) under repair, only during the chunk that repairs them, and only for the purpose of producing the §6.1 parity-evidence transcripts"). Once Chunks 1+2 commit, the exception expires.
- [auto] §Chunks → Chunk 1 → contracts — Added "Expected CI sequence for Chunk 1 (load-bearing — single-pass green CI is not achievable here)" with the explicit 4-step discover → ratchet → re-run flow, cross-referenced to the F1 atomicity rule (both commits = one landing unit), and noting the happy-path no-op case where the estimated 1108 matches the honest count exactly.

### Pending user decision
- None — both findings auto-applied as technical/mechanical.

### Round 1 Summary
- Findings: 2 (both should-fix, both technical)
- Auto-applied: 2
- Rejected: 0
- Deferred: 0
- User-decided: 0
- Verdict: APPROVED_AFTER_FIXES (both findings resolved in-round)
