# Spec review log — wave-6-rls-residue-and-gate-fix iteration 3

- Timestamp: 2026-05-17T07-43-51Z
- Spec commit at start: `4b3963a5`
- Codex output: `tasks/review-logs/_codex_wave-6-rls-residue-and-gate-fix_iter3_2026-05-17T07-43-51Z.txt`

## Findings (4 from Codex; 0 from rubric pass)

All mechanical. Zero directional. Zero reclassified. Diminishing returns — Codex's volume dropped from 10 (iter2) to 4 (iter3).

- **F1** Gate scope contradictory: §6.1 says "only bug-affected gets Option B"; §9 #2 expanded to "every file-scanning gate Option B + seeded fixture". Clarify: file-scanning gates that ARE NOT bug-affected don't need Option B refactor, but DO need seeded-fixture harness coverage. **ACCEPT.**
- **F2** Tier 2 annotation semantics: §9 #4 "all Tier 2 annotated" conflicts with §8 (migrated-to-withAdminConnection Tier 2 callsites are no longer `db.*` and don't need annotation). Fix the wording — only Tier 2 callsites that retain `db` need annotation. **ACCEPT.**
- **F3** FK-only tenant-table source not named — point at `scripts/.gate-baselines/fk-only-tenant-tables.txt` (the baseline produced by `verify-fk-only-tenant-tables.sh`). **ACCEPT.**
- **F4** Dual-GUC tenant tables need migration rule — `setOrgAndSubaccountGUC` exists in `server/lib/orgScoping.ts`. Tier 1 callsites against dual-GUC tables whose entrypoint sets only `app.organisation_id` are Tier 1-blocked. **ACCEPT.**

## Counts

- mechanical_accepted: 4
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0
