# Spec Review Iteration 1 — hierarchical-delegation-dev-spec

**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Iteration:** 1 of MAX_ITERATIONS=5
**Spec commit at iteration start:** `33043648302e2c6b2bb43f78b38c270a335eefa1`
**Codex output:** `tasks/review-logs/_spec-review-hierarchical-delegation-iter1-codex-output.txt`

## Codex findings (5 critical, 10 important, 2 minor)

See the Codex output file for the full raw text. Classifications below.

## Findings and decisions

### FINDING #1 — Upward reassign contradiction (Codex critical)
- Sections: §§1, 4.5, 6.4, 16.1
- Classification: ambiguous, resolved autonomously per spec's own §16.1 delegation to spec-reviewer
- Disposition: AUTO-DECIDED (accept option b — narrow special case allowing any agent to `reassign_task` to its own parent regardless of scope). Apply as mechanical fix to §6.4 and §16.1. Log to tasks/todo.md.
- Reasoning: Author recommends (b); brief commits to "upward escalation allowed, logged"; option (b) is minimum-surface; §16.1 explicitly delegates decision to reviewer.

### FINDING #2 — Phase 1 data without producers (Codex critical)
- Sections: §§4.3, 4.4, 5.3, 11 Phase 1, 12.4
- Classification: Mechanical (phase-sequencing / internal contradiction)
- Disposition: Accept — update §12.4 Phase 1 and §11 Phase 1 exit criteria to reflect that the tables ship empty until Phase 4.

### FINDING #3 — Delegation graph edge source of truth (Codex critical)
- Sections: §§4.4, 4.5, 7.2, 8.2
- Classification: Mechanical (underspecified algorithm)
- Disposition: Accept — tighten §7.2 with explicit traversal algorithm (walk both `parentRunId` and `handoffSourceRunId`) and direction source (`agent_runs.delegation_scope` for spawn rows, `tasks.delegation_direction` for handoff rows).

### FINDING #4 — spawn_sub_agents atomic rejection logs mislabeled outcomes (Codex critical)
- Sections: §6.3
- Classification: Mechanical (logic bug)
- Disposition: Accept — on atomic call rejection, only actual rejecting targets log `rejected`; others are not logged (no delegation happened, no outcome to record).

### FINDING #5 — RLS missing WITH CHECK (Codex critical)
- Section: §§5.4, 9.1
- Classification: Mechanical (concrete migration bug)
- Disposition: Accept — add `WITH CHECK` to the RLS policy in §5.4 migration.

### FINDING #6 — Hierarchy-missing error semantics contradiction (Codex important)
- Sections: §§4.1, 4.3, 6.2
- Classification: Mechanical (internal contradiction)
- Disposition: Accept — tighten §4.1 to distinguish write-skill fail-closed from read-skill fall-through; §6.2 already resolves this correctly — just align §4.1's phrasing.

### FINDING #7 — "No attachment, no drift" phrasing overstates (Codex important)
- Sections: §§1 item 6, 6.5, 6.9
- Classification: Mechanical (phrasing tightening)
- Disposition: Accept — soften §1 bullet 6 phrasing.

