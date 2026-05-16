# Spec Review Iteration 1 — wave-4-architectural-and-duplication

**Iteration:** 1 of 5
**Spec commit at start:** 77b70f82
**Timestamp:** 20260516-104032

## Codex output summary
Codex returned 10 findings. Captured at `/tmp/codex-iter1.txt`. Findings span: missing HandlerContext contract, file/factory split, file inventory drift, count reconciliation, unnamed primitives, unresolved chunk 0 decisions, missing per-DUP acceptance, missing frontmatter fields, missing Lifecycle+ABCd blocks, missing verification log.

## Rubric findings (this iteration)
- **R1**: §4 touch surface lists `notifyOperatorFanout` service — does not exist in tree (only `notifyOperatorChannels/` exists). No DUP item targets it. Stale.
- **R2**: §4 lists `client/src/pages/{operate, govern, system, ...}` but `client/src/pages/system/` does not exist — system pages live at the top level (e.g. `SystemIncidentsPage.tsx`). Wrong path.
- **R3**: §4 says "client/src/components/ (8 new shared modules)" — actual count is 5 client modules + 3 server modules = 8 total, but only 5 are under `client/src/components/`. Wording is misleading.
- **R4**: §8 acceptance #7 references `verify-duplicate-blocks.sh` as a local-run criterion — per CLAUDE.md *Test gates are CI-only*, `scripts/verify-*.sh` must NOT be invoked locally. Reword to "CI-enforced baseline drops" so the spec does not instruct implementers to run the script.
- **R5**: §8 acceptance #8 says "Existing test suite (where present) passes" — same test-gate-policy concern; rephrase to limit to targeted unit tests for code authored in this build (per CLAUDE.md verification table) rather than the full suite.
- **R6**: §1 says "13 items, CD1 sized as Significant within Major-class". Counts cascade (1+8+4=13) is fine. No fix.

## Findings classification

### FINDING #1 — HandlerContext load-bearing but not contractually pinned
- Source: Codex
- Section: §5.2, §9, §10
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Load-bearing-claim-without-mechanism rubric hit. The spec says "handlers receive a HandlerContext" but does not pin module path, type name, argument position, producer, consumers, `import type` requirement. Adding the contract does not change scope or framing.

### FINDING #2 — Pure type module + boot-time factory split
- Source: Codex
- Section: §5.2
- Classification: **directional**
- Disposition: AUTO-DECIDED (accept)
- Reasoning: Matches "Introduce a new abstraction / change interface" architecture signal. However, this is the standard cycle-break pattern — if the type lives in the same file as the wiring factory, the cycle returns through the type module. Separating type-only module from wiring is what actually enables the cycle break the spec exists to achieve. Conservative acceptance per Step 7 priority 3.
- → tasks/todo.md AUTO-DECIDED entry

### FINDING #3 — File inventory drift; replace prose with Files-to-change table
- Source: Codex
- Section: §4, §6, §8
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Checklist §2 file-inventory-lock — every new file/service/migration must appear in the inventory. Spec currently uses prose "Total touch surface" sentence. Replacing with a table is canonical.

### FINDING #4 — Duplicated-line count does not reconcile
- Source: Codex
- Section: §6, §8
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Numeric-count reconciliation rubric. Sum of declared block sizes (213+209+176+178+125+68+143+44+33+28*4+32 ≈ 1,381–1,500 by jscpd accounting) does not match the spec's "~1,800". Either restate as "approximately 1,200-1,500 lines of duplicated source" or annotate the variance explicitly.

### FINDING #5 — Unnamed primitives (historyRender, TemplateGrid, templateHelpers, "or equivalent")
- Source: Codex
- Section: §6.1, §6.5, §6.6
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Rubric "unnamed new primitives" hit. Lock module paths and export names now to prevent invention of parallel primitives during execution.

