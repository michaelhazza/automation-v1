# Handoff — wave-6-rls-residue-and-gate-fix

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md
**Branch:** claude/wave-6-rls-residue-and-gate-fix
**Build slug:** wave-6-rls-residue-and-gate-fix
**UI-touching:** no
**Mockup paths:** n/a
**Spec-reviewer iterations used:** 3 / 5
**ChatGPT spec review log:** tasks/builds/wave-6-rls-residue-and-gate-fix/chatgpt-spec-review-log.md (mirror at tasks/review-logs/chatgpt-spec-review-wave-6-rls-residue-and-gate-fix-2026-05-17T07-52-33Z.md)
**Spec status:** LOCKED (commit 82064baf, 2026-05-17)
**Scope class:** Major
**Parent build:** wave-5-prevention-gates-and-rls (PR #335)

**Open questions for Phase 2:** none

**Decisions made in Phase 1:**
- Scope = gate honesty fix + 1,108-callsite RLS residue migration + P3 OS-parity harness (Wave 6 follow-ups + F3/F4/F7 + WF1/WF3/WF4/WF6 + P3)
- Option B chosen for the gate fix (normalise inside the analyser; reject Option A in §5.1)
- Dual-GUC retention confirmed (spec-reviewer iter 3)
- Chunk 1 MUST land the gate fix AND the `scripts/guard-baselines.json` ratchet to honest Linux count (~1,108) in the same landing unit (chatgpt-spec-review Round 1 F1)
- Parity-evidence artefact mandatory in `gate-audit-results.md` (raw Linux + Windows transcripts OR SHA-256 hashes) with `parity-verified` / `simulated-only` / `n/a` disposition (chatgpt-spec-review Round 1 F2)
- Tier 1 migration MUST preserve app-layer `where(eq(table.organisationId, orgId))` defence-in-depth predicate (§7.1.1, §9 acceptance #5)
- WF1 contingent RLS-policy migration ships in same chunk as code migration but runs FIRST (§7.3)
- Per-domain chunks handle Tier 1 + Tier 2 inline (no separate Tier 2 chunk except final-pass audit)
- File-overlap deconfliction: Session Q waits on Chunks 0+1 publish; Session R coordinates via chunk 0 outputs

**Operator phase-1-close note:** spec-coordinator's Step 9 (handoff) and Step 10 (current-focus → BUILDING) were not executed at lock time on 2026-05-17. Operator launched `feature-coordinator` directly with the directive "from approved spec"; the main session backfilled this handoff and flipped current-focus before entering Step 1. No spec content changed.
