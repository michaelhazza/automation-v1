# Pre-Launch Gate Hygiene Cleanup — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 6
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `13ffec6d372d3d823352f88cca9b9eb9728910b5`)
**Implementation order:** `1 → {2, 4, 6} → 5 → 3` (Chunk 6 lands alongside Chunks 2 and 4 after Chunk 1)
**Status:** draft, ready for user review

---

## Table of contents

1. Goal + non-goals
2. Items closed (verified state per Chunk 6 verification 2026-04-26)
3. Items NOT closed
4. Key decisions
5. Files touched
6. Implementation Guardrails
7. Test plan
8. Done criteria
9. Rollback notes
10. Deferred Items
11. Review Residuals
12. Coverage Check

---

## 1. Goal + non-goals

### Goal

Keep CI honest during the testing round. Verification done 2026-04-26 against `tasks/todo.md` shows ~10 of 16 cited Chunk 6 items are already closed; this spec re-asserts those as invariants and addresses the 5 truly-open items in one bundled PR.

After Chunk 6 lands, every gate the mini-spec lists is green or has a documented baseline; the registry-vs-reality drift the mini-spec was written against has been closed by surrounding work.

### Non-goals

- New gates, or any new gate-style script. The 5 open items are all small touches against existing artefacts.
- Reformulating the gate framework. `scripts/verify-*.sh` is the established convention.
- Anything in mini-spec § "Out of scope" (LAEL-P1-1 emission, TEST-HARNESS, INC-IDEMPOT, etc.).

---

## 2. Items closed

### 2.1 Already-closed items — verified state on 2026-04-26

These 11 items were closed by surrounding work between mini-spec authoring (2026-04-26) and Chunk 6 spec authoring. The Chunk 6 PR re-asserts them as invariants in `docs/pre-launch-hardening-invariants.md` (already covered by invariants 1.4, 1.5, 4.2) and annotates each `tasks/todo.md` line with `→ verified closed; owned by pre-launch-gate-hygiene-spec`.

