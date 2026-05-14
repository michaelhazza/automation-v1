# Plan — Audit Prevention Gates (2026-05-14)

| Field | Value |
|---|---|
| Slug | `audit-prevention-gates-2026-05-14` |
| Class | Major |
| Source spec | `tasks/builds/audit-prevention-gates-2026-05-14/spec.md` (frozen post-pass-1) |
| Source audit | `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md` |
| Target branch | `feat/audit-prevention-gates-2026-05-14` |
| Authorship date | 2026-05-14 |

---

## Table of contents

1. Brief
2. Model-collapse check
3. Architecture notes
4. Chunk table
5. Chunk 1 — Shared infrastructure
6. Chunk 2 — Sync gates (P7, P13, P14)
7. Chunk 3 — Static-grep gates (P4, P5, P6, P9, P10)
8. Chunk 4 — Tool-baselined gates (P11, P12, P16) + dev-deps
9. Chunk 5 — AST gates (P2 tighten + companion, P15)
10. Chunk 6 — Remaining gates (P1, P3, P8)
11. Chunk 7 — Documentation rules (P17–P20)
12. Chunk 8 — KNOWLEDGE entries (P21–P23)
13. Chunk 9 — ADR P24
14. Chunk 10 — Doc-sync registration + test-gate policy update (no `tasks/todo.md` touches)
15. Chunk 11 — Wiring (`run-all-gates.sh` registration)
16. Chunk 12 — `tasks/todo.md` close-out (lands LAST, after wiring)
17. Open questions deferred to executor
18. Executor notes
19. Self-consistency notes
20. Plan-review revision history

---

## Brief

Land 16 new/tightened CI gates plus the shared baseline + suppression infrastructure that all gates share, then land 4 documentation rules, 3 KNOWLEDGE patterns, and 1 ADR. The build implements the 24 prevention proposals from the 2026-05-14 pre-v1 lockdown audit as a single sequenced merge, closing the `[origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z]` items in `tasks/todo.md`. Source: `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`.

---

## Model-collapse check

Rejected. This is CI infrastructure: shell scripts, baseline text files, AST grep against TypeScript source, regex-and-annotate gates, plus doc edits. There is no multimodal input that a frontier model could collapse into one call. The 16 gates are independently triggered by `scripts/run-all-gates.sh` in CI; collapsing them into a single LLM-classified "is this PR clean?" call would (a) destroy determinism, (b) make per-gate suppression annotations meaningless, (c) reintroduce the exact silent-pass-through failure mode that motivated the gates. Keep as deterministic shell + AST.

---

## Architecture notes

Key reuse / extension decisions:

- **`scripts/lib/guard-utils.sh` is the canonical home for shared primitives.** Spec §3 calls for `check_expiring_baseline` and `format_suppression`; both extend the existing utility rather than introducing a new file. Existing `is_suppressed`, `emit_violation`, `emit_header`, `emit_summary`, `check_baseline` already support T1 + legacy + next-line shapes — the plan tightens validation, it does not replace the helpers.
- **Existing `verify-no-silent-failures.sh` collides with spec P4 (`verify-no-silent-catch.sh`).** P4 is reframed as a tightening of the existing gate (extend scope and formalise suppression error message) rather than a duplicate script. Surfaced in Open questions §1.
- **`scripts/.gate-baselines/` directory does not yet exist.** Spec §3 introduces it as the canonical per-gate baseline file location, distinct from the legacy single-file `scripts/guard-baselines.json` that `check_baseline` reads. Chunk 1 creates the directory and a new helper `check_expiring_baseline` that consumes the per-gate `.txt` files alongside the existing JSON baseline (both formats coexist during transition).
- **Tool dependencies (`depcheck`, `madge`, `jscpd`, `knip`) are not yet in `package.json`.** `ts-morph ~28.0.0` IS already installed (line 87). Tool-baselined chunks add their deps to `devDependencies` in the same chunk that authors the gate.
- **Convention pin:** new gates live at `scripts/verify-<id>.sh` (matches the dominant pattern in the existing tree). Do not nest under `scripts/gates/` — that sub-tree exists for older non-conforming scripts and is being held flat per `run-all-gates.sh`.
- **Warning-first rollout.** Every new gate ships with `default_exit_code=2` (warning) per the existing `check_baseline` convention. Chunk 11 (final wiring) keeps them as warnings; operator-initiated promotion to error (exit 1) is a follow-up PR per the recommendation in Open questions §5. Standard language across all per-gate descriptions: drift / violation paths read "emit violation and exit 2 during warning-first rollout; promote to exit 1 later." Sync gates (P7, P13, P14) follow the same posture — "fail" in their scope text means "emit violation + warning exit," not "hard fail from day one."
- **Local gate execution policy (resolves apparent contradiction in earlier drafts).** Newly authored or modified `scripts/verify-*.sh` gates MAY be smoke-run *individually* by the chunk author to confirm exit-code wiring and baseline seeding — e.g. `bash scripts/verify-canonical-retry.sh` against the current tree. This is the ONLY exception. Full gate orchestrators remain CI-only and MUST NOT be run locally: `scripts/run-all-gates.sh`, `scripts/run-all-qa-tests.sh`, `scripts/run-all-unit-tests.sh`, `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, the umbrella `npm test`. Per-chunk verification commands in this plan never include orchestrators; the per-script smoke run is a definition-of-done check inside the chunk author's local loop, not a verification command. CI runs the full suite on PR open.

Patterns applied (and only where needed):
- **Single responsibility** — one gate per concern; one script per gate.
- **Composition** — every gate sources `guard-utils.sh` and uses its primitives. No new shared lib file beyond the pure-logic `*.mjs` companions that exist solely to make logic Vitest-testable.
- **No new pattern** for docs/KNOWLEDGE/ADR chunks — they are direct edits with prescribed prose.

---

## Chunk table

| # | Chunk | Class | Files (est.) | Depends on | Vitest target |
|---|---|---|---|---|---|
| 1 | Shared infrastructure: extend `guard-utils.sh`, create baseline dir, document grammar | Significant | 4 | — | Yes — `parseBaselineFile` / `isExpired` / `isPastGracePeriod` date math |
| 2 | Sync gates: P7 universal-skill, P13 framework-context, P14 types-used | Significant | 6 + 3 tests | 1 | Yes — three pure JSON/AST diff helpers |
| 3 | Static-grep gates batch: P4 (tighten existing), P5, P6, P9, P10 | Significant | 10 + 1 test | 1 | Yes — `per-file-counter-pure` covers all five |
| 4 | Tool-baselined gates: P11 madge, P12 jscpd, P16 knip — including dev-dep adds | Significant | 8 | 1, **3** (reuses `per-file-counter-pure.mjs` for count-diff) | N/A — gates are tool wrappers; count-diff is covered by chunk 3's `per-file-counter-pure` Vitest |
| 5 | AST gates: P2 tighten + companion `verify-with-org-tx-or-scoped-db.sh`, P15 orphan React component | Significant | 6 + 2 tests | 1 | Yes — `ts-morph` analyser pure helpers for both gates |
| 6 | Remaining gates: P1 missing-deps (depcheck), P3 loc-cap, P8 frontend-design-budget | Significant | 8 + 2 tests | 1 | Yes — LoC counter + allow-list lookup helpers (P1 has no pure helper — tool wrapper) |
| 7 | Docs P17–P20: architecture.md / CLAUDE.md / capabilities.md | Standard | 3 | — (independent) |  No |
| 8 | KNOWLEDGE entries P21–P23 (append-only) | Trivial | 1 | — (independent) | No |
| 9 | ADR P24: service-layer extraction for routes touching `db/schema/` | Trivial | 2 | — (independent) | No |
| 10 | Doc-sync registration (no `tasks/todo.md` touches) + `references/test-gate-policy.md` baseline-expiry policy note | Trivial | 3 | 1–9 | No |
| 11 | Wiring: `run-all-gates.sh` registration | Trivial | 1 | 1–6, 10 | No |
| 12 | `tasks/todo.md` close-out (mark P1–P24 `[x]` with PR reference) + deferred-items append (warning→error follow-up) | Trivial | 1 | 11 | No |

Total: 12 chunks. Spec §12 proposed 10 batches; the plan splits the spec's batch 10 ("wiring") into three: chunk 10 = doc-sync only (lands after doc chunks 7-9), chunk 11 = gate wiring (lands after every gate chunk), chunk 12 = todo close-out (lands LAST so P1-P16 are not marked closed until the gates are actually CI-active per chunk 11's wiring step). Earlier draft conflated chunks 10 + 12; reviewer correctly flagged the close-out-before-wiring ordering bug.

The spec's chunks 2-5 (batches A-E) are regrouped into chunks 3, 4, 5, 6 below to keep AST work (chunk 5) and tool-baselined work (chunk 4) cleanly separated — they have different dependency surfaces (`ts-morph` vs npm devDeps) and different verification shapes.

---

## Chunk 1 — Shared infrastructure (baseline directory, suppression grammar, helpers)

### Scope

Lock down the shared primitives every Tier-1 gate depends on, so subsequent chunks plug in cleanly:

- Create `scripts/.gate-baselines/` directory (with a `.gitkeep` placeholder).
- Extend `scripts/lib/guard-utils.sh` with two new functions: `check_expiring_baseline <guard_id> <current_violations>` (consumes per-gate `.txt` baseline files with `# expires: YYYY-MM-DD` directives) and `format_suppression <guard_id>` (emits the canonical suppression-comment template for use in error messages).
- Document the suppression-annotation grammar (legacy, T1 token, next-line, file-scoped forms) in a new header comment block at the top of `guard-utils.sh`. Reference from every new gate's error message.
- Author a baseline-template file `scripts/.gate-baselines/_TEMPLATE.txt` showing the on-disk format with an explanatory header.
- Pure-logic helpers split into a `*.mjs` companion module the Vitest harness can import: `scripts/lib/gate-baseline-helpers.mjs` — `parseBaselineFile(text)`, `isExpired(expiryDate, today)`, `isPastGracePeriod(expiryDate, today, graceDays)`.

