# System Agents v7.1 Migration — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md`
**Build slug:** `system-agents-v7-1-migration`
**Branch:** `claude/audit-system-agents-46kTN`
**Class:** Major (new schema + new tables + new agents + runtime contracts spanning seed + middleware + executor + verification gates)
**Total chunks:** 9 (7 implementation chunks for spec Phases 1–8 — Phases 5+6 are merged per spec §5 — + 1 local-dev validation chunk + 1 pre-merge chunk)

---

## Table of contents

1. Phase-ordering invariant
2. Plan conventions
3. Phase 0 — Baseline
4. Chunk 01 — Phase 1: Schema migration
5. Chunk 02 — Phase 2: Skill files + classification + visibility
6. Chunk 03 — Phase 3: Action registry extensions
7. Chunk 04 — Phase 4: Skill executor — handlers, manager guard, side-effect wrapper
8. Chunk 05 — Phases 5+6: Agent file changes + retire `client-reporting-agent`
9. Chunk 06 — Phase 7: Env vars + manifest regeneration
10. Chunk 07 — Phase 8: Seed-script orphan cleanup + verification gates + post-seed hierarchy assertion
11. Chunk 08 — Phase 9: Local-dev validation (no committed files)
12. Chunk 09 — Pre-merge verification
13. Review pipeline

---

## §1 Phase-ordering invariant

> Per spec §5: **"The phase order below is load-bearing. Reordering causes silent failures."** Reordering causes Path A reset to fail on second attempt because the partial-unique index isn't yet in place; the seed pre-flight aborts because skills declared in `AGENTS.md` have no handler.

| Spec phase | Chunk ID |
|---|---|
| Phase 1 — Schema migration (§6) | `chunk-01-schema-migration` |
| Phase 2 — Skill files + classification + visibility (§7) | `chunk-02-skill-files-classification` |
| Phase 3 — Action registry extensions (§8) | `chunk-03-action-registry` |
| Phase 4 — Skill executor: handlers, manager guard, side-effect wrapper (§9) | `chunk-04-skill-executor` |
| Phases 5+6 — Agent file changes + retire `client-reporting-agent` (§10 + §11) | `chunk-05-agent-files` |
| Phase 7 — Env vars + manifest regeneration (§12) | `chunk-06-env-and-manifest` |
| Phase 8 — Seed-script orphan cleanup + verification gates + assertions (§13) | `chunk-07-seed-and-gates` |
| Phase 9 — Local-dev reset + rollback (§14) | `chunk-08-local-dev-validation` |
| Programme-end pre-merge | `chunk-09-pre-merge-verification` |

**Phases 5 + 6 are merged into a single chunk** per spec §5 (same file-system operation class, identical pre-flight prerequisites). **Phase 9 has no committed files** — it is a local-dev validation step the implementer runs once after Phases 1–8 land. The pre-merge chunk (`chunk-09`) is where `npm test` / `npm run test:gates` execute, per the CLAUDE.md gate-cadence rule and the architect Gate-Timing Rule (gate scripts run twice total: Phase 0 baseline + chunk-09).

**Cross-chunk merge policy.** Per spec §5, **Phases 1–8 land in a single PR — do not split.** Splitting creates the merge-ordering hazards called out in §1 (the five invariants are coupled — schema is a hard prerequisite for the local-dev reset; action-registry extensions are consumed by both the manager guard and the side-effect wrapper; new agents reference new skills which reference new handlers which reference new registry fields). Phase 9 is the local-dev exercise after merge; it touches no committed files.

---

## §2 Plan conventions

- **Reference, don't reproduce.** Every chunk references spec `§`-anchors. Read the spec for content; the plan is the execution scaffold. If spec drifts, anchors stay valid.
- **Per-chunk verification commands are bounded** to `npm run build:server` (fast typecheck) + targeted unit tests added in that chunk. Nothing else. No `scripts/verify-*.sh` mid-build.
- **Review pipeline.** After each non-trivial chunk: `pr-reviewer`. Before the pre-merge chunk runs the gate suite, the spec-driven-task review order from CLAUDE.md applies: `spec-conformance` first → if `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded set → then the gate suite. `dual-reviewer` is local-only and only when the user explicitly asks.
- **Gate-cadence rule (CLAUDE.md + architect contract).** `npm run test:gates` runs **twice total** per this plan: once at Phase 0 baseline, once during the pre-merge chunk after spec-conformance. Mid-build gate runs are forbidden.

**Executor notes:** Gate scripts run TWICE TOTAL per this plan: once during Phase 0 baseline (and any pre-existing-violation fixes) and once during Programme-end verification after all chunks AND spec-conformance. Running them between chunks, after individual fixes, or as 'regression sanity checks' is forbidden — it adds wall-clock cost without adding signal.

---

## §3 Phase 0 — Baseline

Before Chunk 01 begins, run the full gate set ONCE to capture the pre-existing violation set. Record the output in `tasks/builds/system-agents-v7-1-migration/progress.md` under a `## Phase 0 baseline` heading.

Gates to run (per spec §6.5 + §7.7 + §8.4 + §13.6 + §20):

- `npm run typecheck`
- `npm run lint`
- `bash scripts/verify-rls-coverage.sh`
- `bash scripts/verify-rls-protected-tables.sh`
- `bash scripts/verify-rls-session-var-canon.sh`
- `bash scripts/verify-migration-sequencing.sh`
- `bash scripts/verify-action-registry-zod.sh`
- `bash scripts/verify-idempotency-strategy-declared.sh`
- `bash scripts/verify-skill-read-paths.sh`
- `bash scripts/verify-skill-visibility.ts` (existing — pre-extension)
- `bash scripts/verify-no-direct-adapter-calls.sh`
- `bash scripts/verify-principal-context-propagation.sh`

**Pre-existing violation policy.** Any violation that the planned chunks would extend or interact with becomes the first chunk of the build (a Chunk 0a). Pre-existing violations that do NOT block the planned work go into `## Known baseline violations` in `progress.md` and are explicitly OUT OF SCOPE for this build.

---

## §4 Chunk 01 — Phase 1: Schema migration

**ID:** `chunk-01-schema-migration`

**Goal:** Replace full-unique indexes on `system_agents.slug` and `agents.(organisation_id, slug)` with partial uniques `WHERE deleted_at IS NULL`, and create the new `skill_idempotency_keys` table with canonical RLS policy.

**Spec anchors:** §6.1, §6.2, §6.3, §6.4, §6.5, §16.4, §16.5.

**Files touched:**

- NEW
  - `migrations/0233_system_agents_v7_1.sql`
  - `migrations/_down/0233_system_agents_v7_1.sql` (no-op stub)
  - `server/db/schema/skillIdempotencyKeys.ts`
- MODIFIED
  - `server/db/schema/systemAgents.ts` (replace full unique with partial unique on `slug`)
  - `server/db/schema/agents.ts` (rename index to `agents_org_slug_active_uniq` to match migration)
  - `server/db/schema/index.ts` (re-export new schema module)
  - `server/config/rlsProtectedTables.ts` (append `skill_idempotency_keys` entry pointing at migration `0233`)

**Sequence within the chunk:**

1. Write `migrations/0233_system_agents_v7_1.sql` per spec §6.1 — single-transaction `BEGIN;…COMMIT;` containing: (1a) drop+recreate `system_agents.slug` partial-unique, (1b) drop+recreate `agents.(organisation_id, slug)` partial-unique, (2) create `skill_idempotency_keys` table + indexes + `ENABLE`/`FORCE ROW LEVEL SECURITY` + canonical RLS policy. Confirm migration number is the next free integer at write-time; if `main` has advanced past `0232`, renumber per spec §1 / §6.1 / `DEVELOPMENT_GUIDELINES.md` §6.2.
2. Write the matching Drizzle schema additions per spec §6.2: new `server/db/schema/skillIdempotencyKeys.ts` (composite PK + indexes + status `$type<'in_flight'|'completed'|'failed'>()`); update `server/db/schema/systemAgents.ts` to use `uniqueIndex(...).where(sql\`${table.deletedAt} IS NULL\`)`; update `server/db/schema/agents.ts` index name to `agents_org_slug_active_uniq`; re-export from `server/db/schema/index.ts`.
3. Append the RLS-manifest entry per spec §6.3 to `server/config/rlsProtectedTables.ts` with `policyMigration: '0233_system_agents_v7_1.sql'` and the rationale string verbatim.
4. Write `migrations/_down/0233_system_agents_v7_1.sql` as a no-op stub with the explanatory header per spec §6.4 — the comment must call out that operational rollback is via §14 Path A re-seed and that the partial indexes are forward-compatible with v6 row state.
5. Run the chunk's verification commands (below) to confirm the schema compiles.

**Verification commands** (spec §6.5 — the *psql* probes are run against the dev DB AFTER `npm run db:migrate`; the static commands run as part of the per-chunk loop):

- Per-chunk loop (no gate scripts):
  - `npm run build:server` (fast typecheck — Drizzle schema parses)
