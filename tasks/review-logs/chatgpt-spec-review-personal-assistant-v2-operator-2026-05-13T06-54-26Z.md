# ChatGPT Spec Review Session — personal-assistant-v2-operator — 2026-05-13T06-54-26Z

## Session Info
- Spec: `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
- Branch: `claude/personal-assistant-post-merge-audit`
- PR: none (Phase 1; operator opens PR at Phase 3 per spec-coordinator playbook)
- Mode: manual
- Started: 2026-05-13T06:54:26Z
- Finalised: 2026-05-13T~07-45Z
- Rounds: 2
- Scope class: Major
- Prior review state: spec-reviewer (Codex) 5 iterations complete; both architectural decisions (PA-V2-OP-S1 file-events backing store, PA-V2-OP-S2 cross-owner state machine) resolved 2026-05-13 by operator. Schema decisions are LOCKED — do not relitigate.
- Framing per `docs/spec-context.md`: `pre_production: yes`, `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`.
- **Verdict:** APPROVED (2 rounds; spec locked at HEAD `b235d3f6` + Round 2 commit)

---

## Round 1 — 2026-05-13T~07-15Z

### ChatGPT Feedback (raw)

> I've got the spec loaded. I'm checking it as build-ready architecture, so I'm looking for stale wording, contradictions across sections, and contracts that would confuse the implementer.
>
> Thought for 14s
>
> Verdict: much better than the brief, but not quite lock-ready. The big brief-level issue, requester_user_id vs target_owner_user_id, is now fixed. The spec is directionally strong, but I'd clean up 4 blockers before moving to implementation.
>
> Blockers
> F1: operator_run_files versioning contract is internally inconsistent
>
> The spec says operator_run_files has:
> UNIQUE (agent_run_id, path)
> That means there is only one row per file path, with version updated in place.
> But elsewhere the spec talks about:
> MAX(version)+1
> Second writer gets the next version
> row-level terminal/event uniqueness
> With one row per path, there is no historical version row to take MAX(version) over. The correct model seems to be "latest metadata row only," so the update path should be UPSERT with `version = operator_run_files.version + 1` on conflict. Remove the stale MAX(version)+1 / "per-row allocator" language. Also, §9.3 still says the allocator choice is pinned once §13 open question #1 resolves, but §13 says that question is already resolved.
>
> F2: server/config/rlsProtectedTables.ts is both "no code change" and modified
>
> §4.1 / §6.1 / Chunk 1 say operator_run_files must be added to server/config/rlsProtectedTables.ts. But §4.8 lists it under "referenced existing primitives, no code change." Also avoid saying the migration adds an entry to rlsProtectedTables.ts — a SQL migration cannot edit a TypeScript manifest.
>
> F3: Testing posture contradicts itself
>
> The spec says "runtime tests are pure-function only; no new vitest/playwright authoring against V2" then requires "Pure-function unit tests `capabilityMapServicePure.routing.test.ts`." Pure-function tests are Vitest. Fix: "Runtime tests are limited to pure-function Vitest tests. No API, database, frontend, Playwright, supertest, or own-app integration tests."
>
> F4: actions.approver_user_id NULL may create ambiguous read semantics
>
> Spec should explicitly state approver_user_id is override-only, not the canonical approver field for all approvals. Without this, an implementer may backfill or start writing approver_user_id for all approvals, which would silently change V1 semantics.
>
> High-value tightenings
> T1: Make file watcher security explicit — realpath inside watched roots; symlinks, traversal, hidden credential paths ignored.
> T2: Clarify file event payload privacy — initiators see file artefacts only via terminal typed result.
> T3: Confirm target_owner_user_id cannot be supplied directly by untrusted clients.
> T4: Add a schema-level check for file version — `CHECK (version >= 1)`, `size_bytes >= 0`, non-empty path/storage_key.
> T5: Tighten @<DisplayName> matching — use existing agent visibility rules, not org-wide.
>
> Minor stale wording
> §6 opens with "V2 touches three tenant-scoped tables," then adds a fourth.
> §13 says "No HITL checkpoint required," but still contains implementer-discretion item.
> §12 — verify defaults (120-min cap, 5 concurrent sessions, 50 chain links) against merged operator-backend.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1: operator_run_files versioning contract internally inconsistent (MAX(version)+1 vs UNIQUE row-update model) | technical | apply | auto (apply) | high | Real internal-contract gap — implementer would build the wrong allocator. Rewrote §4.1 migration row with canonical UPSERT pattern + concurrency note; updated §9.3 race row; cleaned §13 open-question #1 stale wording. |
| F2: rlsProtectedTables.ts in two inventory buckets + migration claims it edits a .ts file | technical | apply | auto (apply) | medium | Inventory contradiction + impossible-migration assertion (SQL cannot mutate TypeScript). Moved entry from §4.8 to §4.3 as paired Chunk-1 TS edit; updated §6, §6.1, §4.1, Chunk 1 narrative. |
| F3: Testing posture forbids vitest but requires pure-function tests | technical | apply | auto (apply) | medium | Self-contradiction — pure-function tests on this repo ARE Vitest (docs/testing-conventions.md). Rewrote framing clause to allow pure-function Vitest while excluding integration/API/UI/Playwright. |
| F4: approver_user_id NULL semantics ambiguous (override vs canonical) | technical | apply | auto (apply) | high | Risk of silently changing V1 approval semantics if implementer backfills. Added "Semantics of approver_user_id (canonical)" paragraph to §5.5 pinning override-only behaviour and forbidding backfill. |
| T1: Watcher path-safety invariant (realpath, symlinks, credential paths, traversal) | technical | apply | auto (apply) | high | Watcher is the security boundary for less-controlled FS writes; gap would have shipped. Added explicit invariant to §4.5 sandbox-template row. |
| T2: Cross-owner file-event payload privacy | technical | apply | auto (apply) | high | Default-permissive file-event payloads would leak owner-private filenames/sizes/hashes to initiator. Added projection clause to §5.7 routing all `file.*` events through `runTraceProjectionForViewer`. |
| T3: target_owner_user_id from untrusted clients | technical | apply | auto (apply) | high | Authorisation-bypass risk if a future HTTP route accepts client-supplied target_owner. Added "Untrusted-client invariant" paragraph to §5.4 explicitly forbidding inbound client values. |
| T4: Schema CHECKs on operator_run_files (version, size_bytes, non-empty path/storage_key) | technical | apply | auto (apply) | low | Cheap defensive constraints; file-event state is replayable UI state. Folded into the §4.1 column definition. |
| T5: `@<DisplayName>` matching should use existing visibility rules, not org-wide | technical | apply | auto (apply) | medium | Org-wide query could cross subaccount boundaries. Rewrote §5.3 resolution row to defer to existing agent-visibility helper (capabilityDiscoveryHandlers + skillExecutor:1767-1770) with subaccount-scoped fallback. |
| Stale §6 "three tenant-scoped tables" (now four) | technical | apply | auto (apply) | low | Wording drift after operator_run_files was added. Reworded to "modifies three existing + creates one new". |
| Stale §13 "No HITL checkpoint required" vs implementer-discretion item #4 | technical | apply | auto (apply) | low | Wording reads as fully-closed despite a remaining test-surface discretion call. Reworded to "No architectural HITL checkpoint required — item #4 is implementer-discretion only". |
| Verify §12 defaults (120-min, 5, 50) against merged operator-backend | technical | reject | auto (reject) | low | Verified against `tasks/builds/operator-backend/brief.md` lines 252-254 and 290: soft cap default 120, max chain length default 50, concurrent-session cap default 5. Spec is correct as-is; no edit needed. |

### Applied (auto-applied technical)

- [auto] F1 — §4.1 migration 0346 row: canonical UPSERT versioning model + drop of MAX(version)+1 / per-row allocator language; §9.3 race row reworded; §13 open question #1 cleaned.
- [auto] F2 — `server/config/rlsProtectedTables.ts` moved from §4.8 (no-change) to §4.3 (modified) as paired Chunk-1 TS edit; §6, §6.1, §4.1, §8 Chunk 1 narrative updated to clarify SQL ≠ TS manifest.
- [auto] F3 — §1 testing_posture framing clause rewritten to allow pure-function Vitest while excluding integration/API/UI/Playwright.
- [auto] F4 — §5.5 gains canonical override-only semantics paragraph for `approver_user_id` (NULL = "derive via V1", forbidden to backfill).
- [auto] T1 — §4.5 watcher row gains explicit path-safety invariant (realpath inside roots, symlinks/traversal/credential paths ignored + logged).
- [auto] T2 — §5.7 gains cross-owner privacy projection clause routing `file.*` payloads through `runTraceProjectionForViewer` before initiator-side serialisation.
- [auto] T3 — §5.4 gains "Untrusted-client invariant" paragraph forbidding inbound client `target_owner_user_id`.
- [auto] T4 — §4.1 migration column list gains CHECK (version >= 1), CHECK (size_bytes >= 0), CHECK (path <> ''), CHECK (storage_key <> '').
- [auto] T5 — §5.3 `@<DisplayName>` row defers to existing agent-visibility rules (capabilityDiscoveryHandlers + skillExecutor:1767-1770), with subaccount-scoped fallback explicit.
- [auto] Stale §6 — "three" → "modifies three existing + creates one new".
- [auto] Stale §13 — "No HITL" line reworded as "No architectural HITL — item #4 is implementer-discretion only".

### Integrity check
Integrity check: 0 issues found this round (auto: 0, escalated: 0). All section/heading cross-references intact after edits; the new T2 clause references §5.4 (which carries `runTraceProjectionForViewer`); T5 references `server/services/skillExecutor.ts:1767-1770` which is already cited in §4.3.

### Top themes
File-events backing store contract consistency (versioning + manifest edit + CHECKs), security-invariant tightening (watcher path safety, cross-owner file privacy, client-input authorisation), V1-semantics preservation (approver_user_id override-only), and orchestrator visibility scoping (display-name matching reuses existing helper).

---

## Round 2 — 2026-05-13T~07-40Z

### ChatGPT Feedback (raw)

> Yes. The previous blockers are mostly cleaned up. I'd give this a near lock-ready verdict, with 2 remaining fixes I'd make before finalising.
>
> **Remaining fixes**
>
> **F1 — file.created vs file.modified is still underdefined with latest-row-only storage**
>
> The new UPSERT model is good, but the event type decision still says the pure helper decides created vs modified by looking up a prior row. That creates a race if two writers hit the same new path concurrently:
> - Writer A checks prior row: none → decides file.created
> - Writer B checks prior row: none → decides file.created
> - UPSERT serialises them, one becomes version 1, the other becomes version 2
> - Both may emit file.created
>
> The event type should be derived from the UPSERT result, not from a preflight lookup.
>
> Patch wording:
> > The bridge determines event type from the write result, not from a preflight existence check. UPSERT returns the final version. If returned version = 1, emit file.created. If returned version > 1, emit file.modified. Preflight lookup may be used for watcher dedupe only, but not as the source of truth for event type under concurrency.
>
> Then adjust §4.2:
> > operatorSandboxFileEventBridgePure: pure helpers for shape validation, MIME detection, content-sha256 computation, watcher dedupe, and event-type derivation from the persisted write result.
>
> This is small but important.
>
> **F2 — §9.4 still references "§13 open question #2" after that question is resolved**
>
> §9.4 says:
> > The substep_id value is sourced from the sub-step state-machine row whose schema strategy is the subject of §13 open question #2...
>
> But §13 says the cross-owner state-machine strategy is resolved. Replace with:
> > The substep_id value is delegation_outcomes.id. Migration 0345 extends delegation_outcomes with the state-machine columns and terminal_at guard that enforce the exactly-one-terminal-event guarantee.
>
> Also remove any "see that question" phrasing. It is now settled architecture, not an open decision.
>
> **Optional tightenings**
>
> **T1 — The watcher dedupe rule should include version semantics**
>
> Right now watcher dedupe skips if the same hash exists. Good. But if the same file path changes and then changes back to a previous hash, the watcher could mistakenly suppress a legitimate later event if it checks any historical/current row too broadly.
>
> Given latest-row-only storage, define it as:
> > Watcher dedupe checks the current operator_run_files row for the same (agent_run_id, path). It skips only when the current row's content_sha256 equals the observed hash. If the hash differs, it writes through the canonical UPSERT and emits based on returned version.
>
> **T2 — Consider changing "warning-tier" for file events**
>
> §4.6 says file events are warning-tier. That feels semantically odd if "warning" means abnormal. If the existing registry uses warning-tier for non-critical UI updates, fine. If not, file events should be info/normal-tier. Not a blocker, just worth aligning with the existing event criticality taxonomy.
>
> **T3 — Clarify that cross-owner status read-model visibility does not reveal owner-private event timing**
>
> The spec hides raw owner data, but lifecycle states like executing, awaiting_cross_owner_approval, and terminal timing can still leak some activity. This is probably acceptable, but add one sentence:
> > Initiator-visible lifecycle state is limited to coarse task status and must not include owner-side timestamps beyond the parent task's own pause/resume timestamps unless explicitly included in the typed result summary.
>
> **Bottom line**
>
> This is now very close to final. Fix F1 and F2, then I'd be comfortable locking the spec and moving into implementation.

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1: event type derived from preflight lookup creates concurrent-write race (both writers emit `file.created`) | technical | apply | auto (apply) | critical | Real correctness bug under concurrency. Rewrote §4.2 bridge + pure rows: bridge now derives event type from UPSERT `RETURNING version` (v=1 ⇒ created, v>1 ⇒ modified). Rewrote §5.7 with explicit "Event-type derivation rule (canonical)" paragraph + worked race example. §9.1 / §9.3 aligned. |
| F2: §9.4 references "§13 open question #2" + "see that question" as if still open | technical | apply | auto (apply) | medium | Settled architecture must read as settled. Rewrote §9.4 to inline `delegation_outcomes.id` as `substep_id` with the row-level write-time predicate as the uniqueness mechanism; cleaned §4.8 entries for `delegationOutcomes.ts` and `tasks/todo.md` that still framed #2 as open. |
| T1: watcher dedupe should specify "current row only" under latest-row-only storage (hash-regression case) | technical | apply | auto (apply) | medium | Latency-only ambiguity but worth pinning to prevent a misread implementation that scans historical rows. Rewrote §5.7 watcher dedupe rule explicitly + §9.3 race row + §9.1 idempotency row. Covers the hash A→B→A regression case: correctly re-emits because the current row carries B. |
| T2: file events tier should align with existing event-criticality taxonomy (not "warning-tier") | technical | apply | auto (apply) | low | `AGENT_EXECUTION_EVENT_CRITICALITY` registry at `shared/types/agentExecutionLog.ts:408` is `Record<EventType, boolean>` — no "warning" tier exists. Replaced "file events: warning-tier; cross-owner-substep events: critical-tier" in §4.6 with explicit assignments grounded in the boolean registry: `file.*: false` (UI-progress; aligned with `skill.invoked` / `tool.error`); `cross_owner_substep.*: true` (run-flow-relevant — terminal-state semantics affect parent-run resume; aligned with `run.completed` / `handoff.decided`). |
| T3: initiator-visible lifecycle state must not leak owner-side per-state timestamps | technical | apply | auto (apply) | medium | Real privacy invariant — coarse status doesn't leak, but per-state timestamps would enable owner-activity inference (when online, how long approvals took). Added "Initiator-visible lifecycle timing invariant" paragraph to §5.4: timestamp fields are opt-in via the projection allow-list; default opt-out for any new column on `delegation_outcomes`. Only the parent's own `paused_at` / `resumed_at` and timestamps explicitly bundled into the terminal typed result leak through. |

### Applied (auto-applied technical)
- [auto] F1 — §4.2 bridge + pure rows rewritten to derive event type from UPSERT `RETURNING version`; §5.7 gains canonical "Event-type derivation rule" with worked race example; §9.1 / §9.3 rows aligned.
- [auto] F2 — §9.4 inlines `delegation_outcomes.id` as `substep_id` + row-level write-time predicate as uniqueness mechanism; §4.8 entries for `delegationOutcomes.ts` and `tasks/todo.md` rewritten to read as settled.
- [auto] T1 — §5.7 watcher dedupe rule pinned to "current row only" under latest-row-only semantics, with explicit hash-regression handling; §9.3 race row + §9.1 idempotency row aligned.
- [auto] T2 — §4.6 `agentExecutionLog.ts` row rewritten with explicit boolean criticality assignments grounded in the registry: `file.*: false` (info-tier UI progress), `cross_owner_substep.*: true` (critical retry-tier).
- [auto] T3 — §5.4 gains "Initiator-visible lifecycle timing invariant" allow-list paragraph forbidding owner-side per-state timestamp leakage; default opt-out for any new `delegation_outcomes` column.

### Integrity check
Integrity check: 0 issues found this round (auto: 0, escalated: 0). Verified no stale references remain: `grep` for `open question`, `§13 open`, `warning-tier`, `preflight`, `MAX(version)` returns zero hits across the spec. All `§*` cross-references resolve to existing headings (`### Goals` … `### 9.7 State machine closure`). Post-integrity sanity (4c): no empty sections produced; no broken links.

