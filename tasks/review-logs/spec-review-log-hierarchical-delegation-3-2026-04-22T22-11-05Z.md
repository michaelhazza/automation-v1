# Spec Review Iteration 3 — hierarchical-delegation-dev-spec

**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Iteration:** 3 of MAX_ITERATIONS=5
**Codex output:** `tasks/review-logs/_spec-review-hierarchical-delegation-iter3-codex-output.txt`

## Codex findings (4 critical, 12 important)

Codex caught several genuine repo-state bugs this iteration — the spec referenced non-existent columns, routes, middleware, and page files. These were either latent (carried over from the original spec draft) or introduced by iter1/iter2 edits that assumed primitives that don't exist.

## Findings and decisions

### FINDING #43 — tasks.triggerContext column doesn't exist (Codex critical)
- Sections: §6.7, §11 Phase 2, §14.2
- Classification: Mechanical (repo-state bug — spec assumed a column that doesn't exist)
- Disposition: Route scope through pg-boss job payload instead of a task column. No schema change. Updated §6.7 "After" code, §11 Phase 2 prose.

### FINDING #44 — agent_runs.handoffSourceRunId doesn't exist (Codex critical)
- Sections: §1 item 9, §2.1, §7.2, §14.4
- Classification: Mechanical (repo-state bug — assumed on agent_runs, actually lives on tasks)
- Disposition: Add `agent_runs.handoff_source_run_id` in migration 0204 alongside other new columns. Keep `tasks.handoff_source_run_id` as the current-task marker. Graph reads from `agent_runs` column (single-table query).

### FINDING #45 — Root-only gate conflates "rootless" and "root" (Codex critical)
- Sections: §4.1, §4.2, §6.4
- Classification: Mechanical (contract bug — `parentId === null` ambiguous)
- Disposition: Root-only check now uses `rootId === agentId && rootId !== null` — positive proof the caller IS the configured root. Prevents rootless-subaccount agents from sneaking into `subaccount` scope.

### FINDING #46 — Phase 1 framing vs empty-table state (Codex critical)
- Sections: §1 item 1, §4.3, §11 Phase 1, §12.4
- Classification: Mechanical (stale framing)
- Disposition: §1 item 1 rewritten: "Observability foundations" ships tables + detectors; writes start Phase 4. Consistent with §11 Phase 1 exit criteria (already fixed in iter1).

### FINDING #47 — 0204 column set inconsistent across sections (Codex important)
- Sections: §5.3, §5.5, §11 Phase 1, §14.1
- Classification: Mechanical (propagation bug from iter2)
- Disposition: Propagated the full 4-column set (`delegation_scope`, `hierarchy_depth`, `delegation_direction`, `handoff_source_run_id`) to §5.5, §11 Phase 1, §14.1.

### FINDING #48 — Partial slug removal (Codex important)
- Sections: §1 items 3 & 7, §6.6, §6.7, §13
- Classification: Mechanical (language tightening)
- Disposition: §1 bullet 7 narrowed to "partial slug removal for subaccount scope"; org-scope fallback retains slug (deferred to §13).

### FINDING #49 — RLS variable name wrong (Codex important)
- Sections: §5.4, §9.1
- Classification: Mechanical (repo-state bug — wrong setting name)
- Disposition: Changed `app.current_organisation_id` to `app.organisation_id` in the RLS policy, matching the existing migrations 0080+ contract.

### FINDING #50 — Wrong route family + invented middleware (Codex important)
- Sections: §7.2, §9.3, §14.4
- Classification: Mechanical (repo-state bug)
- Disposition: Changed route to `/api/agent-runs/:id/delegation-graph` (correct family); removed `requireRunAccess('view')` (doesn't exist); use `authenticate` + service-layer org scoping per the existing `/api/agent-runs/:id` pattern.

### FINDING #51 — SubaccountCreatePage.tsx doesn't exist (Codex important)
- Sections: §8.1, §14.2
- Classification: Mechanical (repo-state bug)
- Disposition: Pointed at the real create surface, `AdminSubaccountsPage.tsx`. Scoped v1 to the full-form path; Layout quick-create stays picker-less.

### FINDING #52 — Tool-definition source of truth wrong (Codex important)
- Sections: §6.2, §14.3, §14.4
- Classification: Mechanical (repo-state bug — tool definitions live in `server/skills/*.md`, not `actionRegistry.ts`)
- Disposition: Pointed at the correct files (`server/skills/config_list_agents.md` + siblings for Phase 3; `server/skills/spawn_sub_agents.md` + `reassign_task.md` for Phase 4).

### FINDING #53 — Seeded company has 2 roots, not 1 (Codex important)
- Section: §2.1
- Classification: Mechanical (stale factual claim)
- Disposition: Updated §2.1 to reflect current manifest (16 agents, 2 reportsTo-null roots: Orchestrator + portfolio-health-agent); added §13 pull-forward flagging this as BLOCKING for Phase 2 migration 0202.

### FINDING #54 — Spawn depth enforcement unspecified (Codex important)
- Sections: §6.3, §7.2, §10.2
- Classification: Mechanical (unnamed mechanism)
- Disposition: Reuse `agent_runs.handoffDepth` for both spawn and handoff chains. Cap at `MAX_HANDOFF_DEPTH = 5`. Rejected with existing `max_handoff_depth_exceeded` error code. §6.3 updated with explicit depth-enforcement rule.

### FINDING #55 — briefErrorArtefactService is fabricated (Codex important)
- Sections: §6.6, §6.7, §14
- Classification: Mechanical (invented primitive)
- Disposition: Replaced with `briefConversationWriter.appendSystemErrorArtefact()` (extending an existing primitive), per framing "prefer existing primitives." Spec author never intended to introduce a new service here — this was spec-drift from an earlier draft.

### FINDING #56 — DelegationScope contract vs §6.3 rejection (Codex important)
- Sections: §4.2, §6.3
- Classification: Mechanical (contract inconsistency)
- Disposition: §4.2 table now has per-skill columns showing `subaccount` scope is always-rejected for `spawn_sub_agents`, callable-only-by-root for `reassign_task`.

### FINDING #57 — Zero-root has three different statuses (Codex important)
- Sections: §5.1, §6.9, §11 Phase 2, §16.3
- Classification: Mechanical (language tightening)
- Disposition: Declared one steady-state verdict per §16.3: zero-root is a valid operator-opt-in state; `subaccountNoRoot` detector stays at `info` severity across all phases (no elevation). Phase 2 exit criteria updated — no longer expects `subaccountNoRoot` count to decrease.

### FINDING #58 — Success criteria vs best-effort writes (Codex important)
- Sections: §4.3, §10.3, §17.2-§17.3
- Classification: Mechanical (load-bearing claim without mechanism)
- Disposition: §17.2 now separates the primary invariant (enforced by validator code) from the advisory metric (best-effort outcome rows). Cross-check pointer to `agent_execution_events` (lossless).

## Count

- Codex findings: 16 (4 critical, 12 important)
- Rubric findings: 0
- Mechanical accepted: 16
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

---

## Iteration 3 summary

- Codex findings: 16
- Rubric findings: 0
- Mechanical findings accepted:  16
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