Note on coexistence with legacy `scripts/guard-baselines.json`: the existing single-file baseline (used by `check_baseline`) is preserved as-is. The new `check_expiring_baseline` reads per-gate `.txt` files under `scripts/.gate-baselines/<guard-id>.txt`. Both helpers can be called from a single gate; new gates use the new helper, existing gates continue to use `check_baseline`. Migration of existing gates is out of scope for this build.

### Files

- `scripts/lib/guard-utils.sh` — extend
- `scripts/lib/gate-baseline-helpers.mjs` — new (pure-logic helpers extracted for testability)
- `scripts/.gate-baselines/.gitkeep` — new
- `scripts/.gate-baselines/_TEMPLATE.txt` — new (documentation-only baseline template)
- `scripts/__tests__/gate-baseline-helpers.test.ts` — new (Vitest)

### Module shape

- *Public interface this chunk exposes:* `check_expiring_baseline`, `format_suppression` (bash functions sourced by every new gate); `parseBaselineFile`, `isExpired`, `isPastGracePeriod` (JS pure functions importable from Vitest).
- *What stays hidden behind it:* date arithmetic, regex parsing of `# expires:` directives, grace-period state machine (warning → error after `30` days, configurable via `GATE_GRACE_DAYS` env), and the file-format error reporting for malformed baselines.

### Verification commands

```
npm run lint
npm run typecheck
npx vitest run scripts/__tests__/gate-baseline-helpers.test.ts
```

### Definition of done

- `guard-utils.sh` exports `check_expiring_baseline` and `format_suppression`; both visible via `declare -F` when the file is sourced.
- `scripts/.gate-baselines/` exists with `.gitkeep` and `_TEMPLATE.txt`.
- Test file authored, runs in isolation, and asserts: (a) baseline with no expiry → parsed as never-expiring; (b) baseline expired today → warning; (c) baseline expired 31 days ago with `GATE_GRACE_DAYS=30` → error; (d) malformed baseline line → parser returns explicit error result, not silent skip.
- `format_suppression no-db-in-routes` prints the canonical T1 template, the legacy template, and the next-line template separated by newlines (verifiable by `format_suppression no-db-in-routes | wc -l == 3`).
- Suppression grammar header in `guard-utils.sh` lists all four forms (T0 deprecated, T1 preferred, legacy with `reason="..."`, next-line, file-scoped) and an example for each.

### Risks

- Existing `is_suppressed` already accepts T1 + legacy + next-line shapes; the new helpers must not regress those callers. Mitigation: do not touch `is_suppressed`'s body in chunk 1 — only extend the file with new functions.
- Bash date math is unreliable across `date` versions (BSD vs GNU). Mitigation: do all date math in `gate-baseline-helpers.mjs` (Node), call it from bash via `node -e` or a small wrapper. The pure-logic Node module is the source of truth.

---

## Chunk 2 — Sync gates: P7 universal-skill, P13 framework-context, P14 types-used

### Scope

Three "must stay in sync" gates that compare two parts of the codebase and emit violations on drift. All three are deterministic JSON/TS reads, no AST.

**Posture (all three gates, per Architecture-notes "Warning-first rollout"):** on drift detection, emit violation and exit 2 (warning) during the warning-first rollout window. Operator promotes to exit 1 (error) per gate after the one-week soak (Open questions §5). "Must stay in sync" / "no suppression" semantics below refer to the absence of a per-finding `guard-ignore` escape hatch — NOT to immediate hard-fail behaviour. (T4 fix from plan review: earlier draft conflated "no suppression" with "hard fail from day one"; the two are independent.)

- **P7 `verify-universal-skill-sync.sh`** — read `server/config/universalSkills.ts` `UNIVERSAL_SKILL_NAMES` array; read `server/config/actionRegistry.ts` ACTION_REGISTRY entries with `isUniversal: true`; assert bidirectional set equality. No per-finding suppression — the design intent is that these two declarations must mirror each other; if they drift, fix the source, do not suppress.
- **P13 `verify-framework-context-block.sh`** — parse `docs/codebase-audit-framework.md` §2 (the AutomationOS context block table) for declared versions; cross-reference against `package.json` declared versions for the facts that have a `package.json` source of truth (TypeScript, Express, React, Vite, Drizzle, postgres, pg-boss, Socket.io, Zod, Playwright, MCP SDK, Langfuse, Vitest). Emit violation on any mismatch. No per-finding suppression — fix the source.
- **P14 `verify-types-used.sh`** — walk `shared/types/*.ts`; for each exported type/interface/const, check if (a) it appears in a discriminated union (referenced as `| ThisType` or `type Union = A | B`) OR (b) it is imported from any production-code file under `server/`, `client/`, or `worker/`. Allow per-export `guard-ignore: types-used reason="..."` (this is the one gate of the three that has a per-export escape hatch, because dead-but-intentional exports for downstream consumers are a known false-positive class).

### Files

- `scripts/verify-universal-skill-sync.sh` — new
- `scripts/verify-framework-context-block.sh` — new
- `scripts/verify-types-used.sh` — new
- `scripts/lib/universal-skill-sync-pure.mjs` — new (loaders + set-diff)
- `scripts/lib/framework-context-pure.mjs` — new (table parser + version comparator)
- `scripts/lib/types-used-pure.mjs` — new (export collector + reference scanner)
- `scripts/.gate-baselines/universal-skill-sync.txt` — new (empty, with `# expires: 2026-08-14` placeholder if any pre-existing drift)
- `scripts/.gate-baselines/framework-context-block.txt` — new (likely empty; §2 was authored alongside this audit)
- `scripts/.gate-baselines/types-used.txt` — new (baseline of currently unreferenced exports)
- `scripts/__tests__/universal-skill-sync-pure.test.ts` — new (Vitest)
- `scripts/__tests__/framework-context-pure.test.ts` — new (Vitest)
- `scripts/__tests__/types-used-pure.test.ts` — new (Vitest)

### Module shape

- *Public interface:* three gate scripts, each a thin bash wrapper that delegates to its `*-pure.mjs` companion via `node -e`. Public JS exports: `loadUniversalSkillNames(repoRoot) → string[]`, `loadActionRegistrySnapshot(repoRoot) → { name, isUniversal }[]`, `diffUniversalSkills({ names, registry }) → { onlyInNames, onlyInRegistry }`. For P13: `parseFrameworkContextBlock(md) → { fact, declaredVersion }[]`, `extractPackageJsonVersions(pkg) → Record<fact, version>`, `compareVersions(declared, actual) → match|drift`. For P14: `collectExportedTypes(repoRoot) → { file, name, line }[]`, `scanReferences(repoRoot, name) → boolean`.
- *What stays hidden:* the JSON/TS parsing details, the markdown-table column-walking, the file-glob enumeration, the suppression-comment matching.

### Verification commands

```
npm run lint
npm run typecheck
npx vitest run scripts/__tests__/universal-skill-sync-pure.test.ts scripts/__tests__/framework-context-pure.test.ts scripts/__tests__/types-used-pure.test.ts
```

### Definition of done

- Three new `scripts/verify-*.sh` files exist with executable bit set, source `guard-utils.sh`, and emit `[GATE] <guard-id>: violations=<n>` on the final line.
- Each test file asserts: (a) clean fixture → empty diff; (b) intentional drift fixture → exactly the seeded violations; (c) malformed input → explicit error, no silent pass.
- Each baseline file exists. If non-empty at landing, each entry carries a `# expires: 2026-08-14` directive (90-day grace from build merge date).
- Spec §13 open question 4 (`migrations/*.sql` exclusion for LoC) is unrelated here — P14 deliberately does NOT walk `migrations/`.