### Top themes
Final correctness pass: concurrency-safe event-type derivation (F1), settled-architecture wording hygiene (F2), latest-row-only watcher dedupe semantics (T1), event-registry taxonomy alignment (T2), and owner-activity-timing privacy tightening (T3). Round 2 introduces zero new contracts and zero new file paths; every change is a clarification or correctness pin against existing contracts in Round 1.

---

## Consistency check (across rounds)

Scanned all 17 findings across Round 1 (12) and Round 2 (5) for contradictions: zero contradictions detected. Notable cross-round threads:

- Watcher dedupe contract: introduced in R1-T2 (cross-owner file privacy projection); pinned in R2-T1 (latest-row-only semantics with hash-regression case). Same direction; R2 strengthens R1.
- Event-type derivation: implied in R1-F1 (UPSERT model) but left ambiguous on the "who decides created vs modified" axis; R2-F1 closes the ambiguity. Consistent direction.
- Cross-owner privacy projection: §5.4 (R1-T2) + §5.7 (R1-T2 file-event-payload projection) + §5.4 (R2-T3 timing-allow-list) form a coherent three-layer projection: viewer-role data filter, file-event-payload filter, timestamp allow-list. No contradictions.
- §13 open-question wording: R1 cleaned #1 (file-events backing store); R2 cleaned #2 (cross-owner state machine) — same finalisation direction, no override.

