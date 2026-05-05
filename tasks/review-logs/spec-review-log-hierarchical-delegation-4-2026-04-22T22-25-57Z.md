# Spec Review Iteration 4 — hierarchical-delegation-dev-spec

**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Iteration:** 4 of MAX_ITERATIONS=5
**Codex output:** `tasks/review-logs/_spec-review-hierarchical-delegation-iter4-codex-output.txt`

## Codex findings (3 critical, 7 important, 2 minor)

Iteration 4 caught second-order clean-up: stale references left over from iter3's edits (triggerContext / route / slug-removal), plus a few genuine semantic clarifications (rootless-subaccount semantics, resolver null-subaccountId branch, detector naming).

## Findings and decisions

### FINDING #59 — Rootless-subaccount semantic gap (Codex critical)
- Sections: §§4.1, 5.1, 6.4 step 3, 16.3
- Classification: Mechanical (prose tightening)
- Disposition: Clarified that any active agent with `parentId === null` IS a root by schema definition; the "rootless subaccount" prose now correctly states this only occurs when the subaccount has zero active agents (an impossible state for a running agent).

### FINDING #60 — Phase 1 framing vs empty-table state (Codex critical)
- Sections: §1 item 1, §11 Phase 1 intro and exit criteria, §15.1
- Classification: Mechanical (stale framing in §15.1)
- Disposition: Rewrote §15.1 mitigation to reflect that Phase 1 ships storage + detectors but NOT write paths or graph UI. Graph + outcome writes ship in Phase 4.

### FINDING #61 — pg-boss vs triggerContext ambiguity (Codex critical)
- Sections: §§3.4, 6.7, 10.4, 14.1, 14.2
- Classification: Mechanical (stale refs from iter3 fix #43 that missed two locations)
- Disposition: Purged remaining `task.triggerContext` references in §3.4 and §10.4; normalized on pg-boss job payload.

### FINDING #62 — Route path inconsistency (Codex important)
- Sections: §§7.2, 8.2, 11 Phase 4, 14.4, 9.3
- Classification: Mechanical (stale refs from iter3 fix #50)
- Disposition: Propagated `/api/agent-runs/:id/delegation-graph` to all sections (§3.1, §8.2, §11 Phase 4, §12.3, §14.4). Fixed §9.3 client-navigation mention of `requireRunAccess('view')`.

### FINDING #63 — ORCHESTRATOR_AGENT_SLUG retention ambiguity (Codex important)
- Sections: §§1 item 7, 6.6 step 2, 6.7, 11 Phase 2 exit criteria, 14.2
- Classification: Mechanical (stale refs from iter3 fix #48)
- Disposition: §6.7 code comment updated to show slug retained for org-scope; §11 Phase 2 inventory updated; §14.2 consistency-audit line updated.

### FINDING #64 — "Nothing outside main" vs dual-root gate (Codex important)
- Sections: §§2.1, 3.2, 3.3, 13
- Classification: Mechanical (language tightening)
- Disposition: §3.3 rewritten to distinguish code-dependencies (none outside main) from non-code prerequisites (dual-root seed cleanup for Phase 2).

### FINDING #65 — §14.1 column list stale (Codex important)
- Sections: §§5.3, 5.5, 14.1
- Classification: Mechanical (propagation)
- Disposition: §14.1 updated to list all four new columns (`delegation_scope`, `hierarchy_depth`, `delegation_direction`, `handoff_source_run_id`).

### FINDING #66 — Skill resolver missing-hierarchy policy (Codex important)
- Sections: §§4.1, 6.5
- Classification: Mechanical (policy gap)
- Disposition: §6.5 now pins the resolver's behaviour under missing hierarchy (log WARN, return attached skills only; don't fail the run).

### FINDING #67 — resolveRootForScope null subaccountId branch (Codex important)
- Sections: §§6.6, 6.7, 10.4
- Classification: Mechanical (API under-specified)
- Disposition: §6.6 case 1 now explicitly handles `subaccountId === null` → falls through to org-root fallback.

### FINDING #68 — "Every rejection writes a row" overclaim (Codex important)
- Sections: §§4.3, 4.4, 5.4, 10.3
- Classification: Mechanical (load-bearing claim narrowing)
- Disposition: §4.3 side-effect section narrowed to "scope-validation rejections with resolvable actors"; unresolvable-target errors + DB-write gaps surfaced via `agent_execution_events`.

### FINDING #69 — Detector name mismatch (Codex minor)
- Sections: §§6.9, 11, 14.4, 17.5
- Classification: Mechanical (renaming)
- Disposition: Renamed `managerWithoutDerivedSkills` → `explicitDelegationSkillsWithoutChildren` across the spec. Updated §17.5 "trending toward zero" language (replaced with informational framing consistent with iter3 fix #57).

### FINDING #70 — "No new top-level routes" vs §8.3 (Codex minor)
- Section: §§8 intro, 8.3
- Classification: Mechanical (prose softening)
- Disposition: §8 intro now distinguishes mandatory (existing pages) vs optional (new admin route).

## Count

- Codex findings: 12 (3 critical, 7 important, 2 minor)
- Rubric findings: 0
- Mechanical accepted: 12
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

---

## Iteration 4 summary

- Codex findings: 12
- Rubric findings: 0
- Mechanical findings accepted:  12
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