- Run-once-against-the-dev-DB (manual, gate-cadence-compliant — this is a chunk-level dev-DB probe, NOT the Phase 0 / pre-merge gate suite):
  - `npm run db:migrate` (apply 0233 to dev DB)
  - `psql $DATABASE_URL -c "\d+ system_agents"` — expect `system_agents_slug_active_idx` partial unique with `WHERE (deleted_at IS NULL)`.
  - `psql $DATABASE_URL -c "\d+ agents"` — expect `agents_org_slug_active_uniq` partial unique.
  - `psql $DATABASE_URL -c "\d+ skill_idempotency_keys"` — expect `Row security: ENABLED, FORCED`.
  - `psql $DATABASE_URL -c "\d skill_idempotency_keys"` — expect policy `skill_idempotency_keys_org_isolation` with both `USING` and `WITH CHECK` clauses present.

**Risks / blockers:**

- **MVCC reasoning for `DROP INDEX … CREATE UNIQUE INDEX` inside a single transaction** (spec §6.1 trailing rationale). Postgres MVCC means concurrent readers see a snapshot consistent with the pre-COMMIT state — they never observe a moment where the old index is dropped but the new one is missing. The drop+create take an `ACCESS EXCLUSIVE` lock for the migration's duration; pre-prod single-DB with no concurrent writers makes this lock window operationally invisible. `CREATE INDEX CONCURRENTLY` is rejected because it cannot run inside a transaction block (Postgres documented limitation), which would force splitting the migration across transaction boundaries and lose atomicity.
- **Migration-renumber rule** (spec §1 + §6.1 + `DEVELOPMENT_GUIDELINES.md` §6.2). Spec was authored at `0233` against `main` SHA `a87f45ef`. If `main` advances and absorbs another migration before this branch merges, renumber to the next free integer at write time AND retag the down-stub filename AND update §6.3 rlsProtectedTables `policyMigration` reference AND any spec back-references. The spec is internally consistent if the renumber is mechanical.
- **RLS canonical-pattern compliance** (spec §6.1 post-pre-launch-hardening section). The policy MUST use the canonical post-0227 shape: name `<table>_org_isolation`, `DROP POLICY IF EXISTS` first (idempotent), three-clause null-safe `USING` predicate, `WITH CHECK` clause mandatory (without it, INSERT bypass succeeds silently). `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` + `verify-rls-session-var-canon.sh` enforce these at Phase 0 / pre-merge.
- **`status` is a CHECK column, not a PG enum type** (spec §6.1) — lower migration risk, no `CREATE TYPE` required. Drizzle column declares `$type<'in_flight'|'completed'|'failed'>()` to give TypeScript the same closure.
- **Denormalised `organisation_id` on the new table** (spec §6.1 "Why include `organisation_id`"). Handlers MUST populate both `subaccount_id` AND `organisation_id` — the wrapper does this from `SkillExecutionContext` in chunk-04. The `WITH CHECK` clause validates the org column on every INSERT/UPDATE.

**Cross-chunk dependencies:** None — first chunk in the build.

**Acceptance reference:** Spec AC #21 (active-row uniqueness), AC #22 (RLS coverage), AC #24 (migration sequencing), AC #25 (state-machine closure CHECK constraint).

---

## §5 Chunk 02 — Phase 2: Skill files + classification + visibility

**ID:** `chunk-02-skill-files-classification`

**Goal:** Create the 14 new skill `.md` files, add `list_my_subordinates` to `APP_FOUNDATIONAL_SKILLS`, apply visibility, write the Hunter + Google Places provider stubs (fail-soft on missing env), extend the visibility verifier with the foundational-self-containment assertion, and delete the retired `update_financial_record.md` file.

**Spec anchors:** §7.1, §7.2, §7.3, §7.4, §7.5 (incl. §7.5.1 / §7.5.2 / §7.5.3), §7.6, §7.7, §4.4, §4.5, §4.11.

**Files touched:**

- NEW (16): the 14 skill `.md` files listed in spec §7.1 (slug list anchored there — do not reproduce here) + the 2 provider files from spec §4.11:
  - 14 new files under `server/skills/<slug>.md` (slugs in spec §7.1 table)
  - `server/services/leadDiscovery/googlePlacesProvider.ts`
  - `server/services/leadDiscovery/hunterProvider.ts`
- MODIFIED (2):
  - `scripts/lib/skillClassification.ts` (add `list_my_subordinates` to `APP_FOUNDATIONAL_SKILLS`, per spec §7.2 / §4.5)
  - `scripts/verify-skill-visibility.ts` (extend with foundational-self-containment assertion, per spec §7.4 / §4.15)
- DELETED (1):
  - `server/skills/update_financial_record.md` (per spec §7.6 / §4.4)

**Sequence within the chunk:**

1. **Create 14 skill files** under `server/skills/` per spec §7.1. Copy-paste-then-edit from a peer like `server/skills/draft_post.md`. Frontmatter: `name`, `description`, `isActive: true`, `visibility:` (set per the §7.1 column — `list_my_subordinates` = `none`; the other 13 = `basic`). Body: `## Parameters` + `## Instructions`.
2. **Add `list_my_subordinates` to `APP_FOUNDATIONAL_SKILLS`** in `scripts/lib/skillClassification.ts` per spec §7.2. The other 13 skills default to BUSINESS-VISIBLE — no classification entry needed.
3. **Run `npx tsx scripts/apply-skill-visibility.ts`** per spec §7.3. This bulk-applies the `visibility:` field per `classifySkill(slug)`. Idempotent — second run produces no changes.
4. **Write Hunter + Places provider stubs** per spec §7.5.2 / §7.5.3:
   - `googlePlacesProvider.ts`: exports `searchPlaces(input: { query, location, radius, type, limit })` returning `{ places: PlaceSummary[] }`. Calls Places `text-search` + (optional) `place-details`. In-memory LRU keyed on request hash, 24h TTL. **Fail-soft on missing env:** returns `{ status: 'not_configured', warning: 'GOOGLE_PLACES_API_KEY not set' }` — never throws. On 429/5xx returns `{ status: 'transient_error', warning: '...' }`.
   - `hunterProvider.ts`: exports `domainSearch(domain)` and `emailFinder({ domain, firstName, lastName })`. Calls Hunter `/v2/domain-search` + `/v2/email-finder`. In-memory LRU keyed on domain, 24h TTL. **Fail-soft on missing env + 402 (quota) + 429 (rate limit):** returns `{ status: 'transient_error', warning, data: null }` — never throws.
   - Note: `enrich_contact` registry update + handler routing for `provider: 'hunter'` lands in chunk-03 (per spec §7.5.1 + §8.3) — this chunk only delivers the provider modules.
5. **Extend `scripts/verify-skill-visibility.ts`** per spec §7.4 to additionally assert: every skill in `APP_FOUNDATIONAL_SKILLS` declares no external integration in its `ACTION_REGISTRY` entry — i.e. `actionCategory !== 'api'` AND `mcp.annotations.openWorldHint === false` AND `directExternalSideEffect !== true`. **READ THE EXISTING ASSERTIONS FIRST** so the new assertion composes cleanly with the existing exit-code contract. Because `directExternalSideEffect` is added in chunk-03, the assertion must short-circuit cleanly when the field is absent (treat absent as `false` per the §8.1 declaration default) — alternatively defer the assertion to chunk-03 if the gating pattern feels brittle. The spec lists this work under §7.4 (Phase 2), so the gating pattern is the canonical option.
6. **Delete `server/skills/update_financial_record.md`** per spec §7.6.
7. Run the chunk's verification commands (below).

**Verification commands** (spec §7.7 — gate-cadence-compliant: per-chunk loop only):

- `npm run build:server` (fast typecheck — provider modules + verifier extension parse)
- `npx tsx scripts/apply-skill-visibility.ts` (assert exit 0; second run produces no diff — idempotency)
- `bash scripts/run-all-unit-tests.sh` if a targeted unit test was added for the verifier extension (none required by the spec; the assertion is a static gate, not a pure-function helper)
- File-count probe: `ls server/skills/*.md | wc -l` → expect `<previous_count> + 14 - 1 = previous + 13`

(Defer `bash scripts/verify-skill-visibility.ts` itself to the pre-merge chunk per the gate-cadence rule.)

**Risks / blockers:**

- **Foundational-skill self-containment assertion is a NEW assertion in an EXISTING script.** Read the existing assertions in `scripts/verify-skill-visibility.ts` first; compose the new check with the existing exit-code contract (`process.exit(1)` on any miss). Don't duplicate iteration logic — extend the existing skill-walk loop.
- **Provider stubs MUST NOT throw when env is absent.** This is a hard contract — handlers in chunk-04 depend on the providers returning `{ status: 'not_configured', ... }` so the wrapper can route to its fail-soft / must-block branches per spec §9.3. If the providers throw, the wrapper's branch logic is bypassed and the user-facing UX regresses to a 500.
- **Provider modules use no env vars beyond `GOOGLE_PLACES_API_KEY` / `HUNTER_API_KEY`.** Those env vars are added in chunk-07 (Phase 7 per spec §12). Until then, both providers will return `{ status: 'not_configured' }` at runtime — this is the intended behaviour; chunk-04 handlers tolerate it.
- **Visibility-verifier extension references registry fields that don't yet exist in chunk-02.** `directExternalSideEffect` is added in chunk-03 (spec §8.1). If wired in this chunk, the assertion must short-circuit cleanly when the field is absent.
- **`update_financial_record.md` deletion is paired with chunk-03's registry-entry deletion and chunk-04's handler/worker-adapter removal.** Deleting the `.md` here without removing the registry entry would leave a Phase-0 baseline violation in the visibility verifier's "no orphan" path. Order is enforced by the chunk sequence — chunk-02 → chunk-03 → chunk-04 — but the implementer must NOT skip chunk-03 between chunks, or the registry entry references a missing skill file.

