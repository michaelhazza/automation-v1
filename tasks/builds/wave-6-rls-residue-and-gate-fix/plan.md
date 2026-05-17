---
status: PLAN_READY
date: 2026-05-17
author: architect (claude opus 4.7)
scope_class: Major
build_slug: wave-6-rls-residue-and-gate-fix
spec: tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md
handoff: tasks/builds/wave-6-rls-residue-and-gate-fix/handoff.md
parent_build: tasks/builds/wave-5-prevention-gates-and-rls/spec.md
chunk_count: 14
expected_files_touched: ~120-180 (1 helper + 1 harness + 2 gate scripts + 1 baseline file + 1 contingent RLS migration + ~115-175 service-tier files)
---

# Implementation Plan — wave-6-rls-residue-and-gate-fix

## Contents

- Executor notes
- Model-collapse check
- Architecture notes
- Chunk graph
- Chunks
  - Chunk 0 — design + audit + WF1 verification
  - Chunk 1 — gate honesty fix + baseline ratchet (ATOMIC)
  - Chunk 1' — honest tier-categorisation
  - Chunk 2 — other gates + P3 OS-parity harness
  - Chunk 3 — agent-execution residue (F4 completion)
  - Chunk 4 — skill-execution residue (F7 completion)
  - Chunk 5 — workflow services + WF1 contingent RLS migration
  - Chunk 6 — billing / cost services residue
  - Chunk 7 — personal-assistant residue
  - Chunk 8 — sandbox services residue
  - Chunk 9 — integration services residue
  - Chunks 10-11 — remaining Tier 1 services
  - Chunk 12 — final Tier 2 annotation audit sweep
  - Chunk 13 — Tier 1-blocked escalation review
  - Chunk 14 — final-pass verification + PR body
- Risks and mitigations
- Out of scope
- Open questions for build

---

## Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

**Exception — bug-affected portability gates under active repair (Chunks 1 + 2 only).** The very scripts being fixed in Chunks 1 + 2 (`scripts/verify-with-org-tx-or-scoped-db.sh` and any other bug-affected gates surfaced by Chunk 0) MAY be invoked directly by the builder and the operator during those chunks for parity-validation purposes. This exception is narrow: only the gate(s) under repair, only during the chunk that repairs them, and only for the purpose of producing the §6.1 parity-evidence transcripts. All OTHER verify-* scripts remain CI-only throughout. Once Chunk 1 and Chunk 2 commit, the exception expires for those gates as well.

Each chunk's verification section lists only the local commands the chunk's correctness depends on. CI runs the gate sweep on every PR and proves regression-cleanliness for the chunks left unverified locally.

---

## Model-collapse check

This build does NOT decompose into ingest → extract → transform → render. The work is:

1. Fix a deterministic shell/Node enumeration bug (path normalisation).
2. Audit other gates by static-pattern grep, fix the same way.
3. Run an AST analyser (ts-morph) against the codebase, partition results into tiers, then mechanically rewrite call expressions per a per-callsite verdict.
4. Add a harness that asserts deterministic exit codes against seeded fixtures.

A frontier multimodal LLM call cannot replace `glob` + `ts-morph` + `git`. The "ranking" step is the tier partitioning, which is rule-based (table-name lookup against `RLS_PROTECTED_TABLES`, upstream-entrypoint name match, FK-only manifest membership) — there is no semantic judgement an LLM would do better. Collapsed-call alternative rejected: rule-based correctness on 1,108 callsites is exactly the place where determinism wins over model jaggedness. Auditability also wins — every per-callsite verdict has a named entrypoint and a target table; an LLM run would produce verdicts with no provenance.

---

## Architecture notes

### Why Option B over Option A for the gate fix

The bug is fundamentally a path-normalisation mismatch between bash `find` (which on Windows git-bash emits POSIX-style `/c/Files/...` paths) and Node's `fs.existsSync` (which on Windows only accepts `C:/Files/...` form). Two routes close the bug:

- **Option A** — `cygpath -w` shim around `find`. Closes the symptom but leaves the gate brittle: cygpath is not guaranteed on every CI image, every dev machine, every container variant, every future Windows tooling rev. Each gate would need the shim wrapped around its `find` invocation; the bug class can resurface anywhere `find | Node` appears.
- **Option B** — Node-native enumeration via the existing `glob ^13.0.6` dependency. Replaces the entire `find → temp-file → fs.existsSync` pipeline with a single in-process `glob.sync` call that returns paths in whatever form Node's filesystem APIs accept natively. OS-portable by construction. Closes the bug class permanently because no shell `find` step remains. Reuses an already-pinned dependency — no new npm install, no supply-chain risk.

Option B wins on durability, blast radius, and zero-dependency-surface change. The spec mandates Option B (§5.1); this plan confirms.

A pure helper (`scripts/lib/gate-file-enumerator.mjs`) is extracted so every bug-affected gate calls the same enumerator. This matches the existing repo convention for gate helpers (cf. `scripts/lib/with-org-tx-analyser.mjs`, `scripts/lib/check-knip-config.mjs`, `scripts/lib/orphan-component-analyser.mjs`). Single point of change for future portability work; single point of test surface for the path-form contract.

### How predicate retention is enforced reviewer-side

The §7.1.1 rule "every Tier 1 migration MUST preserve the app-layer `where(eq(table.organisationId, orgId))` defence-in-depth predicate" is reviewer-side enforcement, not gate-side. We enforce it through three layers in the plan:

1. **Per-chunk acceptance criterion**: every per-domain chunk's verification section explicitly names predicate retention as a reviewer must-check item.
2. **Builder contract in the per-callsite mechanical-migration rules**: the `getOrgScopedDb()` template the builder applies is the §7.1 example which retains `.where(eq(table.organisationId, orgId))`. Builders mechanically follow the template; reviewers cross-check.
3. **PR-reviewer + chatgpt-pr-review pass on each per-domain chunk**: with `git diff` showing the before/after, predicate removal is mechanically visible. Reviewers reject diffs that drop the predicate.

Considered and rejected: writing a new gate that asserts every `getOrgScopedDb` callsite still has a `.where(eq(*.organisationId, *))` clause. Rationale for rejection: the gate would need ts-morph-level join analysis (a Tier 1 callsite may filter on `organisationId` two `where` clauses up the chain or through a join condition), making it lower precision than reviewer eyes for a one-time migration. If the predicate-retention class of bug becomes a recurring source of regressions later, that gate is the natural follow-up — out of scope for this build.

### Per-domain partitioning strategy

The spec's §10 suggests chunks 3-N by domain (agent-execution, skill-execution, workflow, billing, personal-assistant, sandbox, integrations). Three principles for partitioning the actual residue from Chunk 1's honest gate output:

1. **One domain = one chunk**. A file mixing Tier 1 and Tier 2 callsites is migrated in one pass; the chunk owns the whole file. This is from spec §10.
2. **≤50 files per chunk**. If `tier-categorisation.md` reveals a domain has >50 files of residue, split into two chunks along an obvious sub-boundary (e.g. `agentExecutionService/runLifecycle/*` vs `agentExecutionService/promptBuilders.ts`). Concrete partition is made in Chunk 1' when the honest list exists; this plan locks the per-domain chunk slots and leaves the sub-split decision to the builder for the per-domain chunk.
3. **High-traffic services first**. Per spec §13, agent-execution / workflow / billing migrate before lower-traffic surfaces. If the build runs long, the most-critical surfaces are protected first.

WF1's contingent RLS-policy migration is bundled into the workflow chunk because policy SQL must run before the code switches (spec §7.3). Bundling is correct here even though it slightly weakens the "one logical responsibility per chunk" heuristic — the alternative (separate chunks for policy + code) creates a deployment-ordering tripwire that's worse than the bundling cost.

### The Tier 1-blocked escalation path

A "Tier 1-blocked" callsite is one Chunk 1' cannot name a concrete upstream entrypoint (HTTP route under `authenticate` or pg-boss worker via `createWorker`) for. The plan reserves Chunk 13 as the operator-escalation gate. Three resolutions per spec §11 risk row 4:

- **(a)** Extend an existing entrypoint to thread subaccount/org context through.
- **(b)** Accept the callsite as v2-backlog with explicit operator rationale logged to `tasks/todo.md` per the §8 blocked-tier follow-up format.
- **(c)** Defer the entire callsite (e.g. scheduled job that will be retired before v1).

Resolution (a) requires a small entrypoint edit in the domain chunk that owns the callsite; resolution (b) is a documentation update; resolution (c) is a delete. All three are mechanical once the operator picks. The build does not close until blocked-count == 0 OR every blocked entry is explicitly logged.

### Why not a separate Tier 2 chunk?

The spec deliberately rejects separating Tier 2 work into its own chunk. Reason: a file frequently contains a mix of Tier 1 callsites (migrate to `getOrgScopedDb`) and Tier 2 callsites (migrate to `withAdminConnection`). Splitting the file across two chunks creates a window where the file is half-migrated, raw-`db` residue is hard to see in review, and review attention is fragmented. One-domain-one-pass is cheaper to review and harder to leave residue in. The final Tier 2 annotation sweep (Chunk 12) is a verification pass over the per-domain work, not a rewrite phase.

---

## Chunk graph

Dependency order. Chunks with no shared file overlap may run in parallel where the executor has capacity, but the gating constraints below are strict:

```
Chunk 0 (design)
    |
    v
Chunk 1 (gate honesty fix + baseline ratchet)  <- MUST land first; all later chunks depend on honest counts
    |
    v
Chunk 1' (honest tier-categorisation.md)       <- depends on Chunk 1 merged to working tree
    |
    +--> Chunk 2 (other gates + P3 harness)    <- independent of per-domain work; can run in parallel with 3-11
    |
    +--> Chunk 3 (agent-execution)
    |
    +--> Chunk 4 (skill-execution)
    |
    +--> Chunk 5 (workflow + WF1 contingent RLS migration)   <- MAY block on Chunk 0 WF1 verification result
    |
    +--> Chunk 6 (billing / cost)
    |
    +--> Chunk 7 (personal-assistant)
    |
    +--> Chunk 8 (sandbox)
    |
    +--> Chunk 9 (integration services)
    |
    +--> Chunk 10-11 (remaining domains - partition by Chunk 1')
                |
                v
        Chunk 12 (final Tier 2 annotation audit sweep)
                |
                v
        Chunk 13 (Tier 1-blocked escalation review)
                |
                v
        Chunk 14 (final-pass verification + PR body)
```

**Parallelism**: Chunks 2 through 11 share no source files with each other (Chunk 2 touches `scripts/*`; Chunks 3-11 touch `server/services/<domain>/*` exclusively). They are eligible to run concurrently by the builder fleet if capacity exists. Chunks 12-14 are strictly sequential.

**Critical-path serialisation**: Chunks 0 → 1 → 1' → {fan-out} → 12 → 13 → 14 is the minimum critical path. If everything else runs in parallel, six sequential chunks bound the wall-clock cost.

---

## Chunks

### Chunk 0 — design + audit + WF1 verification