### FINDING #6 — Chunk 0 contains unresolved product decisions
- Source: Codex
- Section: §7, §9
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Spec already states the default decisions in §7 prose ("Default: trim FE1; accept the others"). Making the defaults binding-unless-overridden converts implied behaviour to explicit verdict, satisfies the "every item has a verdict" rubric, and does not change scope. Operator preference (per MEMORY.md) is to auto-decide mechanical/process matters inside coordinator runs.

### FINDING #7 — Per-DUP acceptance criteria missing
- Source: Codex
- Section: §6, §9
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Every chunk should have explicit acceptance. Add one-line acceptance per DUP naming old file(s), new shared module, verification signal.

### FINDING #8 — Frontmatter does not match Checklist §11
- Source: Codex
- Section: frontmatter
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Frontmatter uses YAML-block (lowercase keys) but checklist §11 wants `Status:` / `Spec date:` / `Last updated:` / `Author:` / `Build slug:` as markdown bolded fields. Add the canonical block; keep the existing YAML for backward-compat parsers.

### FINDING #9 — Lifecycle Declaration + ABCd Estimate missing
- Source: Codex
- Section: top matter
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Checklist §12 mandates both blocks for Standard+ specs. Add them.

### FINDING #10 — Present-state verification log missing
- Source: Codex
- Section: §1, checklist §0
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Checklist §0 mandates verification of cited deferred items. I just ran the present-state check (CD1 services exist; DUP destination dirs do not exist yet which is correct since the build will create them; DUP4 source files at `client/src/components/{agent-chat,config-assistant}/messageRender.tsx` confirmed; DUP1 source pages exist; DUP7 services exist; calendar/slack action services exist at `server/services/{calendar,slack}/`; prune jobs: 6 exist, spec claims 4 mirroring audit baseline — surfaceable as Chunk 0 verification action). Add a compact inline verification table.

### Rubric findings

### FINDING R1 — Stale `notifyOperatorFanout` service in touch surface
- Source: Rubric (stale reference)
- Section: §4
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Service does not exist in tree (only `notifyOperatorChannels/`), no DUP item targets it. Delete from touch surface.

### FINDING R2 — Non-existent `client/src/pages/system/` path
- Source: Rubric (file-inventory drift)
- Section: §4
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: System pages live at top level (`SystemIncidentsPage.tsx`, `SystemOrganisationTemplatesPage.tsx`). Path `client/src/pages/system/` does not exist. Subsumed by FINDING #3 (replace prose with table).

### FINDING R3 — "8 new shared modules" under `client/src/components/` is misleading
- Source: Rubric (numeric-count reconciliation)
- Section: §4
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Only 5 modules live in `client/src/components/`; 3 live under `server/`. Subsumed by FINDING #3.

### FINDING R4 — §8 acceptance #7 instructs running `verify-duplicate-blocks.sh` locally
- Source: Rubric (CLAUDE.md test-gate-policy)
- Section: §8
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Per CLAUDE.md *Test gates are CI-only — never run locally* and the spec-reviewer rules ("test gates are CI-only — never recommend running them"), rephrase to "CI-enforced baseline drops" so the spec does not direct implementers to invoke `scripts/verify-*.sh`.

### FINDING R5 — §8 acceptance #8 cites "existing test suite passes" — broad
- Source: Rubric (CLAUDE.md test-gate-policy)
- Section: §8
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Per CLAUDE.md verification table, allowed local tests are limited to those authored in THIS change. Rephrase to limit to targeted unit tests for new pure-function code (per `*Pure.ts` + `*.test.ts` convention), defer the broader suite to CI.

## Application plan

Apply all mechanical findings in a single coherent rewrite of frontmatter + §4 + §5.2 + §6 + §8 + §9, plus add new §12 / §13 (Lifecycle + ABCd) and an inline verification table. Net: large but surgical mechanical pass.

## Decisions log (this iteration)

[ACCEPT] §5.2 — pin HandlerContext contract (type module, factory module, parameter position, producer/consumers, import-type discipline, method-set cap)
  Fix applied: rewrote §5.2 to include a §5.2.1 contract table and §5.2.2 conceptual shape showing pure type module + boot-time factory.