### Risks

- **P13 drift between context-block prose and table rows.** Mitigation: the parser keys on the `| <fact> | <value> |` table row format. Prose changes do not break the gate; only table-cell edits do.
- **P14 false positives on dead-but-intentional types** (e.g. types exported for downstream library consumers). Mitigation: the per-export `guard-ignore: types-used` suppression accepts a reason string; baseline file captures the current set of dead exports.

---

## Chunk 3 — Static-grep gates batch (P4 tighten, P5, P6, P9, P10)

### Scope

Five small grep-based gates that all share the same shape: grep for a forbidden pattern, filter by suppression annotation, count per-file, compare to per-file baseline.

- **P4 `verify-no-silent-failures.sh` (TIGHTEN existing)** — extend the existing gate per spec §4: (a) ensure scope includes `client/src/` not just `server/` (currently `server/`-only); (b) ensure error messages reference `format_suppression no-silent-failures` output; (c) carry over to use `check_expiring_baseline` for the new per-file baseline file `scripts/.gate-baselines/no-silent-failures.txt`. Existing `is_suppressed` logic unchanged.
- **P5 `verify-canonical-retry.sh`** — grep for `retryCount`-style loops outside `server/lib/withBackoff.ts`. Pattern: declarations matching `retryCount`, `retryAttempts`, `retries\s*=\s*\d+` in any `.ts` file under `server/`. Suppression: `guard-ignore: canonical-retry reason="..."` or T1 form.
- **P6 `verify-canonical-logger.sh`** — grep for `console\.(log|warn|error)` in `server/services/**` and `server/routes/**`. Production code only — exclude `__tests__/`, `scripts/`, anything matching `*.test.ts`. Suppression: `guard-ignore: canonical-logger reason="..."`. Use existing `verify-no-raw-console.sh` as reference; see Open questions §6 for collision check.
- **P9 `verify-any-budget.sh`** — count `: any` and `as any` per file across `server/`, `client/`, `shared/`. Per-file baseline: non-growing. New per-line suppression: `guard-ignore: type-strengthening reason="..."`.
- **P10 `verify-marker-budget.sh`** — count occurrences of `TODO`, `FIXME`, `HACK`, `TEMP`, `LEGACY`, `DEPRECATED` per file. Per-file baseline: non-growing. **Suppression: gate-time parsing of `git log -1 --pretty=%B` for a `Marker-Reason: <rationale>` trailer.** When the most recent commit body contains a `Marker-Reason:` line, the gate treats count growth as authorised and exits 2 (warning) instead of exit 1 (error). When the body lacks the trailer AND counts grew above baseline, the gate exits with the configured `default_exit_code` (2 during warning-first rollout per Architecture-notes "Warning-first rollout"; promotable to 1 later per Open questions §5). No PR-time hook, no lint-staged config — gate-time only. (T3 fix from plan review: spec / scope / DoD wording was inconsistent across the earlier draft; this is the locked contract.)

### Files

- `scripts/verify-no-silent-failures.sh` — modify (extend scope to client, swap to new baseline helper)
- `scripts/verify-canonical-retry.sh` — new
- `scripts/verify-canonical-logger.sh` — new
- `scripts/verify-any-budget.sh` — new
- `scripts/verify-marker-budget.sh` — new
- `scripts/lib/per-file-counter-pure.mjs` — new (shared "count regex hits per file, diff against baseline")
- `scripts/.gate-baselines/no-silent-failures.txt` — new (pre-populated from current scan, with `# expires:` on each entry)
- `scripts/.gate-baselines/canonical-retry.txt` — new
- `scripts/.gate-baselines/canonical-logger.txt` — new
- `scripts/.gate-baselines/any-budget.txt` — new (one line per file with current `: any`/`as any` count)
- `scripts/.gate-baselines/marker-budget.txt` — new (one line per file with current marker count)
- `scripts/__tests__/per-file-counter-pure.test.ts` — new (Vitest — covers the shared helper, which is the pure-logic surface for all five gates)

### Module shape

- *Public interface:* five `verify-*.sh` scripts (executable, idempotent, exit `0|1|2|3`). One pure-JS helper `countPerFile({ patterns, fileSet, suppressionPredicate }) → Record<file, count>` and `diffAgainstBaseline(currentCounts, baselineFile) → Violation[]`. Existing `is_suppressed` from `guard-utils.sh` is the predicate.
- *What stays hidden:* the per-gate file-set globs, the per-pattern regex tuning, the suppression-grammar matching (delegates to existing helper), the per-file aggregation logic.

### Verification commands

```
npm run lint
npm run typecheck
npx vitest run scripts/__tests__/per-file-counter-pure.test.ts
```

### Definition of done

- Five gate scripts exist with the conventional structure (`emit_header`, loop, `emit_summary`, `check_baseline`/`check_expiring_baseline` for exit code).
- `verify-no-silent-failures.sh` scope expanded to include `client/src/`. Run against current codebase produces a baseline file at `scripts/.gate-baselines/no-silent-failures.txt` with every current violation listed; each violation entry preceded by `# expires: 2026-08-14`.
- Vitest test covers: (a) zero violations → empty result; (b) baseline match → no diff; (c) one new violation above baseline → exactly that violation surfaced; (d) all-suppressed file → zero violations counted.
- P10's `Marker-Reason: <rationale>` commit-body trailer IS implemented in this chunk: `verify-marker-budget.sh` reads `git log -1 --pretty=%B`, greps for `^Marker-Reason: `, and downgrades count-growth violations to warning when the trailer is present. Tests cover: (a) no growth → exit 0; (b) growth without trailer → exit 1 (or 2 during warning-first rollout); (c) growth with trailer → exit 2 (warning, downgraded). (T3 fix from plan review: contract was inconsistent in earlier draft; this DoD locks it.)

### Risks

- P9 / P10 baselines are large (probably hundreds of files). Mitigation: the per-file diff is the right shape — only files that grow trip the gate; files that shrink are silently fine.
- P6 collides with the existing `scripts/verify-no-raw-console.sh`. Read that gate first; if scopes overlap (server/services + server/routes), P6 is functionally a duplicate. Surfaced in Open questions §6. Recommendation: if `verify-no-raw-console.sh` already covers these directories, drop P6 and update the spec todo to reference the existing gate.

---

## Chunk 4 — Tool-baselined gates (P11 madge, P12 jscpd, P16 knip) + devDependency adds

### Scope

Three gates wrap third-party static-analysis tools, baseline their JSON output, and fail on baseline regression.

- **Add devDependencies in `package.json`:** `madge` (cycle detection), `jscpd` (clone detection), `knip` (orphan/unused). Pin exact versions in the same commit.
- **P11 `verify-no-new-cycles.sh`** — `npx madge --circular --json server/ client/ shared/ worker/`. Compare cycle count against `scripts/.gate-baselines/circular-deps.txt`. New cycles fail; baseline reductions are silent.
- **P12 `verify-duplicate-blocks.sh`** — `npx jscpd --min-tokens 15 --reporters json server/ client/ shared/ worker/`. Compare clone count against `scripts/.gate-baselines/duplicate-blocks.txt`. Same regression semantics.
- **P16 `verify-knip-config.sh`** — assert `knip.json` exists at repo root and registers every dynamic entry surface: server entry (`server/index.ts`), client entry (`client/src/main.tsx`), worker entry (`worker/index.ts` or equivalent — executor confirms during impl), `.claude/hooks/*.js`, every `server/config/*.ts` registry, `scripts/__fixtures__/*`. No suppression. The gate parses `knip.json` and asserts the dynamic-entry list intersects each of those globs.
- **Author `knip.json`** in this chunk if it does not exist. Initial config: entry points + a dynamic-entry list seeded from the surfaces above.

### Files

- `package.json` — add `madge`, `jscpd`, `knip` to `devDependencies`. Update `package-lock.json` accordingly.
- `knip.json` — new (project root)
- `scripts/verify-no-new-cycles.sh` — new
- `scripts/verify-duplicate-blocks.sh` — new
- `scripts/verify-knip-config.sh` — new
- `scripts/.gate-baselines/circular-deps.txt` — new (seeded from initial `madge` run; each entry `# expires: 2026-11-14` — 180-day window for cycle resolution)
- `scripts/.gate-baselines/duplicate-blocks.txt` — new (seeded from `jscpd`; `# expires: 2026-11-14`)
- `scripts/.gate-baselines/knip-config.txt` — new (likely empty)

### Module shape

- *Public interface:* three gate scripts. No pure-JS helpers authored in this chunk — the gates are literal tool wrappers + a count diff. The count-diff logic is imported from chunk 3's `scripts/lib/per-file-counter-pure.mjs`, which is why this chunk depends on chunk 3 (see chunk table).
- *What stays hidden:* the per-tool JSON shapes, the configuration of each tool (clone-density thresholds, knip entry-point list).

