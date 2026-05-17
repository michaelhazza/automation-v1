# Spec Review Log — wave-5-prevention-gates-and-rls — Iteration 3

- **Timestamp**: 2026-05-16T10:41:13Z
- **Spec commit (pre-iteration)**: eeac661208cb8c7d964dc4b455700be0fbfd7caf
- **Codex output**: `tasks/review-logs/_codex_wave-5-prevention-gates-and-rls_iter3_2026-05-16T10-41-13Z.txt`

## Findings (all from Codex)

FINDING #1
  Source: Codex (critical)
  Section: §8 / §4 / §10 — `withAdminConnection` doesn't acquire BYPASSRLS by itself
  Description: helper acquires the connection; caller must explicitly `SET LOCAL ROLE admin_role` inside the callback.
  Classification: mechanical (load-bearing claim contradicted by primitive's actual contract — same class as iter2 #1)
  Disposition: auto-apply
  [ACCEPT] §4 + §8 Tier 2 row — corrected: helper does NOT acquire BYPASSRLS; the canonical Tier 2 migration pattern is `withAdminConnection({ source, reason }, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`.

FINDING #2
  Source: Codex (important)
  Section: §11 risk row 2 — still claims withAdminConnection logs to audit_events
  Classification: mechanical (stale-language residue I missed cleaning up in iter2)
  Disposition: auto-apply
  [ACCEPT] §11 risk row 2 — replaced with the stderr console.warn admin-bypass log explanation, cited the FK/recursive-tx rationale for skipping audit_events, references the three-form guard-ignore enumeration in §4.

FINDING #3
  Source: Codex (important)
  Section: §5.4 / §9 — PP-SK2 currently exits 2, not 0 (two grandfathered baseline entries)
  Description: `scripts/.gate-baselines/universal-skill-sync.txt` carries two entries (read_codebase / search_codebase one-sided pairs). check_expiring_baseline returns exit 2.
  Classification: mechanical (stale state claim)
  Disposition: auto-apply
  [ACCEPT] §5.4 — current-state paragraph now records the two grandfathered entries; delta says resolve both pairs (operator picks direction at chunk 0) and remove the baseline lines; acceptance reframed to "baseline file contains zero grandfathered entries; gate exits 0".

FINDING #4
  Source: Codex (important)
  Section: §5.6 / §9.10 — PP-MC2 has no baseline file (schema gate)
  Classification: mechanical (load-bearing claim that doesn't apply to schema gates)
  Disposition: auto-apply
  [ACCEPT] §5.6 — added "This is a schema gate … no .gate-baselines/ file"; §9.10 PR-gate-summary template allows `n/a — schema gate, no baseline` for PP-MC2.

FINDING #5
  Source: Codex (important)
  Section: §5.3 PP-SK1 — `docs/methodologies/` doesn't exist
  Description: fabricated directory; methodology skills live in `server/skills/` distinguished by registry entry, not by directory.
  Classification: mechanical (file inventory drift — fabricated path)
  Disposition: auto-apply
  [ACCEPT] §5.3 — removed `docs/methodologies/` scan requirement; gate scans only `server/skills/`; explicit ignore list for non-skill files (`README.md`, `__tests__/**/*.md`) captured in gate header.

FINDING #6
  Source: Codex (important)
  Section: §10 Chunk 0 — chunk 0 description regressed to per-file verdict
  Classification: mechanical (internal contradiction with §8 per-callsite rule)
  Disposition: auto-apply
  [ACCEPT] §10 — rewrote chunk 0 artifact description: every raw-`db` callsite recorded as `file:line` with callsite text, tenant key, tier verdict, and upstream entrypoint or bypass rationale; file-level rollups demoted to summary metadata.

## Iteration 3 Summary

- Mechanical findings accepted:  6 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set after commit)
