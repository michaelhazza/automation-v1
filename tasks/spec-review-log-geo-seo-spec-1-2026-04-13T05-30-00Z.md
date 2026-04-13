# Spec Review Log — geo-seo-spec — Iteration 1

**Spec:** `docs/geo-seo-spec.md`
**Iteration:** 1
**Timestamp:** 2026-04-13T05:30:00Z

---

## Mechanical Findings — Decisions

[ACCEPT] §1 Scope boundaries — "Phase 2" should be "Phase 2.5" for seed script seeding
  Fix applied: Changed "seeded in `scripts/seed.ts` Phase 2" to "Phase 2.5" in §1 scope list and §7.3 seed section.

[ACCEPT] §1 Scope boundaries / §11 Doc Updates — `capabilities.md` path missing `docs/` prefix
  Fix applied: All references to `capabilities.md` changed to `docs/capabilities.md`.

[ACCEPT] §9 Phase 2 section heading — stale heading text "Platform optimizer, brand authority, competitive"
  Fix applied: Section heading changed to "Phase 2 — Portfolio UI and dashboard insights (deferred)" to match the actual Phase 2 body content.

[ACCEPT] §4 SKILL_HANDLERS — Wrong handler name `methodologyPassthrough` and ambiguous "verify at implementation time"
  Fix applied: Replaced entire SKILL_HANDLERS section with definitive instructions: handler name is `generic_methodology`, add 8 entries, update `skillHandlerRegistryEquivalence.test.ts` CANONICAL_HANDLER_KEYS and count assertion 105→113.

[ACCEPT] §7.1 defaultOrgSkillSlugs — `search_agent_history` missing
  Fix applied: Added `search_agent_history` to `defaultOrgSkillSlugs` in §7.1 table and §7.3 seed script code block. This wires the Q2 competitor-memory design (§2) to the actual agent skill set.

[ACCEPT] §5 Drizzle schema import — `boolean` missing, `real` and `uniqueIndex` unused
  Fix applied: Import changed from `pgTable, uuid, text, integer, real, jsonb, timestamp, index, uniqueIndex` to `pgTable, uuid, text, integer, boolean, jsonb, timestamp, index`.

[ACCEPT] §9 Phase 1 file table — down migration missing
  Fix applied: Added `migrations/_down/0110_geo_audit_scores.down.sql` to Step 1 file list.

[ACCEPT] §9 Phase 1 Step 8 — stale description "verify methodology passthrough"
  Fix applied: Step 8 description updated to reflect actual required changes: add 8 `generic_methodology` entries and update equivalence test.

[ACCEPT] §9 Phase 1 Step 14 — `capabilities.md` path missing `docs/`
  Fix applied: Updated to `docs/capabilities.md`.

[ACCEPT] §11 architecture.md skill count — 99→107 incorrect (actual is 100→108)
  Fix applied: Updated instruction to clarify architecture.md currently reads "99" (stale — real count is 100) and the correct final count after +8 is 108.

[ACCEPT] §7.1 icon field — unresolved "search (or globe)" choice
  Fix applied: Set to `search`.

[ACCEPT] §7.3 Option A text — Option A still present despite Option B being recommended and chosen
  Fix applied: Removed Option A block and "Recommended: Option B" framing. Replaced with direct instruction for Phase 2.5 direct upsert pattern.

[ACCEPT] §4 Topic tags — `'seo'` vs `topicRegistry.ts` namespace clarification
  Fix applied: Added a note clarifying that action registry topics and topicRegistry.ts topics are separate namespaces; only `'geo'` needs a topicRegistry entry for message routing.

---

## Rejected / Out-of-scope Findings

[REJECT] Codex #10c — "~20 new/modified files" estimate is imprecise
  Reason: An estimate in a spec document is not a contract. "~20" is intentionally approximate; the exact count is in the file table. No fix needed.

---

## Findings Sent to HITL Checkpoint

All directional and ambiguous findings are in: `tasks/spec-review-checkpoint-geo-seo-spec-1-2026-04-13T05-30-00Z.md`

| Finding | Classification | Short title |
|---------|---------------|-------------|
| Codex #1 | directional | read-only contract vs processOutputStep side effect |
| Codex #4 | directional | missing machine-readable score output contract |
| Codex #6 | ambiguous | route params vs implementation drift (from/to, subaccount_ids) |
| Codex #7 | ambiguous | site_url canonicalisation under-specified |
| Codex #8 | directional | scoring dimension overlap / double-counting |
| Codex #9 | directional | Technical Infrastructure dimension vs geo_crawlers scope gap |
| Codex #11b | directional | parentSystemAgentId topology unresolved |

---

## Iteration 1 Summary

- Mechanical findings accepted:  13
- Mechanical findings rejected:  1
- Directional findings:          4 (Codex #1, #4, #8, #9, #11b)
- Ambiguous findings:            2 (Codex #6, #7)
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-geo-seo-spec-1-2026-04-13T05-30-00Z.md`
- HITL status:                   resolved
- Spec commit after iteration:   d3401cab3ba36b0813a1172c249bfd3a8a1f2775 (spec modified in working tree, uncommitted)

---

## HITL Resolution Summary (applied 2026-04-13)

| Finding | Decision | Applied change |
|---------|----------|---------------|
| 1.1 | apply-with-modification | `audit_geo` given standalone ActionDefinition with `idempotencyStrategy: 'write'`, `isMethodology: false`. §1 design philosophy and §4 updated. Sub-skills remain in methodology batch. |
| 1.2 | apply-with-modification | `GEO_SCORE_PAYLOAD` JSON comment block added to §3.1 output format after "30-Day Improvement Roadmap". Parser contract note added to §8.3. Field names match §5 schema columns. |
| 1.3 | apply | Removed `from`/`to` from list endpoint params table; removed `subaccount_ids` from portfolio endpoint params table. Phase 2 notes added to both. |
| 1.4 | apply-with-modification | `canonicaliseSiteUrl(url: string): string` pure helper added to §6.2. Called at top of `saveScore`, `getScoreHistory`, `getLatestScore` in §6.1. 5 test cases added to §6.3. |
| 1.5 | apply-with-modification | Intentional overlap note added to §3.1 under Scoring Framework table. No skill/prompt changes. |
| 1.6 | apply-with-modification | Page speed/CWV indicators section added to §3.3 `geo_crawlers` with response time, viewport meta, HTTPS deductions. Dimension name and schema field names unchanged. |
| 1.7 | apply | `parentSystemAgentId: null` set explicitly in §7.1 table and §7.3 seed script code block. |