### Verification commands

```
npm run lint
npm run typecheck
npm install
```

`npm install` confirms `package-lock.json` regenerates cleanly with the three new deps. No new Vitest authored in this chunk — the pure-logic surface (`countPerFile` / `diffAgainstBaseline`) is covered by chunk 3's test. Per the spec's note (and `audit-runner.md`), pure-grep wrappers with no logic to test are marked `N/A — gate is a literal tool wrapper`; that applies here.

### Definition of done

- `madge`, `jscpd`, `knip` resolve from `npx` (post `npm install`) without errors.
- Each gate runs end-to-end against the current tree, emits `[GATE] <guard-id>: violations=<n>`, and exits `0` (clean) or `2` (within baseline). Executor verifies manually by running each gate locally — does NOT count as "running gates as a suite", just per-script smoke check on the gate the chunk introduces.
- `knip.json` exists; running `npx knip` produces a parseable JSON report.
- Baselines pre-populated; each baseline entry has `# expires:` per the values listed above.
- Pre-existing violation surfaced for the executor: if `npx madge --circular` reports cycles, those land into the baseline at chunk completion. The Pass-3 backlog item to resolve cycles is filed in chunk 10's `tasks/todo.md` close-out, not here.

### Risks

- **Adding three large npm dependencies** could change install time and lockfile churn. Mitigation: install all three in one commit; do not split. CI install timing will surface any cost regression.
- **`knip` baseline depends on `knip.json` correctness.** If the initial config under-declares dynamic entries, the gate floods with false positives. Mitigation: seed `knip.json` from the spec's explicit list (server entry, client entry, worker, `.claude/hooks/*.js`, all `server/config/*.ts`, `scripts/__fixtures__/*`), and treat the first 30 days as warning-only via the baseline grace period.

---

## Chunk 5 — AST gates (P2 tighten + companion, P15 React Router walk)

### Scope

The two largest single chunks of the build. Both use `ts-morph` (already in deps).

- **P2 tighten `verify-no-db-in-routes.sh`:** (a) skip `import type` lines (currently flagged as violations); (b) refuse NEW baseline entries unless the commit body contains `ADR-<id>`. The check-baseline step lands a hard fail when the new violation count exceeds baseline AND the commit body lacks an `ADR-` reference (gate-side detection only — does not block local commits).
- **P2 NEW companion `verify-with-org-tx-or-scoped-db.sh`:** for every `db.select(...)` / `db.insert(...)` / `db.update(...)` / `db.delete(...)` call site outside `server/db/`, confirm the enclosing function body is reached only via a call originating inside `withOrgTx(...)` or `getOrgScopedDb(...)`. Implementation: `ts-morph` walk; for each db-call `CallExpression`, find the enclosing function; check whether any caller of that function passes through `withOrgTx` or `getOrgScopedDb`. Heuristic: walk one level of callers; if direct caller is the helper, pass; else flag. Per-line suppression: `guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>`.
- **P15 `verify-no-orphan-react-component.sh`:** walk `client/src/App.tsx` for `lazy(() => import('./pages/X'))` and `import('./pages/X')` patterns; collect the set of routed pages. Walk `client/src/pages/**/*.tsx` and `client/src/components/**/*.tsx`; emit violations for any file with zero ingress (not in the routed set AND not imported by any routed file). Allow-list at `client/.orphan-allowlist.json` (JSON file with shape `{ "files": [{ "path": "...", "reason": "..." }] }`). Per spec §13 question 2: I default to JSON allow-list, not co-located annotation. Rationale: centralised review surface.

P15 entry-point detection: regex of `lazy(() => import('./pages/X'))` is sufficient for the App.tsx routing pattern (confirmed by reading current App.tsx — every lazy page follows this exact shape). Do NOT use `ts-morph` for App.tsx parsing — the route file's pattern is regex-friendly. Component reachability from each routed page DOES use `ts-morph` (walk imports transitively).

### Files

- `scripts/verify-no-db-in-routes.sh` — modify (tighten checks; skip `import type`; ADR-required baseline-growth check)
- `scripts/verify-with-org-tx-or-scoped-db.sh` — new
- `scripts/verify-no-orphan-react-component.sh` — new
- `scripts/lib/with-org-tx-analyser.mjs` — new (`ts-morph` AST walker, pure logic)
- `scripts/lib/orphan-component-analyser.mjs` — new (App.tsx regex + `ts-morph` reachability)
- `client/.orphan-allowlist.json` — new (initial state: empty `{ "files": [] }`)
- `scripts/.gate-baselines/no-db-in-routes.txt` — new (carries forward existing baseline entries from `scripts/guard-baselines.json` to the new `.txt` format; each gets `# expires: 2026-08-14`; `supportAgentRoutes.ts` carries the audit-noted ADR-pending finding)
- `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` — new
- `scripts/.gate-baselines/no-orphan-react-component.txt` — new
- `scripts/__tests__/with-org-tx-analyser.test.ts` — new (Vitest)
- `scripts/__tests__/orphan-component-analyser.test.ts` — new (Vitest)
- `scripts/__fixtures__/with-org-tx/*.ts` — new (synthetic fixtures: passing, failing, suppressed)
- `scripts/__fixtures__/orphan-component/*.tsx` — new (synthetic fixtures)

### Module shape

- *Public interface:* `analyseWithOrgTxScope(repoRoot, dbCallSites) → Violation[]` and `findOrphanComponents({ entryFile, componentRoot }) → Violation[]`. Plus the two gate scripts.
- *What stays hidden:* the `ts-morph` project setup, `CallExpression` scanning, parent-function resolution, transitive-import walking, the App.tsx regex extraction, the allow-list parser.

### Verification commands

```
npm run lint
npm run typecheck
npx vitest run scripts/__tests__/with-org-tx-analyser.test.ts scripts/__tests__/orphan-component-analyser.test.ts
```

### Definition of done

- `verify-no-db-in-routes.sh` no longer flags `import type` lines. Verified by reading the script's output against `server/routes/supportAgentRoutes.ts` and confirming only the runtime-DB-import lines (not the type-import lines) appear.
- `verify-no-db-in-routes.sh` baseline-growth path: if current violation count > baseline AND `git log -1 --pretty=%B` lacks an `ADR-` mention, exit 1 (hard fail). Otherwise exit 2 (warning).
- `verify-with-org-tx-or-scoped-db.sh` runs end-to-end against the current tree, emits `[GATE] with-org-tx-or-scoped-db: violations=<n>` (count likely non-zero — those violations seed the baseline file).
- `verify-no-orphan-react-component.sh` correctly identifies the routed-pages set from App.tsx (test asserts known-routed page like `HomePage` is routed; known-unrouted but allow-listed fixture is allow-listed; known-orphaned fixture is flagged).
- Vitest tests pass against the synthetic fixtures under `scripts/__fixtures__/`.
- `client/.orphan-allowlist.json` exists with empty initial list and a header `_doc` key explaining the format.
- Baselines pre-populated; each entry has `# expires:` per the conventions above.

### Risks

- **`verify-with-org-tx-or-scoped-db.sh` heuristic is single-level caller walk.** True call-graph analysis is open-ended (could miss async dispatch via `setImmediate`, queue handlers, etc.). Mitigation: single-level + the baseline file. Document the heuristic limitation in the script's header comment.
- **`ts-morph` startup cost** (~3 s for a full project load) inflates CI gate time. Mitigation: both new ts-morph gates share one `Project` instantiation via a shared `scripts/lib/ts-morph-project.mjs` if both are invoked in the same `run-all-gates.sh` pass (optimisation deferred to follow-up; not blocking).
- **P2 ADR-in-commit-body check** depends on `git log` being available in CI. Confirm GitHub Actions provides this (it does for `actions/checkout@v4` with `fetch-depth: 2` or higher). If the workflow uses shallow clone, this needs adjustment. Surfaced in Open questions §7.

---

## Chunk 6 — Remaining gates (P1 missing-deps, P3 loc-cap, P8 frontend-design-budget)

### Scope

Three gates that don't fit the earlier batches cleanly.

