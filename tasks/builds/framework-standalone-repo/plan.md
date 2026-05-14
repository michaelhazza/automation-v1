# Plan — framework-standalone-repo (Phase A only)

**Build slug:** `framework-standalone-repo`
**Spec:** [`tasks/builds/framework-standalone-repo/spec.md`](./spec.md) — Final, chatgpt-spec-review APPROVED (3 rounds, 31 findings closed, 2026-05-04)
**Handoff:** [`tasks/builds/framework-standalone-repo/handoff.md`](./handoff.md)
**Plan date:** 2026-05-04
**Plan author:** architect (Opus)
**Scope class:** Significant
**Phase:** A only — in-tree sync infrastructure built and tested in Automation OS. Phases B (lift to standalone repo) and C (Automation OS self-adoption) are out of scope for this plan.
**Target framework version after Phase A:** 2.2.0 (additive — no breaking changes)

---

## Contents

1. Architecture Notes
2. Model-collapse check + Executor notes
3. Stepwise Implementation Plan (chunk overview)
4. Per-chunk detail
   - Chunk 1 — Placeholder format migration
   - Chunk 2 — manifest.json schema + initial content
   - Chunk 3 — sync.js bootstrap (state, manifest, hashing, logging)
   - Chunk 4 — sync.js file walk + clean/customised classification
   - Chunk 5 — sync.js substitution engine + new-file handling
   - Chunk 6 — sync.js settings.json flat-merge
   - Chunk 7 — sync.js flags (--adopt, --dry-run, --check, --strict, --doctor, --force) + removed-files reporting
   - Chunk 8 — SYNC.md guided-upgrade prompt
   - Chunk 9 — ADAPT.md Phase 6 (record adoption state)
   - Chunk 10 — Synthetic end-to-end tests
5. Risks & Mitigations
6. Contracts reference (canonical TypeScript shapes)

---

## 1. Architecture Notes

This is a build/tooling/docs change, not an application feature. There is no `server/`, `client/`, `shared/`, database, RLS, or route work. The architect playbook's tenant-data constraints (asyncHandler, resolveSubaccount, organisationId scoping) do not apply to anything in this plan.

The deliverable is a pair of artefacts that ship inside `setup/portable/` (Phase A) and later migrate verbatim into the standalone framework repo (Phase B): a declarative `manifest.json` and an imperative `sync.js`. Their job is to take a versioned framework bundle and apply it idempotently to a target repo, preserving operator customisations and producing a deterministic state record.

### 1.1 Decision: implementation language is JavaScript with JSDoc, not TypeScript-with-build-step

**Problem.** Spec §4.5 says "Implementation: TypeScript, ~300 lines." Spec §6 says the consume-time invocation is `node .claude-framework/sync.js`. These two facts conflict unless we (a) ship a build step in the framework repo and ship both `.ts` source and compiled `.js`, (b) require a runtime TypeScript loader (`tsx`/`ts-node`) which violates spec §4.5's "no dependencies beyond Node stdlib" invariant, or (c) reconcile by treating "TypeScript" as "typed JavaScript".

**Decision.** Author `sync.js` as plain JavaScript with rigorous JSDoc `@type` / `@param` / `@returns` annotations, validated by `npx tsc --noEmit --allowJs --checkJs` against the JSDoc comments in CI. Tests are authored as `.test.ts` files run via `npx tsx` (already used elsewhere in the repo and a non-issue at *test* time because tests run in the dev env, not in target repos at sync time).

**Rejected.** A `sync.ts` source + compiled-output approach forces every push to the framework repo to run a build step, increases the surface area for drift between source and shipped artefact, and increases the trust footprint operators audit before pulling a new framework version. Plain JavaScript with JSDoc is a near-zero-cost compromise that honours the runtime contract.

**Note for spec amendment (out of scope for plan execution).** Two future spec edits are flagged here for the Phase A finalisation pass — both additive, neither introduced as its own chunk in this plan:

1. The spec's "TypeScript, ~300 lines" sentence (§4.5) → "JavaScript with JSDoc-annotated types, ~300 lines, type-checked via `tsc --noEmit --allowJs --checkJs`."
2. The spec's FrameworkState shape (§4.4) gains an optional `lastSubstitutionHash?: string` field, with a one-paragraph note describing the substitution-drift detection mechanism (per §1.11 of this plan).

Both are one-line / few-line edits batched into the same finalisation commit.

### 1.2 Decision: `.framework-state.json` is the single source of truth for what's clean vs customised

The hash recorded at `state.files[<path>].lastAppliedHash` is the only signal sync uses to decide "clean" vs "customised". Sync never reconstructs prior framework content from the submodule (which would be wrong — after `git submodule update --remote` the submodule already points at the new version). This is asserted as an invariant in spec §6.

