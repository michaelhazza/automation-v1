# ChatGPT Spec Review Session — wave-6-rls-residue-and-gate-fix — 2026-05-17T08:01:19Z

## Session Info
- Spec: tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md
- Branch: claude/wave-6-rls-residue-and-gate-fix
- PR: #343 — https://github.com/michaelhazza/automation-v1/pull/343
- Mode: manual
- Started: 2026-05-17T08:01:19Z

---

## Round 1 — 2026-05-17T08:01:19Z

### ChatGPT Feedback (raw)
Two findings surfaced this round:

- **F1**: Chunk 1 (gate honesty fix) does not explicitly require `scripts/guard-baselines.json` to be ratcheted in the same landing unit. Without it, CI will red-line the moment the fix merges because the published baseline is `0` and the honest Linux count is ~1,108.
- **F2**: §6.1 audit table and §9 acceptance #1 do not require parity-evidence (raw Linux + Windows transcripts or committed SHA-256 hashes) per bug-affected gate. Without evidence, parity-verified status is a self-claim. Gates without Windows execution available should carry an explicit `simulated-only` disposition with operator acceptance.

Overall verdict: CHANGES_REQUESTED (both findings tractable in a single round).

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: Chunk 1 must ratchet `scripts/guard-baselines.json` in the same landing unit | technical | apply | apply (operator) | high | Mechanical sequencing fix; without it, the fix-merge moment red-lines CI. Operator decision: APPLY — technical-only, no product/policy implication. |
| F2: §6.1 + §9 acceptance #1 require parity-evidence (transcripts or SHA-256 hashes) per bug-affected gate; simulated-only disposition for Windows-unavailable cases | technical | apply | auto (apply) | high | Closes the OS-parity audit trail; without it, parity-verified status is unfalsifiable. Auto-applied per technical triage. |

### Applied (auto-applied technical + user-approved user-facing)
- [auto] §6.1: added `Parity-verification evidence` and `Parity status` columns; `simulated-only` carries operator acceptance recorded in the same row.
- [auto] §9 acceptance #1: tightened to require parity-verified (transcripts/hashes attached) OR simulated-only (operator-recorded acceptance, tracked exception).
- [user] §10 Chunk 1: added in-same-landing-unit ratchet of `scripts/guard-baselines.json` key `with-org-tx-or-scoped-db` from `0` to honest Linux count (~1,108).

### Integrity check
2 issues considered (cross-reference of §5.1 helper path to §10 Chunk 1, baseline-key alignment §5.2 ↔ §10 Chunk 1). Both resolved within the F1/F2 edits. No further findings.

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

---
