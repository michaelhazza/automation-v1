# Spec Review Log — wave-5-prevention-gates-and-rls — Iteration 1

- **Timestamp**: 2026-05-16T10:25:31Z
- **Spec commit (pre-iteration)**: 86730eea38c1f2ca628f16175093b079a8616ec5
- **Codex output**: `tasks/review-logs/_codex_wave-5-prevention-gates-and-rls_iter1_2026-05-16T10-25-31Z.txt`

## Findings (Codex + rubric)

### Codex findings

FINDING #1
  Source: Codex (critical)
  Section: §4 / §6.1 — getOrgScopedDb() contract is wrong
  Description: Spec invents `await getOrgScopedDb(orgId, source)` opening a tx; real primitive is `getOrgScopedDb(source: string)` returning the in-flight ALS tx.
  Classification: mechanical
  Disposition: auto-apply
  [ACCEPT] §4 + §6.1 — rewrote contract around real primitive; named withOrgTx as upstream tx opener; corrected signature.

FINDING #2
  Source: Codex (important)
  Section: §3 vs §11 — non-goal says no changes to primitive, risk says extend it
  Classification: mechanical (contradiction)
  Disposition: auto-apply
  [ACCEPT] §3 + §11 — primitive changes are out of scope; risk row says spec is paused on gap and escalated, not extended.

FINDING #3
  Source: Codex (critical)
  Section: §6.1 — removing app-layer where(eq(orgId)) is load-bearing but not contracted
  Classification: ambiguous → directional (changes acceptance contract / tenant-isolation safety)
  Disposition: AUTO-DECIDED (accept)
  Reasoning: Conservative tenant-isolation default; this spec is the very build closing a defence-in-depth gap, removing the app-layer predicate now would undercut the goal. Operator can carve out predicate removal in a separate narrower spec later.
  → routed to tasks/todo.md for deferred review

FINDING #4
  Source: Codex (important)
  Section: §1 / §2 / §6.2 / §8 — "231 callsites" vs "231 files" conflated
  Classification: mechanical
  Disposition: auto-apply
  [ACCEPT] §1, §2, §4, §6.2, §8, §9 — added headline note; reframed counts as files (per-callsite count produced by chunk 0); §9 PR summary now has separate per-callsite counts.

FINDING #5
  Source: Codex (minor)
  Section: §8 / §10 — "Each service file gets one chunk" contradicts 18-22 chunk estimate
  Classification: mechanical (contradiction)
  Disposition: auto-apply
  [ACCEPT] §8 — verdict is per-service-file, chunks are grouped by domain.

FINDING #6
  Source: Codex (important)
  Section: §5 / §7 — existing gate/config inventory stale
  Classification: mechanical (file inventory drift)
  Disposition: auto-apply
  [ACCEPT] §5 — full rewrite with per-gate current state; §7 — reframed as extension of existing knip.json.

FINDING #7
  Source: Codex (important)
  Section: §5.2 — PP-DUP1 wrong script name, wrong jscpd params, wrong scope
  Classification: mechanical (file inventory drift)
  Disposition: auto-apply
  [ACCEPT] §5.2 — corrected script name (`verify-duplicate-blocks.sh`), corrected jscpd flags (`--min-tokens 15`), corrected scope (`server/ client/ shared/ worker/`), captured the 2026-05-15 promotion-revert history and the re-seed delta.

FINDING #8
  Source: Codex (important)
  Section: §5.5 — PP-FE2 overlaps existing gate with parallel suppression scheme
  Classification: mechanical (file inventory drift)
  Disposition: auto-apply
  [ACCEPT] §5.5 — reframed to reuse `verify-frontend-design-budget.sh` + `docs/frontend-design-allowlist.json`; no parallel `// frontend-design: admin-only-acceptance` annotation primitive.

FINDING #9
  Source: Codex (minor)
  Section: §5.4 — PP-SK2 already bidirectional
  Classification: mechanical
  Disposition: auto-apply
  [ACCEPT] §5.4 — reframed as "confirm gate is in run-all-gates and passing"; no script change required.