**Implication.** All sync operations that change a target file must update `lastAppliedHash` to the new substituted-content hash in the same atomic write. Failure to do so produces silent drift on the next sync (the file will be flagged customised when it isn't). Chunk 4's classification logic and Chunks 3, 5, 6 (write paths) all converge on this.

### 1.3 Decision: state.json writes are all-or-nothing

`state.json` is written to a `.tmp` sibling and atomically renamed at the end of step 11. Mid-run interruption leaves state at the previous version. The next run sees a stale state but no corruption. This honours spec §4.5 step 10's invariant. Implementation: `fs.writeFile(tmpPath, json) → fs.rename(tmpPath, finalPath)` — `rename` is atomic on POSIX and atomic-ish on Windows when source and target are on the same volume (always the case here). No fancy two-phase commit needed.

### 1.4 Decision: `.framework-new` sibling, not three-way merge in v1

Spec §7 explicitly defers three-way merge. Sync's job in v1 is **detection and surfacing**, not merge automation. The operator merges manually, deletes `.framework-new`, re-runs sync, and the hash is updated to the resolved content.

**Implication for `--doctor`.** The doctor flag detects two distinct anomalies (spec §4.5):
- **Case (a):** content hash differs from `lastAppliedHash` AND a `.framework-new` sibling exists → merge in flight, operator hasn't completed it.
- **Case (b):** content hash differs from `lastAppliedHash` AND no `.framework-new` sibling exists → operator merged manually but forgot to re-run sync. Per DEVELOPMENT_GUIDELINES §8.20 (deferred enforcement requires an observability log at the same boundary), `--doctor` is the explicit observability surface for this deferral.

### 1.5 Decision: substitution engine is two-pass and idempotency-validated up front

Per spec §4.5 substitution invariants 1–4, applying substitutions twice must produce identical output. The pre-condition (no substitution value contains `{{...}}`) is **validated at the start of every sync run, before any file write**. If validation fails, sync exits non-zero with a clear error naming the offending key. Plus, runtime substitution is a single pass (`for each placeholder { content = content.replaceAll(needle, value) }`); idempotency follows from the value-shape pre-condition. No need for guard-tokens or escape sequences.

**Implication.** A bad substitution map (e.g. `PROJECT_NAME = "Acme {{COMPANY_NAME}}"`) is a hard error at sync invocation time, not a silent failure that produces broken output. Caught by Chunk 5's `validateSubstitutions()` helper.

### 1.6 Decision: settings.json flat-merge identifies entries by `command` value (first token for shell strings)

Spec §4.6 rule 2 says "a hook entry's identity is its `command` value (first token for shell strings)". Implementation: parse the existing settings.json (if present), split entries under each event into framework-owned (command's first token resolves to a path under `.claude/hooks/`) vs project-owned (everything else), regenerate the framework-owned entries from the framework's own settings.json template, append project-owned entries afterward, write back deterministically. Order is stable: framework entries in manifest-declared order, then project entries in their pre-existing order.

**Implication for collisions.** Spec §4.6 rule 4 says "project wins" on command-path collision. The implementation: when building the merged entry list, project entries are kept; the framework's would-be-duplicate is dropped. This must be tested explicitly (Chunk 10).

### 1.7 Decision: lexicographic glob expansion using a small in-house implementation

Spec §4.5 step 3 says "Expand all managedFiles globs in lexicographic order (deterministic, cross-platform)." The glob set is small and limited to `*` and `{ext1,ext2}` patterns from §4.2 (`.claude/agents/*.md`, `.claude/hooks/*.{js,sh}`, `docs/decisions/0001-*.md`, etc.). Pulling in a full glob library (e.g. `glob`, `fast-glob`) violates the no-deps invariant. Decision: write a ~30-line glob expander that handles `*` (one path segment) and `{a,b,c}` (alternation) — no `**`, no `?`, no character classes. Unit-tested in Chunk 3 with cross-platform path samples.

**Cross-platform path normalisation.** All paths internal to sync.js use forward slashes (POSIX-style). On Windows, `fs.readdir` returns names without separators, and `path.join` is only used for filesystem ops; the manifest-relative paths and state.json keys are always forward-slash. This guarantees state.json portability across operating systems (a state.json written on Linux is readable on Windows and vice versa).

### 1.8 Decision: structured per-file log lines

Spec §4.5 mandates one structured log line per file operation: `SYNC file=<path> status=<one-of-skipped|new|customised|updated|removed-warn|ownership-transferred>`. Format is machine-parseable + human-readable. Implementation: a single `logFileOp(path, status, extra?)` helper used at every emit point. Status values are a closed enum; adding a new status requires both the helper and the spec update.

### 1.9 Decision: Chunk 1 carries the placeholder-format migration

The current 14 source files in `setup/portable/` use `[PROJECT_NAME]` (single bracket). Spec §4.5 invariant 1 mandates `{{PROJECT_NAME}}` (double brace). Substitution engine deliberately ignores any non-conforming format — meaning if Chunk 1 is skipped, sync.js produces literal `[PROJECT_NAME]` in target files at adopt time. Chunk 1 migrates all 14 files in a single mechanical pass, plus the ADAPT.md Phase 2 substitution table, plus the `scripts/build-portable-framework.ts` forbidden-string preflight check (which currently scans for substituted leaks; after Chunk 1 it must also flag any remaining `[PROJECT_NAME]`-style placeholders in the new format's domain).

**Why this is in Phase A and not deferred.** The synthetic end-to-end tests in Chunk 10 exercise the substitution engine against real bundle content. If the bundle still uses old-format placeholders, the test passes vacuously (no substitutions happen) and we ship a sync engine that doesn't actually substitute anything in production. Migration in Phase A makes the test meaningful.

### 1.10 Decision: no application of patterns that don't fit

Sync is small, single-purpose, and stateless across runs (the only state is `state.json`, which is read at start and written at end). No dependency injection, no factories, no command pattern. Plain functions in a flat module structure. Pattern application here would be over-engineering.

The one structural concession: each chunk lands a discrete function or function group exported from `sync.js`'s internal helpers. This makes each chunk reviewable and unit-testable in isolation without forcing the file into multiple modules.

### 1.11 Decision: substitution-map drift is enforced, not just documented

Spec §9 risk row "Operator forgets re-run after merge resolution" is mitigated by `--doctor` case (b). But the symmetric risk — operator edits `state.substitutions` between sync runs — has weaker mitigation in the spec text alone (the spec implies sync re-substitutes only files it rewrites, leaving clean+already-current files frozen at the *old* substitution values, producing silent file-by-file inconsistency).

**Decision.** Sync persists `lastSubstitutionHash` (sha256 of canonicalised `state.substitutions`) inside state.json and verifies it matches at every sync start. If it doesn't:

```
ERROR: state.substitutions changed since last sync (hash mismatch).
       Sync would leave already-current files at old substitution values,
       producing silent inconsistency.

Resolution: run `node .claude-framework/sync.js --adopt` to rebaseline.
            This re-writes every managed file under the new substitutions
            and updates lastAppliedHash + lastSubstitutionHash atomically.
```

`--adopt` (already specified) is the rebaseline path: it skips the drift check, re-applies substitutions to every managed file, recomputes every `lastAppliedHash`, and writes the new `lastSubstitutionHash`. `--force` skips the check without rebaselining (escape hatch for advanced operators who know the change is consistent — e.g. they manually re-substituted every file already; the operator owns the consequence).

**Canonicalisation rule.** `lastSubstitutionHash = sha256(JSON.stringify(substitutions, Object.keys(substitutions).sort()))`. Sorting keys before stringifying ensures hash stability regardless of key insertion order (Object key order in state.json could drift across editor saves).

**Implication for the spec.** State.json gains one optional additive field (`lastSubstitutionHash?: string`). Per spec §1.1's pattern, this is flagged as a future spec-amendment one-liner — additive (new optional field, no existing field changes), backwards-compatible (sync detecting a missing field on a v2.1.x state.json simply skips the check on the *first* run after upgrade and writes the hash on the same run, after which the check is active). Not a behavioural break of any existing spec invariant.

**Why not add a `--migrate-substitution` flag?** YAGNI. `--adopt` already does exactly what the rebaseline needs: re-write every managed file and reset state. Adding a second rebaseline path is duplicate machinery for the same operation.

---

## 2. Model-collapse check + Executor notes

### Model-collapse check

**Reject. Reason:** this build produces a deterministic, file-system-safe, git-state-aware sync engine. There is no LLM call anywhere in the pipeline. The work decomposes into deterministic steps (read manifest → walk files → hash compare → write or warn → atomic state update), and frontier multimodal models cannot produce that kind of correctness or safety profile. They also cannot enforce DEVELOPMENT_GUIDELINES §8.20 (deferred-enforcement observability) or guarantee the substitution invariants in spec §4.5. Collapsing this into a model call is a category error; sync.js must be code, not prompt.

**SYNC.md (Chunk 8)** *is* an LLM-facing artefact, but it is a guided prompt for an operator's Claude session, not a step in the file-modification pipeline. Sync.js does the file work; SYNC.md narrates it for the operator. The model-collapse question doesn't apply to SYNC.md because SYNC.md is the LLM surface, not a step that could be replaced by one.

### Executor notes

> **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Additional execution rules:

- **Branch.** Per the handoff, implementation lives on `claude/framework-standalone-repo` (create fresh from `main`). Do NOT implement on `claude/evaluate-summonaikit-B89k3` (which carries the spec only).
- **One chunk per session.** Each chunk's "Verification commands" section is the gate for that chunk; do not start chunk N+1 until chunk N's verifications pass.
- **No auto-commit from this plan's main session.** Per CLAUDE.md User Preferences, the operator commits explicitly after reviewing each chunk. Review agents (`pr-reviewer`) called between chunks are read-only by definition.
- **No spec edits during execution.** The spec is final. The §1.1 spec-amendment note (TypeScript → JavaScript-with-JSDoc) is a *future* edit, not part of any chunk in this plan.
- **Framework version bump to 2.2.0.** Happens once, in Chunk 7 (the chunk that completes the sync.js implementation surface). Do not bump in earlier chunks — partially-shipped sync infra at version 2.2.0 would be misleading.

Verification commands list per chunk uses ONLY: `npm run lint`, `npm run typecheck` (the dev-env tsc), `npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js` (sync.js JSDoc validation, set up in Chunk 3), `npx tsx <test-file>` for that chunk's targeted tests. Nothing else. No `scripts/verify-*.sh`. No `npm run test:*`.

---

## 3. Stepwise Implementation Plan (chunk overview)

Chunks ordered for forward-only dependencies. Each chunk is independently testable; later chunks layer functionality onto sync.js without rewriting earlier chunks' work.

| # | Chunk | Files (count) | Spec sections | Dependencies |
|---|-------|---------------|---------------|--------------|
| 1 | Placeholder format migration | 16 (14 source files + ADAPT.md + build-portable script) | §4.5 substitution invariants 1, 5 (ADAPT.md update only) | none |
| 2 | manifest.json schema + initial content | 1 (`setup/portable/manifest.json`) | §4.2, §3 (file ownership boundaries) | none (independent of Chunk 1) |
| 3 | sync.js bootstrap (state, manifest, hashing, structured logging, glob expander) | 2 (sync.js scaffold + `setup/portable/tests/helpers.test.ts`) | §4.4, §4.5 steps 0-6 | C2 (manifest schema needed for loader) |
| 4 | sync.js file walk + clean/customised classification | 1 (extends sync.js) + 1 test file | §4.5 steps 7a, 7b, 7e-h | C3 |
| 5 | sync.js substitution engine + new-file handling | 1 (extends sync.js) + 1 test file | §4.5 step 7d, substitution invariants 1-4 | C3, C4 |
| 6 | sync.js settings.json flat-merge | 1 (extends sync.js) + 1 test file | §4.5 step 7c (entry point), §4.6 (full contract) | C3 |
| 7 | sync.js flags + removed-files reporting | 1 (extends sync.js, adds CLI surface) + 1 test file + bump `setup/portable/.claude/FRAMEWORK_VERSION` to 2.2.0 + add `setup/portable/.claude/CHANGELOG.md` 2.2.0 entry | §4.5 flags table, steps 8-9, 11; spec §10 phase A version | C3, C4, C5, C6 |
| 8 | SYNC.md guided-upgrade prompt | 1 (`setup/portable/SYNC.md`) + tweak `setup/portable/README.md` to mention SYNC.md | §6 | C7 (CLI surface must be stable to document) |
| 9 | ADAPT.md Phase 6 (record adoption state) | 1 (`setup/portable/ADAPT.md` — append Phase 6) | §5 | C2 (manifest), C3 (state.json shape), C7 (`--adopt` flag) |
| 10 | Synthetic end-to-end tests | 3 (`setup/portable/tests/e2e-adopt.test.ts`, `setup/portable/tests/e2e-sync.test.ts`, `setup/portable/tests/e2e-merge.test.ts`) | §10 Phase A validation | C7, C8, C9 (full sync surface + ADAPT.md Phase 6) |

**Chunk sizing audit.** All chunks satisfy ≤5 files OR ≤1 logical responsibility per spec. Chunk 1 is mechanical text replace across 16 files (single responsibility — placeholder format change). Chunk 7's 4 file changes are all part of one closure (CLI surface + version bump). Chunks 3-7 each touch sync.js + a paired test file (single responsibility per chunk: bootstrap, walk, substitute, merge, flags). Chunk 10 is one responsibility (synthetic e2e validation) split across three test files because each test file is a self-contained scenario.

**Total file count.** Phase A creates ~10 new files (manifest.json, sync.js, SYNC.md, 1 + 4 + 1 + 1 + 1 + 3 = 11 test/helper files) and modifies ~16 existing files (14 source files for placeholder migration + ADAPT.md + README.md + build-portable script + FRAMEWORK_VERSION + CHANGELOG.md). All within `setup/portable/`, `tasks/builds/framework-standalone-repo/`, or the build-portable script.

**Ordering rationale.** Chunk 1 is independent and can be done in parallel with Chunk 2 if desired; placing it first ensures the source-of-truth files use the canonical format before any sync engine reasoning is built on top of them. Chunks 3-7 are sync.js construction in dependency order. Chunks 8-9 are documentation that depends on the CLI being stable. Chunk 10 is the integration test suite that proves the full surface works end to end.

---

## 4. Per-chunk detail

### Chunk 1 — Placeholder format migration

**spec_sections:** §4.5 substitution invariant 1 (placeholder format `{{PLACEHOLDER_NAME}}`); §4.5 invariant 2 (scoping); ADAPT.md Phase 2 alignment.

**Scope.** Migrate every occurrence of the legacy `[PROJECT_NAME]` / `[PROJECT_DESCRIPTION]` / `[STACK_DESCRIPTION]` / `[COMPANY_NAME]` placeholder format in `setup/portable/` to the canonical `{{PROJECT_NAME}}` / etc. format. Update ADAPT.md Phase 2's substitution table and §3 Operator-inputs table to reference the new format. Update `scripts/build-portable-framework.ts` so its forbidden-string preflight scan accepts the new format and rejects any leftover legacy format.

**Out of scope.** Any change to sync.js, manifest.json, or test scaffolding. Any change to `setup/portable/.claude/CHANGELOG.md` for the new version (Chunk 7 owns the version bump).

**Files to create.** None.

**Files to modify (16):**

- `setup/portable/.claude/agents/adversarial-reviewer.md`
- `setup/portable/.claude/agents/architect.md`
- `setup/portable/.claude/agents/audit-runner.md`
- `setup/portable/.claude/agents/finalisation-coordinator.md`
- `setup/portable/.claude/agents/hotfix.md`
- `setup/portable/.claude/agents/pr-reviewer.md`
- `setup/portable/.claude/agents/spec-conformance.md`
- `setup/portable/.claude/agents/spec-reviewer.md`
- `setup/portable/.claude/agents/triage-agent.md`
- `setup/portable/.claude/agents/validate-setup.md`
- `setup/portable/docs/frontend-design-principles.md`
- `setup/portable/references/spec-review-directional-signals.md`
- `setup/portable/.claude/CHANGELOG.md` — only the leftover-placeholder reference text in the v2.1.0 Fixed entry; do NOT add a new version entry here.
- `setup/portable/ADAPT.md` — substitution table in Phase 2 (§7) AND operator-inputs table in §3.
- `scripts/build-portable-framework.ts` — add `{{PROJECT_NAME}}`-style detection to the FORBIDDEN-STRING / leftover-placeholder preflight scan; keep the existing `[PROJECT_NAME]` detection for back-compat warning (so contributors still get a clear "you're authoring with the old format" message rather than silent failure).
- `setup/portable/README.md` — note the placeholder-format change in the "What ships" or a small "Placeholder format" subsection.

**Contracts.**

- The 4 canonical placeholders are exactly: `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{STACK_DESCRIPTION}}`, `{{COMPANY_NAME}}`. UPPER_SNAKE_CASE inside `{{...}}`. No other placeholders are introduced in this chunk.
- Migration rule: replace the substring `[<NAME>]` with `{{<NAME>}}` only when `<NAME>` is one of the four canonical placeholders. Do NOT touch any other `[…]` text (e.g. markdown links, role names like `[architect]`, code samples).
- Build-portable preflight: before producing the zip, scan all bundle files for any of `[PROJECT_NAME]`, `[PROJECT_DESCRIPTION]`, `[STACK_DESCRIPTION]`, `[COMPANY_NAME]` (legacy-format leftovers). If found, fail with a clear "leftover legacy-format placeholder" error pointing at the offending file + line. Plus the existing forbidden-string scan stays intact.

**Error handling / failure modes.**

- A migration script that accidentally rewrites `[architect]` (a role mention in prose) → `{{architect}}` would corrupt files. Mitigation: explicit per-name targeted replacement, not a regex-anything-bracketed sweep.
- Operator runs Chunk 1 on a branch that already had partial migration → idempotent because the find-and-replace looks for the legacy format only; double-application is a no-op.
- `scripts/build-portable-framework.ts` change must not break existing builds for other branches that still use legacy format → keep the legacy-format detection as a separate preflight error message, not silently change behaviour.

**Test considerations (for `pr-reviewer`).**

- After migration, `grep -rE '\[(PROJECT_NAME\|PROJECT_DESCRIPTION\|STACK_DESCRIPTION\|COMPANY_NAME)\]' setup/portable/` returns zero hits.
- After migration, `grep -rE '\{\{(PROJECT_NAME\|PROJECT_DESCRIPTION\|STACK_DESCRIPTION\|COMPANY_NAME)\}\}' setup/portable/` returns at least the same number of hits as the pre-migration legacy-format count (27 per the pre-migration grep).
- `npm run typecheck` passes (this chunk doesn't touch any TS files except `scripts/build-portable-framework.ts`, which gets one new condition).
- ADAPT.md Phase 2 substitution table now reads `{{PROJECT_NAME}}` etc.; ADAPT.md §3 operator-inputs table also updated.
- `scripts/build-portable-framework.ts` exits non-zero if any legacy-format placeholder remains in the bundle source.

**Dependencies.** None — Chunk 1 is pre-requisite for the meaningfulness of Chunks 5 and 10 but does not depend on them.

**Verification commands.**

```bash
npm run lint
npm run typecheck
# Sanity grep — both expected to pass:
grep -rE '\[(PROJECT_NAME|PROJECT_DESCRIPTION|STACK_DESCRIPTION|COMPANY_NAME)\]' setup/portable/  # expect: zero matches
grep -rE '\{\{(PROJECT_NAME|PROJECT_DESCRIPTION|STACK_DESCRIPTION|COMPANY_NAME)\}\}' setup/portable/  # expect: 27+ matches
# Build-portable script preflight:
npx tsx scripts/build-portable-framework.ts  # expect: exit 0, leftover-placeholder scan passes
```

---

### Chunk 2 — manifest.json schema + initial content

**spec_sections:** §4.2 (manifest schema), §3 (file ownership boundaries: sync vs adopt-only).

**Scope.** Author the canonical `setup/portable/manifest.json` file with all current 14 file-ownership entries (10 `sync` + 4 `adopt-only`) plus the `removedFiles` array (empty) and `doNotTouch` array. The schema MUST match spec §4.2 exactly. The file becomes the single source of truth for what sync.js operates on.

**Out of scope.** Any change to sync.js (Chunks 3+ consume manifest.json). Any new entries beyond what's listed in spec §4.2.

**Files to create (1):**

- `setup/portable/manifest.json` — JSON, formatted with 2-space indent, trailing newline.

**Files to modify.** None.

**Contracts.** See §6 Contracts reference, type `Manifest`. The exact entries (per spec §4.2):

```json
{
  "frameworkVersion": "2.2.0",
  "managedFiles": [
    { "path": ".claude/agents/*.md", "category": "agent", "mode": "sync", "substituteAt": "adoption" },
    { "path": ".claude/hooks/*.{js,sh}", "category": "hook", "mode": "sync", "substituteAt": "never" },
    { "path": ".claude/settings.json", "category": "settings", "mode": "settings-merge", "substituteAt": "never" },
    { "path": ".claude/FRAMEWORK_VERSION", "category": "version", "mode": "sync", "substituteAt": "never" },
    { "path": ".claude/CHANGELOG.md", "category": "changelog", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/decisions/0001-*.md", "category": "adr", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/decisions/0002-*.md", "category": "adr", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/decisions/0005-*.md", "category": "adr", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/decisions/README.md", "category": "adr", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/decisions/_template.md", "category": "adr", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/context-packs/*.md", "category": "context-pack", "mode": "sync", "substituteAt": "adoption" },
    { "path": "docs/spec-authoring-checklist.md", "category": "reference", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/frontend-design-principles.md", "category": "reference", "mode": "sync", "substituteAt": "never" },
    { "path": "references/test-gate-policy.md", "category": "reference", "mode": "sync", "substituteAt": "never" },
    { "path": "references/spec-review-directional-signals.md", "category": "reference", "mode": "sync", "substituteAt": "never" },
    { "path": "docs/spec-context.md", "category": "template", "mode": "adopt-only", "substituteAt": "adoption" },
    { "path": "docs/frontend-design-examples.md", "category": "template", "mode": "adopt-only", "substituteAt": "adoption" },
    { "path": "docs/doc-sync.md", "category": "template", "mode": "adopt-only", "substituteAt": "adoption" },
    { "path": "references/verification-commands.md", "category": "template", "mode": "adopt-only", "substituteAt": "adoption" }
  ],
  "removedFiles": [],
  "doNotTouch": [
    "CLAUDE.md",
    "KNOWLEDGE.md",
    "architecture.md",
    "DEVELOPMENT_GUIDELINES.md",
    "tasks/**"
  ]
}
```

**Note on the `frameworkVersion` field.** It tracks the *target* framework version for this manifest; Chunk 7 bumps `setup/portable/.claude/FRAMEWORK_VERSION` to `2.2.0` in the same chunk that ships the CLI surface. Manifest's `frameworkVersion` is the same value. Chunk 2 lands `frameworkVersion: "2.2.0"` even though the file at `setup/portable/.claude/FRAMEWORK_VERSION` reads `2.1.0` until Chunk 7 — this is intentional and reviewed; the manifest declares "the version this manifest belongs to once Phase A ships," and Chunk 7's bump finalises the alignment. Alternative considered: ship Chunk 2 with `2.1.0` and bump in Chunk 7 — rejected because manifest.json doesn't exist in 2.1.0 by definition (it ships in 2.2.0), so labelling it `2.1.0` would be wrong.

**Error handling / failure modes.**

- Malformed JSON in manifest.json → caught at sync.js startup (Chunk 3), exits non-zero with clear error.
- Missing `frameworkVersion` field → Chunk 3's loader rejects.
- Duplicate `path` entries in `managedFiles` → Chunk 3's loader rejects (deterministic glob expansion requires path uniqueness).

**Test considerations (for `pr-reviewer`).**

- File parses as valid JSON (`node -e 'JSON.parse(require("fs").readFileSync("setup/portable/manifest.json"))'`).
- Every glob in `managedFiles` matches at least one file in the current `setup/portable/` tree (no orphan globs).
- Every file in `setup/portable/` (except `manifest.json` itself, sync.js once Chunk 3 lands, SYNC.md once Chunk 8 lands, and tests/) is covered by at least one manifest entry — ensures no orphan files in the bundle.
- `doNotTouch` entries do not overlap with `managedFiles` paths.

**Dependencies.** None.

**Verification commands.**

```bash
npm run lint
node -e 'JSON.parse(require("fs").readFileSync("setup/portable/manifest.json", "utf8"))'  # JSON parse check
# (No targeted unit test for this chunk — it's a static data file. Sync.js's loader in Chunk 3 owns the schema validation tests.)
```

---

### Chunk 3 — sync.js bootstrap (state, manifest, hashing, structured logging, glob expander)

**spec_sections:** §4.4 (state.json schema), §4.5 steps 0-6 (startup, manifest read, version compare, submodule check), §4.5 invariant "structured per-file log lines".

**Scope.** Lay down the sync.js scaffold with all helper utilities the later chunks will reuse: argument parsing skeleton (flag handling expanded in Chunk 7), state.json read/write (atomic), manifest.json loader with schema validation, content normalisation + sha256 hashing, structured logging (`logFileOp` helper), glob expansion (~30 lines), submodule cleanliness check, FRAMEWORK_VERSION compare, startup `.framework-new` scan. **Does not yet do any file walk, substitution, or settings-merge** — those land in Chunks 4-6. Sync.js after Chunk 3 is a "skeleton sync" that on invocation does steps 0-6 of the pseudocode and exits 0 (with a "no files processed yet" log line).

**Files to create (2):**

- `setup/portable/sync.js` — initial scaffold, ~150 lines (will grow to ~300 as later chunks add walk/substitute/merge/flags).
- `setup/portable/tests/helpers.test.ts` — targeted tests for normalisation, hashing, glob expansion, state.json round-trip, logFileOp output format. Authored as a single self-contained file invoked via `npx tsx`. **No external test framework** (no jest/vitest); use Node's built-in `node:test` and `node:assert`.

**Files to modify.** None.

**Contracts.** See §6 Contracts reference. Key shapes:

- `Manifest` — see Chunk 2.
- `FrameworkState` — per spec §4.4.
- `FileOpStatus = 'skipped' | 'new' | 'customised' | 'updated' | 'removed-warn' | 'ownership-transferred'` — closed enum used by `logFileOp`.
- `NormalisedContent` — string with: BOM stripped, line endings LF-normalised, trailing whitespace per line stripped, trailing blank lines collapsed (per spec §9 Risks row "Customisation detection produces false positives").
- `SyncContext` — internal record passed through helper functions: `{ targetRoot, frameworkRoot, manifest, state, frameworkVersion, frameworkCommit, flags }`.

**Function signatures (JSDoc-typed, JavaScript implementation):**

- `normaliseContent(raw: string) => string` — applies the four normalisation rules.
- `hashContent(normalised: string) => string` — sha256 hex of UTF-8 bytes.
- `expandGlob(pattern: string, rootDir: string) => string[]` — supports `*` and `{a,b,c}`; returns relative paths sorted lexicographically.
- `loadManifest(frameworkRoot: string) => Manifest` — reads + JSON.parses + schema-validates `manifest.json`. Throws on malformed input. **Also runs overlap-conflict detection**: expand every entry's glob against the framework source tree, build a `path → entry[]` index, then for any path matched by two or more entries: (a) **`settings-merge` exclusivity** — if any matching entry has `mode: "settings-merge"`, throw with `ERROR: manifest overlap at <path>: settings-merge mode is exclusive — a path cannot be matched by both a settings-merge entry and any other entry. Resolve in manifest.json before sync can proceed.` This rule fires regardless of whether the other entries' fields agree, because settings-merge has its own write logic (flat-merge, §4.6) that cannot meaningfully compose with regular sync writes; (b) if all matching entries have *identical* `mode` AND `category` AND `substituteAt` AND none is `settings-merge`, emit `WARN: manifest path <path> matched by N entries (identical config; first wins)` and continue; (c) otherwise (fields differ, none is settings-merge), throw with `ERROR: manifest overlap conflict at <path>: entry <i> has mode=<X> but entry <j> has mode=<Y>. Resolve in manifest.json before sync can proceed.` Cases (a) and (c) prevent silent ordering-dependence the "first matching entry wins" rule otherwise hides. Per spec §4.2 ("deterministic, lexicographic order"), determinism is a manifest-author obligation; this check enforces it.
- `hashSubstitutions(s: Substitutions) => string` — sha256 hex of `JSON.stringify(s, Object.keys(s).sort())`. Used by Chunk 5's drift check; defined in Chunk 3 so other helpers can reference it.
- `readState(targetRoot: string) => FrameworkState | null` — reads `.claude/.framework-state.json`; returns null if missing.
- `writeStateAtomic(targetRoot: string, state: FrameworkState) => void` — write to `.tmp` + rename.
- `readFrameworkVersion(frameworkRoot: string) => string` — reads `.claude/FRAMEWORK_VERSION`, trims, validates semver.
- `getSubmoduleCommit(frameworkRoot: string) => string | null` — runs `git -C <frameworkRoot> rev-parse HEAD`; returns commit SHA or null if not a git repo (synthetic-test mode).
- `checkSubmoduleClean(frameworkRoot: string) => { clean: boolean; reason?: string }` — runs `git -C <frameworkRoot> status --porcelain`. Empty output = clean. Detached HEAD or branch mismatch is a warning, not an error (per spec §4.5 step 6).
- `scanForUnresolvedMerges(targetRoot: string, manifest: Manifest) => string[]` — startup check (spec §4.5 step 0). Returns list of `<path>.framework-new` files. **Caller error format (Chunk 7 bootstrap):** when the list is non-empty and `--force` is not set, the bootstrap prints a structured error with count + paths so the operator immediately sees the scope:<br><br>`ERROR: <N> unresolved .framework-new file(s) found. Resolve or delete before syncing (or pass --force to override).`<br>`  - <path1>.framework-new`<br>`  - <path2>.framework-new`<br>`  - ... (showing first 10; <N-10> more)` — when N > 10, truncate to first 10 alphabetically and print the count remainder. Then exit 1. The truncation is to keep stderr scannable on large drift sets.
- `logFileOp(path: string, status: FileOpStatus, extra?: Record<string,string>) => void` — emits `SYNC file=<path> status=<status>[ extra-key=extra-value ...]\n` to stdout. **Dry-run disambiguation:** when `flags.dryRun` is set in the active SyncContext, the helper automatically appends `dry_run=true` to the extra map (caller does not need to pass it). This keeps the status enum closed (six values, see `FileOpStatus`) — the would-have-happened semantic is conveyed via the extra field, symmetric with the other observability extras (`prior_framework_new`, `inline_check`, `error`). Parsers that consume the structured log can filter on `dry_run=true` to distinguish previewed vs applied operations without an enum doubling. **Parser contract:** `status` reflects *intent* — what sync is doing or would do for the file; `dry_run=true` (when present) indicates no actual write occurred. Automation that counts "files updated this run" should check both `status=updated` AND the absence of `dry_run=true`.

**Error handling / failure modes (sync.js exit codes).**

- Exit 1: `state.json` missing or unreadable AND `--adopt` not set (spec §4.5 step 1).
- Exit 1: `.framework-new` files exist AND `--force` not set (spec §4.5 step 0).
- Exit 1: Manifest malformed, missing required fields, or duplicate paths.
- Exit 1: FRAMEWORK_VERSION not parseable as semver.
- Exit 1: Submodule has uncommitted changes (spec §4.5 step 6).
- Exit 0: Already on latest version (spec §4.5 step 5) — print "already on latest (v<X>)" and exit cleanly.
- All errors print a single line to stderr in the form `ERROR: <message>` and exit non-zero. Warnings print `WARN: <message>` to stderr and continue.

**Test considerations (Chunk 3's own targeted tests).** Authored in `setup/portable/tests/helpers.test.ts`:

- `normaliseContent` strips BOM, converts CRLF to LF, strips trailing spaces per line, collapses trailing blank lines. Idempotent (normalising twice == normalising once).
- `hashContent` produces a stable hex digest; same content → same hash; different content → different hash.
- `expandGlob` against a fixture directory tree returns paths in lexicographic order; handles `*.md`, `*.{js,sh}`, `0001-*.md`, no-match cases.
- `readState` / `writeStateAtomic` round-trips a state.json correctly; partial-write simulation (write `.tmp` then crash before rename) leaves the original state intact.
- `loadManifest` rejects malformed JSON, missing `frameworkVersion`, duplicate paths.
- `loadManifest` overlap detection: identical-config overlap → warn, continue; conflicting-config overlap (e.g. one entry has `mode: sync`, another has `mode: adopt-only`) → throw with the exact error message from the function-signatures section; `settings-merge`-involved overlap (any other entry covering the settings.json path) → throw with the settings-merge-exclusivity message regardless of whether other fields match.
- `hashSubstitutions` is stable under key reordering: `hashSubstitutions({ A: 'x', B: 'y' }) === hashSubstitutions({ B: 'y', A: 'x' })`. Different values produce different hashes.
- `logFileOp` produces the exact `SYNC file=… status=…` format expected by automated parsers.
- `scanForUnresolvedMerges` finds `.framework-new` siblings of any manifest-managed path.

**Dependencies.** Chunk 2 (manifest.json must exist for `loadManifest` integration test).

**Verification commands.**

```bash
npm run lint
npm run typecheck
npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js  # JSDoc validation
npx tsx setup/portable/tests/helpers.test.ts                 # targeted unit tests for this chunk
# Smoke — invoke sync.js with fresh state missing, expect exit 1:
node setup/portable/sync.js  # expect exit 1 with "state.json not found" error
```

---

### Chunk 4 — sync.js file walk + clean/customised classification

**spec_sections:** §4.5 step 7a (syncIgnore skip), 7b (adopt-only skip), 7e-h (read target, normalise, hash compare, classify clean vs customised). NOT step 7c (settings-merge — Chunk 6) or step 7d (new-file handling — Chunk 5).

**Scope.** Add the file-walk loop to sync.js. For each manifest-managed file, classify as one of: skipped (syncIgnore), skipped (adopt-only), clean+already-on-version (skip), clean+update-needed (call writeUpdated stub), customised (call writeFrameworkNew stub). Write paths through stub functions that Chunks 5/6 will fill in. After Chunk 4, sync.js can correctly classify every file but does not yet write the new framework version anywhere — the stubs return without doing the actual write.

This chunk also adds the **mode-change check** per spec §4.5 step 7b2: if `state.files[path].mode` differs from `manifest entry.mode` and the new mode is `adopt-only`, set `state.files[path].adoptedOwnership = true` and emit `status=ownership-transferred`.

**Out of scope.** Substitution (Chunk 5), new-file handling (Chunk 5), settings-merge (Chunk 6), removed-files reporting (Chunk 7), final state.json write (Chunk 7 ties it all together).

**Files to create (1):**

- `setup/portable/tests/walk-classify.test.ts` — targeted tests.

**Files to modify (1):**

- `setup/portable/sync.js` — add ~80 lines: the walk loop, the classify function, the mode-change check, the stub callouts.

**Contracts.** See §6 Contracts reference. New function signatures:

- `expandManagedFiles(manifest: Manifest, frameworkRoot: string) => Array<{ entry: ManifestEntry; relativePath: string }>` — expands all globs in manifest order, deduplicates (a file matching multiple globs uses the first matching entry), returns flat list.
- `classifyFile(ctx: SyncContext, entry: ManifestEntry, relativePath: string) => Classification` — returns one of: `{ kind: 'skipped'; reason: 'syncIgnore' | 'adopt-only' | 'already-on-version' }`, `{ kind: 'ownership-transferred' }`, `{ kind: 'clean'; needsUpdate: boolean }`, `{ kind: 'customised' }`, `{ kind: 'new-file-no-state'; targetExists: boolean }`, `{ kind: 'settings-merge' }`. Used by the walk loop to dispatch to the right writer.
- `writeUpdated(ctx: SyncContext, entry: ManifestEntry, relativePath: string) => void` — STUB returning empty in Chunk 4; Chunk 5 implements.
- `writeFrameworkNew(ctx: SyncContext, entry: ManifestEntry, relativePath: string) => void` — STUB in Chunk 4; Chunk 5 implements.
- `writeNewFile(ctx: SyncContext, entry: ManifestEntry, relativePath: string) => void` — STUB in Chunk 4; Chunk 5 implements.
- `mergeSettings(ctx: SyncContext, entry: ManifestEntry, relativePath: string) => void` — STUB in Chunk 4; Chunk 6 implements.

**Error handling / failure modes.**

- Per-file errors (e.g. read error on a target file) MUST NOT abort the entire walk. Log the error against that file's `logFileOp` line with `status=skipped` + `extra={error: 'EACCES' | 'ENOENT' | …}` and continue. Sync's exit code at end is 0 even with per-file failures, but the report at the end (Chunk 7) prints a non-zero failed-files count. **Rationale:** sync is meant to be re-runnable; a single problematic file shouldn't block updates to the other 50+ files.
- An exception thrown from a stub (Chunks 5/6 implementations not yet present in Chunk 4) is caught at the walk-loop boundary, logged with `status=skipped extra={error:<msg>}`, and the walk continues. This keeps Chunk 4 testable in isolation.

**Test considerations (Chunk 4's own targeted tests).** In `walk-classify.test.ts`:

- Synthetic fixture: a small target directory with a state.json + a manifest. Invoke `expandManagedFiles` → assert correct ordering and count.
- For each classification branch, set up a fixture and assert `classifyFile` returns the expected kind:
  - File in `syncIgnore` → `kind: 'skipped', reason: 'syncIgnore'`.
  - Adopt-only file (already exists in target with state entry) → `kind: 'skipped', reason: 'adopt-only'`.
  - Clean file already on the target version → `kind: 'skipped', reason: 'already-on-version'`.
  - Clean file needing update → `kind: 'clean', needsUpdate: true`.
  - Customised file (target hash ≠ state.lastAppliedHash) → `kind: 'customised'`.
  - New file (no state entry, target missing) → `kind: 'new-file-no-state', targetExists: false`.
  - Pre-existing untracked file (no state entry, target exists) → `kind: 'new-file-no-state', targetExists: true`.
  - Mode-changed file (was sync, now adopt-only) → `kind: 'ownership-transferred'`.
  - Settings.json (mode `settings-merge`) → `kind: 'settings-merge'`.
- Walk-loop integration: with all stubs returning empty, run sync against a fixture and assert that `logFileOp` was called exactly once per file, with the correct status.

**Dependencies.** Chunk 3 (uses normalise/hash/state/log helpers).

**Verification commands.**

```bash
npm run lint
npm run typecheck
npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js
npx tsx setup/portable/tests/helpers.test.ts        # still passes (no regression)
npx tsx setup/portable/tests/walk-classify.test.ts  # new
```

---

### Chunk 5 — sync.js substitution engine + new-file handling

**spec_sections:** §4.5 step 7d (new-file branches: target-missing → write fresh; target-exists-no-state → write `.framework-new`); §4.5 substitution invariants 1-4 (placeholder format, scoping, idempotency pre-condition, substitution on `.framework-new`).

**Scope.** Implement the substitution engine and the new-file (no-state) handling that Chunk 4's stubs left empty. Specifically:

- `validateSubstitutions(state.substitutions)` — pre-flight check at sync start: every value is a flat string, no value contains `{{` (idempotency invariant 3a/3b/3c). Called from the bootstrap (Chunk 3 main) before the walk; this means Chunk 5 also adds the call site there.
- `checkSubstitutionDrift(state, currentHash)` — pre-flight check at sync start (per §1.11). Compute `currentHash = hashSubstitutions(state.substitutions)`. If `state.lastSubstitutionHash` is present and differs from `currentHash` AND `--adopt` is not set AND `--force` is not set: throw with the §1.11 error message. If `state.lastSubstitutionHash` is missing (state.json from a pre-2.2.0 sync): skip the check on this run; the new hash will be persisted at step 10 atomic write (silent forward-migration). Called from the bootstrap immediately after `validateSubstitutions`. Chunk 5 adds the call site.
- `applySubstitutions(content, substitutions)` — single-pass `replaceAll` for each declared placeholder. No regex special-character handling needed because placeholders are `{{...}}`. Idempotent given the pre-condition.
- `writeUpdated` (fills the Chunk 4 stub) — read framework source, normalise + apply substitutions if `entry.substituteAt !== "never"`, write to target path, update `state.files[path].lastAppliedHash`, **always (re)set `state.files[path].lastAppliedSourcePath = entry.path`** (self-healing — even if the field already matches, write it; one assignment is cheaper than a conditional read-compare-write and the field stays consistent without a migration), update `lastAppliedFrameworkVersion` and `lastAppliedFrameworkCommit`, emit `status=updated`.
- `writeFrameworkNew` (fills the Chunk 4 stub) — same read+substitute logic, write to `<targetPath>.framework-new`. Set `state.files[path].customisedLocally = true`. Emit `status=customised`. If `<targetPath>.framework-new` already exists, overwrite silently but emit a `extra={prior_framework_new=replaced}` flag in the log line. **Inline manual-merge detection signal (§4.5 step 7h enrichment).** `writeFrameworkNew` is invoked when `hash(target) ≠ lastAppliedHash`. If at this point *no* `.framework-new` sibling existed pre-sync (we're in the customised path, not the prior-merge path), and the operator was the most recent writer (best-effort: target file mtime > state.json mtime by more than a few seconds), emit `extra={inline_check=hash_drift_no_priorMerge}`. This is a non-blocking observability hint that the same condition `--doctor` case (b) detects (operator merged manually, didn't re-run sync) is firing during a normal sync run. It nudges SYNC.md (Chunk 8) to surface "did you mean to merge this?" rather than re-creating `.framework-new` blindly. Hint only — does not change the file-system action.
- `writeNewFile` (fills the Chunk 4 stub) — handles both new-file branches per spec §4.5 step 7d. **Both branches always set `state.files[path].lastAppliedSourcePath = entry.path`** (self-healing convention; same as `writeUpdated`):
  - target missing → write fresh, add state entry with all five `lastApplied*` fields populated, emit `status=new`.
  - target exists but no state entry → write `<targetPath>.framework-new` (substituted), set `state.files[path].customisedLocally = true`, populate `lastAppliedSourcePath` (so future runs have the back-reference), emit `status=customised` plus `extra={reason=untracked-pre-existing}`.

**Out of scope.** Settings-merge (Chunk 6). Flags / removed-files / final report (Chunk 7).

**Files to create (1):**

- `setup/portable/tests/substitute-write.test.ts` — targeted tests.

**Files to modify (1):**

- `setup/portable/sync.js` — add ~70 lines: substitution engine, fill the three writer stubs, add validateSubstitutions call site in bootstrap.

**Contracts.** See §6 Contracts reference. New shapes:

- `Substitutions = Record<string, string>` — values are flat strings; keys are UPPER_SNAKE_CASE.
- `validateSubstitutions(s: Substitutions) => void | throws` — throws with message naming the offending key if any value contains `{{`. **Also emits `WARN: substitution map is empty — files with `substituteAt: "adoption"` will retain literal `{{PLACEHOLDER}}` content.` when `Object.keys(s).length === 0`.** The warn is non-blocking: empty maps are technically valid (e.g. dev/test scenarios where no substitution is intended) but rarely the operator's intent in production. Caller (Chunk 7 bootstrap) does not exit on the warn; the operator decides.
- `checkSubstitutionDrift(state: FrameworkState, flags: SyncFlags) => { drift: boolean; reason?: string }` — returns `{ drift: false }` when state.lastSubstitutionHash is absent (forward-migration), or matches `hashSubstitutions(state.substitutions)`, or `flags.adopt || flags.force` is true. Returns `{ drift: true, reason: <one-line>}` otherwise. Caller (Chunk 7 bootstrap) decides exit handling.

**Error handling / failure modes.**

- Substitution map contains a value with `{{...}}` → `validateSubstitutions` throws at sync start, sync exits 1 with `ERROR: substitution value for <KEY> contains {{; would break idempotency. Fix .framework-state.json substitutions and re-run.`.
- Substitution-drift detected (per §1.11) AND no `--adopt`/`--force` → bootstrap exits 1 with the §1.11 error message before the walk; no file writes.
- Framework source file unreadable → caught at walk-loop boundary (Chunk 4), logged, walk continues.
- Target file write fails (permissions, disk full) → caught at walk-loop boundary, logged with `extra={error:<code>}`, walk continues.
- `.framework-new` write target unwritable → same handling.
- Substitution finds zero placeholders in a `substituteAt: "adoption"` file → not an error; sync writes the file unchanged. (A placeholder leak from the source file's authoring is caught upstream by `scripts/build-portable-framework.ts` per Chunk 1.)

**Test considerations (Chunk 5's own targeted tests).** In `substitute-write.test.ts`:

- `validateSubstitutions` accepts `{ PROJECT_NAME: 'Acme' }`, rejects `{ PROJECT_NAME: 'Acme {{COMPANY_NAME}}' }` with a clear error naming `PROJECT_NAME`.
- `validateSubstitutions` against an empty `{}` does NOT throw, BUT emits the empty-map `WARN:` to stderr; sync continues. (Captured by redirecting stderr in the test.)
- `checkSubstitutionDrift` returns clean when `state.lastSubstitutionHash === hashSubstitutions(state.substitutions)`. Returns drift when they differ. Skips check (returns clean) when `state.lastSubstitutionHash` is missing (legacy state.json forward-migration). Skips check (returns clean) when `flags.adopt` or `flags.force` is true regardless of mismatch.
- `applySubstitutions` is idempotent: applying twice == applying once.
- `applySubstitutions` only acts on `{{X}}` patterns, leaves `[X]` and `<X>` and `%X%` alone.
- `applySubstitutions` against a `substituteAt: "never"` file is a no-op (the writer skips the call).
- `writeUpdated` writes the substituted content, updates `state.files[path].lastAppliedHash` to `hashContent(normaliseContent(substituted))`, and emits `status=updated`.
- `writeUpdated` self-heals `lastAppliedSourcePath`: a state entry pre-seeded with a wrong `lastAppliedSourcePath` (e.g. `.claude/agents/old-name.md`) is corrected to the manifest entry's `path` after the write completes — no migration step required.
- `writeFrameworkNew` writes to `<path>.framework-new`, leaves the target untouched, sets `state.files[path].customisedLocally = true`, emits `status=customised`.
- `writeFrameworkNew` overwriting an existing `.framework-new` emits `extra={prior_framework_new=replaced}`.
- `writeFrameworkNew` with no pre-existing `.framework-new` AND target mtime newer than state.json mtime emits `extra={inline_check=hash_drift_no_priorMerge}` (the inline manual-merge detection hint).
- `writeNewFile` (target missing) writes the file and emits `status=new`.
- `writeNewFile` (target exists, no state entry) writes `<path>.framework-new` and emits `status=customised extra={reason=untracked-pre-existing}`.

**Dependencies.** Chunks 3, 4.

**Verification commands.**

```bash
npm run lint
npm run typecheck
npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js
npx tsx setup/portable/tests/helpers.test.ts
npx tsx setup/portable/tests/walk-classify.test.ts
npx tsx setup/portable/tests/substitute-write.test.ts  # new
```

---

### Chunk 6 — sync.js settings.json flat-merge

**spec_sections:** §4.5 step 7c (settings-merge dispatch); §4.6 (full flat-merge contract: rules 1-6).

**Scope.** Implement the `mergeSettings` function that Chunk 4 stubbed out. `.claude/settings.json` is the only file in the manifest with `mode: "settings-merge"`. Implementation must produce deterministic output matching the §4.6 contract:

1. **Framework-owned identity rule.** A hook entry is "framework-owned" iff its `command`'s first whitespace-separated token resolves to a path under `.claude/hooks/` (i.e. matches the regex `(\$\{CLAUDE_PROJECT_DIR\}/)?\.claude/hooks/[^\s]+`). Anything else is project-owned.
2. **Replace-in-place vs append.** For each event in the framework's `settings.json`, walk the framework's hook entries in declared order. For each: if an existing entry under that event has a matching `command` first-token → replace in place; else → append at the framework boundary (after the last replace-in-place position; before any project-owned entries that follow).
3. **Project hooks coexist.** All project-owned entries are preserved.
4. **Collision rule (project wins).** If a framework hook entry's command path is already present under that event in a project-owned slot → drop the framework's would-be-duplicate entry; keep the project's.
5. **Stable ordering.** Per event: framework entries in framework-declared order, then project entries in their existing order.
6. **Top-level keys.** Only the `hooks` block is owned. Other top-level keys (`permissions`, `env`, etc.) are passed through verbatim from the existing settings.json. If no settings.json exists in the target, write one containing only the framework's `hooks` block.

7. **Framework never removes hooks (explicit policy).** Spec §4.6 rules 1–6 are silent on the case of a framework hook being *removed* between framework versions (e.g. v2.2.0 ships `long-doc-guard.js`, v2.3.0 drops it). The flat-merge contract is **non-removing**: a framework hook entry that no longer appears in the framework's settings.json is *not* deleted from the target's settings.json. The orphaned entry stays in the project's settings.json, and on next sync it is treated as project-owned (because the framework no longer claims it). The operator removes it manually if desired. **Rationale.** Consistent with spec §4.5 step 8 (`removedFiles` action: warn-only — never auto-delete) and spec §7 ("Why not auto-merge — sync never deletes"). Auto-removing hooks would be the only path through which sync deletes operator-visible config; that's precisely the property the spec excludes.

   **Operator surface.** When sync detects this case (a target hook entry's command resolves to `.claude/hooks/<name>` but no matching framework entry exists), emit `WARN: hook entry <command> at <event> is no longer declared by framework — remains in your settings.json as project-owned. Remove manually if no longer needed.` once per orphaned entry. Counts toward the end-of-run "removal warnings" tally for visibility. Future addition (`removedHooks` array in manifest analogous to `removedFiles`) is a Phase B+ concern, deferred.

After merge, write the new settings.json with 2-space indent + trailing newline. Update `state.files['.claude/settings.json'].lastAppliedHash` to the hash of the *full merged file* (so customisation detection on the next run sees only edits made *after* this sync).

**Out of scope.** Anything outside the `hooks` block.

**Files to create (1):**

- `setup/portable/tests/settings-merge.test.ts` — targeted tests covering all 6 rules.

**Files to modify (1):**

- `setup/portable/sync.js` — add ~70 lines: `mergeSettings`, `classifyHookEntry`, `mergeSettingsHooksBlock`.

**Contracts.** See §6 Contracts reference. New shapes:

- `SettingsHookEntry = { type: 'command'; command: string }` (per existing `setup/portable/.claude/settings.json`).
- `SettingsHookGroup = { matcher?: string; hooks: SettingsHookEntry[] }` — events like PreToolUse use matcher-grouped entries; events like SessionStart use a single group with no matcher. Merge operates per `(event, matcher)` pair to preserve matcher semantics.
- `Settings = { hooks: Record<EventName, SettingsHookGroup[]>; [k: string]: unknown }` — open shape allows non-hooks top-level keys.

**Function signatures.**

- `mergeSettings(ctx: SyncContext, entry: ManifestEntry, relativePath: string) => void` — top-level entry called from the walk loop.
- `mergeSettingsHooksBlock(frameworkHooks: Settings['hooks'], projectHooks: Settings['hooks']) => Settings['hooks']` — pure function, fully unit-testable.
- `isFrameworkOwnedCommand(command: string) => boolean` — returns true if first token matches the `.claude/hooks/` path regex.

**Error handling / failure modes.**

- Project's existing settings.json is malformed JSON → log error, emit `status=skipped extra={error=settings_malformed}`, walk continues. Operator's responsibility to fix; sync does not attempt repair.
- Project's settings.json `hooks` block has unexpected shape (not an object, missing `hooks` arrays) → log warning, treat as empty project hooks (framework hooks still get applied). Subsequent edits by the operator can fix; sync does not abort.
- Framework's settings.json missing → manifest has it as a managed file; if absent at the framework source, classify as "missing source" and emit a clear error (genuine framework bug, not a target-repo problem).

**Test considerations (Chunk 6's own targeted tests).** In `settings-merge.test.ts`:

- **Rule 1 (identity).** A command of `node ${CLAUDE_PROJECT_DIR}/.claude/hooks/long-doc-guard.js` is framework-owned. A command of `node ./scripts/my-project-hook.js` is project-owned.
- **Rule 2 (replace-in-place).** Existing target settings.json has the framework's `long-doc-guard` entry; framework re-emits it; result has exactly one `long-doc-guard` entry, in framework-declared position.
- **Rule 2 (append).** Target has no `long-doc-guard`; framework adds it; result appends at the framework boundary.
- **Rule 3 (project preserved).** Target has a project-owned `node ./scripts/my-hook.js` entry; sync runs; result still has it.
- **Rule 4 (collision, project wins).** Target has a project-owned `node ${CLAUDE_PROJECT_DIR}/.claude/hooks/long-doc-guard.js` (operator deliberately re-pointed to the framework hook in a custom slot); sync runs; result keeps only the project's entry, drops the framework's would-be-duplicate.
- **Rule 5 (stable ordering).** After two consecutive syncs against the same target+state (no edits in between), settings.json is byte-identical between runs.
- **Rule 6 (top-level keys preserved).** Target has `permissions: {...}` at top level; sync preserves it.
- **No-target-settings case.** Target has no settings.json; sync writes one containing only the framework hooks block.
- **Empty hooks block.** Framework declares hooks for an event the project hasn't seen; sync inserts the event key and entries.
- **Hash tracking.** `state.files['.claude/settings.json'].lastAppliedHash` after merge equals `hashContent(normaliseContent(merged-output))`.
- **Rule 7 (no auto-removal).** Target settings.json has framework-owned hook `long-doc-guard.js` (carried over from a previous sync). Framework's new settings.json does not declare `long-doc-guard.js`. Sync runs. Result: the orphaned entry is preserved (NOT removed), classified as project-owned for next sync, and a `WARN:` line is emitted naming it. The end-of-run "removal warnings" count includes it.

**Dependencies.** Chunk 3 (state, hashing, logging), Chunk 4 (walk dispatch).

**Verification commands.**

```bash
npm run lint
npm run typecheck
npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js
npx tsx setup/portable/tests/helpers.test.ts
npx tsx setup/portable/tests/walk-classify.test.ts
npx tsx setup/portable/tests/substitute-write.test.ts
npx tsx setup/portable/tests/settings-merge.test.ts  # new
```

---

### Chunk 7 — sync.js flags + removed-files reporting + version bump to 2.2.0

**spec_sections:** §4.5 flags table (--adopt, --dry-run, --check, --strict, --doctor, --force); §4.5 steps 8 (removed-files reporting), 9 (CHANGELOG excerpt), 10 (atomic state write), 11 (final report); spec §10 phase A (bump to v2.2.0).

**Scope.** Tie the sync.js surface together with all six flags, the removed-files report, the CHANGELOG excerpt, the atomic final-state-write, and the end-of-run report. Bump `setup/portable/.claude/FRAMEWORK_VERSION` to `2.2.0` and add a v2.2.0 entry to `setup/portable/.claude/CHANGELOG.md`.

**End-of-run report enrichments (per review feedback).**

- **Orphan state entries surfaced in normal sync runs (not just `--doctor`).** At step 11, after the walk completes, sync emits a one-line summary of orphans: `INFO: N state entries reference paths no longer in any manifest glob (run --doctor for details).` The `--doctor` flag still owns the full per-orphan listing; normal sync just nudges the operator. Auto-clean is deferred per spec §7 ("sync never deletes").
- **Total execution time printed in the report.** Final report line gains a `time=Xs` token: `N updated, M new, P customised, K removal warnings, time=2.3s`. Cheap profiling signal for operators noticing slow sync runs (large repos, slow disks). Implemented via `performance.now()` deltas at sync start and step 11.
- **Substitution-drift hint in --check/--strict output.** If the drift check would have fired, `--check`/`--strict` exit 1 with the drift error (same message as no-flag) rather than the generic "updates available." This avoids CI silently passing while a state.json drift sits unaddressed.

**Out of scope.** SYNC.md prose (Chunk 8). ADAPT.md Phase 6 (Chunk 9).

**Files to create (1):**

- `setup/portable/tests/flags.test.ts` — targeted tests for each flag's behaviour.

**Files to modify (3):**

- `setup/portable/sync.js` — add ~80 lines: argument parser, per-flag logic, removed-files loop, CHANGELOG excerpt parsing, end-of-run report, atomic state write at step 10.
- `setup/portable/.claude/FRAMEWORK_VERSION` — change `2.1.0` → `2.2.0`.
- `setup/portable/.claude/CHANGELOG.md` — prepend a `## 2.2.0 — 2026-05-04` entry under the existing format header. Highlights: "adds sync infrastructure (manifest.json, sync.js, SYNC.md) for one-command framework upgrade across consuming repos. Adds canonical `{{PLACEHOLDER}}` substitution format. ADAPT.md Phase 6 records adoption state for future syncs." Added entries: `setup/portable/manifest.json`, `setup/portable/sync.js`, `setup/portable/SYNC.md`, `setup/portable/tests/*.test.ts`. Changed entries: `setup/portable/ADAPT.md` (Phase 6 added; Phase 2 substitution format updated to `{{...}}`); placeholder format migration across 14 source files; `scripts/build-portable-framework.ts` preflight scan now detects legacy `[…]` placeholders. Breaking entry: NONE (additive — old `[…]` placeholders are ignored by sync, but ADAPT.md authors must use new format from now on; this is documented in the Highlights paragraph).

**Contracts.** See §6 Contracts reference. Flag semantics:

| Flag | Semantics | Exit code |
|------|-----------|-----------|
| (none) | Full sync (per spec §4.5 pseudocode steps 0-11). Includes substitution-drift check (§1.11) — refuse if `state.lastSubstitutionHash` differs from `hashSubstitutions(state.substitutions)`. | 0 if all files succeed (or were skipped); 1 if any pre-walk error (state missing, manifest malformed, .framework-new unresolved, **substitution drift detected**). Per-file errors do not affect exit code. |
| `--adopt` | First-run mode AND substitution-rebaseline mode. State.json is ALLOWED to be missing. Skip startup `.framework-new` scan. Skip substitution-drift check. **First-run sub-case** (state.json missing): for each managed file — if target missing → write fresh + state entry; if target exists → compute hash + state entry only (non-destructive). **Rebaseline sub-case** (state.json present): for each managed file with a state entry — read target; compute `hash(normalise(target))` and compare to `state.files[path].lastAppliedHash` (which was computed under the OLD substitutions); if hashes match (clean against old map) → re-substitute with NEW map, write target, update `lastAppliedHash`; if hashes differ (operator customised against old map) → write `.framework-new` with NEW substitutions, set `customisedLocally = true`, never overwrite the customised target. Files with no state entry follow the new-file-no-state rules per §4.5 step 7d. Adopt-only files: skipped (project owns them). After completion: write `state.lastSubstitutionHash = hashSubstitutions(state.substitutions)`. **Mode disambiguation:** before the walk, sync emits one of two header lines so operators (and parsers) know which sub-case ran: `INFO: --adopt first-run mode (no state.json detected; cataloguing files)` or `INFO: --adopt rebaseline mode (substitution map changed; clean files will be rewritten, customised files get .framework-new)`. | 0 on success, 1 if substitution map invalid or write errors. |
| `--dry-run` | Run the full classify pass but never write to disk (no file writes, no state.json write, no `.framework-new`). Print what would change. Every per-file log line carries `extra={dry_run=true}` (set automatically by `logFileOp` when the dryRun flag is active) so parsers can distinguish previewed from applied operations without a status-enum doubling. Substitution-drift check still runs (informationally; reports "would refuse" without exiting non-zero in dry-run). | 0 always (informational). |
| `--check` | Run classify pass only. Exit 0 if state.frameworkVersion === current framework version AND no clean files need updates. Exit 1 if updates pending. Customised files do NOT cause exit 1. **CI guidance:** `--check` is the right flag for "is a framework upgrade available" gating. Use `--strict` instead if your CI also requires zero local customisations. | 0 = up to date; 1 = updates available. |
| `--strict` | As `--check` plus exit 1 if any file is customised. **CI guidance:** the right flag for repos enforcing "no local divergence." | 0 = up to date AND no customisations; 1 otherwise. |
| `--doctor` | No writes. Diagnose state.json health. Detect: orphaned state entries (state has a path not in manifest globs), missing target files (state has a path that no longer exists in target), case (a) of customisation detection (file ≠ lastAppliedHash AND `.framework-new` exists), case (b) (file ≠ lastAppliedHash AND no `.framework-new`), **substitution-drift state (`lastSubstitutionHash` mismatch)**, **orphaned framework hooks in settings.json (Chunk 6 rule 7)**. Print a summary table grouped by kind. | 0 if all checks clean; 1 if any anomaly found. |
| `--force` | Skip the startup `.framework-new` scan AND skip substitution-drift check. Proceed regardless. Use deliberately. | Same as no-flag. |

Flags are mutually compatible where it makes sense (e.g. `--adopt --dry-run` is allowed and previews the adopt run); incompatible combinations (e.g. `--check --strict --dry-run`) take the most restrictive interpretation. **Argument parser:** simple in-house, no dependencies; supports `--<long-flag>` form only (no `-x` shorts). Unrecognised flag → exit 1 with usage message.

**Error handling / failure modes (this chunk only).**

- Atomic state write (step 10) failure mid-rename → state.json.tmp may be left on disk. The next sync run sees the original state.json (rename was the atomic boundary) and ignores the .tmp. Add a defensive cleanup at sync start: if a stale state.json.tmp exists older than the current state.json, log a warning and remove it. If it's newer, log a warning and leave it (unusual; suggests an aborted sync — operator should investigate).
- CHANGELOG.md unparseable → log warning, do not fail (per spec §4.5 step 9).
- `--check`/`--strict`/`--doctor` exit codes must be precise; tests verify each.

**Test considerations (Chunk 7's own targeted tests).** In `flags.test.ts`:

- `--adopt` against a target with no state.json + files already in place writes state.json with computed hashes; does not overwrite files; emits `status=new` for missing files and a synthetic "tracked-existing" log line for files already in place.
- `--adopt` writes `state.lastSubstitutionHash = hashSubstitutions(state.substitutions)`.
- **Substitution-drift detection.** Set up a state.json where `state.lastSubstitutionHash` deliberately disagrees with `hashSubstitutions(state.substitutions)`. Run sync without flags. Assert: exits 1, prints the §1.11 error, no file writes, state.json untouched.
- **Substitution-drift rebaseline (clean files).** Same setup as drift-detection test. Run with `--adopt`. Assert: exits 0, the rebaseline-mode `INFO:` header is emitted, every clean managed file is rewritten with new substitutions applied, every `lastAppliedHash` updated, `lastSubstitutionHash` updated to the new hash. No `.framework-new` files created.
- **Substitution-drift rebaseline (customised files preserved).** Drift state + one customised file in target (hash mismatches `lastAppliedHash` under old map). Run with `--adopt`. Assert: customised target file is NOT overwritten, `.framework-new` is written with NEW substitutions, `customisedLocally = true` recorded, `lastAppliedHash` for that file is unchanged (still the old-map hash), other clean files are rewritten as in the prior test.
- **--adopt mode header.** First-run case emits the "first-run mode" `INFO:` line; rebaseline case emits the "rebaseline mode" `INFO:` line.
- **Substitution-drift `--force` escape.** Same setup. Run with `--force`. Assert: exits 0, drift check skipped, sync proceeds normally (clean files at current version stay frozen at OLD substitutions — operator owns this consequence; the test verifies the escape hatch works, not that it's wise).
- **Forward migration from pre-2.2.0 state.json.** State.json has no `lastSubstitutionHash` field. Run sync. Assert: drift check skipped this run, state.json after run contains `lastSubstitutionHash`, second run's drift check is active and clean.
- **Orphan state entries in normal sync.** State.json has an entry for a path not in any manifest glob. Run sync. Assert: end-of-run report includes the `INFO: N state entries reference paths…` line. Run `--doctor` and assert the per-orphan listing matches.
- **Execution time in report.** Run sync against a fixture; assert end-of-run report contains `time=Xs` where X parses as a non-negative number.
- `--dry-run` writes nothing to disk; state.json mtime unchanged; framework files unchanged; `.framework-new` not created. Every emitted `SYNC file=…` line for a file that would have been touched contains `dry_run=true` in its extras.
- `--check` exits 0 when state.frameworkVersion matches; exits 1 when manifest has a higher version.
- `--strict` exits 1 when any file is customised, regardless of version match.
- `--doctor` finds case (a) (`.framework-new` present + hash mismatch) and case (b) (no `.framework-new` + hash mismatch); exits 1.
- `--force` skips the unresolved-merge scan.
- Atomic state write: simulate crash between `writeFile(.tmp)` and `rename` (write the .tmp, do not rename, exit non-zero); next run reads the prior state.json and proceeds — no corruption.
- Unrecognised flag (`--bogus`) prints usage to stderr and exits 1.

**Dependencies.** Chunks 3, 4, 5, 6.

**Verification commands.**

```bash
npm run lint
npm run typecheck
npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js
npx tsx setup/portable/tests/helpers.test.ts
npx tsx setup/portable/tests/walk-classify.test.ts
npx tsx setup/portable/tests/substitute-write.test.ts
npx tsx setup/portable/tests/settings-merge.test.ts
npx tsx setup/portable/tests/flags.test.ts  # new
# Smoke: invoke each flag against a synthetic fixture and verify the exit code:
node setup/portable/sync.js --check  # against this repo, expected exit code per current state
```

---

### Chunk 8 — SYNC.md guided-upgrade prompt

**spec_sections:** §6 (Sync flow + SYNC.md narrative).

**Scope.** Author the `setup/portable/SYNC.md` prose. SYNC.md is the operator's prompt to a Claude session that wants to apply a framework upgrade. It mirrors ADAPT.md's structure (operator pastes a short prompt; Claude reads SYNC.md and walks numbered phases) but for upgrades, not first adoption.

The phases SYNC.md walks (per spec §6):

1. **Phase 0 — Confirm prerequisites.** State.json exists at `.claude/.framework-state.json`. The submodule (or local source-of-truth path) is reachable. Operator is on a clean working tree.
2. **Phase 1 — Diff versions.** Read `.claude-framework/.claude/FRAMEWORK_VERSION` (new) vs `.claude/.framework-state.json.frameworkVersion` (current). If equal → "already on latest" and exit. If new < current → warn (going backward; operator confirms).
3. **Phase 2 — Read changelog.** Read `.claude-framework/.claude/CHANGELOG.md` for entries between current and new versions. Summarise Highlights, Breaking, Added for the operator. Warn explicitly on Breaking entries.
4. **Phase 3 — Dry-run sync.** `node .claude-framework/sync.js --dry-run`. Show the operator the would-be report (N updated, M skipped, K customised).
5. **Phase 4 — Run sync.** `node .claude-framework/sync.js`. Show the actual report. **If sync exits with the substitution-drift error (per §1.11):** prompt the operator to confirm the substitution change is intentional, summarise what changed (which keys, old → new values), then re-run with `--adopt` (rebaseline path). Document this conditional branch as Phase 4a — "Substitution rebaseline if drift detected" — and surface the rebaseline-mode `INFO:` header in the operator's view: *"This will rewrite every clean framework-managed file under the new substitution map. Customised files are preserved and get a `.framework-new` sibling for review. Total file count: N."* Operator confirms before running. Documenting the noisy-diff expectation up front prevents post-hoc surprise.
6. **Phase 5 — Walk pending merges.** For each `<path>.framework-new`, suggest a side-by-side review: read both, suggest which side to keep, optionally apply the suggested merge, then prompt the operator to confirm + delete `.framework-new` + re-run sync to update the hash.
7. **Phase 6 — Verify.** Run `node .claude-framework/sync.js --doctor` and report.
8. **Phase 7 — Commit.** List the changed files, suggest a commit message of the form `chore: sync framework v<old>→v<new>`. The operator commits manually (per the auto-commit invariant).

**Out of scope.** Any change to sync.js. Any change to ADAPT.md.

**Files to create (1):**

- `setup/portable/SYNC.md` — ~150-200 lines of prose, structured like ADAPT.md.

**Files to modify (1):**

- `setup/portable/README.md` — add a brief mention: "For ongoing upgrades, see `SYNC.md`." Update the "What ships" table to list `SYNC.md`, `manifest.json`, `sync.js`.

**Contracts.** None — this chunk is prose. The operator-facing prompt at the top of SYNC.md mirrors ADAPT.md's pattern:

```
Read .claude-framework/SYNC.md and execute the upgrade flow.
The current framework version is in .claude-framework/.claude/FRAMEWORK_VERSION.
The target version recorded in this repo is in .claude/.framework-state.json.
```

**Error handling / failure modes.** Documented in SYNC.md prose: what happens when state.json is missing (point at `--adopt`), when the submodule is unreachable, when sync.js exits 1, etc.

**Test considerations (for `pr-reviewer`).**

- SYNC.md cross-references match actual file paths (`.claude-framework/.claude/FRAMEWORK_VERSION`, `.claude/.framework-state.json`, `.claude-framework/CHANGELOG.md`).
- Each phase's instructions are runnable verbatim by a Claude session.
- The `Read` instruction at the top is explicit ("Read SYNC.md in full" — not "skim").
- Section numbering matches ADAPT.md's style for cross-doc consistency.
- README.md mentions SYNC.md in the right contextual place (after the adoption flow description).

**Dependencies.** Chunk 7 (CLI surface must be stable to document).

**Verification commands.**

```bash
npm run lint
# Sanity check: SYNC.md's referenced commands resolve:
test -f setup/portable/SYNC.md
grep -E 'node \.claude-framework/sync\.js' setup/portable/SYNC.md  # should appear at least 4 times
# (No targeted unit test — prose only.)
```

---

### Chunk 9 — ADAPT.md Phase 6 (record adoption state)

**spec_sections:** §5 (Adoption flow Phase 6 addition).

**Scope.** Append Phase 6 to `setup/portable/ADAPT.md`. Phase 6 instructs Claude to write `.claude/.framework-state.json` after the existing Phase 5 verification completes. The phase walks: collect substitution map (already gathered at Phase 0), determine framework version (read `.claude/FRAMEWORK_VERSION`), determine framework commit (run `git -C .claude-framework rev-parse HEAD`; if not a submodule, derive from the bundle's git origin or fall back to "unknown"), per-file: compute `lastAppliedHash` of the *substituted current target file*, set `lastAppliedFrameworkVersion` and `lastAppliedFrameworkCommit`, set `customisedLocally = false` initially. Write the file atomically. Print confirmation.

This phase is also where the operator is told that for any future improvement to a framework-managed file, edit it in the framework repo (not in the target's generated copy) — per spec §11.1 (framework dev location decision).

**Out of scope.** Any change to sync.js. The actual implementation of state.json writing inside sync.js is in Chunks 3 and 7; this chunk is *operator instructions* for how Phase 6 happens within an ADAPT.md walkthrough — Claude can either run sync.js's `--adopt` flag or write the state file directly per the embedded shape in ADAPT.md. Per spec §5, the recommended path is to run `node setup/portable/sync.js --adopt` (which is exactly what Chunk 7 implemented). ADAPT.md Phase 6 directs Claude to that command, then verifies the resulting state.json.

**Files to create.** None.

**Files to modify (1):**

- `setup/portable/ADAPT.md` — append Phase 6 (~30 lines) and update the Contents block at top (§§ list) to include Phase 6.

**Contracts.** Phase 6 ends with a state.json that matches the `FrameworkState` shape (see §6 Contracts reference). The operator-visible artefact is the file at `.claude/.framework-state.json`.

**Error handling / failure modes.** Documented in ADAPT.md prose: what happens if `--adopt` reports a substitution validation error (operator fixes the input, re-runs); what happens if a file the manifest references is missing (sync.js reports it; operator either copies it from the framework source or removes the entry from the manifest before re-running).

**Test considerations (for `pr-reviewer`).**

- ADAPT.md Phase 6 invocation matches the `--adopt` flag spec from Chunk 7.
- The framework-dev-location rule (don't edit generated files in target; edit in framework repo) is mentioned at end of Phase 6.
- Phase 6 cross-references the framework-state file path correctly (`.claude/.framework-state.json`, hidden file at repo root).
- Top-of-file Contents list includes Phase 6 with the right anchor.

**Dependencies.** Chunk 2 (manifest), Chunk 3 (state.json shape), Chunk 7 (`--adopt` flag).

**Verification commands.**

```bash
npm run lint
test -f setup/portable/ADAPT.md
grep -E '^## .*Phase 6' setup/portable/ADAPT.md  # should match
grep -E 'sync\.js --adopt' setup/portable/ADAPT.md  # should match
# (No targeted unit test — prose only.)
```

---

### Chunk 10 — Synthetic end-to-end tests

**spec_sections:** §10 Phase A validation (synthetic test exercises adopt + sync + customisation detection + merge flow).

**Scope.** Three end-to-end tests that exercise the full sync surface against a synthetic target directory. Each test sets up a temp dir, copies a small fixture set in, drives sync.js through a realistic operator scenario, and asserts the resulting filesystem + state.json shape. Cross-platform line-ending handling is verified explicitly (Windows CRLF input + Unix LF source; LF-normalised hash should match either).

**Three scenarios** (one file each, ordered by complexity):

1. **`e2e-adopt.test.ts` — first-run adoption.** Set up synthetic framework source (small fixture: 3 agent files, 1 hook, 1 settings.json with one framework hook entry, 1 manifest.json, 1 ADR). Set up an empty target dir. Run `sync.js --adopt` with a substitution map. Assert: every framework file lands in target with substitutions applied; state.json exists with correct hashes; settings.json has the framework hook block; logs include `status=new` for each file.
2. **`e2e-sync.test.ts` — clean-file update flow.** Start from a post-adoption fixture (output of test 1). Bump the framework's source files (e.g. add a new line to one agent file). Bump the framework version. Run `sync.js`. Assert: the changed agent file's content matches the new framework version (substitutions reapplied); unchanged files have unchanged target content; state.json's `frameworkVersion` is bumped; per-file `lastAppliedHash` is updated only for changed files; logs include `status=updated` for changed and `status=skipped` for unchanged. Re-run sync (idempotency check) — second run produces identical state.json bytes and no further file writes.
3. **`e2e-merge.test.ts` — customisation detection + .framework-new merge flow.** Start from a post-adoption fixture. Operator-edit one file in the target (e.g. add a project-specific note to `agents/architect.md`). Bump the framework's version of the same file (different change). Run `sync.js`. Assert: target file unchanged; `<target>.framework-new` exists with the substituted new framework content; state.json marks `customisedLocally: true`; log emits `status=customised`. Sync.js startup check on next run blocks with `--force`-required error. Operator merges manually (test simulates by writing a merged version to the target + deleting `.framework-new`). Re-run sync. Assert: `lastAppliedHash` updates to the merged content's hash; `customisedLocally` reverts to false; `status=updated` emitted. Run `sync.js --doctor` against an interim state where merge was done but sync wasn't re-run — assert case (b) is reported.

**Cross-platform line-ending handling** is exercised inside `e2e-sync.test.ts`: write the same logical content with CRLF endings into the target, run sync, assert no false `status=customised` (the LF-normalised hash should match the LF-source hash).

**Out of scope.** Tests that depend on a real git submodule, real GitHub network access, or any external dependency. All tests are pure-filesystem against temp dirs.

**Files to create (3):**

- `setup/portable/tests/e2e-adopt.test.ts`
- `setup/portable/tests/e2e-sync.test.ts`
- `setup/portable/tests/e2e-merge.test.ts`

**Files to modify.** None.

**Contracts.** Tests use the same shapes as production (FrameworkState, Manifest, etc.) imported from sync.js or duplicated as type-only references in test fixtures.

**Error handling / failure modes.** Each test cleans up its temp dir on exit (afterEach pattern). Test failures are surfaced with assertion messages naming the asserted invariant. No test should leave temp dirs lying around even on assertion failure (use try/finally).

**Test considerations.** This chunk IS the test deliverable — there are no further tests for the tests. For `pr-reviewer`:

- Tests run against `npx tsx setup/portable/tests/e2e-*.test.ts` with no flag dependencies.
- Each test uses Node's built-in `node:test` harness + `node:assert/strict`.
- Each test's temp dir is created via `os.tmpdir()` + a UUID-named subdir.
- Cross-platform: the file-walk and hash compare must produce the same result on Windows and POSIX. Validate by running tests on both (CI-only); locally, test on the dev machine's OS (Windows for this repo's primary contributor).
- Idempotency assertion in test 2 is critical — second sync run produces zero file writes and identical state.json bytes.

**Dependencies.** Chunks 7 (full CLI surface), 8 (SYNC.md not invoked from tests but documented as the operator-facing layer), 9 (ADAPT.md Phase 6 documents the flow exercised by test 1).

**Verification commands.**

```bash
npm run lint
npm run typecheck
npx tsc --noEmit --allowJs --checkJs setup/portable/sync.js
npx tsx setup/portable/tests/helpers.test.ts
npx tsx setup/portable/tests/walk-classify.test.ts
npx tsx setup/portable/tests/substitute-write.test.ts
npx tsx setup/portable/tests/settings-merge.test.ts
npx tsx setup/portable/tests/flags.test.ts
npx tsx setup/portable/tests/e2e-adopt.test.ts   # new
npx tsx setup/portable/tests/e2e-sync.test.ts    # new
npx tsx setup/portable/tests/e2e-merge.test.ts   # new
```

---

## 5. Risks & Mitigations

These supplement spec §9 (which covers the customer-facing risks of the framework distribution model itself). The risks below are specific to *building the sync engine in Phase A* — implementation traps, partial-state hazards, false-positive triggers, etc.

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | **Partial-write atomicity broken on Windows.** `fs.rename` over an existing file is technically allowed on Windows since Node 14 but historical behaviour was different; if a rare interaction with antivirus or file-locking blocks the rename, state.json could end up missing or stale-while-tmp-lingers. | Low | High (state corruption is high blast radius) | (a) Use `fs.rename` (not `fs.copyFile`+`unlink`). (b) On rename failure, retry once after a 100ms backoff before giving up. (c) Chunk 7 Verification command exercises the simulated mid-rename crash on the dev machine. (d) Defensive cleanup of stale `.tmp` at sync start (Chunk 7 error handling section). |
| R2 | **Stale state file detection misclassifies clean files as customised.** If sync.js or its normalisation function changes between framework versions (e.g. a new normalisation rule is added in v2.3.0), files synced under v2.2.0 will hash differently under v2.3.0 even though the content is byte-identical. Every file is then flagged customised on the first v2.3.0 sync. | Medium | Medium (operator noise, false manual-merge prompts) | (a) Treat normalisation as a stable contract — the normalisation rules in spec §9 (BOM, LF, trailing whitespace, trailing blank lines) are frozen. Adding a new rule requires a major version bump and a state.json migration. (b) Document this constraint in `setup/portable/sync.js` JSDoc on `normaliseContent`. (c) Future Chunk (Phase D) — add a `normaliseSchemaVersion` field to state.json so a normalisation change can be detected and migrated cleanly. Out of scope for Phase A; tracked in Deferred Items below. |
| R3 | **settings.json malformed in target.** Project's existing settings.json has a typo, comment, or invalid JSON. Sync's parse fails. | Low (operators rarely hand-edit settings.json) | Medium (sync fails per file, walk continues, operator must fix) | (a) Per Chunk 6, log error and emit `status=skipped extra={error=settings_malformed}`. (b) Suggest the operator runs `node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json", "utf8"))'` from the failure message. (c) `--doctor` lists settings.json in the "needs attention" list. |
| R4 | **Customisation false positives from line-ending drift.** Submodule cloned on Windows with `core.autocrlf=true` rewrites LF→CRLF on checkout; sync hashes after normalisation match anyway, but if normalisation is bypassed somewhere (e.g. a `lastAppliedHash` was computed before normalisation in an earlier sync version), every file flags customised. | Medium | High (operator paralysis on first cross-platform sync) | (a) `lastAppliedHash` is ALWAYS hash-of-normalised-content, never hash-of-raw. Enforced by funneling all hash compute through `hashContent(normaliseContent(raw))`. Asserted in Chunk 3 unit tests. (b) Framework repo's `.gitattributes` enforces `*.md text eol=lf` per spec §9 risk row. (c) Cross-platform line-ending test inside `e2e-sync.test.ts` (Chunk 10). |
| R5 | **Substitution engine on partial-rendered files.** A target repo's framework-managed file has been partially edited by the operator: some `{{PLACEHOLDER}}` patterns left in (e.g. operator added a new agent file from another source). Sync re-applies substitutions and rewrites those literal strings into substituted values, possibly destroying intended literal content. | Low | Medium | (a) Substitution scope is limited to manifest entries with `substituteAt: "adoption"` — files marked `"never"` are written verbatim. (b) For `"adoption"` files, the substitution is applied to *every* sync write; this is the documented behaviour, not a bug. Operators wanting literal `{{X}}` content in those files should either escape (current spec doesn't define an escape syntax — flagged in Deferred Items below) or move that content to a `"never"` file. (c) Pre-flight `validateSubstitutions` ensures no accidental recursive substitution. |
| R6 | **Substitution map drift between sync runs.** Operator edits `state.substitutions` directly (e.g. to fix a typo in COMPANY_NAME). Sync re-applies the new value to all files it would otherwise update — but doesn't re-apply to files that are clean *and already on the current version*. Result: half the files use the new value, half the old. | Low | Medium (silent inconsistency) | **Now an enforced invariant in Phase A** (per §1.11). State.json carries `lastSubstitutionHash`; sync compares it to `hashSubstitutions(state.substitutions)` at every run; mismatch refuses with a clear error pointing the operator at `--adopt` for rebaseline. `--force` is the deliberate escape hatch for advanced operators. `--doctor` lists the drift state for diagnosis. SYNC.md (Chunk 8) documents the rebaseline procedure. The forward-migration path covers pre-2.2.0 state.json files (skip check on first 2.2.0 run, persist hash, drift detection active from second run). |
| R7 | **Glob expander semantic gap.** The in-house ~30-line glob expander supports `*` and `{a,b,c}` but not `**`. If a future manifest entry needs nested-directory matching, sync silently no-matches. | Low (current manifest has no `**`) | Medium (silent miss is hard to detect) | (a) Chunk 3 test: `expandGlob('foo/**/*.md', root)` throws explicitly with "** not supported in v1; use multiple manifest entries instead." (b) If a future manifest needs `**`, that's a sync.js feature change — extend the glob expander rather than silently downgrading. |
| R8 | **CHANGELOG excerpt parsing fragile.** Spec §4.5 step 9 says sync prints CHANGELOG entries "between old and new versions." If the CHANGELOG is hand-edited and breaks the `## <version>` header format, the parser misses entries. Spec says "warn, continue" — but operator may miss critical Breaking notes. | Low (CHANGELOG is structured) | High (missed Breaking note → operator skips a migration) | (a) Parser is forgiving: any line matching `^## (\d+\.\d+\.\d+)` is a version anchor; everything between two anchors is one version's entry. (b) On parse failure, print `WARN: Could not read CHANGELOG for v<old>→v<new>. Consult .claude-framework/CHANGELOG.md manually.` and exit 0 (per spec §4.5 step 9). (c) Operator can re-read CHANGELOG manually — sync.js doesn't gate on it. |
| R9 | **`.framework-new` collision.** Operator partially merged a previous `.framework-new`, then a second framework upgrade arrives without re-running sync. The new sync would overwrite the in-progress merge. | Medium (forgotten merges happen) | High (operator's in-progress work vanishes) | (a) Per spec §4.5 step 0: startup check scans for any `.framework-new` and exits 1 unless `--force`. (b) Per Chunk 5: when overwriting an existing `.framework-new`, log `extra={prior_framework_new=replaced}` so the operator sees a paper trail. (c) `--doctor` reports unresolved `.framework-new` files. |
| R10 | **Test fixtures drift from production manifest.** Synthetic e2e tests (Chunk 10) use small fixture manifests. If real manifest evolves and fixture doesn't, tests pass while real-world sync breaks. | Medium | Medium | (a) `e2e-adopt.test.ts` includes one assertion against the real `setup/portable/manifest.json` (e.g. "every file in setup/portable/ is covered by at least one manifest entry"). This is a smoke test that breaks when real manifest drifts from the fixture's coverage shape. (b) Document in test file header that fixtures are intentional simplifications, not authoritative. |
| R11 | **Telemetry cascade from per-file logging.** Each managed file emits one `SYNC file=… status=…` line. With 60+ files, a single sync produces 60+ stdout lines plus the report. If parsed by an upstream automation that's not built for that volume, could overwhelm logs. | Very Low | Very Low (this is sync output to a human terminal in v1; no upstream parser yet) | (a) Per-file lines go to stdout; warnings/errors go to stderr — separation lets a parser filter. (b) `--check`/`--doctor` flags suppress per-file lines (only the summary is printed in those modes). |
| R12 | **Load-bearing assumption: state.json substitutions are the single source of truth.** If a future workflow ever lets sync derive substitutions from elsewhere (e.g. env vars, another config), the source-of-truth precedence becomes ambiguous. | Low (Phase A has no such workflow) | Medium | (a) Spec §4.4 declares state.json as the only substitution source. (b) Reject command-line substitution overrides in Phase A — `sync.js --set PROJECT_NAME=Acme` is not implemented. (c) Tracked in Deferred Items: if env-var fallback ever needed, must declare precedence in spec amendment. |
| R13 | **Pre-existing `setup/portable/` contains files not declared in manifest.** A file present in `setup/portable/` but missing from manifest entries would be silently orphaned (sync never touches it). | Low (Chunk 2 test asserts coverage) | Low | (a) Chunk 2 verification: every file in `setup/portable/` must be covered by at least one manifest entry (or excluded by being a build artefact like `manifest.json`/`sync.js`/`SYNC.md`/`tests/**`). (b) `scripts/build-portable-framework.ts` preflight check could be extended in a future chunk to validate manifest coverage. Out of scope for Phase A. |
| R14 | **JSDoc type checking diverges from runtime behaviour.** JSDoc-typed JavaScript validated by `tsc --noEmit --allowJs --checkJs` covers most type errors but is weaker than full TypeScript (e.g. can miss generic constraints, exhaustiveness checks on discriminated unions). | Medium | Low–Medium | (a) Use `@typedef` and `@type` annotations rigorously, especially for the `FileOpStatus` enum and the `Classification` discriminated union. (b) Chunk 3's `helpers.test.ts` includes coverage of every classification branch and every status code, enforcing exhaustiveness at runtime. (c) If JSDoc proves too thin, escalate to a `setup/portable/sync.types.ts` file (TypeScript declaration file alongside the JS module) — this is an additive change. |

### Deferred items (explicitly out of scope for Phase A; flagged here to prevent rediscovery)

- **Three-way merge in sync.js.** Phase A surfaces customisations via `.framework-new`; merge automation is deferred to a future version when `lastAppliedFrameworkCommit` (already recorded in state.json schema) can be used to fetch the prior framework base from git history. See spec §7.
- **Normalisation-schema versioning.** R2 mitigation. State.json should grow a `normaliseSchemaVersion` field in a future major version so changes to `normaliseContent` can be migrated.
- **Glob expander `**` support.** R7 — only if a future manifest needs nested-directory matching.
- **Escape syntax for literal `{{PLACEHOLDER}}` content.** R5 — current workaround is to put the file in a `"never"`-substitution slot.
- **`--set KEY=VALUE` command-line substitution overrides.** R12 — explicitly not implemented in Phase A; would require a spec amendment defining precedence.
- **Spec amendment: TypeScript → JavaScript-with-JSDoc.** §1.1 — one-line edit to spec §4.5; not part of any chunk in this plan.
- **Manifest coverage preflight in `scripts/build-portable-framework.ts`.** R13 — Chunk 2's verification covers it once at Phase A merge; ongoing protection requires a small zip-build script extension, deferred.
- **`removedHooks` analogue to `removedFiles`.** Phase A keeps orphaned framework hooks in target settings.json with a warn (Chunk 6 rule 7). Phase B+ could ship a `manifest.removedHooks` array driving structured opt-in removal.
- **Phase B and Phase C** — entire scope of "lift to standalone repo" and "Automation OS self-adoption" is deferred per the handoff. Phase A merge is the gate.

---

## 6. Contracts reference (canonical TypeScript shapes)

These are the single-source-of-truth shapes used across all chunks. Sync.js implements them as JSDoc `@typedef`; tests reference them from a shared types include. If a chunk needs a shape change, update it here in this plan first, then in implementation.

### 6.1 Manifest

```typescript
type ManifestMode = 'sync' | 'adopt-only' | 'settings-merge';
type ManifestSubstituteAt = 'never' | 'adoption';
type ManifestCategory =
  | 'agent' | 'hook' | 'settings' | 'version' | 'changelog'
  | 'adr' | 'context-pack' | 'reference' | 'template';

interface ManifestEntry {
  path: string;              // glob pattern (forward-slash, framework-root-relative)
  category: ManifestCategory;
  mode: ManifestMode;
  substituteAt: ManifestSubstituteAt;
}

interface RemovedFile {
  path: string;
  removedIn: string;         // semver
  action: 'warn-only';       // closed enum in v1
}

interface Manifest {
  frameworkVersion: string;  // semver, matches .claude/FRAMEWORK_VERSION at the time this manifest was authored
  managedFiles: ManifestEntry[];
  removedFiles: RemovedFile[];
  doNotTouch: string[];      // path patterns sync NEVER touches; cosmetic — purely informational, sync's actual behaviour is "only touch files in managedFiles"
}
```

**Producer:** Chunk 2 authors `setup/portable/manifest.json`.
**Consumer:** Chunks 3-7 (sync.js loads + validates).
**Source of truth:** `setup/portable/manifest.json` is the canonical artefact; this TypeScript shape is its schema.

### 6.2 FrameworkState (state.json)

```typescript
type Substitutions = Record<string, string>;  // values are flat strings, no value contains "{{"

interface FileStateEntry {
  lastAppliedHash: string;                   // sha256 hex of normaliseContent(substituted-content)
  lastAppliedFrameworkVersion: string;       // semver — the version this file was last cleanly synced to
  lastAppliedFrameworkCommit: string | null; // git commit SHA at sync time; null in synthetic-test mode
  lastAppliedSourcePath: string;             // framework-relative source path (forward-slash); supports rename detection
  customisedLocally: boolean;                // INFORMATIONAL only; set automatically by sync; not an operator control
  adoptedOwnership?: boolean;                // optional; true after a mode change from sync→adopt-only handoff
}

interface FrameworkState {
  frameworkVersion: string;                 // semver — the framework version of the LAST successful sync
  adoptedAt: string;                        // ISO-8601 UTC
  adoptedFromCommit: string | null;         // commit SHA at adoption time
  profile: 'MINIMAL' | 'STANDARD' | 'FULL'; // adoption profile
  substitutions: Substitutions;
  lastSubstitutionHash?: string;            // sha256 hex of canonicalised substitutions; absent on pre-2.2.0 state.json (forward-migrated on first 2.2.0 sync); see §1.11
  files: Record<string, FileStateEntry>;    // key = target-relative path, forward-slash
  syncIgnore: string[];                     // target-relative paths sync skips entirely; the sole opt-out
}
```

**Producer:** Sync.js writes via `writeStateAtomic` (Chunk 3 helper). Initially populated by `--adopt` (Chunk 7) or by ADAPT.md Phase 6 (Chunk 9).
**Consumer:** Sync.js reads via `readState` (Chunk 3 helper) at every sync invocation.
**Source-of-truth precedence:** `FrameworkState.files[path].lastAppliedHash` is the single source of truth for "what does sync think the clean version is." Sync NEVER reconstructs from the framework submodule (which has already moved on). If state is missing or unreadable, sync exits 1 unless `--adopt` is set. `state.lastSubstitutionHash` is the single source of truth for "are the substitutions still the ones that produced the current `lastAppliedHash` set" — drift between this hash and `hashSubstitutions(state.substitutions)` blocks sync (see §1.11).
**Persistence contract:** state.json is written via `<file>.tmp` + `rename` for atomicity. Mid-write crash leaves the prior state.json intact.
**Spec amendment note (per §1.1 pattern).** The `lastSubstitutionHash?: string` field is additive — present in v2.2.0+ state.json files, absent in pre-2.2.0. Spec §4.4's FrameworkState shape should be amended in a future spec edit to include this field. Not a behavioural break (forward migration is built in); flagged for the same future spec-amendment commit as the TS→JS-with-JSDoc clarification.

### 6.3 Classification (sync internal)

```typescript
type FileOpStatus =
  | 'skipped' | 'new' | 'customised' | 'updated'
  | 'removed-warn' | 'ownership-transferred';

type Classification =
  | { kind: 'skipped'; reason: 'syncIgnore' | 'adopt-only' | 'already-on-version' }
  | { kind: 'ownership-transferred' }
  | { kind: 'clean'; needsUpdate: boolean }
  | { kind: 'customised' }
  | { kind: 'new-file-no-state'; targetExists: boolean }
  | { kind: 'settings-merge' };

interface SyncContext {
  targetRoot: string;       // absolute, OS-native separators
  frameworkRoot: string;    // absolute
  manifest: Manifest;
  state: FrameworkState;
  frameworkVersion: string; // = readFrameworkVersion(frameworkRoot)
  frameworkCommit: string | null;
  flags: SyncFlags;
}

interface SyncFlags {
  adopt: boolean;
  dryRun: boolean;
  check: boolean;
  strict: boolean;
  doctor: boolean;
  force: boolean;
}
```

**Producer:** Chunks 3-4 (classifier).
**Consumer:** Chunk 4 walk loop + Chunks 5/6 writers.
**Note:** `Classification` is a closed discriminated union; adding a kind requires updating all writers' switch statements.

### 6.4 Settings (`.claude/settings.json`)

```typescript
type EventName = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'SessionStart' | string;

interface SettingsHookEntry {
  type: 'command';
  command: string;          // shell string; first whitespace token determines framework vs project ownership
}

interface SettingsHookGroup {
  matcher?: string;         // tool name pattern; absent for non-tool events like SessionStart
  hooks: SettingsHookEntry[];
}

interface Settings {
  hooks?: Record<EventName, SettingsHookGroup[]>;
  // any other top-level keys (permissions, env, etc.) are passed through verbatim
  [k: string]: unknown;
}
```

**Producer:** Sync.js mergeSettings (Chunk 6).
**Consumer:** Claude Code at runtime (target repo); also sync.js when re-reading on subsequent runs.
**Source-of-truth precedence:** the file at `.claude/settings.json` IS the source of truth at runtime. Sync.js's mergeSettings is responsible for keeping the framework-owned hook entries (those whose `command` first token resolves to `.claude/hooks/*`) up to date with the framework's own settings.json template; the project-owned entries pass through unchanged.

### 6.5 sync.js public CLI surface

```
Usage:
  node sync.js                  # full sync
  node sync.js --adopt          # first-run mode; allows missing state.json
  node sync.js --dry-run        # classify only; no writes
  node sync.js --check          # exit 0 if up-to-date; exit 1 if updates pending
  node sync.js --strict         # as --check + exit 1 if any customisations
  node sync.js --doctor         # diagnose state.json health; no writes
  node sync.js --force          # skip startup .framework-new check

Flags can be combined where semantically compatible (e.g. --adopt --dry-run).
Unrecognised flags exit 1 with usage message.
```

**Stdout:** one `SYNC file=… status=…` line per managed file (suppressed in `--check`/`--doctor`); end-of-run summary (`N updated, M new, P customised, K removal warnings`).
**Stderr:** `WARN:` and `ERROR:` lines.
**Exit codes:** 0 = success / up-to-date; 1 = error or updates available (depends on flag); never 2+ in v1.

---

## End of plan

This plan covers Phase A only. Phases B and C are out of scope and deferred per the handoff. After Phase A merges, the operator (or a successor plan) can:

1. Create `claude-code-framework` GitHub repo and lift `setup/portable/` → repo root.
2. Tag `v2.2.0` in the new repo.
3. Open Phase C as a new spec/plan covering Automation OS's self-adoption.

The Phase A artefacts produced by this plan (manifest.json, sync.js, SYNC.md, ADAPT.md Phase 6, tests) move verbatim into the new repo with no further changes — they are designed for that lift.

