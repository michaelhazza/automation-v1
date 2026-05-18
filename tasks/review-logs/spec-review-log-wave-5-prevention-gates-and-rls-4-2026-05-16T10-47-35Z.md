# Spec Review Log — wave-5-prevention-gates-and-rls — Iteration 4

- **Timestamp**: 2026-05-16T10:47:35Z
- **Spec commit (pre-iteration)**: a679589cf17f4082e990462bced956ac7f639a8f
- **Codex output**: `tasks/review-logs/_codex_wave-5-prevention-gates-and-rls_iter4_2026-05-16T10-47-35Z.txt`

## Findings (all Codex; rubric pass surfaced no additional items)

FINDING #1
  Source: Codex (important)
  Section: §4 / §6.1 — "HTTP `orgScoping` middleware" doesn't exist
  Description: HTTP wrapper is `authenticate` in `server/middleware/auth.ts`, which opens `withOrgTx` and issues `set_config('app.organisation_id', ...)`. `server/lib/orgScoping.ts` is GUC helper functions, not the middleware.
  Classification: mechanical (file inventory drift — fabricated path)
  Disposition: auto-apply
  [ACCEPT] §4 + §6.1 — replaced all "HTTP `orgScoping` middleware" mentions with `authenticate` middleware (`server/middleware/auth.ts`).

FINDING #2
  Source: Codex (important)
  Section: §6.1 / §10 — RLS_PROTECTED_TABLES doesn't carry tenant-key metadata
  Description: manifest schema is {tableName, schemaFile, policyMigration, rationale}; no tenant-key field.
  Classification: mechanical (load-bearing claim contradicted by primitive shape)
  Disposition: auto-apply
  [ACCEPT] §6.1 — chunk 0 derives tenant key from schema file + policyMigration SQL; manifest is the protected-table list, not the tenant-key registry.

FINDING #3
  Source: Codex (important)
  Section: §5.4 / §10 — PP-SK2 delta self-contradicts
  Description: §5.4 (iter3) requires resolving 2 grandfathered entries + baseline cleanup; §10 still says PP-SK2 "requires zero script change and reduces to a wiring check".
  Classification: mechanical (internal contradiction introduced by iter3 fix)
  Disposition: auto-apply
  [ACCEPT] §10 — updated PP-SK2 line to reflect "no script change but DOES require source alignment + baseline cleanup".

FINDING #4
  Source: Codex (important)
  Section: §3 / §11 — unsupported-pattern handling contradicts itself
  Description: §3 says "spec is paused, gap raised"; §11 risk row 3 said "fallback within this build is to document the gap, classify as Tier 2 residue, and continue".
  Classification: mechanical (stale residue from iter1 — I never re-aligned §11 row 3 with §3)
  Disposition: auto-apply
  [ACCEPT] §11 row 3 — distinguished tenant-traffic Tier 1 callsites (escalate) from genuinely sanctioned cross-tenant callsites (Tier 2 residue with rationale). The "downgrade to Tier 2" silent path is removed.

FINDING #5
  Source: Codex (minor)
  Section: §1 / §9.9 — Scope says "closes all 6 gates incl PP-MC2"; §9.9 says PP-MC2 is verify-only
  Classification: mechanical (internal contradiction)
  Disposition: auto-apply
  [ACCEPT] §1 — reframed as "5 still-open + 1 already-closed verify-only"; "Total: ~9 closeable items + PP-MC2 verify-only".

FINDING #6
  Source: Codex (minor)
  Section: §2.1 / §9.1 — "all 6 baselined" vs §5.6 "PP-MC2 is schema gate with no baseline"
  Classification: mechanical (internal contradiction)
  Disposition: auto-apply
  [ACCEPT] §2 goal 1 and §9.1 — "baselined where applicable (PP-MC2 has `n/a` baseline)".

FINDING #7
  Source: Codex (nit)
  Section: §7 — starter knip.json inventory wrongly says `.claude-hooks` instead of `.claude/hooks/**/*.js`
  Classification: mechanical (file inventory drift — typo)
  Disposition: auto-apply
  [ACCEPT] §7 — replaced `.claude-hooks` with `.claude/hooks/**/*.js` and listed the project-glob roots explicitly.

## Iteration 4 Summary

- Mechanical findings accepted:  7 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set after commit)
