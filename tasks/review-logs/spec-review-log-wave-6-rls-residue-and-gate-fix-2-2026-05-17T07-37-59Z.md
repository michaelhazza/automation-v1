# Spec review log — wave-6-rls-residue-and-gate-fix iteration 2

- Timestamp: 2026-05-17T07-37-59Z
- Spec commit at start: `4afaa7d8`
- Codex output: `tasks/review-logs/_codex_wave-6-rls-residue-and-gate-fix_iter2_2026-05-17T07-37-59Z.txt`

## Findings (10 from Codex; 0 from rubric pass)

All mechanical. Zero directional / ambiguous. Zero reclassified.

- **F1** §7.1.1 mandates `import from 'server/lib/orgScopedDb'` but `server/tsconfig.json` has no `paths` mapping — must use relative imports + bundler module resolution. **ACCEPT.**
- **F2** §9 #4 vs §8: baseline math says `Tier2 + Tier1-blocked` but Tier 0 / Tier 3 callsites would still count unless annotated. Make Tier 0 + Tier 3 annotations mandatory so the analyser drops their counts. **ACCEPT.**
- **F3** §5.1 helper should be `.mjs` (matching `scripts/lib/with-org-tx-analyser.mjs` precedent), not `.ts`. **ACCEPT.**
- **F4** §6.2 seeded fixtures need a common override contract (e.g. `GATE_ROOT` env var or analyser-level injection). **ACCEPT.**
- **F5** §6.2 Windows-path simulation needs a per-gate pure-helper path-form fixture (`/c/Files/...`, `C:\Files\...`, `/usr/...`), not just for `with-org-tx`. **ACCEPT.**
- **F6** §6.2 accepted exit set must include `3` (legacy informational exit per `run-all-gates.sh:33`). **ACCEPT.**
- **F7** §9 #2 `OR` weakens §6.2 — change to `AND` for file-scanning gates. **ACCEPT.**
- **F8** §8 "tenant key per rlsProtectedTables.ts" — the manifest lacks tenant-key metadata. Soften to "tenant-key column per the table's policy migration or schema definition; `rlsProtectedTables.ts` is the table-membership manifest." **ACCEPT.**
- **F9** §7.3 WF1 "runs FIRST" — pin the deployment mechanism (migration filename ordering precedes code; deployment runs migrations before server boot). **ACCEPT.**
- **F10** §5.1/§6.1 5-line tolerance — tighten: tolerated path differences MUST be enumerated in `gate-audit-results.md` with classification. **ACCEPT.**

## Counts

- mechanical_accepted: 10
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0
