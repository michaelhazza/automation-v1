# Handoff — personal-assistant-v2-operator

**Phase complete:** BUILD
**Next phase:** FINALISE (run `launch finalisation` in a new session)
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

8. **File-events backing store (PA-V2-OP-S1):** new table `operator_run_files` keyed on `agent_run_id → agent_runs.id`. Migration 0353. UNIQUE `(agent_run_id, path)`. RLS policy filters on row's own `organisation_id`. Rejected the alternative of extending `execution_files` (distinct lifecycle/domain).
9. **Cross-owner sub-step state machine (PA-V2-OP-S2):** extend `delegation_outcomes` rather than create a new table. Migration 0352 adds `cross_owner_approval_timeout_policy`, `substep_status`, `terminal_at`, plus partial index `(run_id, substep_status) WHERE terminal_at IS NULL`. Rejected the alternative of a separate state-machine table (would split cross-owner state across two tables).

### chatgpt-spec-review decisions (auto-applied, technical findings only)

Round 1 (commit `b235d3f6`): 11 technical fixes applied, 1 rejected, 0 deferred. Highlights:
- §4.1 migration 0353 rewritten with canonical UPSERT pattern (`INSERT ... ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1`) + 4 CHECK constraints (`version >= 1`, `size_bytes >= 0`, non-empty path/storage_key).
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

