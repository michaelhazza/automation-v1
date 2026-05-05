# Spec Review Iteration 2 — hierarchical-delegation-dev-spec

**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Iteration:** 2 of MAX_ITERATIONS=5
**Codex output:** `tasks/review-logs/_spec-review-hierarchical-delegation-iter2-codex-output.txt`

## Codex findings (4 critical, 11 important, 2 minor)

Codex surfaced 17 findings. Most are second-order consequences of iteration-1 edits (particularly iter1 fixes #3/#9/#14 rippled into iter2 #26/#27/#28).

## Findings and decisions

### FINDING #26 — Spawn lateral direction vs graph spawn-edge = always down (Codex critical)
- Sections: §6.3, §4.5, §7.2
- Classification: Mechanical (internal contradiction introduced by iter1 fix #9)
- Disposition: Restrict `spawn_sub_agents` to descendant-only targets — `subaccount` scope is rejected for all callers. Spawn direction is always `'down'` by construction. Roots crossing subtrees use `reassign_task`, not spawn. Updated §6.3 step 2, step 5, step 6; updated §4.5 direction derivation.

### FINDING #27 — Tree vs DAG: runs with two parents (Codex critical)
- Section: §7.2
- Classification: Mechanical (contract over-specifies as tree)
- Disposition: Change response to `{ nodes: DelegationGraphNode[], edges: DelegationGraphEdge[] }` graph shape. UI deduplicates by `runId`. Updated §7.2 response shape; updated §8.2 renderer prose.

### FINDING #28 — tasks.delegation_direction mutable used as historical source (Codex critical)
- Sections: §4.5, §6.4, §7.2
- Classification: Mechanical (durability bug)
- Disposition: Add `agent_runs.delegation_direction` column (immutable per-run fact). `tasks.delegation_direction` stays as the current-task marker per §5.2. Graph reads from `agent_runs.delegation_direction` on the child run — not from the task. Updated §5.3 migration; updated §7.2 traversal; updated §6.4 step 7 to populate on child run creation; updated §5.5 files-to-change.

### FINDING #29 — Graph access inconsistency with per-run policy (Codex critical)
- Sections: §7.2, §9.3
- Classification: Mechanical (access policy under-specified)
- Disposition: Keep summary-only exposure in graph (no sensitive fields); document that clicking a child node re-checks `requireRunAccess` at the detail page. Summary fields enumerated in §9.3. No per-node access check in the graph service itself.

### FINDING #30 — "exactly one active root" vs "at most one" (Codex important)
- Sections: §1 item 2, §5.1, §6.6
- Classification: Mechanical (language tightening)
- Disposition: Rewrite "exactly one" → "at most one (zero allowed until configured)" in §1 and §5.1.

### FINDING #31 — HierarchyContext.rootId undefined for zero-root subaccounts (Codex important)
- Sections: §4.1, §6.1, §6.6, §11 Phase 3
- Classification: Mechanical (contract gap)
- Disposition: Make `rootId: string | null`; document the null case. Also clarified `parentId` semantics for root-less subaccounts.

### FINDING #32 — childIds determinism has no mechanism (Codex important)
- Sections: §4.1, §6.1
- Classification: Mechanical (contract-signature mismatch)
- Disposition: Switch determinism from `createdAt asc` to `id asc` (the id is in the roster shape; no signature change needed).

### FINDING #33 — Hierarchy "built once per run" vs resolver re-builds (Codex important)
- Sections: §1 item 4, §4.1, §6.5
- Classification: Mechanical (internal duplication)
- Disposition: Rewrote §6.5 pseudocode to consume `context.hierarchy` (already built by `agentExecutionService`); added call-ordering note.

### FINDING #34 — §5.3 populated-by contradicts Phase 1 null-ship (Codex important)
- Sections: §5.3, §11 Phase 1, §14.1
- Classification: Mechanical (phase-sequencing)
- Disposition: Rewrote §5.3 with explicit phase-staggered population schedule (Phase 1 columns null; Phase 3 populates hierarchy_depth; Phase 4 populates delegation_scope + delegation_direction).

### FINDING #35 — "fire detector" language is sync while detectors are async (Codex important)
- Sections: §1 item 3, §6.6, §10.4, §10.5
- Classification: Mechanical (language tightening)
- Disposition: Replace "fire detector" with "emit structured log; detector surfaces on next audit sweep" in §1 and §6.6.

### FINDING #36 — hierarchy_context_missing example uses list-skill (Codex important)
- Sections: §4.1, §4.3, §6.2
- Classification: Mechanical (stale example)
- Disposition: Updated §4.3 example to use `spawn_sub_agents`; narrowed description to write-side only.

### FINDING #37 — managerWithoutDerivedSkills vs explicit-attachment escape hatch (Codex important)
- Sections: §6.5, §6.9
- Classification: Mechanical (contradiction)
- Disposition: Downgrade detector to `info` severity; change message to frame as "informational / verify still intentional" rather than "consider detaching."

### FINDING #38 — subaccountId/organisationId integrity not enforced (Codex important)
- Sections: §4.4, §5.4, §9.1
- Classification: Mechanical (load-bearing claim without mechanism)
- Disposition: Pin service-layer validator in `delegationOutcomeService.insertOutcomeSafe()` that cross-checks actor rows' subaccount_id/organisation_id against the outcome row. Drop "self-enforcing" claim.

### FINDING #39 — Success metrics depend on non-stored facts (Codex important)
- Sections: §17.1, §17.2
- Classification: Mechanical (metric definition gap)
- Disposition: Clarify that metrics join against CURRENT `subaccount_agents` state; add caveat that roster churn creates skew; add pull-forward item to §13 for persisting caller-hierarchy facts.

### FINDING #40 — Outcome-write mechanism under-specified (Codex important)
- Sections: §10.3, §15.6
- Classification: Mechanical (unnamed primitive)
- Disposition: Pin concrete `insertOutcomeSafe()` shape with inline code sample; drop "post-commit hook" language as over-engineered.

### FINDING #41 — Permission seed TBD location (Codex minor)
- Section: §14.1
- Classification: Mechanical (file-inventory drift)
- Disposition: Pin location — `DEFAULT_PERMISSION_SET_TEMPLATES` in `server/lib/permissions.ts`, consumed by `server/services/permissionSeedService.ts`.

### FINDING #42 — Stale "deferred" bullet for upward reassign (Codex minor)
- Sections: §13, §16.1
- Classification: Mechanical (stale language)
- Disposition: Delete the §13 bullet; §16.1 resolution stands.

## Count

- Codex findings: 17 (4 critical, 11 important, 2 minor)
- Rubric findings: 0 (Codex caught everything; rubric found nothing new)
- Mechanical accepted: 17
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

---

## Iteration 2 summary

- Codex findings: 17
- Rubric findings: 0
- Mechanical findings accepted:  17
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