| Mini-spec ID | todo.md line | Verbatim snippet | Verified state (2026-04-26) |
|---|---|---|---|
| `P3-H4` | 858 | "P3-H4 — `server/lib/playbook/actionCallAllowlist.ts` does not exist but is expected by `verify-action-call-allowlist.sh`" | File now exists at `server/lib/workflow/actionCallAllowlist.ts` (path moved from playbook/ to workflow/); gate at `scripts/verify-action-call-allowlist.sh:29` references the workflow/ path. **CLOSED.** |
| `P3-H5` | 859 | "P3-H5 — `measureInterventionOutcomeJob.ts:213-218` queries `canonicalAccounts` outside `canonicalDataService`" | `grep -nE "canonicalAccounts" server/jobs/measureInterventionOutcomeJob.ts` → no matches. **CLOSED.** |
| `P3-H6` | 860 | "P3-H6 — `server/services/referenceDocumentService.ts:7` imports directly from `providers/anthropicAdapter`" | `grep -nE "anthropicAdapter" server/services/referenceDocumentService.ts` → no matches. **CLOSED.** |
| `P3-H7` + `S-2` (partial) | 861 + 940 | "P3-H7 — 5+ files import `canonicalDataService` without `PrincipalContext` / `fromOrgId` migration shim"; "S-2 — Principal-context propagation is import-only across 4 of 5 files" | Verified call-sites: `server/services/connectorPollingService.ts:125,151` calls `fromOrgId`; `server/services/intelligenceSkillExecutor.ts` calls `fromOrgId`; `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts:43,60,73,86` calls `fromOrgId`; `server/routes/webhooks/ghlWebhook.ts:112` calls `fromOrgId`; `server/config/actionRegistry.ts:1` carries the `@principal-context-import-only` marker explicitly documenting the design (registry references canonicalDataService only in handler-classification documentation). **CLOSED.** |
| `P3-M11` | 880 | "P3-M11 — 5 workflow skills missing YAML frontmatter" | All 5 skills (`workflow_estimate_cost.md`, `workflow_propose_save.md`, `workflow_read_existing.md`, `workflow_simulate.md`, `workflow_validate.md`) start with `---` frontmatter delimiter. **CLOSED.** |
| `P3-M12` | 881 | "P3-M12 — `scripts/verify-integration-reference.mjs` crashes with `ERR_MODULE_NOT_FOUND: 'yaml'`" | `package.json` includes `"yaml": "^2.8.3"`. **CLOSED.** |
| `P3-M15` | 863 | "P3-M15 — `canonical_flow_definitions` + `canonical_row_subaccount_scopes` missing from canonical dictionary registry" | Both tables present in `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`. `bash scripts/verify-canonical-dictionary.sh` → `PASS: verify-canonical-dictionary (all canonical tables covered)`. **CLOSED.** |
| `P3-L1` | 882 | "P3-L1 — Missing explicit `package.json` deps: `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth`" | Verified by `package.json` grep — no flagged missing deps. **CLOSED.** |
| `S3-CONFLICT-TESTS` (`S3`) | 351 | "S3 — strengthen rule-conflict parser tests" | `server/services/__tests__/ruleConflictDetectorPure.test.ts` includes the three required cases: line 68 `'rejects conflict with unknown existingRuleId'`, line 83 `'rejects conflict with invalid conflictKind'`, line 98 `'rejects conflict with out-of-range confidence'`. **CLOSED.** |
| `S5-PURE-TEST` (`S-5`) | 947 | "S-5 — Pure unit test for `saveSkillVersion` orgId-required throw contract" | `server/services/__tests__/skillStudioServicePure.test.ts` exists and asserts `'saveSkillVersion: orgId is required for scope=org'` (verified). **CLOSED.** |
| `P3-M13` / `P3-M14` | 864, 865 | "verify-input-validation.sh WARNING — some routes may lack Zod validation"; "verify-permission-scope.sh WARNING — some permission checks incomplete" | These are warning-level gates, not failures. Live counts captured 2026-04-26: `verify-input-validation.sh = 44 violations`, `verify-permission-scope.sh = 13 violations`. Both are baselined per § 2.2 SC-COVERAGE-BASELINE; that closes the requirement to *capture* the baseline. The actual reduction work is out of scope per mini-spec ("manual scan of routes added in last 3 PRs; add Zod schemas where missing" is a separate effort). **CLOSED-AS-BASELINED.** |

### 2.2 Truly-open items — closed by this spec

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `P3-M10` | 879 | "P3-M10 — Skill visibility drift: `smart_skip_from_website` and `weekly_digest_gather` have visibility `internal`, expected `basic`" | Run `npx tsx scripts/apply-skill-visibility.ts` (per todo guidance), then re-run `skills:verify-visibility`. The script updates the markdown frontmatter on both skills from `visibility: internal` to `visibility: basic`. |
| `P3-M16` | 883 | "P3-M16 — `docs/capabilities.md:1001` — 'Anthropic-scale distribution' in customer-facing Non-goals section" | Manual edit at line 1001: replace `"Anthropic-scale distribution isn't the agency play."` with `"Hyperscaler-scale distribution isn't the agency play."` per the existing remediation note. |
| `S2-SKILL-MD` (`S2`) | 350 | "S2 — add skill definition .md files for `ask_clarifying_questions` and `challenge_assumptions`" | Create both `.md` files at `server/skills/ask_clarifying_questions.md` and `server/skills/challenge_assumptions.md` with YAML frontmatter matching the existing skill-file convention. The handler entries already exist in `SKILL_HANDLERS` so runtime dispatch works; the markdown definitions surface the skills in config-assistant and skill-studio UIs. |
| `RLS-CONTRACT-IMPORT` (`GATES-2`) | n/a (mini-spec coined; no labeled todo entry) | (mini-spec text only) | Update `scripts/verify-rls-contract-compliance.sh` to skip lines beginning with `import type` (or matching the `import type ... from ... db` pattern) when scanning for direct-`db` violations. Add a fixture test under `server/services/__tests__/` (or the existing gate test convention) that exercises both runtime and type-only imports — the type-only import must NOT trigger the gate. |
| `SC-COVERAGE-BASELINE` (≈`REQ #35`) | 916 | "REQ #35 — `verify-input-validation.sh` (44) and `verify-permission-scope.sh` (13) warnings (§5.7)" | Capture the baseline numbers in `tasks/builds/pre-launch-hardening-specs/progress.md` § Coverage Baseline (new section). Live counts as of 2026-04-26: `verify-input-validation.sh = 44 violations`; `verify-permission-scope.sh = 13 violations`. Future PRs touching input-validation or permission-scope must cite the baseline + delta in their PR body. |

