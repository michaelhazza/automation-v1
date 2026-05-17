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

## Round 2 — 2026-05-17T08:30:00Z

### ChatGPT Feedback (raw)
> "No further must-fix issues found. Both prior findings are addressed: Chunk 1 now explicitly ratchets `scripts/guard-baselines.json` in the same landing unit. `gate-audit-results.md` now requires Linux + Windows transcript evidence or a tracked simulated-only exception with operator acceptance. Spec is lockable from my side."

Overall verdict: **APPROVED**. Zero must-fix findings.

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| (none) | n/a | n/a | n/a | n/a | Round 2 returned zero findings; ChatGPT explicitly stated the spec is lockable. |

### Applied
- No spec edits this round.

### Integrity check
Skipped — no edits applied this round, no surface to re-check.

### Operator decision
LOCK THE SPEC. Frontmatter flipped `status: DRAFT → LOCKED` per the wave-5 precedent (no `locked_date` field — not used by any existing locked spec in this repo).

---

## Final Summary

- Rounds: 2
- Auto-accepted (technical): 1 applied | 0 rejected | 0 deferred
- User-decided:              1 applied | 0 rejected | 0 deferred
- Index write failures: 0
- Deferred to `tasks/todo.md § Spec Review deferred items`: none (zero deferred verdicts this session)
- Verdict: **APPROVED** (2 rounds)
- Spec status: **LOCKED** as of 2026-05-17

### Implementation-readiness checklist
- Inputs defined: yes (§4 framing assumptions; §5 itemised; §8 tier-categorisation rules)
- Outputs defined: yes (§9 acceptance criteria — gate honesty, parity evidence, baseline ratchet, P3 harness)
- Failure modes covered: yes (§6.1 parity-evidence; §10 Chunk 1 in-same-landing-unit ratchet; simulated-only operator-acceptance disposition)
- Ordering guarantees explicit: yes (Chunk 0 audit → Chunk 1 gate fix + baseline ratchet → migration chunks → P3 harness)
- No unresolved forward references: yes (Round 1 integrity check confirmed §5.1 ↔ §10 alignment; Round 2 verified)
- **Spec is implementation-ready.**

### Doc sync sweep
- KNOWLEDGE.md updated: yes (1 entry — gate-baseline ratchet sequencing pattern)
- architecture.md updated: no — checked `getOrgScopedDb`, `withOrgTx`, `withAdminConnection`, `guard-baselines.json`, `run-all-gates`, `verify-with-org-tx-or-scoped-db`; all references already current. Wave 6 reuses Wave 5 primitives verbatim (§ Non-Goals confirms zero new primitives).
- capabilities.md updated: `n/a: internal refactor with no capability surface change` — RLS residue migration + Windows-path gate-fix are internal hardening; no customer-visible capability mutation.
- integration-reference.md updated: n/a — no integration / scope / OAuth / MCP / capability slug change.
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — checked test-gate posture, RLS rules, gate protocol; current language already covers the wave-6 surface. KNOWLEDGE entry is the right home for the new sequencing rule per §13 doc-style split.
- spec-context.md updated: no — checked framing terms (`pre-prod`, `service-tier`, `org-scoped`, `guard-ignore`, `tier-categorisation`); wave-6 reaffirms wave-5 framing without changing it.
- frontend-design-principles.md updated: n/a — no UI surface in this spec.
- CONTRIBUTING.md updated: n/a — no lint-suppression / disable-pattern change.
- references/test-gate-policy.md updated: no — wave-6 reuses existing gate posture; new P3 harness asserts gate correctness but doesn't change forbidden/allowed locally-runnable lists.

### PR
- PR #343 — https://github.com/michaelhazza/automation-v1/pull/343
- Final commit (this session): see lock-transition commit on `claude/wave-6-rls-residue-and-gate-fix`.
