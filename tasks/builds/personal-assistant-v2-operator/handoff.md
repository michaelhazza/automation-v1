# Handoff — personal-assistant-v2-operator

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Branch:** `claude/personal-assistant-post-merge-audit`
**Build slug:** `personal-assistant-v2-operator`
**UI-touching:** no
**Mockup paths:** n/a (brief §0.5 decision #6 ratified zero new mockups; all surfaces reuse existing primitives — `OpenTaskView`, `GlobalAskBar`, `RunTraceEventRenderer`, `FilesTab`, approval queue, operator-backend prototypes `r1-r17`)
**Spec-reviewer iterations used:** 5 / 5
**ChatGPT spec review log:** `tasks/review-logs/chatgpt-spec-review-personal-assistant-v2-operator-2026-05-13T06-54-26Z.md`
**Spec-reviewer final report:** `tasks/review-logs/spec-review-final-personal-assistant-v2-operator-2026-05-13T06-41-00Z.md`
**Spec at HEAD:** commit `e27a218a` (locked APPROVED 2026-05-13 after 2 ChatGPT rounds)

## Open questions for Phase 2

None blocking. All architectural decisions ratified before / during Phase 1. Two minor implementer-discretion items survive:

1. The orchestrator routing module path was previously TBD; resolved to `server/tools/capabilities/capabilityDiscoveryHandlers.ts` (`executeCheckCapabilityGap`, dispatched by `server/services/skillExecutor.ts:1767-1770`). Confirm before Chunk 2.
2. Whether `runTraceProjectionForViewer` deserves a dedicated `*Pure.ts` split — implementer's judgement on test surface during Chunk 3.

## Decisions made in Phase 1

### Pre-spec (ratified in brief §4.A, inherited by spec)

1. Mid-session memory updates apply at chain-link boundaries, not mid-link.
2. Initial-context bundle hard cap 4 KB; trim priority voice profile features > recent memory blocks > older memory blocks.
3. Operator-mode planning: per-action approval only, no plan-level gate before execution.
4. `@<DisplayName>` collision rule: no score boost; pure capability matching proceeds.
5. New CI gate name: `scripts/gates/verify-capability-map-shape.sh`.
6. Cross-owner delegation authorisation: two-layer rule (named-owner reference in user intent OR explicit owner-scoped capability request from trusted parent-agent tool call). Else fail closed with clarifying question.
7. Use case shortlist: V2 ships use cases #1 (complex client investigation) + #2 (multi-source synthesis); use case #3 (calendar-aware multi-person orchestration) deferred to V2.1.

### Spec-coordinator decisions (operator-confirmed via decision prompts 2026-05-13)

8. **File-events backing store (PA-V2-OP-S1):** new table `operator_run_files` keyed on `agent_run_id → agent_runs.id`. Migration 0348. UNIQUE `(agent_run_id, path)`. RLS policy filters on row's own `organisation_id`. Rejected the alternative of extending `execution_files` (distinct lifecycle/domain).
9. **Cross-owner sub-step state machine (PA-V2-OP-S2):** extend `delegation_outcomes` rather than create a new table. Migration 0347 adds `cross_owner_approval_timeout_policy`, `substep_status`, `terminal_at`, plus partial index `(run_id, substep_status) WHERE terminal_at IS NULL`. Rejected the alternative of a separate state-machine table (would split cross-owner state across two tables).

### chatgpt-spec-review decisions (auto-applied, technical findings only)

Round 1 (commit `b235d3f6`): 11 technical fixes applied, 1 rejected, 0 deferred. Highlights:
- §4.1 migration 0348 rewritten with canonical UPSERT pattern (`INSERT ... ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1`) + 4 CHECK constraints (`version >= 1`, `size_bytes >= 0`, non-empty path/storage_key).
- `server/config/rlsProtectedTables.ts` moved from "referenced existing primitives" to "modified" (TypeScript file, not SQL — the migration creates the table + RLS policy; the implementation chunk edits the manifest).
- §1 testing-posture clause reworded: "pure-function Vitest tests, no API/UI/Playwright" (resolves the contradiction with the new pure-function unit-test files the spec requires).
- §5.5 `approver_user_id` pinned as override-only (NULL = "derive approver via V1 default rule", not "unknown"); forbids backfill.
- §4.5 sandbox watcher path-safety invariant (realpath check; symlinks/traversal/credential paths ignored + logged).
- §5.4 untrusted-client invariant: `target_owner_user_id` from HTTP/client input is ignored.
- §5.3 `@<DisplayName>` defers to existing agent-visibility helper (not org-wide).
- §5.7 cross-owner file-event payloads projected through `runTraceProjectionForViewer`.

Round 2 (commit `e27a218a`): 5 technical fixes applied, 0 rejected, 0 deferred. Highlights:
- **Critical:** §5.7 file-event type now derives from the UPSERT `RETURNING version` result, not a preflight existence check. Closes a concurrent-write race where two writers both observed "no prior row" and both emitted `file.created`. Pattern extracted to `KNOWLEDGE.md`.
- §9.4 stale "§13 open question #2" reference replaced with concrete `delegation_outcomes.id` source.
- §4.5 watcher dedupe clarified: check current row's `content_sha256` only; if differs, UPSERT and emit based on returned version.
- §4.6 file-event criticality tier aligned with existing event-registry taxonomy (boolean criticality, not "warning-tier").
- §5.4 cross-owner status read-model: initiator-visible lifecycle state limited to coarse task status; no owner-side per-state timestamps unless in the typed result summary.

## Implementation entry points

- **Start chunk:** Chunk 1 (Foundation — schema + types + CI gate). Migrations 0345–0348, new shared types, new schema file `server/db/schema/operatorRunFiles.ts`, new CI gate `scripts/gates/verify-capability-map-shape.sh`, `computeCapabilityMapPure` extension. No prerequisites.
- **Acceptance criterion (§8 Chunk 1):** typecheck + lint + `verify-capability-map-shape.sh` + `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` all pass on fresh DB; `operator_run_files` registered in `rlsProtectedTables.ts`.
- **Chunk 7 (live-file events) acceptance criterion (§10 #5):** long-running operator-mode EA task writes 5 files at different chain-link boundaries; `file.created` / `file.modified` events appear on the `agent-run` WebSocket channel before terminal completion; `FilesTab` shows files updating live.
- **Reuse acceptance test (Appendix A):** stub Dev Agent with `owner_user_id` + equivalent `capability_map` passes all four routing fixtures (direct-owner, cross-ownership, approval-owner, ambiguous-fail-closed) with no EA-specific branching in matcher / approval router / delegation path.

## Phase 1 review summary

| Reviewer | Verdict | Rounds | Findings applied | Findings rejected | Findings deferred |
|---|---|---|---|---|---|
| spec-reviewer (Codex + Claude) | NEEDS_REVISION → resolved via operator decisions | 5 | 33 + 2 schema decisions | 0 | 0 (both PA-V2-OP-S1/S2 resolved 2026-05-13) |
| chatgpt-spec-review (manual) | APPROVED | 2 | 16 | 1 | 0 |

Branch state at handoff: clean local tree (spec + KNOWLEDGE.md + tasks/todo.md edits committed). Branch ahead of `main` by ~11 commits (1 sync + 1 brief + 6 spec-reviewer + 1 schema-lock + 2 ChatGPT + this handoff).