**Cross-chunk dependencies:**

- Chunk 01 must be merged (or, within a single PR, must precede this chunk in commit order). Reason: spec §5 #2 — pre-flights `preflightVerifySkillVisibility` + new `verify-agent-skill-contracts.ts` (chunk-08) read these files, and any seed reset run during local dev requires the partial-unique indexes from chunk-01 to be in place before any duplicate-row write would otherwise sneak in.

**Acceptance reference:** Spec AC #3 (skill files synced), AC #4 (foundational classification), AC #18 (foundational-skill self-containment), AC #19 (no orphan skills — partly).

---

## §6 Chunk 03 — Phase 3: Action registry extensions

**ID:** `chunk-03-action-registry`

**Goal:** Extend `ActionDefinition` with the four v7.1 fields (`sideEffectClass`, `idempotency`, `directExternalSideEffect`, `managerAllowlistMember`), add the 14 new `ACTION_REGISTRY` entries per spec §8.2, backfill `sideEffectClass` across the existing ~50 entries, mark the universal-bundle skills `managerAllowlistMember: true`, add the `provider` parameter + Hunter routing to `enrich_contact`, deliver the canonicalisation + TTL pure helpers + their tests, and remove the `update_financial_record` registry entry entirely.

**Spec anchors:** §8.1, §8.1.1, §8.2, §8.3, §8.4, §4.6, §4.11c.

**Files touched:**

- NEW (2 source + 1 test):
  - `server/services/skillIdempotencyKeysPure.ts` (per spec §4.11c — `canonicaliseForHash`, `hashKeyShape`, `ttlClassToExpiresAt`, `TTL_DURATIONS_MS`, `IDEMPOTENCY_CLAIM_TIMEOUT_MS`, `assertHandlerInvokedWithClaim`)
  - `server/services/__tests__/skillIdempotencyKeysPure.test.ts` (per spec §4.11c — covers `hashKeyShape` dot-paths + missing-field throw + collision determinism, `ttlClassToExpiresAt` all three classes incl. `'permanent' → null`, `canonicaliseForHash` rules 1–6, `assertHandlerInvokedWithClaim` test-mode invariant per §16A.1)
- MODIFIED (1 — large):
  - `server/config/actionRegistry.ts` (per spec §4.6 — interface extension, 14 new entries, `enrich_contact` `provider` + side-effect-class assignment, ~50-entry `sideEffectClass` backfill per spec §8.3 inference rules, `managerAllowlistMember` flags on the universal+delegation bundle skills per §8.3, `update_financial_record` entry deleted)

**Sequence within the chunk:**

1. **Extend `ActionDefinition`** in `server/config/actionRegistry.ts` per spec §8.1 — add `SideEffectClass` type, `IdempotencyContract` interface (with the documented `keyShape` / `scope` / `ttlClass` / `reclaimEligibility` semantics), and the four new fields on `ActionDefinition` (`sideEffectClass: SideEffectClass` (required), `idempotency?: IdempotencyContract`, `directExternalSideEffect?: boolean`, `managerAllowlistMember?: boolean`). Compiler will now flag every existing entry that does not declare `sideEffectClass` — that's the safety net for step 4.
2. **Write `skillIdempotencyKeysPure.ts`** per spec §4.11c + §8.1.1. Exports: `canonicaliseForHash(value)` (rules 1–6 per §8.1.1), `hashKeyShape(keyShape, input)` (dot-path resolution, missing-field throws `IdempotencyKeyShapeError`, calls `canonicaliseForHash` + SHA-256), `TTL_DURATIONS_MS` (constant table per §8.1.1), `ttlClassToExpiresAt(class)` (returns `null` for `'permanent'`), `IDEMPOTENCY_CLAIM_TIMEOUT_MS = 10 * 60 * 1000` (per §9.3.1 trailing constants block), `assertHandlerInvokedWithClaim(isFirstWriter)` (test-mode-only throw per §16A.1). Pure module — no DB / no env / no I/O.
3. **Write `skillIdempotencyKeysPure.test.ts`** — tsx pure-function tests per spec §4.11c. Run via `bash scripts/run-all-unit-tests.sh` (which discovers tests under `__tests__/`).
4. **Add the 14 new `ACTION_REGISTRY` entries** per spec §8.2 table (slug list + per-skill column values verbatim). Each write entry MUST declare `idempotency.reclaimEligibility` explicitly (`'eligible'` for all 8 writes per §8.2 trailing rationale, with the runtime-budget annotation comment per §8.1 registry-default rule). `parameterSchema` Zod shapes are implementation work, not spec scope — write the minimum schema each handler needs.
5. **Modify `enrich_contact`** per spec §7.5.1 + §8.3 — add `provider: z.enum(['hunter', 'apollo', 'clearbit']).optional()` (or whatever the existing parameter list calls for) to its `parameterSchema`; set `sideEffectClass: 'write'`; do NOT add an `idempotency` block (existing `idempotencyStrategy: 'keyed_write'` covers it).
6. **Backfill `sideEffectClass`** across every existing `ACTION_REGISTRY` entry per spec §8.3 inference rules: `actionCategory === 'api' && readOnlyHint === false` → `'write'`; `actionCategory === 'api' && readOnlyHint === true` → `'read'`; `actionCategory === 'worker'` → `'none'` (DB-internal writes are NOT external blast radius). The compiler enforces completeness — any missed entry fails `npx tsc --noEmit`.
7. **Mark universal+delegation bundle skills `managerAllowlistMember: true`** per spec §8.3 — `read_workspace`, `write_workspace`, `move_task`, `update_task`, `request_approval`, `add_deliverable`, `create_task`, `list_my_subordinates`, `spawn_sub_agents`, `reassign_task`, plus `web_search` (clarity per §8.3 note). Per-manager domain reads (`read_codebase`, `read_revenue`, etc.) are NOT marked here — they're added at agent-load time per §9.4.
8. **Delete the `update_financial_record` entry** entirely per spec §8.3 (paired with chunk-02 `.md` deletion + chunk-04 handler/worker-adapter removal).
9. Run the chunk's verification commands (below).

**Verification commands** (spec §8.4 — gate-cadence-compliant: per-chunk loop only):

