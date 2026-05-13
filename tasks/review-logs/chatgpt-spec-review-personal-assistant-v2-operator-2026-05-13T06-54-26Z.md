# ChatGPT Spec Review Session — personal-assistant-v2-operator — 2026-05-13T06-54-26Z

## Session Info
- Spec: `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
- Branch: `claude/personal-assistant-post-merge-audit`
- PR: none (Phase 1; operator opens PR at Phase 3 per spec-coordinator playbook)
- Mode: manual
- Started: 2026-05-13T06:54:26Z
- Scope class: Major
- Prior review state: spec-reviewer (Codex) 5 iterations complete; both architectural decisions (PA-V2-OP-S1 file-events backing store, PA-V2-OP-S2 cross-owner state machine) resolved 2026-05-13 by operator. Schema decisions are LOCKED — do not relitigate.
- Framing per `docs/spec-context.md`: `pre_production: yes`, `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`.

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