- **Start chunk:** Chunk 1 (Foundation — schema + types + CI gate). Migrations 0345 + 0351–0353, new shared types, new schema file `server/db/schema/operatorRunFiles.ts`, new CI gate `scripts/gates/verify-capability-map-shape.sh`, `computeCapabilityMapPure` extension. No prerequisites.
- **Acceptance criterion (§8 Chunk 1):** typecheck + lint + `verify-capability-map-shape.sh` + `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` all pass on fresh DB; `operator_run_files` registered in `rlsProtectedTables.ts`.
- **Chunk 7 (live-file events) acceptance criterion (§10 #5):** long-running operator-mode EA task writes 5 files at different chain-link boundaries; `file.created` / `file.modified` events appear on the `agent-run` WebSocket channel before terminal completion; `FilesTab` shows files updating live.
- **Reuse acceptance test (Appendix A):** stub Dev Agent with `owner_user_id` + equivalent `capability_map` passes all four routing fixtures (direct-owner, cross-ownership, approval-owner, ambiguous-fail-closed) with no EA-specific branching in matcher / approval router / delegation path.

## Phase 2 — BUILD (complete)

**Phase complete:** BUILD
**Next phase:** FINALISE (run `launch finalisation` in a new session)
**Branch HEAD:** `96e5df6c` (chore: record dual-review log commit hash)
**Branch ahead of main:** ~54 commits
**Spec used:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`

### Chunks built

| Chunk | Status | Key deliverable |
|-------|--------|-----------------|
| 1a | done | Migrations 0345 + 0351–0353, `operatorRunFiles` Drizzle schema, RLS manifest |
| 1b | done | Shared types, `verify-capability-map-shape.sh` CI gate, capability-map `owner_user_id` axis, backfill script |
| 2 | done | `RoutingContext.target_owner_user_id`, addressing parser (`@PA`/`@<DisplayName>`), matcher rule |
| 3 | done | `crossOwnerDelegationAuthorisationPure.ts`, `crossOwnerDelegationRequestAssemblerPure.ts`, `runTracePure.ts` projection |
| 4 | done | `approverUserId` override column, stall-job cross-owner branch, `decideTimeoutPolicyAction`, `ask_initiator` substep |
| 5 | done | Operator-mode EA enablement — no-op confirmed (guard already wired from prior sprint) |
| 6 | done | `operatorSessionInitialContextBundler.ts` — 4 KB cap, voice profile, memory, calendar context |
| 7 | done | `operatorSandboxFileEventBridge.ts` — UPSERT writer, R2 + DB + event-emit, `isR2Retryable`, `shouldWatcherSkip` |
| 8 | done | `file-watcher.js` (chokidar), `entrypoint.sh`, `Dockerfile`, IPC retry, path-safety |
| 9 | done | `architecture.md` (cross-owner delegation, run-trace invariant, capability-map scope axis), `capabilities.md`, `KNOWLEDGE.md` (4 entries), ADR-0023 |

### Branch-level review pass results

| Reviewer | Verdict | Key outcomes |
|----------|---------|-------------|
| G2 gate (lint + typecheck) | PASS | 0 lint errors; 2 pre-existing typecheck errors only (`@react-pdf/renderer`) |
| `adversarial-reviewer` | HOLES_FOUND → fixed | 6 holes fixed (migration columns, IPC semantics, path traversal, approver gate, regex bug); 1 deferred (`deriveApproverUserId` wiring) |
| `spec-conformance` | NON_CONFORMANT | 8 directional gaps routed to `tasks/todo.md` (PA-V2-CONFORMANCE-1 through 8); 0 mechanical fixes; all require design judgment — none blocking merge |
| `pr-reviewer` (pass 1) | CHANGES_REQUESTED | 5 blocking issues identified |
| Fix-loop (pass 1) | SUCCESS | 5 blocking fixes applied (rejectItem gate, run-trace vocab, db-in-routes, org-filter, Pure.test.ts) |
| `pr-reviewer` (pass 2) | CHANGES_REQUESTED | 1 remaining: run_terminated vs phantom run_finished/run_failed |
| Fix inline | done | `run_terminated` substituted; POSSESSIVE_RE Unicode apostrophe escapes fixed; approveItem uses `isWrongApprover` |
| `pr-reviewer` (pass 3) | APPROVED | All 5 blockers resolved; 7 should-fix items deferred to backlog |
| `reality-checker` | READY | All 8 success criteria verified with file:line evidence |
| `dual-reviewer` (Codex, 3 iter.) | APPROVED | 5 fixes applied (cursor advance, ask_initiator dedup, replay serialization, R2 retry scope) |

### Review-log artifacts

- `tasks/review-logs/spec-conformance-log-personal-assistant-v2-operator-full-2026-05-13T20-55-39Z.md`
- `tasks/review-logs/dual-review-log-personal-assistant-v2-operator-2026-05-13T22-04-43Z.md`
- Adversarial review committed inline (no separate log; findings were fix-loop driven)

### Open deferred items (tasks/todo.md)

- `PA-V2-CONFORMANCE-1` through `PA-V2-CONFORMANCE-8` — 8 spec-conformance directional gaps requiring design judgment (callers not wired, payload convention delta, RLS context, admin bypass)
- `deriveApproverUserId` dead-code wiring — requires `MiddlewareContext` changes + execution loop integration (tracked with full remediation plan in todo.md)
- 7 should-fix items from pr-reviewer (all DEFER_TO_BACKLOG) — admin bypass for run-trace, voice-profile RLS outside HTTP request, R2→DB ordering comment, `isR2Retryable` test, ambiguous-name test, file-watcher boundary asymmetry, shallow-module smell

### REVIEW_GAP entries

None required. All mandatory reviewers ran:
- `spec-conformance`: ran (NON_CONFORMANT, directional gaps to todo.md — not a policy violation)
- `adversarial-reviewer`: ran (triggered: routes, auth, schema in diff)
- `pr-reviewer`: ran (3 passes)
- `reality-checker`: ran (READY)
- `dual-reviewer`: ran (APPROVED, 3 Codex iterations)
- `chatgpt-pr-review`: deferred to Phase 3 (per CLAUDE.md — finalisation-coordinator handles this, not feature-coordinator)

## Phase 1 review summary

| Reviewer | Verdict | Rounds | Findings applied | Findings rejected | Findings deferred |
|---|---|---|---|---|---|
| spec-reviewer (Codex + Claude) | NEEDS_REVISION → resolved via operator decisions | 5 | 33 + 2 schema decisions | 0 | 0 (both PA-V2-OP-S1/S2 resolved 2026-05-13) |
| chatgpt-spec-review (manual) | APPROVED | 2 | 16 | 1 | 0 |

Branch state at handoff: clean local tree (spec + KNOWLEDGE.md + tasks/todo.md edits committed). Branch ahead of `main` by ~11 commits (1 sync + 1 brief + 6 spec-reviewer + 1 schema-lock + 2 ChatGPT + this handoff).

## Phase 3 (FINALISATION) — complete

**PR number:** #299
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-personal-assistant-v2-operator-2026-05-13T22-55-35Z.md`
**spec_deviations reviewed:** n/a (none recorded in Phase 2 handoff)
**Doc-sync sweep verdicts:** architecture.md `yes (Cross-ownership delegation pattern V2 — added cross-org service-layer fail-closed bullet + timeout-sweep durability columns paragraph)`; capabilities.md `n/a` (no capability/skill/integration change); integration-reference.md `n/a` (no integration change); CLAUDE.md / DEVELOPMENT_GUIDELINES.md `no — no build-discipline / agent-fleet / locked-rule change`; CONTRIBUTING.md `no — checked listPendingApprovalsForUser / cross_owner_substep / operator_run_files / substep_status_updated_at / terminal_event_emitted_at / awaiting_initiator_event terms; zero stale references; no lint-suppression-policy change`; frontend-design-principles.md `n/a` (no UI pattern change); KNOWLEDGE.md `yes (4 Phase-2 patterns + 3 Phase-3 patterns extracted)`; docs/decisions/ `yes (ADR-0023 added Phase 2, index entry verified)`; references/test-gate-policy.md `n/a`; references/spec-review-directional-signals.md `n/a` (PR review, not spec review); docs/incident-response.md `n/a`; docs/testing-transition-plan.md `n/a`; .claude/FRAMEWORK_VERSION + CHANGELOG.md `n/a (no framework-level change; this repo is at 2.3.0)`.
**KNOWLEDGE.md entries added:** 4 in Phase 2 + 3 in Phase 3 finalisation (three-state owner lookup, claim+emit pattern, DB trigger for status-transition timestamp, JSONB key-existence guards).
**tasks/todo.md items removed:** 0 — no items closed by this build's Phase 3 fixes; 4 new backlog items added (PA-V2-LIST-APPROVALS-V1-ARM, PA-V2-WATCHER-HOST-BRIDGE, PA-V2-OPERATOR-TEMPLATE-PROMOTION, PA-V2-EVENT-IDEMPOTENCY).
**ready-to-merge label applied at:** 2026-05-14T00:12:11Z

### Phase 3 review summary

| Reviewer | Verdict | Rounds | Findings applied | Findings rejected | Findings deferred |
|---|---|---|---|---|---|
| chatgpt-pr-review (manual) | APPROVED | 7 | 22 (F1–F15 + T1, T3–T8 — F2 + T2 partially deferred per nature) | 0 | 4 (LIST-APPROVALS-V1-ARM, WATCHER-HOST-BRIDGE, OPERATOR-TEMPLATE-PROMOTION, EVENT-IDEMPOTENCY) |

### Notable Phase 3 events

1. **Mid-Phase-3 main sync (Round 5→6):** main's PR #297 (iee-browser-on-e2b) merged while ChatGPT Round 5 returned APPROVED. The follow-up S2 sync hit a 6-migration collision on numbers 0346-0350 (main claimed them for IEE browser session work). All six V2 migrations renumbered: `0346→0351`, `0347→0352`, `0348→0353`, `0349→0354`, `0350→0355`, `0351→0356`. A subsequent Round 6 adversarial pass found three new issues (F13 stale 0345 EA migration renumbered to 0357; F14 missing `.js` imports; F15 over-broad assembler UPDATE) and one should-fix (T7 capability-map gate ignoring absent JSONB keys). All fixed in Round 6 + final T8 down-migration-header cleanup in Round 7.
2. **Final migration ordering:** 0345 (memory_utility_30d, main) + 0346/0347/0349/0350 (iee-browser, main) + 0348 (llm_subtype, main) + 0351-0356 (PA-V2: actions.approver, delegation state, operator_run_files, substep_status_updated_at, trigger, event-emit audit) + 0357 (EA controller-style flip).
3. **Branch at finalisation:** all Phase 3 commits on `claude/personal-assistant-post-merge-audit`; the squash-commit on main will collapse the 7-round review arc + the post-merge renumber + the doc-sync work into a single landed commit.
