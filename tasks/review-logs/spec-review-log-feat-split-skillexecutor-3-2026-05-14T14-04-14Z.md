# Spec Review Log — feat-split-skillexecutor — Iteration 3

**Spec:** `tasks/builds/feat-split-skillexecutor/spec.md`
**Spec commit at start of iter 3:** `80ed6de8`
**Timestamp:** 2026-05-14T14:04:14Z
**Codex raw output:** `tasks/review-logs/_codex_feat-split-skillexecutor_iter3_2026-05-14T14-04-14Z.txt`

## Findings

### FINDING #1 — Codex iter3 #1 — Wrong slack slug names
- **Description:** §5.2 + Chunk 11 listed `slack.list_users`, `slack.list_messages` — neither exists in source. Real slugs: `slack.list_channels`, `slack.read_channel`, `slack.search_messages`, `slack.summarise_thread`, `slack.post_message`, `slack.post_dm` (6).
- **Classification:** mechanical (slug names verified against source).
- **Disposition:** auto-apply. Fixed in §5.2 and Chunk 11.

### FINDING #2 — Codex iter3 #2 — `support.classify_ticket` unmapped
- **Description:** Source line 840 has `support.classify_ticket` (thin dispatcher to `skillHandlers/supportClassifyTicket.ts`); spec didn't assign it. It belongs with the rest of `support.*` in `handlers/support.ts`.
- **Classification:** mechanical (file-inventory drift).
- **Disposition:** auto-apply. Added to support.ts entry; updated Chunk 11 description to enumerate 11 slugs (10 from line 2210 block + 1 inline at line 840).

### FINDING #3 — Codex iter3 #3 — Methodology ownership contradicted
- **Description:** §5.2.1 says `methodologyStubs.ts` owns all `executeMethodologySkill` consumers; but §5.2 still listed methodology under `pages.ts`, and Chunk 9 said "+ handlers/methodology.ts".
- **Classification:** mechanical (contradiction).
- **Disposition:** auto-apply. Removed methodology from pages.ts entry; removed handlers/methodology.ts from Chunk 9; made `methodologyStubs.ts` the sole owner.

### FINDING #4 — Codex iter3 #4 — `analyse_pipeline`/`draft_followup`/`detect_churn_risk` double-claimed
- **Description:** Three slugs listed in both `crm.ts` and `methodologyStubs.ts`. Single owner = `methodologyStubs.ts` (they all dispatch via `executeMethodologySkill`).
- **Classification:** mechanical.
- **Disposition:** auto-apply. Removed from `crm.ts` line in §5.2; added a clarifying note that CRM-domain methodology lives with sibling stubs.

### FINDING #5 — Codex iter3 #5 — `write_patch`/`run_command`/`create_pr` misclassified [important]
- **Description:** Spec put them under `reviewGatedProposers.ts`; source routes them via `proposeDevopsAction` (a devContext-specific gate helper, not `proposeReviewGatedAction`). They share a family with `proposeDevopsAction` itself.
- **Classification:** mechanical (verified against source lines 669-679 + 5210-5298).
- **Disposition:** auto-apply. Moved to Chunk 8 (devContext.ts) alongside `proposeDevopsAction`. Added a NOTE in §5.2.1 reviewGated row to explain the proximity trap.

### FINDING #6 — Codex iter3 #6 — `importN8nWorkflow` vs `import_n8n_workflow` slug name
- **Description:** Spec used camelCase as the slug; source slug is snake_case `import_n8n_workflow` and the function is camelCase `executeImportN8nWorkflow`.
- **Classification:** mechanical (minor convention drift).
- **Disposition:** auto-apply. Fixed Chunk 10 entry to use both names explicitly.

### FINDING #7 — Codex iter3 #7 — §10 missed `runOptimiserScanPure.test.ts` vi.mock
- **Description:** `runOptimiserScanPure.test.ts` both `vi.mock`s the barrel AND has a value import. §10 only listed it in the value-import section.
- **Classification:** mechanical.
- **Disposition:** auto-apply. Added it to the vi.mock subsection too (with a note that it appears in both lists).

## Iteration 3 Summary

- Mechanical findings accepted: 7
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- Spec commit after iteration: (to be recorded after commit)

## Self-noted concern

The iteration-2 §5.2.1 expansion introduced 14+ new module names. This iteration caught 7 mechanical mismatches between those names and source. There may be more in iteration 4 — the gross slug count (214) is large enough that not every assignment can be verified line-by-line in one pass.

For iteration 4, focus on: any remaining unverified slug placements, any cross-references between the new modules, the registry.ts final assembly mechanics (does the spread pattern correctly merge ~20 modules?).