---

## 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Reducing the 44 input-validation warnings to zero | Out of scope per mini-spec (`P3-M13` resolution is "manual scan ... add Zod schemas where missing" — separate effort) | Post-launch CI hygiene backlog |
| Reducing the 13 permission-scope warnings to zero | Same as above (`P3-M14`) | Post-launch CI hygiene backlog |
| All `P3-M3..M9` items (`as any` suppressions, dlqMonitorService typing, deprecated `toolCallsLog` column, handoff depth/fallback tests) | Not in mini-spec § Chunk 6 | Separate audit-runner pass |
| `P3-L2..L10` | Low-priority items not in mini-spec § Chunk 6 | Post-launch backlog |
| All "build-during-testing watchlist" items in mini-spec | By design — earn their value when traffic exists | Built during testing round |

---

## 4. Key decisions

**None architectural.** The mini-spec explicitly states "Key decisions: none. Pure cleanup." The 5 truly-open items are mechanical.

The only directional choice is the editorial wording for `P3-M16`: the existing remediation note in `tasks/todo.md:883` recommends `"hyperscaler-scale distribution"` or `"provider-marketplace-scale distribution"`. This spec adopts `"hyperscaler-scale distribution"` (shorter; reads cleanly in the customer-facing Non-goals section). User can override at review.

For `RLS-CONTRACT-IMPORT`, the gate update strategy is the simpler regex approach: match lines beginning with `import type` (with optional whitespace) and exclude them from the direct-`db` scan. No AST parsing — that would inflate the gate's complexity for a single feature.

---

## 5. Files touched

### Modified

| File | Change |
|---|---|
| `server/skills/smart_skip_from_website.md` | Frontmatter `visibility:` field changes from `internal` to `basic` |
| `server/skills/weekly_digest_gather.md` | Same |
| `docs/capabilities.md:1001` | Replace `"Anthropic-scale distribution"` with `"Hyperscaler-scale distribution"` |
| `scripts/verify-rls-contract-compliance.sh` | Add `import type` line filter to the direct-`db` scan |
| `tasks/builds/pre-launch-hardening-specs/progress.md` | Add `## Coverage Baseline` section recording 44 / 13 baseline counts |

### Created

| File | Purpose |
|---|---|
| `server/skills/ask_clarifying_questions.md` | New skill definition file. YAML frontmatter matches existing skill convention (`name`, `description`, `category`, `visibility`, `inputs`, `outputs`); body documents the skill behaviour. Handler entry already exists in `SKILL_HANDLERS`. |
| `server/skills/challenge_assumptions.md` | Same. |
| Fixture test for `RLS-CONTRACT-IMPORT` | Either a small `.test.ts` file or a fixture under `scripts/__tests__/` per repo convention. Asserts: runtime `import { db } from ...` triggers the gate; `import type { db } from ...` does NOT. |

### Untouched (verification-only — no code change in this PR)

- `server/lib/workflow/actionCallAllowlist.ts` (P3-H4 already exists)
- `server/jobs/measureInterventionOutcomeJob.ts` (P3-H5 already correct)
- `server/services/referenceDocumentService.ts` (P3-H6 already correct)
- `server/services/connectorPollingService.ts`, `intelligenceSkillExecutor.ts`, `crmQueryPlanner/executors/canonicalQueryRegistry.ts`, `routes/webhooks/ghlWebhook.ts`, `config/actionRegistry.ts` (P3-H7 + S-2 already correct)
- 5 workflow skill `.md` files (P3-M11 already has frontmatter)
- `package.json` (P3-M12 + P3-L1 already complete)
- `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` (P3-M15 already complete)
- `server/services/__tests__/ruleConflictDetectorPure.test.ts` (S3 already covers all 3 cases)
- `server/services/__tests__/skillStudioServicePure.test.ts` (S5 already exists with the orgId-required assertion)

