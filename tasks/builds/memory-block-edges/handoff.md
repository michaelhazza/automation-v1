# Handoff — memory-block-edges

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md
**Branch:** claude/build-memory-block-edges-7jIyt
**Build slug:** memory-block-edges
**Task class:** Significant
**UI-touching:** no
**Mockup paths:** n/a (backend-only build)
**Spec-reviewer iterations used:** 0 / 5 — SKIPPED via REVIEW_GAP (Codex unavailable in remote env)
**ChatGPT spec review log:** n/a — SKIPPED via REVIEW_GAP (manual mode; remote autonomous session)

## REVIEW_GAP entries (carried to Phase 3)

```
REVIEW_GAP: grill-me | task-class: Significant | reason: remote autonomous session; no operator interview channel | operator-override: no | remediation: brief covers the grill topics (scope, dependencies, failure modes, operator surfaces, cluster fit, open questions) — per spec-coordinator §3b skip rule
REVIEW_GAP: spec-reviewer | task-class: Significant | reason: Codex CLI unavailable in remote execution environment | operator-override: no | remediation: run spec-reviewer manually before Phase 2 plan gate when in a local-dev session with Codex installed
REVIEW_GAP: chatgpt-spec-review | task-class: Significant | reason: manual ChatGPT-web mode requires operator paste loop; not viable in remote autonomous session | operator-override: no | remediation: run chatgpt-spec-review in a dedicated new session before Phase 2 plan gate, OR consume the chatgpt-pr-review pass at Phase 3 finalisation as the primary external-LLM review surface
```

## Open questions for Phase 2

All eight intent-level Open Questions were locked at spec authoring time (see `tasks/builds/memory-block-edges/intent.md § Open Questions` and the spec's §3 Goals + §4 Non-Goals + §9 Contracts). No open questions remain for the architect / builders.

**Operator decisions awaiting confirmation at the Phase 2 plan gate:**

1. Endpoint scope locked to block↔block (heterogeneous endpoints deferred to a future build).
2. Retrieval surface extends `graphExpansion.ts` via `memory_block_version_sources` reverse-walk (single-leg RRF preserved).
3. Skill-amendment ↔ memory_block linkage via new validated `rcaJson.cited_memory_block_ids: string[]` field (Zod-enforced).
4. Contradiction detector is a peer job (`memoryBlockContradictionDetectorJob.ts`), NOT folded into `correctionPatternDetector`.
5. `derived_from` edges fire only on block-of-blocks synthesis; the existing `memory_block_version_sources` keeps the workspace-entry lineage semantics unchanged.
6. Bounded traversal defaults: `edgeTraversalDepth = 2`, `edgeTraversalFanout = 5`. `MemoryConsolidationConfig` bumps to version 2.
7. Edge-type multipliers: `contradicts = 0`, `validates = 1.2`, `invalidates = 0.6`, `derived_from = 1.1`, `supersedes = 1.3`, `relates_to = 1.0`.
8. `memory.retrieved` payload extension: `traversed_edges: { id, type, confidence }[]` capped at 20 (empty array when flag is OFF).

## Decisions made in Phase 1

- Build slug ratified as `memory-block-edges` (matches the brief's nominated slug).
- Six v1 edge types: `contradicts | validates | invalidates | derived_from | supersedes | relates_to`.
- Feature flag `MEMORY_BLOCK_EDGES_ENABLED`, default OFF in every environment.
- Behaviour-mode flag (not a rollout gate); rollout-decision input is the audit-script `pass` result.
- Forward-only edge writes (G2): no historical backfill across synthesis or amendment data.
- Operator mutation surface limited to tombstone (no edge-type or provenance mutation; confidence-edit deferred).
- Soft-delete only (`tombstoned_at`); no hard delete.
- Six-phase build (§6 of spec); 11 phase-level acceptance criteria.
- Two new migrations (0379 schema + 0380 amendment JSONB validation; numbers assumed available — builder confirms at Phase 1 start; renumber if `0378_vision_inference_calls` has shifted up by parallel work).
- New `MEMORY_OVERRIDE` permission check on the tombstone route (key already exists in `server/lib/permissions.ts`).

## Phase 2 entry checklist

When `feature-coordinator` resumes in a fresh session:

1. Read this handoff first.
2. Read the spec at `docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md`.
3. Read the intent at `tasks/builds/memory-block-edges/intent.md`.
4. Read `tasks/builds/memory-block-edges/progress.md` for the REVIEW_GAP history.
5. Confirm the latest migration number — if migration 0379 is already taken by parallel work, renumber to the next available.
6. Run S1 branch-sync per `feature-coordinator` Step 2.
7. Invoke `architect` to produce the implementation plan (`tasks/builds/memory-block-edges/plan.md`).
8. Run `chatgpt-plan-review` (manual mode) per `feature-coordinator` Step 4.
9. Present the finalised plan at the plan gate; operator switches to Sonnet before construction.

## Phase 2 acceptance criteria (from the spec)

| Phase | Acceptance |
|---|---|
| Phase 1 (schema) | Migration runs forward/backward cleanly; `verify-rls-coverage.sh` passes; flag reads OFF by default. |
| Phase 2 (edge service + pure) | Pure helpers covered by Vitest; service has no direct DB import; no E2E/contract tests added. |
| Phase 3 (contradiction detector) | Job runs without traversing edges; idempotent on re-detection; bounded scan honoured; admin-only DB via `withAdminConnection`. |
| Phase 4 (synthesis + amendment emission) | Synthesis-of-blocks emits `derived_from` atomically; amendment-accept emits `validates` atomically; amendment-retire tombstones the prior `validates`; both writes RLS-respecting. |
| Phase 5 (retrieval traversal) | Flag-off retrieval bit-identical to pre-build; flag-on retrieval bounded; RRF fusion correctly combines edge-discovered candidates; `memory.retrieved` payload captures traversed edges. |
| Phase 6 (audit + observability + tombstone API) | Audit script runs five new checks against staging fixture set; observability events register without breaking LAEL; tombstone API requires `MEMORY_OVERRIDE`; gate-check warning fires when expected. |