[ACCEPT] §4 — replace prose touch-surface sentence with §4.1 Files-to-change tables (new files + modified files)
  Fix applied: added 10-row "New files" table and 15-row "Modified files" table. Removed stale `notifyOperatorFanout` reference and the non-existent `client/src/pages/system/` path.

[ACCEPT] §2 #5 + §8 #2 — count reconciliation for duplicated-line drop
  Fix applied: restated estimate as ~1,200-1,500 lines with breakdown (213+209+176+178+125+68+143+44+33+~120+32), noted that precise number is whatever CI reports.

[ACCEPT] §6 — lock module paths and export names; add per-DUP acceptance lines
  Fix applied: 8 DUP subsections now name concrete modules + export names + per-item acceptance.

[ACCEPT] §7 — convert chunk-0 deferred decisions into binding defaults with override path
  Fix applied: each of FE1/FE4/FE5+FE6 has Default verdict (binding) + Override path + Acceptance.

[ACCEPT] frontmatter — add canonical Markdown frontmatter (Status / Spec date / Last updated / Author / Build slug)
  Fix applied: added 5-field Markdown block below the YAML.

[ACCEPT] top matter — add Lifecycle Declaration + ABCd Estimate blocks (checklist §12)
  Fix applied: 5-field Lifecycle Declaration (Platform Hygiene cluster, Growth, Risk Surface "None.", on-incident-only); 4-row ABCd Estimate (L/L/S/S).

[ACCEPT] §1.1 — present-state verification table per checklist §0
  Fix applied: 12-row table summarising verified-open status for each scoped item with evidence pointers.

[ACCEPT - rubric R4/R5] §8 — remove local instructions to run CI-only gates
  Fix applied: acceptance #1 reframed as "CI's npm run check:circular"; #7 reframed as "CI's verify-duplicate-blocks.sh baseline"; #8 reframed to limit to targeted unit tests authored in this build, full suite is CI-only.

[ACCEPT - rubric R1] §4 — delete stale `notifyOperatorFanout` reference
  Fix applied: subsumed by §4.1 rewrite (table doesn't include it).

[ACCEPT - rubric R2] §4 — `client/src/pages/system/` does not exist
  Fix applied: subsumed by §4.1 rewrite (table uses correct top-level paths).

[ACCEPT - rubric R3] §4 — "8 new shared modules under client/src/components/" is wrong
  Fix applied: subsumed by §4.1 rewrite. Explicit "five new client modules + three new server modules = 8 total" line added above the table.

[ACCEPT - secondary] §4 framing-assumptions bullet about FE defaults
  Fix applied: updated to reference §7 binding-verdicts framing.

[ACCEPT - secondary] §5.4 acceptance
  Fix applied: reframed `madge --circular` to "CI's npm run check:circular"; `npm run build:server` stays local; Vitest references now limited to targeted unit tests authored in this build.

[AUTO-DECIDED - accept] §5.2 — split HandlerContext into pure type module + boot-time factory
  Reasoning: standard cycle-break pattern; without the split, the cycle returns through the type module and the CD1 break does not actually land.
  → Added to tasks/todo.md for deferred review

## Iteration 1 Summary

- Mechanical findings accepted:  10 (Codex #1, #3, #4, #5, #6, #7, #8, #9, #10) + 5 rubric (R1/R2/R3 subsumed; R4/R5 distinct; plus 2 secondary cleanups)
- Mechanical findings rejected:  0
- Directional findings:          1 (Codex #2)
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (see tasks/todo.md for details)
- Stopping-heuristic counters for this iteration:
  - mechanical_accepted: 10 (using the 10 distinct Codex findings as the unit-of-work; rubric findings are bundled into the same 10 fix applications)
  - mechanical_rejected: 0
  - directional_or_ambiguous: 1
- Spec commit after iteration: pending Step 8b commit