## Implementation readiness checklist
- All inputs defined: yes — every contract in §5 names producer + consumer + TypeScript shape.
- All outputs defined: yes — terminal events (§9.4) closed set + cross-owner sub-step state machine (§9.7) closed set + addressing parse result discriminated union (§5.3).
- Failure modes covered: yes — credential broker fail → `failed` (§9.7); authorisation fail-closed → clarifying question (§5.4); 4 KB context overflow → trim-fallback (§5.8); timeout policies × 3 (§5.6).
- Ordering guarantees explicit: yes — §8 chunk DAG; §6.4 same-transaction recompute; §9.3 concurrency guards.
- No unresolved forward references: yes — integrity check confirms zero stale references.

Checklist clean — spec is implementation-ready.

---

## Final Summary
- Rounds: 2
- Auto-accepted (technical): 16 applied | 1 rejected | 0 deferred
- User-decided: 0 applied | 0 rejected | 0 deferred (HUMAN_IN_LOOP not applicable — manual mode; every finding was triaged technical and auto-applied per playbook)
- Index write failures: 0
- Deferred to `tasks/todo.md` § Spec Review deferred items / personal-assistant-v2-operator: none — every finding across both rounds was apply or reject; no defers raised.
- KNOWLEDGE.md updated: yes (1 entry — see Pattern extraction below)
- architecture.md updated: no — checked `operator_run_files`, `runTraceProjectionForViewer`, `cross_owner_substep`, `capability_map.owner_user_id`, `requester_user_id`, `target_owner_user_id`, `delegation_outcomes.substep_status`, `chokidar`; spec §4.7 explicitly defers the architecture-clause edits ("universal OpenTaskView + run-trace invariant", "capability_map.owner_user_id description", "cross-ownership delegation pattern") to the Phase 2 implementation Chunk 9 doc-sync sweep — those clauses are paired with code landing, not spec-review finalisation
- capabilities.md updated: no — checked "standing autonomous operator", "Executive Assistant", "cross-ownership", "owner-scoped"; the EA "standing autonomous operator" capability bullet is similarly deferred to Chunk 9 (§4.7) — vendor-neutral editorial-compliant copy is authored alongside the implementation, not during spec review
- integration-reference.md updated: n/a — V2 adds zero new integrations; no scope / OAuth provider / MCP preset / capability slug / alias changes
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — checked "spec review", "ChatGPT", "chatgpt-spec-review", "review pipeline", "test gate", "RLS"; this session followed the locked playbook without modifying it
- spec-context.md updated: no — checked `pre_production`, `testing_posture`, `runtime_tests`, `accepted_primitives`, `convention_rejections`; framing statements were verified current and explicitly cited by the spec under review (§1, §3 ranked-source #5, §10) — no framing-assumption change triggered by this spec
- frontend-design-principles.md updated: n/a — V2 ships zero new UI surfaces (§1 non-goals; OpenTaskView / GlobalAskBar / FilesTab / approval queue / RunTraceEventRenderer all reused unchanged)
- decisions/ updated: no — Appendix B already lists "consider ADR for 'approval follows executor's owner, not initiator'" as a Chunk 9 candidate. Operator may author at implementation time. Schema decisions PA-V2-OP-S1 / PA-V2-OP-S2 are locked in §13 and trace through brief.md decisions; no separate ADR needed for this review pass.
- doc-sync.md updated: no — checked the table of registered docs; no new top-level reference doc was introduced by this spec or this review
- PR: pending (Phase 1 spec; operator opens PR at Phase 3 per spec-coordinator playbook)

### Pattern extraction (KNOWLEDGE.md)
One pattern emerges from Round 2 that generalises beyond this spec:

> **Derive event type from the persistent write result, not from a preflight existence check.** Under concurrency, two writers performing the same preflight lookup will both observe "no prior row" and both emit `*.created`, even though the UPSERT will serialise them and only one becomes version 1. Always source the event-type discriminator (`created` vs `modified`, `inserted` vs `updated`, etc.) from the post-write return value (`RETURNING version`, `xmax = 0` check, or RPC result), never from a separate read. Preflight existence checks are acceptable for dedupe / fast-path skips, but never for event-type discrimination.

This is a general agent-coding gotcha — Postgres UPSERT race semantics are a frequent foot-gun in agent-emitted webhook / event-stream code. Adding to KNOWLEDGE.md so future specs touching event streams catch it pre-review.

## End of session — spec LOCKED at HEAD `b235d3f6` + Round 2 commit. Hand off to architect or invoke writing-plans when ready to implement.