---

## 6. Implementation Guardrails

### MUST reuse

- Existing skill `.md` template (any of `server/skills/*.md` — pick one with similar shape, e.g. `read_data_source.md` or another internal skill — and clone its frontmatter structure).
- `npx tsx scripts/apply-skill-visibility.ts` for P3-M10 — it's the documented remediation per `tasks/todo.md:879`.
- The existing `scripts/verify-*.sh` shell-script convention for the gate update.

### MUST NOT introduce

- A new skill-loader / skill-registry pattern. The 2 new `.md` files use the existing convention.
- A complex AST-based gate replacement. The `import type` filter is a simple regex update.
- Any new package.json dependency.
- Vitest / Jest / Playwright / Supertest tests for the gate fixture. Per `convention_rejections`, the gate fixture is a tsx-runnable static check, matching the existing convention.

### Known fragile areas

- **`apply-skill-visibility.ts`.** This script edits markdown frontmatter in-place. After running, `git diff server/skills/smart_skip_from_website.md server/skills/weekly_digest_gather.md` should show only the `visibility:` line changing. If the diff is broader, abort and investigate.
- **`docs/capabilities.md` editorial rule.** Per `CLAUDE.md` rule 1: "Never auto-rewrite capabilities.md." The Chunk 6 PR makes a single targeted line edit; do not let any tooling reflow surrounding lines.
- **`scripts/verify-rls-contract-compliance.sh` regex.** False-positive risk: a line starting with `import type` but containing a runtime `import` later (e.g. via re-export inside the same statement). The fixture test covers this case explicitly.

---

## 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`, `static_gates_primary`):

### Static gates

- `verify-action-call-allowlist.sh` → must pass (already passing per P3-H4 verification).
- `verify-canonical-dictionary.sh` → must pass (already passing per P3-M15 verification).
- `verify-rls-contract-compliance.sh` → must pass with the new `import type` filter; fixture test asserts the filter behaves correctly.
- `npm run skills:verify-visibility` → must pass after `apply-skill-visibility.ts` runs.
- `verify-input-validation.sh` → 44 violations baseline captured in progress.md.
- `verify-permission-scope.sh` → 13 violations baseline captured in progress.md.

### No new pure tests needed

The 3 pure-test items in mini-spec scope (S3, S5) are already closed. The new fixture for `RLS-CONTRACT-IMPORT` is a static gate test, not a pure unit test.

---

## 8. Done criteria

- [ ] `server/skills/smart_skip_from_website.md` and `weekly_digest_gather.md` have `visibility: basic` in frontmatter; `npm run skills:verify-visibility` passes.
- [ ] `docs/capabilities.md:1001` reads `"Hyperscaler-scale distribution isn't the agency play."` (or user-approved alternative).
- [ ] `server/skills/ask_clarifying_questions.md` and `server/skills/challenge_assumptions.md` exist with valid YAML frontmatter; both skills surface in config-assistant and skill-studio UIs (validated by `npm run skills:verify-visibility` pass).
- [ ] `scripts/verify-rls-contract-compliance.sh` skips `import type` lines; fixture test passes (runtime import triggers gate; type import does not).
- [ ] `tasks/builds/pre-launch-hardening-specs/progress.md` has a `## Coverage Baseline` section with `verify-input-validation.sh = 44` and `verify-permission-scope.sh = 13`.
- [ ] `tasks/todo.md` annotated for all 16 cited items per § 2.
- [ ] PR body links the spec; test plan checked off.

---

## 9. Rollback notes

Each item is reverted independently:

- Skill visibility (P3-M10) — re-run `apply-skill-visibility.ts` with the original `internal` value, or revert the markdown files.
- Capabilities edit (P3-M16) — single-line `git revert` on `docs/capabilities.md`.
- New skill `.md` files (S2-SKILL-MD) — delete; `SKILL_HANDLERS` entries are unchanged so dispatch still works (just without UI surfacing).
- Gate update (RLS-CONTRACT-IMPORT) — `git revert` on `scripts/verify-rls-contract-compliance.sh`; fixture test removed.
- Coverage baseline (SC-COVERAGE-BASELINE) — pure documentation; no rollback needed (numbers are point-in-time).

No DB impact. No service-level impact.

---

## 10. Deferred Items

None for Chunk 6.

The verification-only items in § 2.1 are not deferrals — they're already complete and re-asserted as invariants. Real deferrals are routed to § 3 (Items NOT closed) and tracked separately.

---

## 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

### HITL decisions (user must answer)

- **Capabilities.md editorial wording.** § 4 picks `"Hyperscaler-scale distribution"`. The remediation note in `tasks/todo.md:883` allows either that OR `"provider-marketplace-scale distribution"`. User confirms which at review.

### Directional uncertainties (explicitly accepted tradeoffs)

- **`RLS-CONTRACT-IMPORT` regex approach.** § 4 picks regex over AST parsing for the gate update. Trade-off: simpler implementation, edge case where a line has both `import type` and runtime imports (covered by fixture test). Accepted; alternative is full AST parse which is overkill for one feature.
- **Baseline values are point-in-time.** § 2.2 captures `44 + 13` as of 2026-04-26. If significant other Chunk PRs land before this PR merges, the baseline may need re-capture. Accepted; the baseline-capture step is fast.

---

## 12. Coverage Check

### Mini-spec Items (verbatim)

- [x] `P3-H4` — `server/lib/playbook/actionCallAllowlist.ts` does not exist — **addressed in § 2.1** (verified closed; file at `server/lib/workflow/actionCallAllowlist.ts`).
- [x] `P3-H5` — `measureInterventionOutcomeJob` queries `canonicalAccounts` outside service — **addressed in § 2.1** (verified closed).
- [x] `P3-H6` — `referenceDocumentService.ts` imports `anthropicAdapter` directly — **addressed in § 2.1** (verified closed).
- [x] `P3-H7` / `S-2` — propagate `PrincipalContext` through callers — **addressed in § 2.1** (verified closed across all 5 files).
- [x] `P3-M10..M16` — skill visibility drift, missing YAML, yaml dep, dictionary entries, capabilities editorial — **P3-M10 + P3-M16 in § 2.2; P3-M11/M12/M13/M14/M15 in § 2.1**.
- [x] `P3-L1` — explicit package.json deps — **addressed in § 2.1** (verified closed).
- [x] `S2-SKILL-MD` — `.md` definitions for `ask_clarifying_questions` and `challenge_assumptions` — **addressed in § 2.2**.
- [x] `S3-CONFLICT-TESTS` — strengthen rule-conflict parser tests — **addressed in § 2.1** (verified closed).
- [x] `S5-PURE-TEST` — `saveSkillVersion` pure unit test — **addressed in § 2.1** (verified closed).
- [x] `SC-COVERAGE-BASELINE` — capture pre-Phase-2 baseline counts — **addressed in § 2.2**.
- [x] `RLS-CONTRACT-IMPORT` (`GATES-2`) — gate skips `import type` lines — **addressed in § 2.2**.

### Mini-spec Key decisions (verbatim)

- [x] **"Key decisions: none. Pure cleanup."** — **addressed in § 4 (no architectural decisions; only the editorial-wording choice for P3-M16 routed to user)**.

### Final assertion

- [x] **No item from mini-spec § "Chunk 6 — Gate Hygiene Cleanup" is implicitly skipped.** Every cited item appears in either § 2.1 (verified closed) or § 2.2 (closed by this spec). The two warning gates (P3-M13, P3-M14) are closed-as-baselined per the SC-COVERAGE-BASELINE pattern.

### Mini-spec done criteria — mapped to this spec's § 8

- [x] "All gates green; all warning baselines captured." — § 8 first 5 checkboxes (gates green) + § 2.2 SC-COVERAGE-BASELINE (warning baselines).