- **P1 `verify-no-missing-deps.sh`** — wrap `npx depcheck --skip-missing=false --json`. Fail on any imported package that isn't in `package.json`. Add `depcheck` to devDependencies. **Suppression path:** declare the package in `optionalDependencies` (which is the documented pattern for dynamic-only imports — see how the audit landed `docx` and `mammoth` as optionalDependencies). No per-line `guard-ignore` for this gate — depcheck reports missing-package names, not import-line locations, so a per-line suppression has no anchor point. (T2 fix from plan review: the spec's "per-line `guard-ignore`" wording for P1 has no implementable mapping back to import sites without a separate scanner; package-tier declaration via `optionalDependencies` is the realistic surface.)
- **P3 `verify-loc-cap.sh`** — per-layer LoC caps from `docs/codebase-audit-framework.md` § Area 10. Soft cap = warning (exit 2 contribution); hard cap = error (exit 1 contribution). Exclusions: `server/db/schema/*.ts`, `server/config/rlsProtectedTables.ts`, generated files (filename matching `*.generated.ts`, OR file starts with `// AUTO-GENERATED` header), `migrations/*.sql` (per spec §13 question 4 — recommended yes), `tasks/**`, `docs/**`. Allow-list growth requires an ADR (gate-time check: if a file crosses the hard cap and isn't in `scripts/.gate-baselines/loc-cap.txt`, fail unless commit body contains `ADR-`).
- **P8 `verify-frontend-design-budget.sh`** — grep `client/src/**/*.tsx` for imports of `KpiCard`, `KpiTile`, `Sparkline`, and chart components (operator confirms the exact list from `client/src/components/ui/*` during impl). Files importing any of these must appear in `docs/frontend-design-allowlist.json` (new file). No per-line suppression — allow-list is the surface.

### Files

- `package.json` — add `depcheck` to devDependencies
- `package-lock.json` — modify (regenerated by `npm install` after adding `depcheck`; commit alongside `package.json` in the same chunk)
- `scripts/verify-no-missing-deps.sh` — new
- `scripts/verify-loc-cap.sh` — new
- `scripts/verify-frontend-design-budget.sh` — new
- `scripts/lib/loc-cap-pure.mjs` — new (per-layer cap lookup + file matcher)
- `scripts/lib/frontend-design-allowlist-pure.mjs` — new (allow-list parser + import-grep helper)
- `docs/frontend-design-allowlist.json` — new (initial list: every currently-importing admin-only page is seeded here; format `{ "files": [{ "path": "...", "components": [...], "reason": "..." }] }`)
- `scripts/.gate-baselines/no-missing-deps.txt` — new (likely empty)
- `scripts/.gate-baselines/loc-cap.txt` — new (every current hard-cap-exceeding file seeded; `# expires: 2026-11-14`)
- `scripts/.gate-baselines/frontend-design-budget.txt` — new
- `scripts/__tests__/loc-cap-pure.test.ts` — new (Vitest)
- `scripts/__tests__/frontend-design-allowlist-pure.test.ts` — new (Vitest)

### Module shape

- *Public interface:* three gate scripts. Pure helpers: `applyCaps({ files, soft, hard, exclusions }) → { soft: [...], hard: [...] }`, `isInAllowlist({ file, components, allowlist }) → boolean`.
- *What stays hidden:* the per-layer regex matching, the generated-file detection, the JSON allow-list parser, the import-statement scanning.

### Verification commands

```
npm run lint
npm run typecheck
npm install
npx vitest run scripts/__tests__/loc-cap-pure.test.ts scripts/__tests__/frontend-design-allowlist-pure.test.ts
```

`npm install` regenerates `package-lock.json` after the `depcheck` devDependency add (mirrors chunk 4's pattern; T1 fix from plan review). P1 has no pure helper — `verify-no-missing-deps.sh` is a tool wrapper with `depcheck` doing the work. Marked `N/A — gate is a literal tool wrapper with no pure helper` per the `audit-runner.md` exemption.

### Definition of done

- All three gates run end-to-end. P3 produces a list of god files matching the audit's known god-file register; P8 seeds the allow-list from current importers without flagging them.
- Tests assert: (a) file under soft cap → no flag; (b) file between soft and hard → warning; (c) file over hard cap → error; (d) file in allow-list → no flag; (e) generated file → excluded; (f) `migrations/*.sql` → excluded.
- `docs/frontend-design-allowlist.json` exists and lists every currently-importing admin file. The list is the seeded baseline — new imports require an allow-list PR.
- Baselines pre-populated; each entry has `# expires:` per the convention.

### Risks

- **P3 LoC counting method.** Different tools (`wc -l`, `cloc`, custom regex) give different counts. Mitigation: pin to `wc -l` (matches the audit framework's `find ... | xargs wc -l` recipe). Document in the script header.
- **P8 allow-list as JSON.** JSON does not allow comments. Mitigation: include a top-level `"_doc"` key with explanatory text. Format inheritance: matches the convention of `server/config/rlsProtectedTables.ts`'s structure (centralised allow-list + a "why" string per entry).

---

## Chunk 7 — Documentation rules (P17–P20)

### Scope

Four discrete doc edits. Author the exact prose here so the executor copy-pastes — do not say "executor decides wording."

### P17 — `architecture.md` § Tenant Scoping sub-section

Insert AFTER the existing `req.user.organisationId` reference (currently line 148-149) and BEFORE the §three-tier agent model heading. New sub-section heading: `### Single org-id source`.

Body (verbatim):

```
**`req.user.organisationId` is read in exactly one place: `server/middleware/auth.ts`.**

All other code — routes, services, jobs, helpers — reads `req.orgId`. The two values differ only when a system admin is acting on a non-owned org (`req.user.organisationId` = the admin's home org, `req.orgId` = the impersonated org from the URL). Reading the wrong one in tenant-scoped code is a silent cross-tenant leak.

Enforced by `scripts/verify-org-id-source.sh`. Suppression for legitimate exceptions (the auth middleware itself, audit logs that record the acting user's home org) uses `guard-ignore: org-id-source reason="..."`.
```

### P18 — `CLAUDE.md` § Comments

CLAUDE.md does not currently have a `## Comments` section. Either (a) add it as a new top-level section after `## 13. Doc style`, or (b) append to `## 6. Surgical Changes` since that section already discusses code-style discipline. Recommendation: (b) — append to § 6 as a new bullet under the existing `## 6. Surgical Changes` list. Surfaced in Open questions §4.

Body to append (verbatim):

```
- **Comments describing a *completed* refactor are residue, the commit message is the right home.** If a comment block exists only to explain why some code USED to be different, delete it. Anchor case: the 2026-05-14 pre-v1-lockdown audit found a 44-line cluster in `server/services/agentExecutionService.ts:72-116` describing an import-removal refactor that shipped in migration 0106. The git history carries that. The code does not need to.
```

### P19 — `CLAUDE.md` § Frontend Design Principles

Append to the existing `## Frontend Design Principles` section as a new bullet at the end of that section's list.

Body (verbatim):

```
- **Prefer named exports for React components.** Default-and-named dual exports create ambiguity that `knip` cannot reliably trace, leaving orphan components hidden until a manual audit catches them. Rename-shim cases (e.g. the subaccount-vs-client transition in `client/src/lib/auth.ts`) are time-limited exceptions: every such shim documents a sunset date in its header comment.
```

### P20 — `docs/capabilities.md` § Editorial Rules

Append to the existing `### Editorial Rules` section. Add three sub-sections at the end of that section's body.

Body (verbatim):

```
#### Always-OK industry terms

These terms are vendor-neutral standards and pass editorial review without modification:

- Protocol / format: OAuth, HTTP, REST, GraphQL, SAML, SSO, OIDC, JWT, JSON, XML, CSV
- Tooling categories: webhook, container, browser automation
- Vendor-neutral product categories: SMTP, IMAP, calendar, CRM

#### Provider names allowed only in factual sections

Provider-specific names (Google, Microsoft, Stripe, HubSpot, Salesforce, Slack, etc.) appear ONLY in:

- `## Skills Reference` — when a skill explicitly integrates with that provider
- `## Integrations Reference` — when listing supported connectors

Anywhere else (capability descriptions, agency narrative, marketing prose) a provider name is an editorial violation. Use the vendor-neutral category instead.

#### Borderline cases requiring human judgement

When unsure whether a partner-name mention is factual or marketing, route to the editor:

- "Google Docs as a knowledge source", borderline; if Google Docs is the only supported source, factual; if it's one of many, replace with "document stores"
- "Slack as a notification channel", borderline; same rule

The default is vendor-neutral. Provider names are the exception, not the rule.
```

### Files

- `architecture.md` — modify (one new sub-section)
- `CLAUDE.md` — modify (two appends: § 6 bullet, § Frontend Design bullet)
- `docs/capabilities.md` — modify (three new sub-sections at end of § Editorial Rules)

### Module shape

N/A — direct doc edits. No public interface.

### Verification commands

```
npm run lint
```

Lint catches markdown issues if present. No typecheck, no tests — these are doc-only edits.

### Definition of done

- All three docs edited with the verbatim prose above.
- `docs/doc-sync.md` is updated to reference the new gates in chunk 10 (not this chunk — split for tracking).
- Manual read of each updated section in a markdown previewer confirms formatting.

### Risks

- **CLAUDE.md may grow past the long-doc-guard threshold** (10k chars per the `.claude/hooks/long-doc-guard.js` policy). Mitigation: P18 + P19 add about 12 lines total. The hook checks chars on Write; appends via Edit are unaffected by the threshold. The plan's recommendation is to append rather than restructure, minimising diff.

---

## Chunk 8 — KNOWLEDGE entries (P21–P23, append-only)

### Scope

Three append-only entries at the end of KNOWLEDGE.md. Per the file's own rule: never edit existing entries, only append.

### P21 — Per-critical-path coverage tier matrix

Append (verbatim):

```
### [2026-05-14] Pattern — Per-critical-path coverage tier matrix

Not every critical path needs the same coverage shape. Static gates are cheap, unit tests are mid, trajectory tests are expensive. Match the tier to the failure-mode being defended against.

**Initial matrix (refresh quarterly):**

| Critical path | Coverage tier | Rationale |
|---|---|---|
| RLS context propagation (`withOrgTx`, `getOrgScopedDb`, session var canonicalisation) | gates + unit | Failure mode is silent cross-tenant; gates catch shape, unit tests catch propagation through transformations |
| `agentRunVisibility` resolution | gates + unit | Failure mode is permission bypass; both invariant types tested |
| Idempotency-key dedup | gates + sparse unit | Failure mode is double-execution; gates assert declaration, sparse unit covers the dedup logic at one canonical site |
| Cost-breaker invocation | gates only | Failure mode is over-spend; the invariant ("breaker wraps every LLM call") is structural and gate-detectable |

Refresh this matrix every quarterly review. If a new critical path emerges and lacks a tier, the first PR that touches it picks one.

**Anchor:** 2026-05-14 pre-v1-lockdown audit, Layer 1 Area 5 coverage assessment.
```

### P22 — Custom retry loops are pass-3

Append (verbatim from the audit log):

```
### [2026-05-14] Pattern — Custom retry loops are pass-3 even when they look right

`agentBeliefService.ts:124-403` rolls its own `retryCount` storm-detection loop with manual jitter and exponential backoff. The implementation is sound on first read. On second read it's a partial reimplementation of `server/lib/withBackoff.ts`. Audit caught it because the gate `verify-canonical-retry.sh` (P5) flagged the `retryCount` declaration outside the canonical helper.

**Rule.** A retry-shaped construct outside `server/lib/withBackoff.ts` is pass-3 by default, never auto-merge a custom retry loop on Rule 8 ("trust this is intentional"). Either extend `withBackoff` to cover the new case, OR document why the canonical helper genuinely cannot, AND add a `guard-ignore: canonical-retry ADR-<id> <rationale>` suppression that future audits can grep.

**Anchor:** 2026-05-14 pre-v1-lockdown audit, Module J finding 1.
```

### P23 — Handoff depth-cap rejections need structured events

Append (verbatim from the audit log):

```
### [2026-05-14] Pattern — Handoff depth-cap rejections need structured events, not `console.warn`

`server/services/skillExecutor.ts:3992` (the `enqueueHandoff` depth-cap path) rejected handoffs deeper than 5 with a `console.warn` and a silent drop. The three-tier agent invariant is "handoffs up to 5 deep", a rejection at that boundary is a meaningful event, not a debug log. The 2026-05-14 audit found this only because the audit explicitly walked all three-tier invariants; routine log review never flags `console.warn` strings.

**Rule.** Any invariant rejection (depth cap, rate limit, idempotency conflict, RLS gate) emits a structured event via the canonical logger AND a Langfuse tag, not a `console.*` call. Gate-enforced via `verify-canonical-logger.sh` (P6).

**Anchor:** 2026-05-14 pre-v1-lockdown audit, Module K finding 3.
```

### Files

- `KNOWLEDGE.md` — append three entries to the end of the file.

### Module shape

N/A — pure doc append.

### Verification commands

```
npm run lint
```

### Definition of done

- Three entries appended. No existing KNOWLEDGE entry edited or removed.
- Each entry uses the canonical `### [YYYY-MM-DD] Pattern — <title>` heading shape (matches the existing KNOWLEDGE pattern).
- The audit log's pre-drafted versions for P22 and P23 are referenced — verbatim where possible.

### Risks

- **Duplication with existing audit-log entries.** The audit log already drafted P22 and P23 in its KNOWLEDGE-entries-to-append section. The KNOWLEDGE.md append is the canonical home; the audit log is the source. Mitigation: copy from audit log into KNOWLEDGE.md verbatim.

---

## Chunk 9 — ADR P24: Service-layer extraction for routes touching `db/schema/`

### Scope

Author a new ADR at the next available number (`0024`). The ADR template is at `docs/decisions/_template.md`. Update `docs/decisions/README.md` to index the new ADR.

ADR body (verbatim):

```
# ADR-0024: Service-layer extraction for routes touching `db/schema/`

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-05-14 |
| Deciders | Operator (michaelhazza), Claude Code (main session) |
| Supersedes | — |

## Context

Routes occasionally need a row type from `server/db/schema/*.ts` for request/response shapes. The convention has been to import the schema module directly. The 2026-05-14 pre-v1-lockdown audit found that `server/routes/supportAgentRoutes.ts` had used this pattern as a pretext to also issue queries against the `canonicalInboxes` table from inside a route handler, a Route to DB layer breach. The `verify-no-db-in-routes.sh` baseline had the file pinned, which made the breach invisible to gate runs for an unknown duration.

The cause is the dual purpose of a `db/schema/*.ts` import. The import can mean "give me the type for my response shape" OR "give me the table object to build a query." Routes legitimately want the first; they MUST NOT want the second.

## Decision

1. **Routes that need a row type from a schema module MUST import via `shared/types/`**, not from `server/db/schema/*.ts`. If the type does not exist in `shared/types/`, the PR adds it there in the same commit.
2. **Routes that need to run a query MUST go through a service** in `server/services/`. No exceptions, including for "just a tiny SELECT". The existing `verify-no-db-in-routes.sh` gate enforces this.
3. **Tightening the existing gate (P2 of the audit-prevention-gates build):** the gate now skips `import type` lines (so legitimate type imports don't trip), AND refuses new baseline entries unless the commit body references an ADR. New layer breaches require deliberate sign-off; they cannot accumulate silently.

## Consequences

**Positive.**

- The "type import" path and the "query import" path are no longer the same statement. A route that needs a type imports from `shared/types/` and cannot accidentally also query.
- New baselines require ADR justification, so the failure mode that produced the `supportAgentRoutes.ts` finding (a baseline grew silently) is replaced by a deliberate sign-off.

**Negative.**

- `shared/types/` may grow as types that previously lived only in schema modules get extracted. The cost is small per type, but cumulative. Mitigation: type extraction is mechanical; do it as part of the PR that needs the type, not as a one-shot cleanup.
- Some routes will need a service wrapper for what is currently a one-line query. This is the intended pressure, services own ORM access. If a service file does not exist, create it. The `architecture.md` § "When to create a new service file" guidance applies.

## Alternatives considered

- **Allow `db/schema/*.ts` type imports in routes via a typed re-export.** Rejected: still creates the dual-purpose import statement; the gate would have to distinguish "imported the schema module for the type only" from "imported it for the table object", which is fragile.
- **Drop the gate entirely and rely on reviewer discipline.** Rejected: the `supportAgentRoutes.ts` finding is the proof that this fails. The gate exists because the discipline does not, at scale.

## Related

- Audit: `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
- Spec: `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`
- Gate: `scripts/verify-no-db-in-routes.sh`
- KNOWLEDGE pattern: § "Gate baselines must expire, not just exist" (2026-05-14)
```

### Files

- `docs/decisions/0024-service-layer-extraction-for-routes-touching-db.md` — new
- `docs/decisions/README.md` — modify (add index entry for ADR-0024)

### Module shape

N/A — pure documentation.

### Verification commands

```
npm run lint
```

### Definition of done

- ADR-0024 file exists at the path above with the verbatim body.
- `docs/decisions/README.md` indexes ADR-0024 with one-line summary.
- ADR status field is `Accepted` (not `Proposed`).

### Risks

- **ADR number collision.** If another ADR landed between plan authorship and execution, renumber. Verify by `ls docs/decisions/` immediately before authoring.

---

## Chunk 10 — Doc-sync registration + test-gate policy update (no `tasks/todo.md` touches)

### Scope

Three doc-housekeeping edits, sequenced AFTER chunks 7-9 so the new docs exist to be referenced. **NO `tasks/todo.md` touches in this chunk** — that close-out moves to chunk 12 so it lands after the gates become CI-active (chunk 11 wiring).

- **`docs/doc-sync.md`** — add a new row to the "Reference docs and update triggers" table for the new gates from chunks 2-6. Single canonical row:

```
| `scripts/verify-*` (16 gates from audit-prevention-gates-2026-05-14) | Triggers when adding/removing/renaming a gate, when changing suppression grammar, when changing baseline expiry policy. Update `references/test-gate-policy.md` if the gate posture changes |
```

Plus add doc-anchor cross-references where the spec calls for them (architecture.md § "Single org-id source" pairs with `verify-org-id-source.sh`; etc.).

- **`references/test-gate-policy.md`** — add a short policy update covering the contracts this build introduces. Specifically:
  - **Baseline expiry policy.** Every per-gate baseline entry under `scripts/.gate-baselines/<guard-id>.txt` carries an `# expires: YYYY-MM-DD` directive. Entries become warning at expiry; entries become error after `GATE_GRACE_DAYS` (default 30) past expiry. Cross-reference `scripts/lib/guard-utils.sh` `check_expiring_baseline` (introduced by chunk 1).
  - **Suppression annotation grammar.** Four forms supported: T0 deprecated, T1 preferred, legacy with `reason="..."`, next-line, file-scoped. Cross-reference the header comment block in `guard-utils.sh`.
  - **Warning-first promotion policy.** New gates ship with `default_exit_code=2` (warning). Promotion to `exit 1` (error) is per-gate, operator-initiated, after a minimum one-week soak post-merge. Cross-reference Open questions §5 of the prevention-gates plan.
  - The existing policy document keeps the canonical "test gates are CI-only" rule unchanged; this update lives in a new sub-section near the end of the policy file.

### Files

- `docs/doc-sync.md` — modify
- `references/test-gate-policy.md` — modify (append sub-section per above)

### Module shape

N/A — doc housekeeping.

### Verification commands

```
npm run lint
```

### Definition of done

- `docs/doc-sync.md` has the new doc-sync row referencing the audit-prevention-gates spec slug.
- `references/test-gate-policy.md` has the three-bullet baseline-expiry + suppression-grammar + warning-first-promotion sub-section.
- No `tasks/todo.md` changes in this chunk (close-out lands in chunk 12 after wiring).

### Risks

- **Drift between docs/doc-sync.md and the actual gate list.** Mitigation: doc-sync row references the audit-prevention-gates spec by slug, not by enumerating each gate name. If the spec moves or is archived, doc-sync still resolves.
- **References/test-gate-policy.md is a high-leverage doc** (loaded into many agent sessions). Mitigation: append-only sub-section at end of file; do not rewrite existing content; the canonical "CI-only" rule stays unchanged.

---

## Chunk 11 — Wiring (`run-all-gates.sh` registration)

### Scope

Single commit: register every new gate in `scripts/run-all-gates.sh`. This is the moment the gates become CI-active.

### Files

- `scripts/run-all-gates.sh` — modify (append 14 `run_gate` lines under a new section header)

### Module shape

N/A — wiring only.

### Verification commands

```
npm run lint
```

No new tests authored — this is the orchestrator stitch. The gates' own logic is covered by chunks 1-6 tests. Per the test-gates-are-CI-only rule, the executor does NOT run `scripts/run-all-gates.sh` locally to verify the wiring. CI handles that on PR open.

### Definition of done

- `run-all-gates.sh` has new `run_gate` invocations (one per gate from chunks 2-6), grouped under a new section header `# ── Audit prevention gates (2026-05-14 lockdown) ──`.
- Order follows the chunk order: chunk 2 (P7, P13, P14 = 3), chunk 3 (P4 already wired — skip; P5, P6, P9, P10 = 4), chunk 4 (P11, P12, P16 = 3), chunk 5 (P2 tighten already wired — skip; new companion `verify-with-org-tx-or-scoped-db.sh`, P15 = 2), chunk 6 (P1, P3, P8 = 3). **Net new `run_gate` lines: 15.** (P4 and P2 are tightenings of already-wired gates and remain at their existing call sites.) If Open question §6 resolves with "drop P6 because `verify-no-raw-console.sh` already covers it", the count drops to 14 and the chunk 3 `run_gate` group loses one entry; executor confirms during chunk 3 implementation and adjusts chunk 11 accordingly.

### Risks

- **CI minutes inflation.** Adding 15 new gates increases gate-run time. Each gate is small individually; cumulative cost is bounded by `madge`, `jscpd`, `knip`, and the two `ts-morph` gates (the slowest five). Mitigation: monitor first week of post-merge CI runs; if total gate time exceeds the workflow timeout, split into a separate "audit-prevention-gates" workflow that runs in parallel. Not blocking for this build.
- **Order matters for exit-code interpretation.** `run-all-gates.sh` accumulates pass/warn/fail counts; the audit-prevention gates ship warning-first, so they should ALL exit 2 on the first CI run after merge. Operator promotes to error per gate after one-week soak (Open questions §5).

---

## Chunk 12 — `tasks/todo.md` close-out (lands LAST, after wiring)

### Scope

Mark P1–P24 as `[x]` in `tasks/todo.md` and append the closing PR/branch reference. This is the LAST chunk of the build because it MUST land after chunk 11 wiring — until the gates are registered in `scripts/run-all-gates.sh`, the prevention proposals P1–P16 are not actually CI-active and marking them closed is premature. Earlier draft (where doc-sync + close-out shared one chunk) had this ordering bug.

- **`tasks/todo.md`** — mark P1–P24 as `[x]` with the closing reference. Format per existing convention:

```
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:PR#NNN] **P1** — ...
```

(Executor fills `PR#NNN` once the PR exists. If the executor runs locally before the PR opens, mark as `[status:closed:branch:feat/audit-prevention-gates-2026-05-14]` and update on PR open.)

- Append a new deferred-items sub-section at the end of the prevention-proposal section listing the warning→error promotion follow-ups. Per the rollout recommendation (Open questions §5), ALL 15 newly wired gates ship warning-first; each needs a one-week-soak follow-up PR to promote to error. Template entry:

```
- [ ] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:open] **Warning→error promotion: <guard-id>** — earliest promotion date: <merge date + 7 days>. Operator reviews CI signal for the first week; if no unexpected false positives, promote `default_exit_code` from 2 to 1 in `scripts/verify-<guard-id>.sh`.
```

One row per gate (15 gates: P5, P6, P9, P10, P7, P13, P14, P11, P12, P16, P15, the P2 companion, P1, P3, P8). If chunk 3 confirms the P6 / `verify-no-raw-console.sh` collision and drops P6, the list is 14.

### Files

- `tasks/todo.md` — modify (24 lines checked off + 14-or-15 deferred warning→error rows appended)

### Module shape

N/A — doc housekeeping.

### Verification commands

```
npm run lint
```

### Definition of done

- All 24 prevention proposals (P1–P24) marked `[x]` in `tasks/todo.md` with closing reference (`PR#NNN` or branch slug).
- Each newly wired gate from chunk 11 has a corresponding warning→error promotion follow-up row appended to the prevention-proposals section (14 or 15 rows depending on P6 resolution).
- File is append-only with respect to historical sections per CLAUDE.md §3 and the framework's "append-only" rule.

### Risks

- **PR number is unknown until the PR opens.** Mitigation: the executor lands chunk 12 with the branch-slug status placeholder; updates it to `PR#NNN` in the same branch on PR creation (one extra commit on the branch).
- **The warning→error follow-up list could drift from the actual run-all-gates.sh entries.** Mitigation: chunk 11's wiring is the source of truth; chunk 12's executor verifies the count matches chunk 11's net-new `run_gate` count before committing.

---

## Open questions deferred to executor (or operator at plan-gate)

### 1. P4 collision with existing `verify-no-silent-failures.sh`

The spec proposes a new `scripts/verify-no-silent-catch.sh` (P4). The existing `scripts/verify-no-silent-failures.sh` already enforces almost the same rule. The plan above treats P4 as a TIGHTENING of the existing gate (extend scope to `client/src/`, swap to new baseline helper). **Recommended default: tighten existing gate; do NOT create a duplicate.** One-line rationale: two near-identical gates with overlapping baselines are an anti-pattern; the existing gate is well-tested and used.

### 2. P15 allow-list format (spec §13 open question 2)

JSON file (`client/.orphan-allowlist.json`) vs co-located comment (`// orphan-allowed: <reason>`). **Recommended default: JSON.** One-line rationale: centralised allow-list creates a single review surface (one file in the diff signals "we're widening the orphan budget"); co-located comments make growth invisible.

### 3. P10 commit-body trailer parsing (spec §13 open question 3) — RESOLVED

PR-time hook vs gate-time only. **Resolved at plan revision: gate-time only, parsing via `git log -1 --pretty=%B` for `Marker-Reason:` trailer.** Locked into Chunk 3 scope and DoD (T3 fix from plan review). One-line rationale: PR-time hooks add tooling complexity for marginal earlier signal; gate-time catches the violation at the same effective merge gate. No further executor decision needed.

### 4. P18 placement in CLAUDE.md (no "## Comments" section exists)

Add a new top-level section, OR append to existing § 6 Surgical Changes. **Recommended default: append to § 6.** One-line rationale: the rule is about code-style discipline; § 6 already covers code-style discipline; consolidates rather than fragments.

### 5. CI promotion from warning to error (spec §13 open question 5)

Manual per-gate (a PR per gate to promote) vs calendar-based automatic (after N days). **Recommended default: manual per-gate after one-week soak.** One-line rationale: forcing-function consistency is valuable but the operator has expressed preference for explicit gate posture changes (per ADR-0013 "Suppression is success" and the general "no auto-anything" stance); manual promotion respects that.

### 6. P6 collision with existing `verify-no-raw-console.sh`

Existing gate may already cover server/services + server/routes. **Recommended default: executor reads the existing gate FIRST; if scopes overlap, drop P6 from this build and update `tasks/todo.md` with a one-line note "P6 already covered by `verify-no-raw-console.sh`".** One-line rationale: the audit spec was authored from outside that gate's content; verifying before duplicating is cheap.

### 7. P2 ADR-in-commit-body check (chunk 5)

Depends on `git log -1 --pretty=%B` being available in CI. **Recommended default: confirm `actions/checkout@v4` is using a non-shallow clone (or `fetch-depth: 2+`).** One-line rationale: GitHub Actions defaults to `fetch-depth: 1` which omits older commits but exposes the current commit message; verify on first CI run after chunk 5 lands.

### 8. Sequencing: one PR vs many (spec §13 open question 6)

Spec proposes batch-per-PR. The plan assumes a single PR for all 12 chunks. **Recommended default: single PR.** One-line rationale: the chunks have shared infrastructure (chunk 1) that all subsequent chunks depend on; splitting into multiple PRs creates merge-order coupling without reducing blast radius (gates ship warning-first regardless). If CI minutes inflation becomes acute, the operator can split chunks 4 + 5 (the heavy tool/AST chunks) into a follow-up PR — that decision lands at code-review time, not plan-authoring time.

---

## Executor notes

- Test gates and whole-repo orchestrators (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/run-all-gates.sh`, `scripts/run-all-qa-tests.sh`, `scripts/run-all-unit-tests.sh`, `scripts/gates/*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.
- **One exception, scoped narrowly:** per Architecture-notes "Local gate execution policy", a chunk author MAY smoke-run an INDIVIDUAL `scripts/verify-*.sh` gate that is newly authored OR modified in THAT chunk, against the current tree, to confirm exit-code wiring and baseline seeding before commit. This is a per-script invocation only (e.g. `bash scripts/verify-canonical-retry.sh`), never a glob (`scripts/verify-*.sh`) or orchestrator. It does NOT appear in the chunk's "Verification commands" block — those stay lint / typecheck / targeted Vitest. The per-script smoke run is a local sanity check by the author, not a contract gate.
- Pre-existing violations are seeded into per-gate baseline files at chunk landing time. Each baseline entry MUST carry an `# expires: YYYY-MM-DD` directive on the preceding line. The `# expires:` dates suggested above (2026-08-14 = 90-day, 2026-11-14 = 180-day) are starting points; the operator can adjust at plan-gate review.
- Per-chunk verification is limited to `npm run lint`, `npm run typecheck`, and targeted `npx vitest run` of the test files authored in that chunk. Do NOT run the full Vitest suite, do NOT run gate orchestrators, do NOT run `scripts/run-all-gates.sh`. CI runs all of those on PR open.
- The branch name is `feat/audit-prevention-gates-2026-05-14`. The PR opens against `main` (audit findings are batched per the spec, not landed on the audit branch).
- Commit cadence: one commit per chunk. Chunk titles map directly to commit subjects. Body of each commit lists the gate IDs (or doc IDs) landed.
- Coordinator playbook applies: after each chunk, run `npm run lint` and `npm run typecheck`; on the chunks with new Vitest files, also run the targeted `npx vitest run` per the verification block. `pr-reviewer` runs once at end-of-build (Phase 2 D step in `feature-coordinator`).

---

## Self-consistency notes

- Every chunk's "Files" list is enumerable from the spec §3 / §4 / §5 / §6 / §12 tables — no file added without spec backing.
- Every chunk's "Verification commands" stays within the CI-only constraint: lint, typecheck, targeted Vitest, plus `npm install` in chunks that add deps (chunks 4, 6). No `scripts/verify-*.sh` invocations in verification commands, no orchestrator scripts. Per-script smoke-runs of newly authored gates are permitted outside the verification block per the Architecture-notes "Local gate execution policy".
- Every baseline file mentioned has an `# expires:` policy.
- Chunk dependencies are forward-only: chunks 2, 3, 5, 6 depend on chunk 1; chunk 4 depends on chunks 1 and 3 (reuses `per-file-counter-pure.mjs`); chunks 7-9 are independent; chunk 10 depends on 7-9; chunk 11 depends on 1-6 and 10; chunk 12 depends on 11 (close-out lands AFTER wiring so prevention proposals are not marked closed before the gates are CI-active).
- Spec §9 acceptance criteria coverage: AC1 (16 gates exist) → chunks 2-6 + 11. AC2 (baselines with expiry) → chunks 2-6. AC3 (suppression grammar documented) → chunk 1. AC4 (doc updates P17-P20) → chunk 7. AC5 (KNOWLEDGE entries) → chunk 8. AC6 (ADR-0024) → chunk 9. AC7 (todo.md closed) → chunk 12 (after wiring). AC8 (doc-sync lists new gates) → chunk 10. AC9 (reviewers approve) → standard pipeline.

---

## Plan-review revision history

### 2026-05-14 — Revision 1 (4 blocking + 5 should-fix issues addressed)

Reviewer flagged contract-level contradictions in the initial plan; the revisions below lock the contracts cleanly before execution.

**Blocking issues addressed:**

- **F1.** Local gate execution was both required (chunks 4 + 6 wanted per-script smoke runs) and forbidden (executor notes banned all `scripts/verify-*.sh`). Resolution: Architecture-notes "Local gate execution policy" carves out per-script smoke runs of *newly authored or modified* gates as the single exception; orchestrators (`scripts/run-all-gates.sh`, `scripts/run-all-qa-tests.sh`, `npm run test:gates`, etc.) remain CI-only. Smoke runs never appear in a chunk's "Verification commands" block; they are author-local sanity checks only.
- **F2.** Chunk 4 imports `per-file-counter-pure.mjs` (introduced in chunk 3) but the chunk table listed only chunk 1 as a dependency. Resolution: chunk 4 dependency updated to "1, 3".
- **F3.** Chunk 11 declared "14 net new run_gate lines" but the listed gates summed to 15. Resolution: count corrected to 15 with the P6-conditional caveat (if `verify-no-raw-console.sh` collision is confirmed during chunk 3, P6 drops and the count returns to 14).
- **F4.** Chunk 10 was marking P1-P24 closed in `tasks/todo.md` BEFORE chunk 11 wired the gates into `run-all-gates.sh` — so the proposals were being marked closed before they were CI-active. Resolution: split into chunks 10 (doc-sync only) and 12 (todo close-out, lands LAST after chunk 11 wiring). Total chunks now 12, not 11.

**Should-fix issues addressed:**

- **T1.** Chunk 6 added `depcheck` as a devDependency but did not include `package-lock.json` or `npm install`. Resolution: both added (mirrors chunk 4's pattern).
- **T2.** P1 claimed per-line `guard-ignore` suppression but `depcheck` reports missing-package names, not import-line locations — per-line suppression has no anchor point. Resolution: per-line suppression removed; `optionalDependencies` declaration is the documented suppression path (the audit's own `docx` and `mammoth` precedent).
- **T3.** P10 `Marker-Reason` trailer handling was inconsistent across scope / DoD / open question (scope said "PR-time", DoD said "not implemented", open question said "gate-time only"). Resolution: locked to gate-time `git log -1 --pretty=%B` trailer parsing; scope + DoD updated; Open question §3 marked RESOLVED.
- **T4.** Sync gates (P7, P13, P14) said "fail on drift" and "no suppression", which read as hard-fail-from-day-one despite Architecture-notes "warning-first rollout". Resolution: standardised wording — "emit violation and exit 2 during warning-first rollout; promote to exit 1 later". "No suppression" clarified as "no per-finding escape hatch" (independent of immediate exit-code).
- **T5.** `references/test-gate-policy.md` predates the baseline-expiry, suppression-grammar, and warning-first-promotion contracts this build introduces. Resolution: added to chunk 10 files; appends a three-bullet sub-section covering the new policy surfaces; keeps the canonical "test gates are CI-only" rule unchanged.

Net effect on chunk count and dependencies: 11 → 12 chunks; chunk 4 now depends on chunks 1 + 3 (was 1 only); chunk 12 is new and depends on chunk 11.
- Spec §13 open questions: 1 → answered in chunk 1 (30-day grace, baseline-per-entry, `GATE_GRACE_DAYS` env). 2 → answered in Open questions §2 (JSON). 3 → answered in Open questions §3 (gate-time only). 4 → answered in chunk 6 (`migrations/*.sql` excluded). 5 → answered in Open questions §5 (manual one-week soak). 6 → answered in Open questions §8 (single PR).