- `npx tsc --noEmit` (the new required `sideEffectClass` field forces every missed backfill to fail loudly — this IS the chunk's primary correctness check)
- `bash scripts/run-all-unit-tests.sh` (runs `skillIdempotencyKeysPure.test.ts` along with all other tsx unit tests)
- Defer `bash scripts/verify-action-registry-zod.sh` + `bash scripts/verify-idempotency-strategy-declared.sh` + `bash scripts/verify-skill-read-paths.sh` to the pre-merge chunk per the gate-cadence rule.
- Compile-only sanity probe: `npx tsx -e "import { ACTION_REGISTRY } from './server/config/actionRegistry'; const writes = Object.values(ACTION_REGISTRY).filter(d => d.sideEffectClass === 'write'); const missingReclaim = writes.filter(d => !d.idempotency || !('reclaimEligibility' in d.idempotency)); if (missingReclaim.length) { console.error('write skills missing reclaimEligibility:', missingReclaim.map(d => d.actionType)); process.exit(1); } console.log('ok:', writes.length, 'write skills, all declare reclaimEligibility');"` (validates the §8.1 registry-default rule at chunk close — the full pre-flight gate runs in chunk-08).

**Risks / blockers:**

- **Registry-default rule for `reclaimEligibility`** (spec §8.1 final paragraph + §8.2 last note) — the pre-flight refuses to start the seed if any write-class skill omits `reclaimEligibility`. The spec mandates `'eligible'` for all 14 with a runtime-budget annotation comment in the source. Any future write skill defaults to `'disabled'` if undeclared but the pre-flight HARD-FAILS rather than silently inheriting the default — both are correct behaviours, the `'disabled'` default exists only as a defence-in-depth fallback.
- **`sideEffectClass` is non-optional** — the ~50-entry backfill is mechanical but compiler-enforced. A missed backfill fails `npx tsc --noEmit` loudly with "Property 'sideEffectClass' is missing" — this is the intended forcing function, NOT a regression.
- **Canonicalisation rules in §8.1.1 must match the constant table in §8.1.1** — single source of truth. Both `canonicaliseForHash` rules 1–6 and `TTL_DURATIONS_MS` live in `skillIdempotencyKeysPure.ts`; no duplicate copy elsewhere. Spec §8.1.1 final paragraph: "no literal `expires_at` arithmetic is permitted at any other call site."
- **Distinction between `directExternalSideEffect` and `sideEffectClass`** (spec §8.2 notes) — `discover_prospects` and `track_subscriptions` are both `sideEffectClass: 'read'` but `directExternalSideEffect: true` because they call quota'd APIs. The manager guard (chunk-04) rejects on `directExternalSideEffect: true` regardless of class — confirm the registry table follows this exactly.
- **`enrich_contact` provider routing** — adding the `provider` field only; the actual Hunter routing logic in the handler is chunk-04 work. This chunk delivers the registry-side declaration.

**Cross-chunk dependencies:** Chunks 01 + 02 must land first. Chunk 02's foundational-self-containment assertion in `verify-skill-visibility.ts` reads `directExternalSideEffect` — once this chunk merges, the assertion's "absent → treat as false" short-circuit can be removed (or, more cleanly, no change is needed because `directExternalSideEffect: false` is the explicit declaration after this chunk for every foundational skill).

**Acceptance reference:** Spec AC #5 (action registry covers all 14 new skills), AC #6 (side-effect class backfill), AC #7 (idempotency contract on every write skill), AC #19 (no orphan registry entries — `update_financial_record` removed), AC #23 (registry-default rule enforced).

---

## §7 Chunk 04 — Phase 4: Skill executor — handlers, manager guard, side-effect wrapper

**ID:** `chunk-04-skill-executor`

**Goal:** Wire the 14 new handler entries into `SKILL_HANDLERS`, deliver the 3 new domain-handler service modules + extend `configSkillHandlersPure.ts` with `executeListMySubordinates`, add the manager-role guard to `proposeAction.ts` middleware (with the §9.4 three-condition deny composition + reason ordering), extend `executeWithActionAudit` with the cross-run idempotency wrapper (§9.3.1) and the side-effect-class wrapper (§9.3.2), deliver the manager-guard pure helper + its tests, write the daily `skill_idempotency_keys` cleanup pg-boss job per §17, and remove the `update_financial_record` worker-adapter case.

**Spec anchors:** §9.1, §9.2, §9.3, §9.3.1, §9.3.2, §9.3.3, §9.4, §9.5, §9.6, §16A.1, §16A.3, §16A.4, §16A.5, §16A.6, §16A.7, §16A.8, §17.1, §17.2, §18.1, §4.7, §4.8, §4.11a, §4.11b, §4.11c.

**Files touched:**

- NEW (5 source + 2 test):
  - `server/services/middleware/managerGuardPure.ts` (per spec §4.11c — `isManagerAllowlisted(skill, agentRole, perAgentReads)` pure helper)
  - `server/services/__tests__/managerGuardPure.test.ts` (per spec §4.11c — allowed bundle, denied worker skill, per-manager declared read pass-through, `directExternalSideEffect` reject, `sideEffectClass !== 'none'` indirect-side-effect reject — covers all five §9.4 deny paths)
  - `server/services/adminOpsService.ts` (per spec §4.11a — 7 admin-ops handlers)
  - `server/services/sdrService.ts` (per spec §4.11a — 4 SDR handlers)
  - `server/services/retentionSuccessService.ts` (per spec §4.11a — 2 retention-success handlers)
  - `server/jobs/skillIdempotencyKeysCleanupJob.ts` (per spec §4.11b — daily worker; deletes rows where `expires_at IS NOT NULL AND expires_at < NOW()`)
- MODIFIED (4):
  - `server/services/skillExecutor.ts` (large — 14 handler entries in `SKILL_HANDLERS` per spec §9.1; `executeWithActionAudit` extensions per §9.3.1 + §9.3.2 + §9.3.3; remove `executeFinancialRecordUpdateApproved` + the `'update_financial_record'` worker-adapter case per §9.5; extend `hashActionArgs` to call `canonicaliseForHash` per §8.1.1 final paragraph)
  - `server/services/middleware/proposeAction.ts` (manager-role guard wired before `proposeAction()` per spec §9.4 — three-condition deny composition with reason ordering: `manager_role_violation` → `manager_direct_external_side_effect` → `manager_indirect_side_effect_class`)
  - `server/tools/config/configSkillHandlersPure.ts` (append `executeListMySubordinates` per spec §9.2 — reuses existing `computeDescendantIds`)
  - `server/jobs/index.ts` (register the new cleanup job in the worker fan-out per spec §4.11b)

**Sequence within the chunk:**

1. **Write the manager-guard pure helper + tests first** (`managerGuardPure.ts` + `managerGuardPure.test.ts`) — pure module, no DB. The middleware change in step 3 imports from this module, so it must compile first. Test coverage per spec §4.11c: allowed bundle skill → pass; non-allowlisted worker skill → deny `manager_role_violation`; per-manager declared read → pass; `directExternalSideEffect: true` → deny `manager_direct_external_side_effect`; `sideEffectClass !== 'none'` → deny `manager_indirect_side_effect_class`.
2. **Write `executeListMySubordinates`** in `server/tools/config/configSkillHandlersPure.ts` per spec §9.2 — appends a new handler that resolves children (`scope: 'children'`) or descendants (`scope: 'descendants'` via DFS depth ≤ 3) from `system_agents.parent_system_agent_id`. Filters by `deleted_at IS NULL && status === 'active'`.
3. **Wire the manager-role guard** in `server/services/middleware/proposeAction.ts` per spec §9.4 — inserted AFTER scope validation, BEFORE `proposeAction()`. Resolves `agentRole` via cache, calls `isManagerAllowlisted` from the new pure helper, applies the three-condition deny composition with the EXACT reason-ordering precedence per spec §9.4: `!allowed → 'manager_role_violation'` first, then `directExternalSideEffect === true → 'manager_direct_external_side_effect'`, then `sideEffectClass !== 'none' → 'manager_indirect_side_effect_class'`. Returns `{ action: 'block', reason }` via the existing middleware-block surface; writes the security event with `decision: 'deny'` + the same `reason` value.
4. **Write the 3 new domain-handler service modules** (`adminOpsService.ts`, `sdrService.ts`, `retentionSuccessService.ts`) per spec §4.11a + §9.1. Stub semantics per §9.1: external-provider reads return `{ status: 'not_configured', warning, data: null }` when the provider isn't configured; external-provider writes return `{ status: 'blocked', reason: 'provider_not_configured', requires: [...] }`. LLM-synthesis handlers (`draft_outbound`, `prepare_renewal_brief`, `prepare_month_end`) call `routeCall` from `llmRouter.ts`. Each `canonicalDataService.<method>` call site MUST pass `fromOrgId(context.organisationId, context.subaccountId)` per spec §9.1 trailing paragraph (or declare `// @principal-context-import-only — reason: <one-sentence>` at file head if the import is type-only).
5. **Extend `executeWithActionAudit`** in `server/services/skillExecutor.ts` per spec §9.3:
   - **§9.3.1 cross-run idempotency block** — gated on `def?.idempotency`. The raw-SQL `INSERT ... ON CONFLICT DO NOTHING RETURNING xmax = 0` MUST be preceded by `assertRlsAwareWrite('skill_idempotency_keys')` per spec §9.6 verification + §16.5. Implements: first-writer-wins INSERT, existing-row read on conflict, `request_hash !== requestHash` → `idempotency_collision`, `status === 'completed'` → return cached `responsePayload` + emit `skill.idempotency.hit`, `status === 'in_flight'` → branch on `reclaimEligibility` (eligible: stale-claim takeover via UPDATE-with-WHERE-clause concurrency guard once `ageMs >= IDEMPOTENCY_CLAIM_TIMEOUT_MS`; disabled: return `{ status: 'in_flight', retryable_after_ms: 5000 }` + emit `skill.warn` rate-limited per §18.1), `status === 'failed'` → terminal-per-§16A.7 → return `{ status: 'previous_failure' }`. Terminal UPDATE on success/failure includes the mandatory `WHERE status = 'in_flight'` predicate per §16A.7; on `updateResult.length === 0` (terminal-race-lost) emit `skill.warn` + return the winning row's `responsePayload` per §16A.3. Call `assertHandlerInvokedWithClaim(isFirstWriter)` before invoking the handler per §16A.1 (test-mode invariant).
   - **§9.3.2 side-effect-class block** — gated on `def?.sideEffectClass`. `'write'` branch calls `checkSkillPreconditions(actionType, input, context)` BEFORE any handler invocation; `'blocked'` returns `{ status: 'blocked', reason, provider, requires }` + emits `skill.blocked` (INFO level — never paged per §18). `'read'` branch runs the handler normally; if the handler returns `{ status: 'not_configured' | 'transient_error' }` the wrapper logs `skill.warn` and propagates the structured warning unchanged.
   - **§9.3.3 logging contract** — match the level mapping verbatim: read fail-soft → `skill.warn` (WARN); expected-blocked write → `skill.blocked` (INFO); hard failure / contract violation → `skill.error` (ERROR); idempotency hit → `skill.idempotency.hit`; idempotency collision → `skill.error` with `reason: 'idempotency_collision'`.
   - **§8.1.1 canonicalisation** — extend `hashActionArgs` to call `canonicaliseForHash(input)` before SHA-256 instead of `JSON.stringify(input)`. This is a single-line edit at the existing utility's call site; the canonical form lives in `skillIdempotencyKeysPure.ts`.
6. **Add the 14 `SKILL_HANDLERS` entries** in `server/services/skillExecutor.ts` per spec §9.1. Each routes through `executeWithActionAudit` and delegates to the appropriate domain-handler service. `requireSubaccountContext(context, '<slug>')` precedes any handler that touches subaccount-scoped data.
7. **Remove `executeFinancialRecordUpdateApproved`** + the `case 'update_financial_record'` line in `registerAdapter('worker', ...)` per spec §9.5. `tsc` will report the function as unused — that's the expected effect of the v7.1 finance rescope.
8. **Write `skillIdempotencyKeysCleanupJob.ts`** per spec §4.11b + §17.1. Daily worker — DELETE FROM `skill_idempotency_keys` WHERE `expires_at IS NOT NULL AND expires_at < NOW()`. The `IS NOT NULL` predicate skips permanent-class rows by design (per §8.1.1 TTL constant table). Raw-SQL DELETE MUST call `assertRlsAwareWrite('skill_idempotency_keys')` immediately before the DELETE per spec §9.6 verification + §16.5.
9. **Register the cleanup job** in `server/jobs/index.ts` per spec §4.11b — append to the worker fan-out using the existing daily-cron registration pattern (anchor on the existing daily job nearest to it for the convention).
10. Run the chunk's verification commands (below).

**Verification commands** (spec §9.6 — gate-cadence-compliant: per-chunk loop only):

- `npx tsc --noEmit` (handler signatures, wrapper extensions, middleware-guard wiring all parse)
- `bash scripts/run-all-unit-tests.sh` (runs `managerGuardPure.test.ts` + `skillIdempotencyKeysPure.test.ts` from chunk-03 + every other tsx unit test)
- Defer `bash scripts/verify-rls-protected-tables.sh` + `bash scripts/verify-principal-context-propagation.sh` + `bash scripts/verify-no-silent-failures.sh` to the pre-merge chunk per the gate-cadence rule. Per spec §9 the static gates are the verification spine — no new vitest/supertest is added in this chunk; the manual smoke tests in §9.6 (manager-block, idempotency-hit, terminal-race) run during the chunk-09 local-dev validation, not here.

**Risks / blockers:**

- **Stale-claim takeover safety gate** (spec §9.3.1 + §16A.8) — only `reclaimEligibility: 'eligible'` skills are reclaimable past `IDEMPOTENCY_CLAIM_TIMEOUT_MS`. `'disabled'` skills deadlock-by-design until cleanup or manual intervention; the wrapper surfaces stuck rows via `skill.warn` (rate-limited per §18.1) rather than reclaiming. Reclaim path's UPDATE-with-WHERE-`status = 'in_flight'`-AND-`createdAt < cutoff` is the concurrency guard — only one of N racing reclaimers wins; the rest see 0 rows updated and re-poll.
- **Raw-SQL writes to `skill_idempotency_keys`** MUST be preceded by `assertRlsAwareWrite('skill_idempotency_keys')` per spec §16.5 + §9.6. Two call sites: (a) the wrapper INSERT in §9.3.1, (b) the cleanup-job DELETE in step 8. `verify-rls-protected-tables.sh` flags missing guards as advisory violations during the chunk-10 pre-merge gate run.
- **Manager-guard reason ordering** matters for explainability — match spec §9.4 EXACTLY: `!allowed` → `'manager_role_violation'` (highest precedence; no allowlist match means no further checks), then `directExternalSideEffect === true` → `'manager_direct_external_side_effect'`, then `sideEffectClass !== 'none'` → `'manager_indirect_side_effect_class'`. The agent observes the block as a normal denial regardless of the specific reason; observability uses the reason for diagnosis.
- **Cleanup job's `WHERE expires_at IS NOT NULL AND expires_at < NOW()` predicate** skips permanent-class rows by design (per spec §8.1.1 TTL table — `'permanent'` rows have `expires_at = NULL`). Permanent rows persist forever for audit-trail compliance — this is the intended semantics, not a leak.
- **Principal-context propagation is now call-site granular** (A1b post-hardening) — handlers in the 3 new service modules that call `canonicalDataService.<method>(...)` MUST pass `fromOrgId(context.organisationId, context.subaccountId)` as first argument, per spec §9.1 trailing paragraph. Type-only imports declare `// @principal-context-import-only — reason: <one-sentence>` at file head (matches the convention applied to `actionRegistry.ts` in main).
- **`hashActionArgs` canonicalisation switch** (spec §8.1.1 + §9.3.1 trailing reminder) — flipping from `JSON.stringify(input)` to `canonicaliseForHash(input)` invalidates any in-flight `request_hash` values in pre-existing `skill_idempotency_keys` rows. Pre-prod, no live users → safe; in production this would be a coordinated cutover. The wrapper handles the mismatch correctly (would surface as `idempotency_collision` for legacy rows) but the pre-launch-hardening framing assumption (no live users) eliminates the operational concern.
- **`update_financial_record` removal is paired with chunk-02 (.md delete) + chunk-03 (registry delete)** — tsc will flag the now-unused `executeFinancialRecordUpdateApproved`. That's the expected forcing function for the worker-adapter case removal; do NOT silence the warning.

**Cross-chunk dependencies:** Chunks 01 (`skill_idempotency_keys` table + RLS), 02 (skill `.md` files declared, including `list_my_subordinates`), and 03 (registry fields exist — `sideEffectClass`, `idempotency`, `directExternalSideEffect`, `managerAllowlistMember`; `IDEMPOTENCY_CLAIM_TIMEOUT_MS` + pure helpers exported from `skillIdempotencyKeysPure.ts`). The 14 handler entries reference registry slugs that must already be present.

**Acceptance reference:** Spec AC #8 (14 handlers wired), AC #9 (cross-run idempotency wrapper), AC #10 (side-effect-class wrapper), AC #11 (manager-role guard with three-condition deny), AC #12 (cleanup job runs daily), AC #13 (principal-context propagation), AC #14 (terminal-race observability), AC #15 (stale-claim takeover gated on `reclaimEligibility`).

---

## §8 Chunk 05 — Phases 5+6: Agent file changes + retire `client-reporting-agent`

Per spec §5, Phases 5 + 6 are explicitly merged into a single chunk because they are the same file-system operation class (folder/AGENTS.md edits) and have identical pre-flight prerequisites (skills + handlers + registry must already exist).

**ID:** `chunk-05-agent-files`

**Goal:** Create the 7 new `companies/automation-os/agents/<slug>/AGENTS.md` folders (4 manager heads + admin-ops + retention-success + sdr), apply the 13 single-line `reportsTo:` reparent edits per spec §10.2, drop `update_financial_record` from `finance-agent/AGENTS.md` skills list, and delete the entire `companies/automation-os/agents/client-reporting-agent/` folder per spec §11.

**Spec anchors:** §10.1, §10.1.1–§10.1.7, §10.2, §10.3, §10.4, §11.1, §11.2, §11.3, §11.4, §4.12.

**Files touched:**

- NEW (7 folders, each containing one `AGENTS.md`): per spec §4.12 + §10.1 — slug list anchored there, not reproduced here. Counts: 7 new manager/worker AGENTS.md.
- MODIFIED (13 — single-line `reportsTo:` edits + finance skill drop): per spec §4.12 + §10.2 — slug list anchored there.
- DELETED (1 folder): `companies/automation-os/agents/client-reporting-agent/` (entire folder, including any in-folder skill bindings) per spec §11.1.

**Sequence within the chunk:**

1. **Create the 7 new AGENTS.md folders** under `companies/automation-os/agents/<slug>/` per spec §10.1.1–§10.1.7. Frontmatter shape follows the existing pattern (e.g. `companies/automation-os/agents/orchestrator/AGENTS.md`); the four department heads carry `role: manager` so `companyParser.toSystemAgentRows` propagates `agentRole: 'manager'` to seed rows (per spec §3 reuse decision — no parser change). `admin-ops-agent` and `retention-success-agent` and `sdr-agent` carry `role: staff` or `role: worker` per spec §10.1.5–§10.1.7. Master prompts for the 4 manager agents + 3 new workers are out-of-scope per spec §2 / §22 — the AGENTS.md frontmatter MUST land but a stub `body:` (one-line description plus a TODO pointing at master brief §10/§14/§21) is acceptable. Per-skill lists per spec §10.1.1–§10.1.7 verbatim.
2. **Apply the 13 reparent edits** per spec §10.2 — single-line `reportsTo:` switch in each existing `AGENTS.md`. No body changes.
3. **Drop `update_financial_record`** from `companies/automation-os/agents/finance-agent/AGENTS.md` `skills:` list per spec §10.3 (same diff as the `reportsTo:` switch — that's the "thirteenth" edit in §10.2's count).
4. **Search for `client-reporting-agent` references** before deleting the folder, per spec §11.4: `rg -l '\bclient-reporting-agent\b'` — expected hits are `automation-os-manifest.json` (regenerated in chunk-07) + `docs/automation-os-system-agents-brief-v6.md` (predecessor — no edit) + `tasks/builds/*/progress.md` (no edit). Any active source file hit is a missed reparent — investigate before continuing.
5. **Delete `companies/automation-os/agents/client-reporting-agent/`** entirely (folder + any in-folder skill bindings) per spec §11.1. Skill files `server/skills/draft_report.md` and `server/skills/deliver_report.md` are PRESERVED per spec §11.2 — they're now wired into `retention-success-agent` per spec §10.1.6.
6. Run the chunk's verification commands (below).

**Verification commands** (spec §10.4 — gate-cadence-compliant: per-chunk loop only):

- `npx tsc --noEmit` (frontmatter parsing via `companyParser` — any malformed YAML fails the existing parser's strict mode)
- `ls companies/automation-os/agents/ | wc -l` → expect exactly **22** post-deletion (16 existing − 1 retired + 7 new = 22, per spec §10.4)
- `rg -l '\bclient-reporting-agent\b' companies/ server/` → expect zero hits in both directories after the deletion (manifest + docs + progress hits are tolerated; any active code/AGENTS.md hit is a missed reparent)
- Defer `bash scripts/verify-agent-skill-contracts.ts` (which doesn't yet exist — added in chunk-08) and the seed pre-flight `preflightVerifySkillVisibility` to chunk-08, where the gate covers the full chunk-02 → chunk-05 surface end-to-end. The agent-file changes themselves validate at this stage by `companyParser` parse success + the file-count probe.

**Risks / blockers:**

- **Master prompts are out-of-scope** per spec §2 / §22 — the 4 manager agents + 3 new workers need their `AGENTS.md` frontmatter to land (skills list, `reportsTo`, `role`, `gate`, `model`, `tokenBudget`, `maxToolCalls`) but the body prompt drafting is a copy/adapt task from master brief §10/§14/§21, NOT an architectural decision the spec gates on. A stub body with a TODO comment is acceptable; the chunk is not blocked by prompt drafting.
- **`companyParser.toSystemAgentRows` already passes `agentRole` through to seed rows** per spec §3 reuse decision — no parser change needed. The 4 manager agents declare `role: manager` in frontmatter; the seed-time row carries `agentRole: 'manager'` which the chunk-04 manager-role guard reads via `resolveAgentRole(context.agentId)`.
- **`client-reporting-agent` deletion** removes the folder + any in-folder skill bindings. Verify no other `AGENTS.md` references it via the rg probe in step 4 BEFORE deletion. If any active source file references the slug, that's a missed reparent — investigate before continuing per spec §11.4.
- **Skill files preserved** — `draft_report.md` + `deliver_report.md` are NOT deleted (per spec §11.2). They migrate to `retention-success-agent`'s skill list. Deleting them by mistake would orphan the new agent's skills list and fail the chunk-08 agent-skill-contract gate.
- **The `finance-agent` skill drop** (`update_financial_record` removed from `skills:` list) is paired with chunk-02 `.md` deletion + chunk-03 registry deletion + chunk-04 handler deletion. Out-of-order edits would leave the agent referencing a missing skill OR the registry referencing a missing handler — both fail the chunk-08 pre-flight. The chunk sequence enforces correct order.
- **Per-domain reads on managers** (`read_codebase`, `read_revenue`, `read_campaigns`, `read_analytics`, `read_crm`, `read_expenses`, etc.) are listed in the manager AGENTS.md `skills:` lists per spec §10.1.1–§10.1.4 — these are NOT marked `managerAllowlistMember: true` in the registry; they're resolved at agent-load time via `isPerManagerDeclaredRead(toolSlug, context.agentId)` per spec §9.4. The middleware (chunk-04) handles the lookup; this chunk just wires the skill list per spec.

**Cross-chunk dependencies:** Chunks 01 + 02 + 03 + 04 must land first. The agent-skill contract gate (added in chunk-08) will validate this chunk's outputs end-to-end; without chunks 03 + 04 the new manager/worker agents reference handlers that don't yet exist. Chunk-02's skill-file landing means every skill the new AGENTS.md files reference (e.g. `discover_prospects`, `score_nps_csat`, `book_meeting`, `list_my_subordinates`) has a corresponding `.md` file — required for `preflightVerifySkillVisibility` in chunk-08.

**Acceptance reference:** Spec AC #1 (22-agent roster), AC #2 (3-tier hierarchy via `reportsTo` + `agentRole`), AC #16 (`client-reporting-agent` retired with skills preserved), AC #17 (finance-agent rescoped — `update_financial_record` dropped end-to-end), AC #20 (`reportsTo` reparenting completes for all 13).

---

## §9 Chunk 06 — Phase 7: Env vars + manifest regeneration

**ID:** `chunk-06-env-and-manifest`

**Goal:** Add the two new env vars (`GOOGLE_PLACES_API_KEY`, `HUNTER_API_KEY`) to env validation + `.env.example`, write the `regenerate-company-manifest.ts` script (with `--check` drift mode), and regenerate `automation-os-manifest.json` to v7.1.0 with the 22-agent roster.

**Spec anchors:** §12.1, §12.2, §4.10, §4.13.

**Files touched:**

- MODIFIED (2):
  - `server/lib/env.ts` (append `GOOGLE_PLACES_API_KEY: z.string().optional()` and `HUNTER_API_KEY: z.string().optional()` to the Zod schema, under a `// Lead discovery (SDR Agent)` comment per spec §12.1)
  - `.env.example` (append the two vars under `# Lead discovery (SDR Agent)` heading per spec §12.1, both with empty values)
- NEW (1):
  - `scripts/regenerate-company-manifest.ts` (~30 lines per spec §12.2.1 — walks `companies/automation-os/agents/*/AGENTS.md`, parses frontmatter via existing `parseCompanyFolder`, emits the manifest JSON; supports default write mode + `--check` drift mode that exits 1 on mismatch)
- REGENERATED (1):
  - `companies/automation-os/automation-os-manifest.json` (output of running the script — 22 agent entries with `version: "7.1.0"`, slug-sorted)

**Sequence within the chunk:**

1. **Add env vars** in `server/lib/env.ts` per spec §12.1 — both `z.string().optional()` so missing values produce `undefined` rather than a startup throw. Providers (chunk-02 stubs) already fail-soft when the value is absent.
2. **Mirror in `.env.example`** per spec §12.1 — keep the heading + variable order identical so the diff reads as a single contiguous addition.
3. **Write `scripts/regenerate-company-manifest.ts`** per spec §12.2.1. Constants in the script: `MANIFEST_VERSION = '7.1.0'` (single-source, comment pointing at spec §4.13 + §12.2.1), `MASTER_BRIEF = 'docs/automation-os-system-agents-master-brief-v7.1.md'`, `DESCRIPTION` per §12.2.1 verbatim. Sort agents by slug before serialising so the JSON is deterministic — non-deterministic ordering would cause `--check` mode to flap. `--check` mode: read the on-disk JSON, compare against the regenerated output (string equality after canonical JSON formatting), exit 1 with a diff summary on mismatch.
4. **Run `npx tsx scripts/regenerate-company-manifest.ts`** to write the manifest. Spot-check the diff: 22 agent entries (the v7.1 roster from chunk-05); `version` field reads `7.1.0`; `client-reporting-agent` is absent.
5. **Run `npx tsx scripts/regenerate-company-manifest.ts --check`** immediately after the write — must exit 0 (idempotency / round-trip).
6. Run the chunk's verification commands (below).

**Verification commands** (gate-cadence-compliant: per-chunk loop only):

- `npx tsc --noEmit` (env schema + script parse)
- `npx tsx scripts/regenerate-company-manifest.ts --check` (drift mode green after the write — confirms the regenerator is deterministic)
- File-count probe inside the JSON: `node -e "console.log(JSON.parse(require('fs').readFileSync('companies/automation-os/automation-os-manifest.json','utf8')).company.agents.length)"` → expect `22`.

(The seed pre-flight wiring + `verify-agent-skill-contracts.ts` end-to-end gate land in chunk-07.)

**Risks / blockers:**

- **Env vars are `optional()` — fail-soft is by design.** Providers (chunk-02 `googlePlacesProvider.ts` / `hunterProvider.ts`) already return `{ status: 'not_configured' }` when the values are absent. Until the operator sets the keys in `.env`, both providers will return that status — the wrapper (chunk-04) routes the response correctly. This is intended pre-prod behaviour, NOT a missing-config bug.
- **Manifest version field bumps to `7.1.0`** per spec §4.13. The version string lives ONLY in the regenerator's `MANIFEST_VERSION` constant — never hand-edit the JSON. A comment in the script must point at spec §4.13 + §12.2.1 so future v7.2 contributors update the constant in one place.
- **Determinism / sort-by-slug.** If the regenerator's output ordering depends on filesystem walk order, `--check` mode will flap on different OSes (Windows vs. Linux readdir ordering). Sort agents by slug before serialising — this is a hard requirement for the seed pre-flight `preflightVerifyManifestDrift` (chunk-07) to be stable.
- **`automation-os-manifest.json` is INDEX-ONLY** per the existing `_comment` header. Hand-edits drift the file from frontmatter; the chunk-07 pre-flight catches this. Editors / IDEs that auto-format JSON on save can also drift the file — the regenerator output's whitespace must match what `JSON.stringify(value, null, 2)` produces (the existing convention).
- **No new client / server build surface** — env-loading happens at process boot; existing tests do not need updating.

**Cross-chunk dependencies:** Chunks 01–05 must land first. The 22-agent count requires the chunk-05 agent-folder edits (7 new + 1 deletion); the manifest regenerator reads from `companies/automation-os/agents/*/AGENTS.md` directly so any chunk-05 frontmatter is consumed here.

**Acceptance reference:** Spec AC #26 (env vars declared optional + fail-soft), AC #27 (manifest regenerator deterministic + drift-mode green), AC #28 (manifest v7.1.0 with 22 agents).

---

## §10 Chunk 07 — Phase 8: Seed-script orphan cleanup + verification gates + post-seed hierarchy assertion

**ID:** `chunk-07-seed-and-gates`

**Goal:** Write `scripts/verify-agent-skill-contracts.ts`, extend the seed pre-flight to invoke it (plus the manifest-drift check from chunk-06), add Phase-2/3 orphan soft-delete + cascade soft-delete + `subaccount_agents` deactivation, and add the post-Phase-3 hierarchy assertion (one root, no cycles, depth ≤ 3, all parents non-deleted, every worker parented in `ALLOWED_T1_T2_PARENTS`).

**Spec anchors:** §13.1, §13.2, §13.3, §13.4, §13.5, §4.14, §4.15.

**Files touched:**

- NEW (1):
  - `scripts/verify-agent-skill-contracts.ts` (per spec §13.2 — single-file script, exit 1 on any violation)
- MODIFIED (2):
  - `scripts/seed.ts` (three additions per §13: pre-flight wiring `preflightVerifyAgentSkillContracts` + `preflightVerifyManifestDrift` per §13.1; Phase-3 orphan soft-delete + cascade + `subaccount_agents` deactivation per §13.3; post-Phase-3 hierarchy assertion per §13.4)
  - `scripts/verify-skill-visibility.ts` (extend with foundational-skill self-containment assertion if chunk-02 deferred it — see "Risk / blockers" below for the no-op-if-already-done case)

**Sequence within the chunk:**

1. **Write `scripts/verify-agent-skill-contracts.ts`** per spec §13.2 — single-file script. Steps:
   - Walk `companies/automation-os/agents/*/AGENTS.md`; parse frontmatter via `parseFrontmatter` from `companyParser.ts`. Collect the union of all `skills:` slugs.
   - Import `ACTION_REGISTRY` from `server/config/actionRegistry.ts` and `SKILL_HANDLERS` from `server/services/skillExecutor.ts`.
   - `readdir('server/skills/')`, filter `.md`.
   - **Assertions** (collect violations, print all, exit 1 if any):
     - Every agent-skill slug has a corresponding `server/skills/<slug>.md` with valid frontmatter (incl. `visibility:`).
     - Every agent-skill slug exists as a key in `ACTION_REGISTRY`.
     - Every agent-skill slug exists as a key in `SKILL_HANDLERS`.
     - Every `.md` file in `server/skills/` is referenced by at least one agent's `skills:` list OR carries `reusable: true` in frontmatter (the §4.4 / §11.2 reusable-skill rule covers `draft_report` + `deliver_report` post-retire).
     - Every slug in `APP_FOUNDATIONAL_SKILLS` has registry entry with `actionCategory !== 'api'`, `mcp.annotations.openWorldHint === false`, `directExternalSideEffect !== true` (per spec §4.15 self-containment — duplicates the chunk-02 visibility-verifier assertion deliberately; both gates must pass).
     - Every slug whose registry entry has `sideEffectClass === 'write'` declares `idempotency.reclaimEligibility` explicitly (`'eligible' | 'disabled'`); a missing field is a hard fail per §13.2 / §8.1 registry-default rule.
     - For every `'eligible'` declaration, the source line in `actionRegistry.ts` (the script reads the file as text in addition to importing it) carries either a runtime-budget annotation comment OR a `reclaimEligibility justification:` comment on the same line. Regex check.
2. **Wire the new pre-flights** in `scripts/seed.ts` per spec §13.1 — append `preflightVerifyAgentSkillContracts()` + `preflightVerifyManifestDrift()` to the existing pre-flight sequence, AFTER `preflightVerifySkillVisibility()`. Implementations are thin wrappers that shell out to `npx tsx scripts/verify-agent-skill-contracts.ts` and `npx tsx scripts/regenerate-company-manifest.ts --check` respectively, throwing on non-zero exit. **All pre-flights MUST run before any DB write** so a failed gate doesn't leave the dev DB in a half-mutated state — match the existing pre-flight ordering convention.
3. **Add Phase-2/3 orphan cleanup** in `scripts/seed.ts` per spec §13.3 — append a step in `phase3_playbookAuthor()` after the Playbook Author upsert but before returning. Compute `expectedSlugs = (parsed.agents.slug ∪ 'workflow-author')`. Soft-delete `system_agents` rows whose slug is not in `expectedSlugs` AND `deleted_at IS NULL`; cascade soft-delete to `agents` rows where `is_system_managed = true AND system_agent_id IN (...)`; deactivate `subaccount_agents` (set `is_active = false`) where `agent_id` references the cascaded agents. Idempotent — no-op when no orphans exist. Operate within the existing seed-script transaction structure; if the seed is multi-transaction, gate the cleanup on the same transactional boundary the upsert runs in.
4. **Add post-Phase-3 hierarchy assertion** in `scripts/seed.ts` per spec §13.4 — append AFTER the orphan cleanup. Four assertions:
   - **Assertion 1:** exactly one business-team root (`orchestrator`) with `parent_system_agent_id = NULL`. `portfolio-health-agent` and `workflow-author` are exempt (special).
   - **Assertion 2:** no cycles, depth ≤ 3 from any leaf via parent-chain walk. Reject if any parent is missing or soft-deleted.
   - **Assertion 3:** every non-root non-special agent has a non-null `parent_system_agent_id`.
   - **Assertion 4:** every non-root non-special agent's parent is in `ALLOWED_T1_T2_PARENTS = { orchestrator, head-of-product-engineering, head-of-growth, head-of-client-services, head-of-commercial, admin-ops-agent, strategic-intelligence-agent }` per spec §13.4 — the future-proofing comment for `admin-ops-agent` (currently `role: staff`, T2 direct report, no current subordinates but allowed as a valid worker parent) MUST be retained verbatim from the spec.
   - On success: emit the `[ok] hierarchy assertions: 1 root, no cycles, depth ≤ 3, all parents present, every worker has exactly one parent in ALLOWED_T1_T2_PARENTS` log line per §13.4 trailing.
5. **Extend `scripts/verify-skill-visibility.ts`** with the foundational-self-containment assertion if chunk-02 deferred it. If chunk-02 already landed the extension (per the chunk-02 risks-and-blockers note: "the assertion may have already happened in Chunk 02"), this step is a no-op for that file — confirm by reading the existing assertions and either skipping or extending without duplication. The §13.2 contract gate covers the same invariant; the visibility-verifier extension is defence-in-depth.
6. Run the chunk's verification commands (below).

**Verification commands** (spec §13.5 — gate-cadence-compliant: per-chunk loop only):

- `npx tsc --noEmit` (script + seed-script changes parse)
- `npx tsx scripts/verify-agent-skill-contracts.ts` (must exit 0 — every assertion green)
- `npm run seed` end-to-end against the dev DB (must complete the pre-flight sequence, run the orphan cleanup if applicable, and emit the new hierarchy-assertion `[ok]` line)
- `bash scripts/run-all-unit-tests.sh` (regression — chunk-03/04 pure-function tests still pass)
- Defer the full gate suite (`npm test` / `npm run test:gates`) to chunk-09 per the gate-cadence rule.

**Risks / blockers:**

- **Pre-flight ordering is load-bearing** — `preflightVerifySkillVisibility()` must run first so the agent-skill-contract gate (which reads `visibility:` from skill frontmatter) sees a known-valid set of skill files. The manifest-drift check goes last because it has the highest cost (file read + JSON-stringify equality) and is the most likely to flap if a stray IDE auto-format snuck in. **All three pre-flights MUST run before any DB write** — match the existing convention.
- **Cascade soft-delete must respect `withOrgTx` boundaries** — read existing `seed.ts` structure before inserting the orphan-cleanup block. If the existing Phase 3 runs in a `withOrgTx` callback, the cleanup writes use the same `tx` handle; if Phase 3 runs outside any tx, the cleanup writes use `db` directly. The spec §13.3 code sample uses `db` — match the existing seed-script convention; if there's a mismatch, prefer the seed's convention over the spec's example syntax (the spec is a contract on behaviour, not a copy/paste template).
- **Depth-≤-3 hierarchy assertion is a NEW invariant.** It accepts the v7.1 three-tier structure (T1 Orchestrator → T2 Heads/strategic-intelligence/admin-ops/portfolio-health → T3 workers). Any pre-v7.1 four-tier remnant (e.g. a stale `parent_system_agent_id` left over from a prior dev DB) will fail the assertion — this is the intended forcing function. Path A re-seed (chunk-08) clears the dev DB before re-seeding so this is not an operational concern at v7.1 cutover.
- **Orphan-cleanup is destructive in spirit** (soft-deletes rows). The seed-script entrypoint is already idempotent against a pre-populated dev DB — the cleanup just moves rows to soft-deleted state. No `--reset` flag needed because the cleanup is conditional on `expectedSlugs` set membership.
- **`verify-skill-visibility.ts` extension may already be done** in chunk-02 — read the file before editing. If the foundational-self-containment assertion is already present, this chunk's step 5 is a no-op for that file. Document the no-op in the per-chunk diff explicitly so the implementer doesn't double-write.
- **Last implementation chunk before merge** — after this chunk completes, only chunk-08 (local-dev validation, no committed files) and chunk-09 (pre-merge verification, no committed files) remain. Spec-conformance runs at the end of chunk-07 per the review-pipeline rule.

**Cross-chunk dependencies:** Chunks 01–06 must land first. The new verification script reads from every prior chunk's outputs (skill files, registry, handlers, agent folders, manifest); the seed-script pre-flight runs the script against the chunk-05/06 final state; the hierarchy assertion validates the chunk-05 reparenting end-to-end.

**Acceptance reference:** Spec AC #29 (agent-skill contract gate green), AC #30 (manifest-drift gate green), AC #31 (orphan cleanup soft-deletes + cascades + deactivates), AC #32 (hierarchy assertions all four pass), AC #33 (one-root, depth-≤-3, allowed-parent invariants enforced).

---

## §11 Chunk 08 — Phase 9: Local-dev validation (no committed files)

Per spec §14.

**ID:** `chunk-08-local-dev-validation`

**Goal:** Run the spec §14.1 Path A re-seed end-to-end against the dev DB to validate chunks 01–07 work as a coherent system. This chunk has NO committed files — its purpose is integration validation.

**Spec anchors:** §14.1, §14.2 (probes), §14.4 (rollback documented but not exercised).

**Files touched:** none.

**Sequence within the chunk:**

1. **Verify the Phase-1 migration is applied** to the dev DB. Run `psql $DATABASE_URL -c "\d+ system_agents"` and confirm `system_agents_slug_active_idx` is a partial unique with `WHERE (deleted_at IS NULL)` (per chunk-01 acceptance). If absent, run `npm run migrate` first — without the partial-unique index the second seed run fails on a unique-constraint violation against the soft-deleted rows.
2. **Run the Path A wipe SQL** per spec §14.1 step 3 verbatim — single transaction, deactivates `subaccount_agents` linked to system-managed `agents`, soft-deletes the matching `agents` rows, soft-deletes all `system_agents` rows. Use the spec's exact SQL — do not paraphrase.
3. **Run `npm run seed` end-to-end.** Must complete:
   - The new pre-flight sequence (visibility → agent-skill contracts → manifest drift) — all green.
   - Phase 3 orphan cleanup is a no-op (the wipe just made everything `deleted_at IS NOT NULL`; the new seed inserts fresh rows under the partial-unique index).
   - Phase 3 hierarchy assertion logs the `[ok] hierarchy assertions: ...` line.
4. **Spot-check the post-seed state** per spec §14.1 step 5 + §14.2:
   - `SELECT count(*) FROM system_agents WHERE deleted_at IS NULL` → expect **23** (22 v7.1 agents + `workflow-author`).
   - `SELECT slug FROM system_agents WHERE parent_system_agent_id = (SELECT id FROM system_agents WHERE slug = 'orchestrator' AND deleted_at IS NULL) AND deleted_at IS NULL ORDER BY slug` → expect 6 rows: `head-of-product-engineering, head-of-growth, head-of-client-services, head-of-commercial, admin-ops-agent, strategic-intelligence-agent`.
   - Inspect a worker row (e.g. `sdr-agent`) — confirm `parent_system_agent_id` resolves to `head-of-growth` per chunk-05 reparenting.
5. **Verify partial-unique-index behaviour** by attempting a duplicate-slug insert manually:
   - First insert with the same `slug` as an active row → must be rejected (unique violation).
   - Soft-delete an existing row, then insert with the same slug → must succeed (the partial-unique excludes soft-deleted rows). This validates the chunk-01 schema migration is operationally correct.
6. **Confirm `subaccount_agents` activation state** — at least one row per v7.1 agent in the Synthetos Workspace subaccount has `is_active = true` (Phase 5 of the seed reactivates them).

**Verification commands:**

- `npm run seed` exits 0 with all pre-flights green and the hierarchy `[ok]` line in the log.
- The four manual `psql` probes return the expected results above.
- The duplicate-slug behaviour matches partial-unique semantics.

**Risks / blockers:**

- **Path A wipe is destructive on the dev DB** — the user is the only operator. Be ready to re-run the seed if anything intermediate fails. Existing UI-created custom agents (non-system-managed) are PRESERVED by the wipe (the SQL filters `is_system_managed = true`).
- **Phase-1 migration MUST be applied BEFORE the wipe SQL** — without the partial-unique indexes, the second seed run fails on duplicate-slug because the soft-deleted rows still occupy the slug under the old full-unique constraint. Step 1 of the sequence guards against this.
- **This chunk does NOT commit code** — its purpose is integration validation. If a probe fails, the failure routes to the responsible prior chunk (most likely chunk-07 hierarchy assertion or chunk-05 reparenting). Do not patch in this chunk; reopen the chunk that owns the broken behaviour.
- **Path B (full DB reset) is the fallback** per spec §14.2 — if Path A runs into FK weirdness from a stale custom-data state. Document that Path B is acceptable but unnecessary in the happy path.
- **Rollback path** per spec §14.4 is documented but NOT exercised in this chunk. The branch revert + Path A re-run is the operational safety net for post-merge issues.

**Cross-chunk dependencies:** Chunks 01–07 merged. This is the integration test for the build.

**Acceptance reference:** Spec AC #34 (Path A re-seed end-to-end green), AC #35 (post-seed roster = 22 + workflow-author), AC #36 (partial-unique-index behaviour validated).

---

## §12 Chunk 09 — Pre-merge verification

**ID:** `chunk-09-pre-merge-verification`

**Goal:** Run the full gates suite + clean rebuild before opening the PR. Per CLAUDE.md gate-cadence rule, this is the SECOND of the two total gate-suite runs in this build (the first was Phase 0 baseline).

**Spec anchors:** none — governed by CLAUDE.md gate-cadence rule + architect Gate-Timing Rule, not the spec.

**Files touched:** none.

**Sequence within the chunk:**

1. `npm run lint` — exit 0.
2. `npm run typecheck` — exit 0.
3. `npm run build` — exit 0 (client + server bundles produced cleanly).
4. `npm test` — invokes `npm run test:gates` first per CLAUDE.md gate-cadence rule, then runs unit + integration tests. Exit 0.
5. **If any check fails:** REOPEN the relevant prior chunk to fix the underlying issue. Do NOT skip a failing gate. Per CLAUDE.md, after 3 failed fix attempts on the same check, STOP and escalate to the user with: exact error output, what was tried, root-cause hypothesis.

**Verification commands:**

- All four commands above exit 0. No suppressed warnings, no skipped checks.

**Risks / blockers:**

- **`npm test` is expensive** — minutes-long runtime is expected. This is THE place to absorb that cost; mid-build gate runs are explicitly forbidden by the architect Gate-Timing Rule (§2 plan conventions).
- **Failure routing.** A gate failure here is almost always a prior-chunk regression — diagnose by gate output → file → owning chunk. Common failure classes for THIS migration: `verify-action-registry-zod.sh` flags a missing `sideEffectClass` (chunk-03 backfill miss); `verify-rls-protected-tables.sh` flags a missing `assertRlsAwareWrite` call (chunk-04 wrapper or cleanup-job); `verify-skill-read-paths.sh` flags an unwrapped read (chunk-04 handler); `verify-principal-context-propagation.sh` flags a missing `fromOrgId` at a `canonicalDataService.<method>` call site (chunk-04 service modules); `verify-skill-visibility.ts` flags a foundational-skill self-containment violation (chunk-02 or chunk-03 boundary).
- **3-attempt escalation cap** per CLAUDE.md — same check failing the same way three times means escalate, not retry-with-rephrasing. Write the blocker to `tasks/todo.md` under `## Blockers`.
- **Spec-conformance runs BEFORE this chunk** — see Review pipeline below. If spec-conformance returns `CONFORMANT_AFTER_FIXES`, those fixes land before chunk-09 starts; chunk-09 then validates the post-fix state.

**Cross-chunk dependencies:** Chunks 01–08 merged. Spec-conformance has run.

---

## §13 Review pipeline

This is a Major spec-driven build. Per CLAUDE.md, the review order is mandatory:

1. **Per-chunk reviews.** After each non-trivial implementation chunk (chunks 01–07), invoke `pr-reviewer` against the chunk's diff. Findings route per the standard contract (spec-conformance / pr-reviewer). Self-review bias is avoided by treating the reviewer's output as authoritative.
2. **Final spec-conformance pass.** After chunk-07 (the last implementation chunk that commits code), invoke `spec-conformance` against the spec at `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md` and the full changed-code set. If it returns `CONFORMANT`: proceed. If it returns `CONFORMANT_AFTER_FIXES`: re-run `pr-reviewer` on the expanded changed-code set (the spec-conformance fixes plus the pre-existing diff). If it returns `NON_CONFORMANT`: route per the contract in `tasks/review-logs/README.md` — typically reopen the responsible chunk.
3. **Pre-merge verification.** After spec-conformance is green, run chunk-09 (the gate suite). This is the only post-baseline gate-suite run in the entire build per the architect Gate-Timing Rule.
4. **Optional dual-reviewer.** AFTER chunk-09 passes and the user explicitly asks: invoke `dual-reviewer`. Local-only — never auto-invoked. Skip silently if not requested.
5. **Open the PR.** After PR exists, OPTIONAL `chatgpt-pr-review` in a SEPARATE Claude Code session per the agent definition. Skip silently if not requested.

Caller contracts (filename convention, deferred-items routing, log persistence): `tasks/review-logs/README.md`.
