# Spec Review Iteration 5 — hierarchical-delegation-dev-spec

**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Iteration:** 5 of MAX_ITERATIONS=5 (lifetime cap reached)
**Codex output:** `tasks/review-logs/_spec-review-hierarchical-delegation-iter5-codex-output.txt`

## Codex findings (2 critical, 7 important, 3 minor)

Iter 5 caught a handful of genuine contradictions that hid in the prior cleanup (rootless example was still reachable in §4.1; Phase 1 sequencing line still said "records what's happening before enforcement"; §15.1 pointed at dashboard that's optional; self-consistency pass still called outcomes "sole source"). Remaining findings are stale refs from iter3/iter4 edits.

## Findings and decisions

### FINDING #71 — Rootless-subaccount semantics still self-contradictory (Codex critical)
- Sections: §§4.1, 5.1, 6.4, 6.6, 16.3
- Classification: Mechanical (prose tightening)
- Disposition: Tightened `rootId` back to non-nullable `string`; rewrote the §4.1 example to show a ROOT caller's context (the realistic `parentId: null` case); updated nullability prose to explain that "root-less subaccount" is about Brief routing (falls through to org Orchestrator), not about an executing agent seeing `rootId: null`.

### FINDING #72 — Phase 1 sequencing contradiction (Codex critical)
- Section: §11 Phase 1 intro
- Classification: Mechanical (stale framing)
- Disposition: §11 Phase 1 intro rewritten: "storage-only; no write paths ship in Phase 1; no behaviour change."

### FINDING #73 — Framing contract vs §6.5 (Codex important)
- Sections: Framing "Scope of enforcement", §6.5
- Classification: Mechanical (language tightening)
- Disposition: Framing line updated to include "derived delegation skill set" explicitly alongside "delegation constraints."

### FINDING #74 — Escape-hatch claim unusable in practice (Codex important)
- Sections: §§6.3, 6.4, 6.5, 6.9
- Classification: Mechanical (documentation gap)
- Disposition: §6.5 "Interaction with explicit attachment" block now spells out exactly what the attached skills CAN do for a no-child agent (`spawn_sub_agents` unusable; `reassign_task` parent-only; `config_list_agents` fully usable). Realistic narrow escalation-role framing.

### FINDING #75 — §15.1 dashboard dependency (Codex important)
- Sections: §§8.3, 13, 15.1
- Classification: Mechanical (load-bearing claim mismatch)
- Disposition: §15.1 mitigation rewritten: daily review uses SQL queries from §17 as the primary surface; dashboard is optional enhancement. No dependency on optional deliverable.

### FINDING #76 — Stale trigger-context in §14 (Codex important)
- Sections: §14.1, §14.2
- Classification: Mechanical (stale refs)
- Disposition: Both inventory lines updated to reflect pg-boss job-payload wiring.

### FINDING #77 — Phase 4 exit "full fidelity" overstates (Codex important)
- Sections: §11 Phase 4 exit, §§4.3, 10.3
- Classification: Mechanical (load-bearing claim)
- Disposition: Phase 4 exit criterion now explicitly "best-effort for resolvable actors"; cross-references `agent_execution_events` as lossless companion.

### FINDING #78 — Graph access model 404 mechanism (Codex important)
- Sections: §§7.2, 9.3
- Classification: Mechanical (mechanism mismatch — iter4 fix introduced a 404 path that doesn't exist)
- Disposition: §9.3 client-navigation prose now correctly says same-org users can read both graph and run detail (org scoping is the only gate in v1); removed the fabricated 404 path.

### FINDING #79 — TOC / §3.1 stale schema summary (Codex important)
- Sections: TOC, §3.1, §1, §5.3, §14
- Classification: Mechanical (propagation)
- Disposition: Updated TOC entry for §5.3 and §3.1 bullet to list all four new `agent_runs` columns.

### FINDING #80 — Phase 4 spawn test covers impossible directions (Codex minor)
- Sections: §§6.3, 12.2
- Classification: Mechanical (test-plan cleanup)
- Disposition: Trimmed `skillExecutor.spawnSubAgents.test.ts` coverage to `down + rejection cases`; `up/lateral` tests stay on `reassign_task`.

### FINDING #81 — §17.6 LOC/file targets unrealistic (Codex minor)
- Sections: §§14, 17.6
- Classification: Mechanical (target adjustment)
- Disposition: Raised LOC target to <3,500; softened file-count target to informational (not a cap) with a note about pure+impure convention.

### FINDING #82 — Self-consistency pass overstates sole-source (Codex minor)
- Sections: Self-consistency pass, §§4.3, 10.3, 17.2
- Classification: Mechanical (language alignment)
- Disposition: Self-consistency bullet now frames `delegation_outcomes` as primary (paired with `agent_execution_events`), consistent with the rest of the spec.

## Count

- Codex findings: 12 (2 critical, 7 important, 3 minor)
- Rubric findings: 0
- Mechanical accepted: 12
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

---

## Iteration 5 summary

- Codex findings: 12
- Rubric findings: 0
- Mechanical findings accepted:  12
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0

---

## Stopping heuristic (post-iter5)

Lifetime cap MAX_ITERATIONS=5 reached. Loop exits. Additionally, iter2/iter3/iter4/iter5 all had zero directional/ambiguous findings — the spec has converged on its framing.