FINDING #10
  Source: Codex (minor)
  Section: §5.3 — PP-SK1 dead allowlist clause for docs/methodologies/
  Classification: mechanical (internal contradiction)
  Disposition: auto-apply
  [ACCEPT] §5.3 — scan both `server/skills/` AND `docs/methodologies/`; methodology files participate in scan but don't require registry entry.

FINDING #11
  Source: Codex (critical)
  Section: §8 / §9.4 — Tier 2 raw db bypass conflicts with withAdminConnection contract
  Classification: mechanical (load-bearing claim without contract; existing primitive contract documented in orgScopedDb.ts header)
  Disposition: auto-apply
  [ACCEPT] §8 — Tier 2 migrates to `withAdminConnection(...)`; residue uses existing guard-ignore form. §4, §11 risk row 2 updated to match.

FINDING #12
  Source: Codex (important)
  Section: §9.4 — sibling-call P2 guard is too weak
  Classification: ambiguous → mechanical (existing analyser already does per-callsite AST; this is alignment to existing behaviour, not a new guard)
  Disposition: auto-apply
  [ACCEPT] §9.4 — reframed: existing analyser does per-callsite AST; build relies on it without modification; analyser-coverage gaps are escalated, not silently changed.

FINDING #13
  Source: Codex (important)
  Section: §4 / §8 / §9.3 — `guard-ignore: rls-intentional-bypass` invents new suppression primitive
  Classification: mechanical
  Disposition: auto-apply
  [ACCEPT] §4, §8, §9.3, §11 risk row 2 — replaced with existing `guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>` form throughout.

FINDING #14
  Source: Codex (important)
  Section: §9.8 / §11 — testing language conflicts with static_gates_primary
  Classification: mechanical (stale-retired-language per framing)
  Disposition: auto-apply
  [ACCEPT] §9.8 — concrete acceptance list (build, lint, static gates, tier verdict, spec-conformance); existing runtime tests run for services that have them. §11 risk row 1 aligned.

FINDING #15
  Source: Codex (important)
  Section: §9 / §10 — missing per-item verdict artifact for gates and knip
  Classification: ambiguous → directional (adds a new artifact contract)
  Disposition: AUTO-DECIDED (accept)
  Reasoning: Symmetry with the existing per-service-tier PR summary; minimal addition, no testing/rollout posture shift, no new primitive. Cheap to require, prevents "seeded and passing" handwave at merge time.
  → routed to tasks/todo.md for deferred review

FINDING #16
  Source: Codex (minor)
  Section: §13 — "Git merge handles this naturally" contradicts the hard-stop rule
  Classification: mechanical (contradiction)
  Disposition: auto-apply
  [ACCEPT] §13 — removed "naturally" claim; chunk 0 produces explicit per-file merge order; per-file ordering is the contract, not git auto-merge.

### Rubric findings (my pass, additive)

FINDING #R1
  Source: Rubric (file-inventory-drift / stale state)
  Section: §5.1 PP-CD1 — spec says "promote to error mode and seed baseline" but already done 2026-05-14 + 2026-05-15
  Classification: mechanical
  Disposition: auto-apply (covered by Codex #6 + per-gate rewrite in §5)

FINDING #R2
  Source: Rubric (file-inventory-drift)
  Section: §7 — spec says "Author knip.json" but knip.json already exists at repo root
  Classification: mechanical
  Disposition: auto-apply (covered by Codex #6; §7 rewritten as extension)

FINDING #R3
  Source: Rubric (load-bearing claim without contract)
  Section: §11 risk row 1 — "manual verification of existing test coverage" inconsistent with §9.8 rewrite
  Classification: mechanical
  Disposition: auto-apply — updated §11 row 1 wording to match §9.8 posture.

## Iteration 1 Summary

- Mechanical findings accepted:  14 (12 Codex + 2 rubric distinct from Codex; one rubric finding was subsumed into the §11 row 1 follow-up edit)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            2 (Codex #3 and Codex #15) — both auto-decided ACCEPT
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 2
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             2 (see tasks/todo.md)
- Spec commit after iteration:   (set after commit)