### FINDING #8 — Detectors ship before their invariants are real (Codex important)
- Sections: §§6.9, 11 Phase 1, 15.7
- Classification: Mechanical (phase-sequencing)
- Disposition: Accept — move `managerWithoutDerivedSkills` detector to Phase 4 (it depends on derived skills that don't exist until Phase 4). For `subaccountNoRoot`, keep in Phase 1 but clarify severity interpretation pre-Phase 2.

### FINDING #9 — spawn_sub_agents hardcodes delegationDirection='down' (Codex important)
- Sections: §§4.4, 6.3
- Classification: Mechanical (logic bug)
- Disposition: Accept — compute direction per target using the same algorithm as §6.4; update §6.3 step 5.

### FINDING #10 — Scope semantics for config_list_subaccounts / config_list_links (Codex important)
- Sections: §§3.1, 6.2
- Classification: Mechanical (underspecified)
- Disposition: Accept — tighten §6.2 with per-skill scope semantics. For list-subaccounts and list-links, the scope parameter is a no-op (they operate at the subaccount container level); the adaptive default returns current behaviour.

### FINDING #11 — Resolver call path inconsistency (Codex important)
- Sections: §§3.4, 6.6, 6.7, 10.4, 11 Phase 2
- Classification: Mechanical (contradiction)
- Disposition: Accept — standardise on: `briefCreationService` passes `scope` through `task.triggerContext`; `orchestratorFromTaskJob` calls the resolver. Update §3.4, §10.4.

### FINDING #12 — resolveRootForScope return type / fallback enum (Codex important)
- Section: §6.6
- Classification: Mechanical (contract bug)
- Disposition: Accept — change return type to `Promise<ResolveRootResult | null>`; drop `hardcoded_slug` from the fallback enum (no path emits it).

### FINDING #13 — "Sole source" vs best-effort writes (Codex important)
- Sections: §§4.3, 4.4, 10.3, 17
- Classification: Mechanical (load-bearing claim without mechanism)
- Disposition: Accept — soften §4.3 "sole source" language to "primary telemetry (best-effort writes; some rows may be missed under DB load)"; add advisory note to §17.

### FINDING #14 — subaccount_id nullability inconsistent (Codex important)
- Sections: §§4.4, 5.4
- Classification: Mechanical (contradiction with FK model)
- Disposition: Accept — make `subaccount_id` NOT NULL; update §4.4 shape and §5.4 DDL.

### FINDING #15 — delegation-graph route per-node access check (Codex important)
- Sections: §§7.2, 9.3
- Classification: Mechanical (claim vs signature mismatch)
- Disposition: Accept — drop the "asserts every returned run is accessible" claim in §9.3; rely on root-run access granting subtree access + org boundary enforced by `orgScopedDb`. Update §9.3 to state this explicitly and remove the per-node assertion language.

### FINDING #16 — DelegationGraphView.test.tsx violates testing posture (Codex important)
- Sections: §§8.2, 12.3, 14.4
- Classification: Mechanical (self-contradiction)
- Disposition: Accept — remove `DelegationGraphView.test.tsx` from §8.2 and §14.4. Note that tree-shaping pure logic (if any) can be extracted and tested in `delegationGraphServicePure.test.ts` instead.

### FINDING #17 — Incomplete file inventory for admin page (Codex minor)
- Sections: §§8.3, 9.2, 14
- Classification: Mechanical (file-inventory drift)
- Disposition: Accept — add `server/lib/permissions.ts` (permission key registration), `client/src/App.tsx` (route registration), `client/src/components/Layout.tsx` (sidebar entry) to inventory §14.1 under "Modified" with a note that admin page shipping is optional.

### FINDING #18 — Stale editorial language / broken cross-refs (Codex minor)
- Sections: §§1, 6.7, 13
- Classification: Mechanical (editorial cleanup)
- Disposition: Accept — (a) remove "The Run Trace Viewer gains a delegation-graph view" from §1 bullet 1 (Phase 1); (b) fix `§6.8` → `§6.7` in §6.7 code comment; (c) fix `§5.9` → `§6.9` in §13.

### FINDING #21 (rubric) — HierarchyContextBuildError unnamed
- Section: §6.1
- Classification: Mechanical (unnamed new primitive)
- Disposition: Accept — declare the error class location and shape inline in §6.1.

## Count

- Codex findings: 17 (5 critical, 10 important, 2 minor)
- Rubric findings: 1 (HierarchyContextBuildError shape)
- Mechanical accepted: 18 (includes Finding #1 adopted via AUTO-DECIDED path)
- Mechanical rejected: 0
- Directional / ambiguous: 1 (Finding #1 routed to tasks/todo.md while being applied)
- Reclassified → directional: 0

---

## Iteration 1 summary

- Codex findings: 17 (5 critical, 10 important, 2 minor)
- Rubric findings: 1 (HierarchyContextBuildError shape)
- Mechanical findings accepted:  18
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 5 (Findings #1 + §§16.2/16.3/16.4/14.1 permission-seed location — all routed to tasks/todo.md for leisure review)
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             5
- Spec commit after iteration:   <pending — not committed; edits on working tree>
