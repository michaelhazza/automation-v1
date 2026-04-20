# Spec Review Iteration 4 Log — session-1-foundation-spec

**Spec:** `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Iteration:** 4 of 5 (lifetime cap)
**Timestamp:** 2026-04-20T03:45:00Z
**Prior state:** iter-3 produced 5 mechanical + 1 directional (resolved `apply` → Option A). Iter-3's checkpoint edits applied at the start of iter-4 before running Codex.

---

## Codex findings

Codex surfaced 10 findings. Classification and disposition below.

### FINDING #1 — "single source of truth" stale phrasing
- Source: Codex
- Section: §1.1 first bullet, §1.3(h), §2.2, §2.6
- Description: "Every runtime read targets the single `organisations.operational_config_override` row" is slightly stale since effective config is deep-merge of two layers, and the override can be NULL.
- Codex fix (verbatim): replace "single runtime source-of-truth" with clarified phrasing specifying it's the writable-override source-of-truth and effective = deep-merge.
- Classification: MECHANICAL — stale language, consistency fix
- Reasoning: §1.3(h) already qualifies "single runtime source-of-truth **for org-level operational config**" but the §1.1 bullet is loose. Tightening to match §2.2's two-layer chain is a consistency cleanup that doesn't change scope.
- Disposition: ACCEPT — apply at §1.1, §1.3(h).

### FINDING #2 — §2.5 schema-change row missing `appliedSystemTemplateId`
- Source: Codex
- Section: §2.5 row for `server/db/schema/organisations.ts`
- Description: §2.5 only mentions `operationalConfigOverride` but §2.4 migration also adds `appliedSystemTemplateId`. §9.3 already lists both; §2.5 doesn't.
- Codex fix: add `appliedSystemTemplateId` to the §2.5 schema-change row.
- Classification: MECHANICAL — file inventory drift (§2.5 is the code-changes table; §9.3 is the inventory; they must agree)
- Disposition: ACCEPT — apply.

### FINDING #3 — §2.4 column comment on `operational_config_seed` is stale
- Source: Codex
- Section: §2.4 step 6 COMMENT ON COLUMN line
- Description: The comment says the seed is "copied into `organisations.operational_config_override` when this template is adopted" — stale under Option A (no copy happens at adoption).
- Codex fix: replace comment text to clarify one-time informational snapshot, and that `organisations.operational_config_override` stays NULL until first explicit edit.
- Classification: MECHANICAL — stale language from pre-Option-A, load-bearing (migration SQL comment)
- Disposition: ACCEPT — apply.

### FINDING #4 — systemDefaults nullability contract gap
- Source: Codex
- Section: §2.4 step 2 (FK nullable), §2.6 (falls back to `{}`), §4.5 response shape
- Description: §4.5 declares `systemDefaults: OperationalConfig` (non-nullable) but §2.6's code falls back to `{}` when `appliedSystemTemplateId IS NULL`. The response contract is under-specified for the legacy-org case (Option A guarantees new orgs always have FK set; legacy orgs may not).
- Codex fix: either make `systemDefaults: OperationalConfig | null` with UI behaviour defined, or state the route always materialises a schema-default OperationalConfig when no template is linked.
- Classification: MECHANICAL — load-bearing claim without contract
- Disposition: ACCEPT — apply. Pick the nullable option (the route returns the {} or null from §2.6's fallback); Settings UI already needs to handle the "no template adopted" edge, and making the type reflect reality is the minimum mechanical fix.

### FINDING #5 — §4.1 error-code union missing `INVALID_BODY`
- Source: Codex
- Section: §4.1 error-code union vs. §4.4 route example
- Description: §4.4 emits `errorCode: 'INVALID_BODY'` on zod parse failure, but the §4.1 error-code union doesn't include it.
- Codex fix: add `INVALID_BODY` to the §4.1 union, or change the route example.
- Classification: MECHANICAL — contradiction between sections
- Disposition: ACCEPT — apply; add to the §4.1 union (matches the route's behaviour).

### FINDING #6 — `differsFromTemplate` uses `!==` (reference equality)
- Source: Codex
- Section: §4.5 definition of `differsFromTemplate(path)`
- Description: JS `!==` is reference equality — for array/object leaves it will always return `true` even when values are deep-equal. The reset-button enablement would mis-trigger.
- Codex fix: change the definition to "true iff effective leaf is not deep-equal to the system-default leaf after schema normalisation".
- Classification: MECHANICAL — load-bearing claim with wrong mechanism
- Disposition: ACCEPT — apply.

### FINDING #7 — §7.2 step 6 config_history row under-specified under Option A
- Source: Codex
- Section: §7.2 step 6
- Description: Under Option A, no override write happens at create-time, so what does `snapshot_after` in the history row contain? Entity_type/entity_id also not explicitly defined in step 6 (relies on §4.8).
- Codex fix: either remove step 6 (no history row for a non-write) or specify entity_type/entity_id/snapshot_after explicitly.
- Classification: AMBIGUOUS → directional (HITL)
- Reasoning: The choice between "remove step 6" and "add an explicit audit row for the creation event" is a small-but-real product call about whether org-creation deserves a config_history marker. Under Option A, no config change happened; a strict "history logs changes" view says drop it. An auditor view says "yes, even for 'nothing yet' the creation moment should be on the timeline." Either is reasonable and the spec is currently mechanically silent on this. Biasing to HITL per classifier rules.
- Disposition: HITL CHECKPOINT (Finding 4.1).

### FINDING #8 — §7.3 screen 3 wizard violates NULL-until-first-edit
- Source: Codex
- Section: §7.3 screen 3
- Description: Screen 3 says each value is POSTed on Next without qualifying "only dirty values". A no-op pass through would initialise the override row with no actual operator intent, violating the Option A lock from iter-3.
- Codex fix: add "Only fields the operator actually changes on screen 3 are POSTed on Next; advancing without edits performs no config write and leaves `organisations.operational_config_override` NULL."
- Classification: MECHANICAL — invariant stated in §7.2/§10.1 but not enforced in §7.3
- Severity per Codex: critical
- Disposition: ACCEPT — apply. This directly reinforces the iter-3 Option A lock.

### FINDING #9 — §8.3 test plan line still says "seeds the override"
- Source: Codex
- Section: §8.3 `organisationServiceCreateFromTemplate.test` description
- Description: Test-plan line says the test asserts "seeds the override + applied-template FK + default blueprint correctly" — "seeds the override" contradicts Option A.
- Codex fix: change to "asserts `createFromTemplate` leaves `operational_config_override` NULL while seeding `appliedSystemTemplateId` + default blueprint correctly".
- Classification: MECHANICAL — stale language from pre-Option-A (same pattern as Finding #3)
- Disposition: ACCEPT — apply.

### FINDING #10 — subaccount-inheritance contract phrasing inconsistent + §9.3 file gap
- Source: Codex
- Section: §2.2, §6.5, §7.2 step 3, S1-5.2, §9.3
- Description: Subaccount inheritance described differently across sections:
  - §2.2: "the org's current `operational_config_override` deep-merged with the system defaults"
  - §6.5: "inherit the org's current ClientPulse Settings"
  - §7.2 step 3: "inherit the org's live `operational_config_override`"
  - S1-5.2: "seeds the org's current operational config override"
  And no concrete subaccount-create service/route file appears in §9.3.
- Codex fix: standardise to "inherit via `orgConfigService.getOperationalConfig(orgId)` (effective merged config, not raw override row)" + add concrete files to §9.3.
- Classification: MECHANICAL — split into two edits:
  - (a) canonical phrasing: apply
  - (b) concrete file list: the spec doesn't know which files without a kickoff audit (consistent with existing §10.8 pattern). Add as a §10.8 item rather than inventing files.
- Disposition: ACCEPT — apply both parts; (a) as prose edits, (b) as a §10.8 audit line.

---

## Rubric pass (independent of Codex)

I re-read the spec's framing sections (§1, §2 intro, §4.5, §6.4, §7.2, §10.1) specifically hunting for:

- Additional Option-A stale phrasing beyond what Codex caught — none found beyond Finding 3/9.
- Contradictions between §1.3(h) ("single runtime source-of-truth") and the actual two-layer chain — Codex's Finding #1 covers this.
- Load-bearing claims without contracts — Codex's Findings 4, 5, 6 cover the three instances I spotted.
- Missing verdicts on roadmap items — §10.7/§10.8 are clean; no item lacks a verdict.
- Unnamed new primitives — every new type/function/file is named.
- File inventory drift — Codex Finding #2 catches §2.5 vs §9.3; rubric found no additional drift.

No rubric-unique findings this iteration. The spec is close to convergent.

---

## Adjudication summary

| Finding | Classification | Disposition |
|---|---|---|
| 1 | Mechanical | Accept — apply |
| 2 | Mechanical | Accept — apply |
| 3 | Mechanical | Accept — apply |
| 4 | Mechanical | Accept — apply |
| 5 | Mechanical | Accept — apply |
| 6 | Mechanical | Accept — apply |
| 7 | Ambiguous → directional | HITL checkpoint |
| 8 | Mechanical | Accept — apply |
| 9 | Mechanical | Accept — apply |
| 10 | Mechanical (split) | Accept — apply both parts |

**Counts:**
- mechanical_accepted: 9
- mechanical_rejected: 0
- directional_or_ambiguous: 1 (Finding 7)

## Iteration 4 Summary

- Mechanical findings accepted: 9
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 1
- Reclassified → directional: 1 (Finding 7)
- HITL checkpoint path: `tasks/spec-review-checkpoint-session-1-foundation-4-20260420T034500Z.md`
- HITL status: pending

**Stopping-heuristic status:** iter-3 had 1 directional; iter-4 has 1 ambiguous→directional. The two-consecutive-mechanical-only rule does not fire yet. Loop continues to iter-5 (the hard lifetime cap) once this checkpoint is resolved, unless the human sets `stop-loop`.
