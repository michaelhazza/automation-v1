# ChatGPT Spec Review Session — wave-6-rls-residue-and-gate-fix — 2026-05-17T07-52-33Z

## Session Info
- Spec: tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md
- Branch: claude/wave-6-rls-residue-and-gate-fix
- PR: #343 — https://github.com/michaelhazza/automation-v1/pull/343
- Mode: manual
- Started: 2026-05-17T07:52:33Z

---

## Round 1 — 2026-05-17T08:10:00Z

### ChatGPT Feedback (raw)
I'll review this as a spec, not an implementation diff: consistency, enforceability, sequencing, acceptance criteria, and hidden failure modes. The key surface is the gate-honesty fix plus the 1,108-callsite migration plan.

Spec review complete. I found 2 should-fix issues before locking.

F1 — Chunk 1 must update guard-baselines.json in the same landing unit (severity: medium-high)

The spec says the gate honesty fix lands first, then §5.2 captures the honest baseline, but Chunk 1 only lists the script fix + helper test. If the fixed gate starts reporting ~1,108 violations while scripts/guard-baselines.json still says 0, CI may fail before later chunks can run.

Fix: make Chunk 1 explicitly include the honest baseline ratchet:

Chunk 1: Apply gate honesty fix, extract helper/test, and update scripts/guard-baselines.json to the post-fix honest Linux count before CI runs.

F2 — Windows parity evidence is not enforceable unless the spec requires an artefact (severity: medium)

The spec repeatedly requires Linux CI and Windows local counts to match, but the only CI runner described is Linux. Without a required pasted log or committed audit artefact, the "Windows local dev" claim can become unverifiable.

Fix: add to §6.1 / §9:

gate-audit-results.md MUST include the raw Linux and Windows command outputs or a pasted transcript hash for each bug-affected gate. If Windows execution is unavailable, the gate cannot be marked parity-verified; it remains "simulated-only" and requires operator acceptance.

No blocking structural issues found. The spec is otherwise strong: sequencing, tier rules, WF1 deployment ordering, and predicate-retention risk are all well covered.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Chunk 1 must update `scripts/guard-baselines.json` in the same landing unit | technical-escalated (high severity) | apply | pending user | high | Real CI sequencing gap: if Chunk 1 lands the gate fix without ratcheting `guard-baselines.json` from 0 to ~1108, the next CI run fails before subsequent migration chunks can run. Spec §5.2 implies it but §10 Chunk 1 description doesn't enforce it. Escalated per `high severity` carveout. |
| F2 — Windows parity evidence is not enforceable without a committed artefact | technical | apply | auto (apply) | medium | Spec repeatedly claims "Linux + Windows parity" but only specifies Linux CI as the runner. Without a committed transcript/hash, the claim is unverifiable. Adding the evidence column to §6.1's `gate-audit-results.md` schema + a `simulated-only` fallback closes the enforceability gap. No product/policy implications; pure audit-artefact tightening. |

### Applied (auto-applied technical)
- [auto] §6.1 — Added two new required columns to `gate-audit-results.md`: a `Parity-verification evidence` column (raw Linux + Windows transcripts OR committed SHA-256 hashes) and a `Parity status` column with values `parity-verified` / `simulated-only` / `n/a (not file-scanning)`; appended the `simulated-only does NOT satisfy the OS-parity claim` note to the §6.1 acceptance paragraph.
- [auto] §9 acceptance #1 — Extended to require the §6.1 evidence be attached for every bug-affected gate.

### Pending user decision
- F1 (see Recommendations and Decisions table above) — escalated for severity.

---