- chunk_name: `design-and-audit`
- spec_sections: `§5.1, §6.1, §7.3, §8, §10 Chunk 0`
- files:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-fix-design.md` (new — Option A vs B comparison; Option B chosen)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md` (new — full audit list, with parity-evidence placeholders for Chunks 1 + 2 to fill)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/wf1-rls-verification.md` (new — per-table verdict for the five FK-scoped workflow tables: workflow_step_runs, workflow_step_reviews, workflow_studio_sessions, workflow_run_event_sequences, flow_step_outputs)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation-framework.md` (new — defines mandatory fields and partition rules; the actual per-callsite list is produced in Chunk 1')
- module shape:
  - *Public interface this chunk exposes:* four artefact files at known paths that downstream chunks consume.
  - *What stays hidden behind it:* the Linux-vs-Windows gate-count diffing pass, the `grep "CREATE POLICY.*ON <table>"` verification queries against `migrations/`, the cross-reference between `server/config/rlsProtectedTables.ts` and `scripts/.gate-baselines/fk-only-tenant-tables.txt`, the migration-order analysis for high-traffic services.
- contracts:
  - `gate-fix-design.md` includes the Option A / B comparison, the rejection rationale for Option A, and the locked Option B design.
  - `gate-audit-results.md` carries the full required-columns table from spec §6.1 (Gate path, Uses bug pattern, Baseline source, Linux count, Windows count, Bug verdict, Fix decision, Parity-verification evidence placeholder, Parity status, Residual risk) for every gate `scripts/run-all-gates.sh` invokes (~70 gates).
  - `wf1-rls-verification.md` per FK-scoped table: table name, existence of policy on current main (yes/no), policy migration file path (or "none"), recommendation (`no migration needed` / `author contingent migration in Chunk 5`).
  - `tier-categorisation-framework.md` enumerates the §8 mandatory fields, the Tier 0/1/1-blocked/2/3 partition rules, the dual-GUC sub-decision (per §7.1.1), and the column schema for `tier-categorisation.md` (produced in Chunk 1').
- error_handling: none — pure design / audit chunk. If a gate cannot be classified, leave the cell blank with a `# TBD-chunk-1` marker and resolve in Chunk 1 after the honest gate runs.
- verification:
  - All four artefact files exist under `tasks/builds/wave-6-rls-residue-and-gate-fix/`.
  - `gate-audit-results.md` has one row per gate invoked by `scripts/run-all-gates.sh` (~70 rows expected).
  - `wf1-rls-verification.md` has exactly five rows.
  - `npm run lint` exits 0.
- dependencies: none (entry chunk).

### Chunk 1 — gate honesty fix + baseline ratchet (ATOMIC)

- chunk_name: `gate-honesty-fix-and-baseline-ratchet`
- spec_sections: `§5.1, §5.2, §10 Chunk 1, KNOWLEDGE 2026-05-17 F1`
- files:
  - `scripts/lib/gate-file-enumerator.mjs` (new — pure helper, Node-native enumeration, OS-agnostic, honours `GATE_ROOT` env var)
  - `scripts/__tests__/gate-file-enumerator.test.ts` (new — Vitest; pins POSIX-style `/c/Files/...`, Windows `C:\Files\...`, Linux `/usr/...` path forms)
  - `scripts/verify-with-org-tx-or-scoped-db.sh` (modified — replaces `find -> TMP_FILES -> Node existsSync` chain with `node --input-type=module` invocation that calls `enumerateGateFiles()` then passes the file list to `analyseWithOrgTxScope(repoRoot, files)`)
  - `scripts/guard-baselines.json` (modified — key `with-org-tx-or-scoped-db` ratchets from `1108` to the post-fix Linux honest count read from CI evidence on the fix branch)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-transcripts/verify-with-org-tx-or-scoped-db.linux.txt` (new — Linux CI raw stdout of the gate post-fix)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-transcripts/verify-with-org-tx-or-scoped-db.windows.txt` (new — Windows local raw stdout of the gate post-fix; or operator-recorded `simulated-only` rationale if Windows execution unavailable)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md` (modified — fill in the `verify-with-org-tx-or-scoped-db` row's Linux count, Windows count, Parity-verification evidence cells)
  - `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` (modified — update narrative header to record the 2026-05-17 honest-count baseline; the file remains header-only, not the numeric source of truth)
- module shape:
  - *Public interface this chunk exposes:* `enumerateGateFiles({ root, includes, excludes }) -> string[]` (absolute paths in Node-native form, OS-agnostic); the gate script's exit code + stdout contract is preserved; the baseline integer for `with-org-tx-or-scoped-db` in `guard-baselines.json` is the only numeric promise downstream chunks check against.
  - *What stays hidden behind it:* the glob pattern composition, the GATE_ROOT precedence (env override → caller-supplied root → script-relative repo root), Node-vs-bash path-form coercion, the temp-file plumbing that used to live in the gate script, the JSON marshalling between bash and Node.
- contracts:
  - `enumerateGateFiles(opts)` signature:
    ```ts
    function enumerateGateFiles(opts: {
      root: string;                // absolute path; honours process.env.GATE_ROOT first
      includes: string[];          // glob patterns relative to root (e.g. ['server/services/**/*.ts'])
      excludes?: string[];         // glob patterns to filter out (e.g. ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'])
    }): string[];                  // absolute file paths, sorted, deduped, Node-native form
    ```
  - `verify-with-org-tx-or-scoped-db.sh` calls the helper with `includes: ['server/services/**/*.ts', 'server/jobs/**/*.ts', 'server/lib/**/*.ts', 'server/adapters/**/*.ts']` and `excludes: ['**/*.test.ts', '**/*.integration.test.ts', '**/node_modules/**']` — semantically equivalent to the pre-fix `find` enumeration on Linux, and OS-portable on Windows.
  - `guard-baselines.json` key `with-org-tx-or-scoped-db` ratchets to the integer reported by `verify-with-org-tx-or-scoped-db.sh` running on the Chunk-1 fix branch on Linux CI. The pre-fix value of `1108` is the working estimate; the actual ratchet number is the CI-reported number. Builder uses CI output as the source of truth for this single integer.
  - **Expected CI sequence for Chunk 1 (load-bearing — single-pass green CI is not achievable here):** (1) the builder lands the gate-honesty fix + the *estimated* baseline value (1108); (2) the first CI run on the chunk branch executes the fixed gate and reports the honest Linux count, which may or may not match 1108; (3) if the reported count differs from the committed baseline, CI fails intentionally — the builder reads the reported count from CI logs, ratchets `guard-baselines.json` to that exact integer in a follow-up commit on the same chunk, and pushes; (4) the second CI run passes. Both commits remain part of the same Chunk 1 landing unit per the F1 atomicity rule — neither commit ships in isolation. If the first CI run's reported count matches 1108 exactly, step (3) is a no-op and the first CI run passes.
  - Parity transcripts are committed at the paths above; if Windows execution is unavailable, the windows-side file contains the operator-recorded `simulated-only` rationale (≤120 chars) per spec §6.1.
- error_handling:
  - `enumerateGateFiles` throws synchronously if `opts.root` does not exist (programmer error, not gate output).
  - `verify-with-org-tx-or-scoped-db.sh` retains the existing `set -euo pipefail` and the `[GATE] ${GUARD_ID}: analyser failed` error envelope from the existing `with-org-tx-analyser.mjs` failure path.
  - The Vitest test asserts that POSIX-style `/c/Files/...` and Windows `C:\Files\...` paths both resolve to the same canonical file when present, and that Linux `/usr/...` paths pass through unchanged.
- verification:
  - `npx vitest run scripts/__tests__/gate-file-enumerator.test.ts` exits 0.
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
  - Local Windows operator runs `bash scripts/verify-with-org-tx-or-scoped-db.sh` and observes a Linux-equivalent violation count (within the §5.1 hard cap of 5 lines divergence). If divergence exceeds the cap, the chunk is NOT complete — the builder escalates to the operator with the divergence enumerated per §5.1.
  - Linux CI reports `with-org-tx-or-scoped-db` baseline count matches the `guard-baselines.json` value; CI gate run passes.
  - `gate-audit-results.md` row for `verify-with-org-tx-or-scoped-db.sh` has `parity-verified` disposition (or `simulated-only` with operator rationale).
- dependencies: Chunk 0 (gate-fix-design.md must exist; the gate-audit-results.md table row must exist for this chunk to fill in).

### Chunk 1' — honest tier-categorisation

- chunk_name: `honest-tier-categorisation`
- spec_sections: `§7.2, §7.3, §8, §10 Chunk 1'`
- files:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation.md` (new — produced from Chunk 1's now-honest gate output; one row per residue callsite with the §8 mandatory fields)
- module shape:
  - *Public interface this chunk exposes:* `tier-categorisation.md` is the per-domain chunks' input; downstream chunks read it to know which callsites in their domain are Tier 1 vs Tier 2 vs Tier 3 vs Tier 0 vs Tier 1-blocked.
  - *What stays hidden behind it:* the table-tier classification logic (read each callsite's target table → look up in `RLS_PROTECTED_TABLES` and `fk-only-tenant-tables.txt` → assign tier), the upstream-entrypoint tracing (ts-morph caller-walk to a named `authenticate` route or `createWorker` handler, falling back to Tier 1-blocked when no entrypoint can be named), the dual-GUC sub-decision (per §7.1.1).
- contracts:
  - `tier-categorisation.md` table columns (per spec §8): `file:line | Call expression | Target table | In RLS_PROTECTED_TABLES? | Tenant key | Tier verdict | Upstream entrypoint (Tier 1 only) | Bypass rationale + ADR (Tier 2 only) | Required new entrypoint (Tier 1-blocked only)`.
  - Expected distribution per spec §4: ~700-900 Tier 1, ~100-200 Tier 2, remainder Tier 3 + Tier 0 + blocked.
  - The file is grouped by domain (matching the per-domain chunks below) with sub-headers like `## agent-execution residue`, `## skill-execution residue`, `## workflow residue`, etc. Sub-totals per domain are stated in the section header.
- error_handling:
  - For each callsite where the tier verdict is ambiguous, mark as `Tier 1-blocked` and add a row in the file's `## Blocked verdicts requiring operator review` appendix. Chunk 13 resolves these.
- verification:
  - `tier-categorisation.md` exists.
  - The file's total row-count matches the `verify-with-org-tx-or-scoped-db` post-Chunk-1 baseline integer (i.e., honest count from `guard-baselines.json`).
  - Every row has a non-empty `Tier verdict` cell.
  - Every Tier 1 row has a non-empty `Upstream entrypoint` cell.
  - Every Tier 2 row has a non-empty `Bypass rationale` cell.
- dependencies: Chunk 1 (the gate must report honestly before tier categorisation is meaningful).

### Chunk 2 — other gates + P3 OS-parity harness

- chunk_name: `other-gates-fix-and-portability-harness`
- spec_sections: `§6.1, §6.2, §10 Chunk 2`
- files:
  - `scripts/verify-no-direct-boss-work.sh` (modified — apply Option B per spec §6.1; confirmed bug-affected per Wave 5 evidence of 4 entries visible only on Linux)
  - Any additional bug-affected gates surfaced by Chunk 0's audit (modified — one Option B fix per gate)
  - `scripts/test-gate-portability.sh` (new — OS-parity harness; for each file-scanning gate, asserts the gate detects a seeded-fixture violation; for each non-file-scanning gate, asserts exit ∈ {0, 1, 2, 3} AND non-empty stdout)
  - `scripts/__tests__/gate-portability/fixtures/<gate-id>/...` (new — per-gate seeded-fixture directories; one known violation per gate)
  - Any file-scanning gate that does not currently honour `GATE_ROOT` (modified — accept the env-var override; §6.2 fixture-injection contract)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-transcripts/<other-bug-affected-gate>.{linux,windows}.txt` (new — parity transcripts for each bug-affected gate fixed in this chunk)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md` (modified — fill in Linux/Windows counts + parity-verification cells for every gate this chunk touches)
  - `scripts/run-all-gates.sh` (modified — register `scripts/test-gate-portability.sh` as a gate)
- module shape:
  - *Public interface this chunk exposes:* `bash scripts/test-gate-portability.sh` pass/fail; every file-scanning gate now accepts `GATE_ROOT` env var override.
  - *What stays hidden behind it:* the per-gate seeded fixtures (each gate's specific seeded-violation pattern lives under `scripts/__tests__/gate-portability/fixtures/<gate-id>/`), the harness's exit-code interpretation logic, the GATE_ROOT precedence retrofit per gate.
- contracts:
  - Each bug-affected gate's enumeration block is replaced with `node --input-type=module <<<'... await import enumerateGateFiles ...'` matching Chunk 1's pattern. Same helper, same path-form contract.
  - `scripts/test-gate-portability.sh` iterates every gate `run-all-gates.sh` invokes. For each:
    - File-scanning gate: set `GATE_ROOT=scripts/__tests__/gate-portability/fixtures/<gate-id>`, run the gate, assert exit-code is non-zero (gate fired) AND stdout names the seeded fixture file.
    - Non-file-scanning gate: run the gate against repo root, assert exit ∈ {0, 1, 2, 3} AND stdout is non-empty.
  - Each fixture under `scripts/__tests__/gate-portability/fixtures/<gate-id>/` contains the minimum repo structure the gate needs (e.g. `server/services/seededViolation.ts` for `with-org-tx-or-scoped-db`) with exactly one seeded violation.
  - Parity-evidence rule (per spec §6.1 + §9 acceptance #1): every bug-affected gate has linux + windows transcript files committed under `gate-transcripts/`, OR carries `simulated-only` disposition recorded in `gate-audit-results.md` with operator rationale.
- error_handling:
  - `test-gate-portability.sh` runs `set -euo pipefail` and accumulates per-gate verdicts. A single per-gate failure does not abort the run; the harness reports all failures at the end with the per-gate exit codes.
  - If a gate cannot be made GATE_ROOT-honouring without significant rework, the gate's row in `gate-audit-results.md` records the limitation as `excluded-with-rationale` and the harness skips it. This is the documented escape hatch in spec §6.1.
- verification:
  - `bash scripts/test-gate-portability.sh` exits 0 locally (against fixtures; this is a single targeted script run, not a gate sweep).
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
  - `gate-audit-results.md` `Parity status` cell is `parity-verified` or `simulated-only` for every bug-affected gate fixed in this chunk; no cells remain blank.
- dependencies: Chunk 1 (the helper this chunk reuses must exist; the audit-results table this chunk fills in must exist).

### Chunk 3 — agent-execution residue (F4 completion)

- chunk_name: `agent-execution-residue`
- spec_sections: `§7.1, §7.1.1, §7.2 (F4), §10 Chunks 3-N, §11 risk row 1, §13`
- files: per Chunk 1' partition; expected scope includes:
  - `server/services/agentExecutionService.ts`
  - `server/services/agentExecutionService/runLifecycle/dispatch.ts`
  - `server/services/agentExecutionService/runLifecycle/validate.ts`
  - `server/services/agentExecutionService/runLifecycle/persistRun.ts`
  - `server/services/agentExecutionService/runLifecycle/complete.ts`
  - `server/services/agentExecutionService/runLifecycle/configure.ts`
  - `server/services/agentExecutionService/runLifecycle/loadContext.ts`
  - `server/services/agentExecutionService/runLifecycle/prepare.ts`
  - `server/services/agentExecutionService/backendDispatch.ts`
  - `server/services/agentExecutionService/promptBuilders.ts`
  - `server/services/agentExecutionService/resume.ts`
  - any agent-execution-domain files surfaced in Chunk 1' `tier-categorisation.md § agent-execution residue`
- module shape:
  - *Public interface this chunk exposes:* each modified file's exported functions retain byte-identical signatures; route handlers and pg-boss workers calling these functions need no caller change.
  - *What stays hidden behind it:* the swap from `db.*` to `getOrgScopedDb('agentExecutionService.functionName')` (Tier 1) or `withAdminConnection({ source, reason }, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })` (Tier 2); local-binding renames to `scopedDb`; transaction-nesting reuse; predicate retention.
- contracts (per-callsite, from §7.1 + §7.1.1):
  - Tier 1: convert `await db.select().from(table).where(eq(table.organisationId, orgId))...` to `const scopedDb = getOrgScopedDb('agentExecutionService.<functionName>'); await scopedDb.select().from(table).where(eq(table.organisationId, orgId))...` — the `where` clause **stays**.
  - Tier 1 inside an existing `tx` closure: reuse `tx`, do NOT call `getOrgScopedDb()`.
  - Tier 2: convert raw `db.*` to `withAdminConnection({ source: 'agentExecutionService.<functionName>', reason: '<rationale>' }, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. No annotation needed (analyser stops counting once the call expression is no longer `db.*`).
  - Tier 2 unable to move to `withAdminConnection`: retain `db.*` with one of the three Wave-5 guard-ignore forms + WHY comment + ADR reference.
  - Tier 0 / Tier 3 (if any in this domain): annotate per §8.
  - Import: relative path from caller, `.js` suffix (e.g. `import { getOrgScopedDb } from '../../lib/orgScopedDb.js';`).
  - Local binding: `scopedDb` (never `db`).
  - `source` argument: `'agentExecutionService.<functionName>'` (matches Wave 5 convention).
- error_handling:
  - Existing error-handling code paths in each function remain unchanged. The swap is a connection-acquisition change, not a logic change.
  - If a callsite in `tier-categorisation.md` cannot be migrated because the entrypoint named in `Upstream entrypoint` does not actually wire `withOrgTx` (Chunk 1' false positive), reclassify the callsite as `Tier 1-blocked` in `tier-categorisation.md`, log to `tasks/todo.md` per §8 blocked-tier follow-up format, and skip the migration for that callsite in this chunk. Chunk 13 resolves blocked entries.
- verification:
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
  - `npm run build:server` exits 0.
  - **Reviewer-side acceptance check** (must be confirmed in chunk completion notes): every Tier 1 migration in this chunk preserves the `.where(eq(table.organisationId, orgId))` predicate verbatim. Diff inspection — if `git diff` shows a removed `.where(eq(*.organisationId, *))` line, the chunk is NOT complete.
  - The post-chunk `with-org-tx-or-scoped-db` count decreases by the count Chunk 1' attributes to the agent-execution domain (within ±5; CI is the canonical runner for the final number).
- dependencies: Chunk 1' (must know the per-callsite tier verdicts before touching files).

### Chunk 4 — skill-execution residue (F7 completion)

- chunk_name: `skill-execution-residue`
- spec_sections: `§7.1, §7.1.1, §7.2 (F7), §10 Chunks 3-N, §11 risk row 1`
- files: per Chunk 1' partition; expected scope includes:
  - `server/services/skillExecutor.ts`
  - `server/services/skillExecutorPure.ts` (Tier 0 / 3 callsites if any — pure helpers shouldn't have DB callsites, but the gate may still flag if any leaked)
  - `server/services/skillExecutorDelegationPure.ts` (same)
  - any skill-execution-domain files surfaced in Chunk 1' `tier-categorisation.md § skill-execution residue`
- module shape:
  - *Public interface this chunk exposes:* `skillExecutor` exported methods retain identical signatures; the F7 `db.update(tasks)` write at the legacy line:4302 callsite (or its post-#311 location) is migrated to `getOrgScopedDb('skillExecutor.<functionName>')`.
  - *What stays hidden behind it:* same migration pattern as Chunk 3; predicate retention; Tier 2 transition to `withAdminConnection` where applicable.
- contracts: identical to Chunk 3 except `source` strings use `'skillExecutor.<functionName>'`.
- error_handling: identical to Chunk 3.
- verification: identical to Chunk 3; post-chunk count drops by skill-execution domain's Chunk 1' attribution.
- dependencies: Chunk 1'.

### Chunk 5 — workflow services + WF1 contingent RLS migration

- chunk_name: `workflow-residue-and-wf1-rls`
- spec_sections: `§7.1, §7.1.1, §7.3 (WF1/3/4/6), §10 Chunks 3-N, §11 risk row 2`
- files:
  - **If Chunk 0's `wf1-rls-verification.md` flags any of the five FK-scoped tables as missing a policy on current main:**
    - `migrations/<next-number>_rls_workflow_fk_scoped_tables.sql` (new — CREATE POLICY statements for the missing tables, in a single migration; migration filename is **strictly lower** than any companion change so deployment order is correct per §7.3)
    - `server/config/rlsProtectedTables.ts` (modified — add the WF1 tables in the same commit per §7.3 deployment-ordering contract)
  - `server/services/workflowEngineService.ts` (WF3)
  - `server/services/workflowEngine/queueLifecycle/tick.ts` (WF4 — note the §2 exception: `resolveOrgContext: () => null` pattern; rewire to `withOrgTx(row.organisationId, ...)` after the cross-tenant row lookup per DEVELOPMENT_GUIDELINES §2)
  - `server/services/workflowEngine/queueLifecycle/watchdog.ts` (same WF4 exception)
  - `server/services/workflowAgentRunHook.ts` (WF6 — `db.select` on `agent_runs` at line 36-39 or its current location)
  - Any other workflow-domain files surfaced in Chunk 1' `tier-categorisation.md § workflow residue`
- module shape:
  - *Public interface this chunk exposes:* workflow service exported methods retain identical signatures; the WF1 RLS policy migration adds tenant-isolation policies on `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs` (those that don't already have them); `RLS_PROTECTED_TABLES` gains the missing WF1 table entries.
  - *What stays hidden behind it:* the WF4 `resolveOrgContext: () => null` re-wiring pattern (cross-tenant lookup → `withOrgTx({tx, organisationId, ...})` re-entry); the WF1 policy SQL details (canonical RLS policy template per architecture.md § Row-Level Security).
- contracts:
  - **WF1 deployment ordering (per §7.3):** the RLS-policy migration filename has a strictly-lower migration number than any companion change in this chunk; deployment runs migrations before booting the server. Builder confirms by inspecting the migration directory immediately before commit (per CLAUDE.md migration-number-collision pattern at KNOWLEDGE 2026-05-08).
  - **WF1 manifest update:** every WF1 RLS-protected table added in the new migration also lands in `server/config/rlsProtectedTables.ts` in the same commit.
  - **WF4 re-wire pattern (per DEVELOPMENT_GUIDELINES §2):** after the cross-tenant row lookup in `tick.ts` and `watchdog.ts`, every subsequent DB call runs inside `withOrgTx({tx, organisationId: run.organisationId, ...}, async () => { /* ... use getOrgScopedDb here ... */ })`.
  - **Tier 1 / Tier 2 migrations per file:** same template as Chunk 3, `source` strings use `'workflowEngineService.<functionName>'`, `'workflowEngineTick.<functionName>'`, `'workflowAgentRunHook.<functionName>'`, etc.
  - **Predicate retention** per §7.1.1.
- error_handling:
  - If Chunk 0's `wf1-rls-verification.md` was wrong about a table's policy status (verified policies on current main but Chunk 5 finds otherwise, or vice versa), pause the chunk and revisit the verification before proceeding. A policy migration shipped against a table that already has a policy is at best a no-op, at worst a corrective migration with no NOTE comment (which fails the §6 migration discipline gate). A policy migration NOT shipped against a table that needs one fails §9 acceptance #4 because `getOrgScopedDb()` reads return 0 rows silently.
  - If a `withOrgTx` re-entry inside `tick.ts` or `watchdog.ts` introduces a nested-transaction error at runtime (the pg-boss handler may have already opened a tx via `createWorker`), the builder reverts the re-wire for that callsite, marks it `Tier 1-blocked`, and escalates to Chunk 13.
- verification:
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
  - `npm run build:server` exits 0.
  - If a new migration was shipped: `npm run db:generate` produces no schema-drift diff (the migration is hand-written SQL, not Drizzle-generated, but the schema file changes — if any — must round-trip).
  - **Reviewer-side acceptance check** (must be confirmed in chunk completion notes): the WF1 migration file is numerically lower than any other migration in this chunk's diff. `git log --oneline migrations/` confirms deployment order.
  - The post-chunk `with-org-tx-or-scoped-db` count decreases by the workflow domain's Chunk 1' attribution.
- dependencies: Chunk 1' (per-callsite verdicts); Chunk 0 (`wf1-rls-verification.md` must exist).

### Chunk 6 — billing / cost services residue

- chunk_name: `billing-cost-residue`
- spec_sections: `§7.1, §7.1.1, §10 Chunks 3-N`
- files: per Chunk 1' partition; expected scope: `server/services/<billing-*>.ts`, `server/services/<cost-*>.ts`, `server/services/workflowRunCostLedgerService.ts`, and any other billing-domain files surfaced in `tier-categorisation.md § billing residue`.
- module shape: same template as Chunk 3.
- contracts: same template as Chunk 3; `source` strings use the billing service names.
- error_handling: same template as Chunk 3.
- verification: same template as Chunk 3; post-chunk count drops by billing domain's Chunk 1' attribution.
- dependencies: Chunk 1'.

### Chunk 7 — personal-assistant residue

- chunk_name: `personal-assistant-residue`
- spec_sections: `§7.1, §7.1.1, §10 Chunks 3-N`
- files: per Chunk 1' partition; expected scope: `server/services/personal*`, and any other personal-assistant-domain files surfaced in `tier-categorisation.md § personal-assistant residue`.
- module shape: same template as Chunk 3.
- contracts: same template as Chunk 3; `source` strings use `'personalAssistant.<functionName>'`.
- error_handling: same template as Chunk 3.
- verification: same template as Chunk 3; post-chunk count drops by personal-assistant domain's Chunk 1' attribution.
- dependencies: Chunk 1'.

### Chunk 8 — sandbox services residue

- chunk_name: `sandbox-residue`
- spec_sections: `§7.1, §7.1.1, §10 Chunks 3-N`
- files: per Chunk 1' partition; expected scope: `server/services/sandbox*`, and any other sandbox-domain files surfaced in `tier-categorisation.md § sandbox residue`.
- module shape: same template as Chunk 3.
- contracts: same template as Chunk 3; `source` strings use `'sandbox.<functionName>'`.
- error_handling: same template as Chunk 3.
- verification: same template as Chunk 3; post-chunk count drops by sandbox domain's Chunk 1' attribution.
- dependencies: Chunk 1'.

### Chunk 9 — integration services residue

- chunk_name: `integration-services-residue`
- spec_sections: `§7.1, §7.1.1, §10 Chunks 3-N`
- files: per Chunk 1' partition; expected scope: `server/services/integrationConnectionService.ts`, `server/services/ghl*`, `server/services/connectionTokenService.ts`, and any other integration-domain files surfaced in `tier-categorisation.md § integration residue`.
- module shape: same template as Chunk 3.
- contracts: same template as Chunk 3; `source` strings use the integration service names.
- error_handling: same template as Chunk 3.
- verification: same template as Chunk 3; post-chunk count drops by integration domain's Chunk 1' attribution.
- dependencies: Chunk 1'.

### Chunks 10-11 — remaining Tier 1 services (partitioned by Chunk 1' output)

- chunk_name (10): `remaining-residue-batch-a`
- chunk_name (11): `remaining-residue-batch-b`
- spec_sections: `§7.1, §7.1.1, §10 Chunks 3-N`
- files: per Chunk 1' partition. Chunk 1' will reveal which domains have residue (`server/jobs/*`, `server/lib/*`, `server/adapters/*`, plus any service domains not covered by Chunks 3-9). Builder splits the remaining domains across these two chunks, keeping the ≤50-file ceiling per chunk per spec §10. If Chunk 1' shows only one batch worth of residue, Chunk 11 is empty and merged with Chunk 10.
- module shape: same template as Chunk 3.
- contracts: same template as Chunk 3.
- error_handling: same template as Chunk 3.
- verification: same template as Chunk 3.
- dependencies: Chunk 1'.

### Chunk 12 — final Tier 2 annotation audit sweep

- chunk_name: `final-tier-2-annotation-sweep`
- spec_sections: `§8 (Tier 2 rules), §9 acceptance #4 + #6, §10 Chunk 13`
- files:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-2-audit.md` (new — one row per Tier 2 callsite touched in Chunks 3-11; verifies the correct form was applied: `withAdminConnection` migration OR one of the three Wave-5 guard-ignore forms with WHY + ADR)
  - Any files where Chunks 3-11 left an unannotated Tier 2 callsite that retains `db.*` (modified — add the correct guard-ignore form)
- module shape:
  - *Public interface this chunk exposes:* `tier-2-audit.md` is the auditable record that every Tier 2 callsite has been correctly handled.
  - *What stays hidden behind it:* per-callsite cross-check against `tier-categorisation.md` Tier 2 rows; verification that `withAdminConnection` migrations carry the explicit `SET LOCAL ROLE admin_role` inside the callback (the wrapper itself does NOT acquire BYPASSRLS per spec §8); verification that `db.*` retentions carry the three required elements.
- contracts:
  - Every row in `tier-categorisation.md § Tier 2` has a corresponding row in `tier-2-audit.md` with disposition = `migrated-to-withAdminConnection` OR `db-with-guard-ignore-form-1` / `-form-2` / `-form-3` (the three Wave-5 forms).
  - For `db-with-guard-ignore-*` dispositions, the audit row cites the WHY comment and the ADR ID.
  - For `migrated-to-withAdminConnection`, the audit row confirms the callback contains `SET LOCAL ROLE admin_role` if the callsite needs BYPASSRLS.
- error_handling:
  - If an audit row reveals a Tier 2 callsite was migrated to `withAdminConnection` but the `SET LOCAL ROLE admin_role` is missing inside the callback (so the migration is a no-op for cross-tenant access), the chunk re-opens the relevant file and adds the SET LOCAL ROLE statement. The audit row's disposition flips from `incorrect` to `corrected-in-chunk-12`.
- verification:
  - `tier-2-audit.md` exists with one row per Tier 2 callsite from `tier-categorisation.md`.
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
- dependencies: Chunks 3-11 (all per-domain chunks must be complete; this chunk is the verification pass).

### Chunk 13 — Tier 1-blocked escalation review

- chunk_name: `tier-1-blocked-escalation`
- spec_sections: `§8 (Tier 1-blocked), §9 acceptance #11, §10 Chunk N+1, §11 risk row 4`
- files:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-1-blocked-resolutions.md` (new — one row per Tier 1-blocked entry from `tier-categorisation.md`; per-row resolution: (a) extend existing entrypoint, (b) accept as v2-backlog, (c) defer the callsite)
  - For resolution (a): the file containing the blocked callsite is opened and the entrypoint extended (modified) — these are surgical edits, no domain-wide rewrite
  - For resolution (b): `tasks/todo.md` (modified — add the §8 blocked-tier follow-up format entry: file:line, owning domain, required new entrypoint, risk surface, proposed v2-backlog disposition)
  - For resolution (c): the file containing the blocked callsite is opened and the callsite deleted (modified)
- module shape:
  - *Public interface this chunk exposes:* the build's blocked-tier disposition is captured in `tier-1-blocked-resolutions.md`; `tasks/todo.md` carries any v2-backlog entries; the residue callsite count after this chunk is the §9 acceptance #4 baseline target.
  - *What stays hidden behind it:* the operator's per-blocked decision (which routes need new entrypoints, which callsites are v2-backlog, which are dead code).
- contracts:
  - Every blocked entry in `tier-categorisation.md § Blocked verdicts requiring operator review` has a resolution in `tier-1-blocked-resolutions.md` with disposition in {`resolved-via-entrypoint-extension`, `accepted-as-v2-backlog`, `deferred-callsite-deleted`}.
  - For `accepted-as-v2-backlog`, the matching `tasks/todo.md` entry exists at format: `[ ] <file:line> | <owning-domain> | <required-new-entrypoint> | <risk-surface> | <proposed-v2-disposition>`.
- error_handling:
  - If the operator cannot give a disposition for a blocked entry, the chunk pauses and escalates with the entry + context. The build does not close until every blocked entry has a recorded disposition.
- verification:
  - `tier-1-blocked-resolutions.md` exists with one row per blocked entry.
  - `tasks/todo.md` has the §8-formatted entries for every `accepted-as-v2-backlog` disposition.
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
- dependencies: Chunk 12 (Tier 2 work complete; only blocked entries remain).

### Chunk 14 — final-pass verification + PR body

- chunk_name: `final-pass-verification-and-pr-body`
- spec_sections: `§6.1, §6.2, §9 acceptance #12 + #14, §10 Chunk N+2`
- files:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md` (modified — re-run §6.1 audit against the post-migration codebase; refresh Linux/Windows counts; confirm `parity-verified` disposition holds for every bug-affected gate)
  - `scripts/guard-baselines.json` (modified — ratchet `with-org-tx-or-scoped-db` from the Chunk 1 honest count to the post-migration value (target: count of operator-deferred Tier 1-blocked callsites only; goal 0 if no Tier 1-blocked deferrals); ratchet `no-direct-boss-work` and any other bug-affected gates' baselines per their Chunk 2 + per-domain-chunk-driven decreases)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-transcripts/<gate>.{linux,windows}.txt` (modified — append post-migration transcripts to every bug-affected gate's transcripts; original Chunk 1 + 2 transcripts retained for archaeology)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/per-service-tier-summary.md` (new — table form: domain | Tier 1 migrated | Tier 2 migrated | Tier 0 annotated | Tier 3 annotated | blocked-deferred)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/pr-body.md` (new — PR-body draft per spec §9 acceptance #14; includes the per-service-tier summary, per-gate verdict table, baseline-ratchet evidence, closed-todo-list of F3/F4/F7/WF1/WF3/WF4/WF6/P3 + 3 Wave-6 follow-ups)
- module shape:
  - *Public interface this chunk exposes:* the PR body is the operator-readable evidence that every spec acceptance criterion has been satisfied; `scripts/guard-baselines.json` reflects the post-build canonical state.
  - *What stays hidden behind it:* the re-run mechanics, the per-domain count reconciliation, the PR-body composition.
- contracts:
  - Post-migration `with-org-tx-or-scoped-db` baseline equals `(operator-deferred Tier 1-blocked count from Chunk 13)`. Per §9 acceptance #4, the goal is 0; if blocked-deferred entries exist, the baseline records that number.
  - `gate-audit-results.md` confirms OS-parity holds across every bug-affected gate (target: 0 divergence; hard cap: 5 lines per gate, with classification of each tolerated divergence).
  - `per-service-tier-summary.md` rows sum to the Chunk 1' total, partitioned across migrated / annotated / deferred. The math has to add up; reviewers cross-check.
- error_handling:
  - If the post-migration baseline does not match the Chunk 13 deferred count (e.g. some Tier 1 callsites were missed by per-domain chunks), the missing callsites are surfaced in this chunk's verification step, the relevant per-domain chunk is re-opened, and the chunk does NOT close until reconciliation holds.
- verification:
  - `npm run lint` exits 0.
  - `npm run typecheck` exits 0.
  - `npm run build:server` exits 0.
  - `npm run build:client` exits 0.
  - Every artefact file (`gate-audit-results.md`, `per-service-tier-summary.md`, `pr-body.md`) exists with the required content.
  - `tasks/todo.md` items F3, F4, F7, WF1, WF3, WF4, WF6, P3 + 3 Wave-6 follow-ups are marked `[status:closed:pr:<num>]` (the PR number is the build's open PR — builder uses placeholder until merge time per CLAUDE.md task-management workflow).
  - **CI run**: the canonical pass per §9 acceptance #10. Local lint/typecheck/build are necessary but not sufficient; CI is the final canonical signal.
- dependencies: Chunks 12 + 13.

---

## Risks and mitigations

Spec §11 covers the locked risk register. The plan-level risks below are additive — they cover risks that surface from the chunk-graph itself, not the migration content.

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Chunk 1 ships but Chunk 1's baseline ratchet number is wrong** (e.g. the CI-reported integer differs from the working estimate by more than a handful — say, 1,108 turns into 1,250 once the gate runs honestly). | medium | Builder reads the CI integer from the Chunk-1 fix-branch CI output as the canonical source. Any divergence from the spec's `~1,108` estimate is surfaced in chunk completion notes and re-flowed into Chunk 1' tier-categorisation. The build does not commit a guessed baseline integer. |
| **Chunk 1' tier verdicts are wrong for a non-trivial number of callsites** (e.g. an upstream entrypoint named by the analyser doesn't actually wire `withOrgTx`). | medium | Per-domain chunks (3-11) treat the Chunk 1' verdicts as input but builders re-verify the upstream entrypoint when they touch each file. Any callsite whose Tier 1 verdict cannot be confirmed at migration time is reclassified to `Tier 1-blocked` and surfaced in `tasks/todo.md` per §8. |
| **Branch staleness during multi-day build window** (concurrent Sessions P/Q/R touch files Chunks 3-11 own). | high | Per spec §13, Session Q's stale-status sweep waits until O publishes Chunks 0+1+post-fix baseline. Session R reads `tier-categorisation.md` before drafting its plan. Builder runs `git fetch origin main` at every chunk boundary; any merge conflict on tenant-isolation code requires operator review (no automated conflict resolution per spec §13 HARD RULE). |
| **WF1 RLS migration ships against a table that already has a policy** (Chunk 0 verification was wrong, or a parallel branch landed the policy first). | low-medium | Chunk 5 re-verifies each WF1 table's policy state against current `main` immediately before writing the migration. If a policy already exists, the migration is empty for that table and the manifest entry is checked-only (no schema change). |
| **WF1 RLS migration ships AFTER code that depends on it** (deployment order violated). | medium | Spec §7.3 deployment-ordering contract: the policy migration filename is strictly-lower than any companion change in the chunk. Chunk 5 verification step explicitly confirms `git log --oneline migrations/` shows policy-first order. |
| **A per-domain chunk drops a `.where(eq(table.organisationId, orgId))` predicate**. | high | Reviewer-side enforcement at three layers: per-chunk acceptance criterion, builder follows the §7.1 template verbatim, PR-reviewer + chatgpt-pr-review pass on each per-domain chunk. Any `git diff` showing predicate removal is a chunk-incomplete signal. |
| **`withAdminConnection` Tier 2 migration omits `SET LOCAL ROLE admin_role` inside the callback** (so cross-tenant access still fails, silently). | medium | Chunk 12 audit sweep explicitly checks for `SET LOCAL ROLE admin_role` in every `withAdminConnection` callback that needs BYPASSRLS. If missing, Chunk 12 corrects. |
| **Chunk 1's path-form Vitest test passes on Linux CI but Windows execution is unavailable** (so the `simulated-only` disposition gets recorded for the Windows transcript). | low | Per spec §6.1, `simulated-only` is an accepted disposition with operator acceptance; it does NOT satisfy the OS-parity claim and the gate stays a tracked exception until Windows evidence lands. The plan does not block on Windows evidence — it records absence honestly. |
| **PR review fatigue from 14 chunks** (the per-domain chunks are mechanically similar and may receive less attention than they need). | medium | Chunks 3-11 follow the same template, but each goes through `pr-reviewer` per `feature-coordinator`'s GRADED posture (Major build → mandatory `pr-reviewer` + `reality-checker` + `dual-reviewer`). Predicate retention is the single check the reviewer must perform, and it is mechanically visible in the diff. |
| **Migration-number collision on the WF1 contingent migration** (parallel branch lands a migration with the same number during build window). | low-medium | Chunk 5 builder runs `ls migrations/` immediately before commit and renumbers if needed per the 2026-05-08 KNOWLEDGE entry (KNOWLEDGE.md line 109). Down-migration renamed in lockstep. |

---

## Out of scope

Re-stated from spec §12 for plan-level clarity:

- LAEL Phase 3 retention tiering (v2-backlog)
- Hermes H2 rollup-vs-ledger asymmetry (v2-backlog)
- 188 `:any` ratchet (`verify-any-budget.sh` ratchets naturally)
- IEE-DEF (dead-code pending live traffic)
- OSI-DEF future-state operator-session items
- Sandbox advisory waiting on e2b SDK
- The operator's 1-2 features (Wave 6 Session R, separate branches)
- Any Tier 1-blocked callsite the operator defers per spec §8 — logged in `tasks/todo.md` with the §8 blocked-tier handoff format

Additionally NOT in scope for this plan (plan-level clarifications):

- No changes to `getOrgScopedDb()`, `withOrgTx()`, `withAdminConnection()` primitives. Same primitives Wave 5 used; this build is mechanical migration only.
- No new gate-suppression annotation forms. The three Wave-5 forms are exhaustive.
- No drive-by lint cleanup outside the migration scope.
- No new test suites authored beyond the targeted unit tests for the path-form helper (Chunk 1) and the gate-portability harness (Chunk 2). Per `docs/spec-context.md` `runtime_tests: pure_function_only`, runtime tests are reserved for pure helpers.
- **No predicate-retention gate**. The §7.1.1 rule is enforced reviewer-side, not gate-side. A future PR may add such a gate if predicate-removal becomes a recurring regression class; out of scope here.

---

## Open questions for build

None. Handoff §"Open questions for Phase 2: none". Phase 1 review locked all decisions per spec-reviewer iter 3 + chatgpt-spec-review Round 1.

If new ambiguity surfaces during execution (e.g. an unexpected Tier 1-blocked count, a Chunk 0 finding that contradicts the spec), the builder appends to this section and pauses for operator confirmation — per CLAUDE.md §1 stuck-detection rule.
