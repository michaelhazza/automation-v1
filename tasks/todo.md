# Live backlog — in-flight items only

**Purpose.** This file holds only items that are mid-flight or imminently actionable. It is intentionally short. If an item belongs on a watchlist, in a future spec, in an architecture doc, or in an ADR — it does not belong here.

**Last triaged:** 2026-05-13 (Chunk 13.A inventory → Chunk 13.B sweep). Pre-sweep file (4,408 lines) is preserved verbatim in `tasks/todo-archive/2026-Q2.md § Bulk legacy backlog sweep — 2026-05-13`.

---

## How to use this file

1. **Adding an item.** Only add an item here if it is a concrete, claimable task that is being actively worked or will be worked in the next 1–2 weeks. Everything else goes in:
   - `tasks/builds/<slug>/spec.md` — for future-feature stubs (one paragraph each)
   - `tasks/todo-archive/<quarter>.md` — for items resolved, superseded, or accepted-as-is
   - `docs/decisions/<NNNN>-<slug>.md` — for durable architectural choices
   - `KNOWLEDGE.md` — for patterns / gotchas / conventions
   - `architecture.md` — for canonical structural rules
2. **Removing an item.** When an item is resolved, archived, or promoted, replace its body with a one-line back-reference to the new home. Do not silently delete.
3. **Quarterly trim.** Once per quarter, sweep `[x]` / CLOSED / RESOLVED rows to the archive under a "Bulk closed items — <date> sweep" heading. No per-item rationale needed; each row carries its own context.

---

## Currently active items

_(none — see `tasks/current-focus.md` for sprint-level pointer; status NONE as of 2026-05-11)_

---

## Pick-next queue

The pick-next backlog now lives as one-paragraph stub specs under `tasks/builds/<slug>/spec.md`. Each stub names a trigger condition and a one-line scope statement; `architect` expands at activation time. Browse the list with `ls tasks/builds/`.

The 38 SHIP stubs created in the 2026-05-13 sweep are listed in `tasks/todo-triage-inventory.md § 3`. Notable near-term candidates:

- `tasks/builds/sandbox-isolation-mvp/spec.md` — critical-path completion for the sandbox primitive once the e2b account is provisioned.
- `tasks/builds/operator-session-identity-v2/spec.md` — 13 OSI-DEF items from PR #286.
- `tasks/builds/workflows-v1-phase-2-gaps/spec.md` — 11 Phase 2 conformance gaps consolidated.
- `tasks/builds/lael-llm-request-emission/spec.md` — Live Agent Execution Log timeline "doing phase" wiring.
- `tasks/builds/ghl-oauth-hardening-v2/spec.md` — pre-launch GHL OAuth + auto-onboard hardening.

---

## Architectural decisions awaiting confirmation

Five new ADRs landed in the 2026-05-13 sweep (slots 0017–0021); the rationale and trigger-to-revisit for each is documented in the ADR itself, not here.

- `docs/decisions/0017-retrieval-ranker-v1-simplified.md` — auto-knowledge-retrieval ranker direction locked to v1-simplified.
- `docs/decisions/0018-overlay-stack-ownership.md` — central overlay-stack manager primitive for frontend.
- `docs/decisions/0019-job-result-and-review-loop-contracts.md` — `JobResult` discriminated union + review verdict vocabulary.
- `docs/decisions/0020-test-conventions-vitest-and-test-folder.md` — Vitest-only, `__tests__/` folder, `.js` relative imports.
- `docs/decisions/0021-workflows-v1-v2-boundary.md` — Workflows V1 → V2 boundary contract.

---

## Watchlist (not actionable yet — trigger-gated)

These items are deliberately not in flight. Each has a named trigger that will move it to a SHIP stub or active item.

- **`local-dev-*` → `v1.0.0` flip + real e2b template publish** (SANDBOX-F1 in legacy backlog). Operator action when the e2b account is provisioned. See `tasks/builds/sandbox-isolation-mvp/spec.md` for the surrounding work.
- **External Call Safety Contract abstraction** (`tasks/builds/external-call-safety-contract/spec.md`). Trigger: next subsystem that re-invents the intent-record / single-terminal-transition pattern.
- **Phase-5A canonicalRegistryDrift test upgrade** (`tasks/builds/canonical-registry-three-set-drift-test/spec.md`). Trigger: next `canonical_*` table OR Phase 5A spec authoring.
- **Run-debugger view** (`tasks/builds/run-debugger-view/spec.md`). Trigger: operator complaint about cross-service grep being the only diagnostic entry point.

---

## Pre-launch / paused builds

- **`support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277).** Phase 2 (BUILD) was previously recorded complete; resume from `tasks/builds/support-desk-canonical/handoff.md`. The Phase 2 follow-up scope lives in `tasks/builds/support-desk-canonical-phase-2/spec.md`.

---

## Pointers to upstream homes

- [ ] **SANDBOX-R3-T2 (advisory, covered by SANDBOX-F1) — Placeholder PUBLISHED_VERSION acceptable only because version is `local-dev-*`**
  - ChatGPT call (Round 3): *"The publish workflow still hard-fails until real e2b publish/inspect is wired, which is the right posture. Not a blocker, but keep the deferred item explicit."*
  - Status: **already explicit** in SANDBOX-F1 (step 0 + step 6). No new work item — this entry exists as a cross-reference so future audits find the connection.

---

## Closed by operator-backend (2026-05-13)

- [x] **OP-BACKEND-SR1 — Capability literal import surface.** Closed structurally: the CI gate `scripts/gates/verify-execution-capability-references.sh` covers non-adapter consumer code via grep, and the type-checker enforces adapter-declaration correctness. The deferred runtime-const idea remains a low-priority cosmetic — KNOWLEDGE.md captures the pattern. No follow-up build needed.

---

## Deferred from spec-conformance review — operator-backend (2026-05-12)

**Captured:** 2026-05-12T13:39:59Z
**Source log:** `tasks/review-logs/spec-conformance-log-operator-backend-2026-05-12T13-39-59Z.md`
**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`

- [x] REQ #63 — Naked `'operator-session.*'` literals at emit sites bypass the registry (CI gate will fail on PR open)
  - Spec section: §3.2 item 1 (single source of truth), §4.7 (namespace discipline)
  - Gap: 18+ naked literals in `server/services/executionBackends/operatorManagedBackend.ts`, `server/jobs/operatorSessionProgressedHandler.ts`, `server/services/credentialBrokerService.ts`, and `shared/types/runTraceEvent.ts`. The `verify-operator-event-registry.sh` gate's allow-list only includes `shared/types/operatorBackendEvents.ts` + `__tests__/` + `.test.ts` + `docs/` + `tasks/` + `.sh:` + `.md:` files. Adapter and handler files are NOT allowed, so every emit-site literal will trip the gate.
  - Suggested approach: either (a) widen the gate's allow-list to include `server/services/executionBackends/*.ts` and `server/jobs/operator*.ts` (matches spec § 3.2 item 2 intent — the spec already lists "adapter declarations under `server/services/executionBackends/*.ts`" as permitted), or (b) replace naked literals at emit sites with constants imported from the registry. Option (a) is smaller; option (b) is more idiomatic.
  - Resolved: 2026-05-13 by commit `4106ad2b`. 20 per-event named constants added to `shared/types/operatorBackendEvents.ts` (registry); 8 naked literals at emit sites replaced with imported constants across adapter, progressed handler, and broker. `runTraceEvent.ts` added to gate allow-list (consumer-side type registry). Verified PASS by Round 2 spec-conformance.

- [x] REQ #64 — Lifecycle event names diverge across three sources of truth (RunTrace will not render the chain-link/task lifecycle events)
  - Spec section: §4.7 (lifecycle events)
  - Gap: Three name sets in play. Spec §4.7 + registry (`operatorBackendEvents.ts`) uses `chain_link_completed/failed/cancelled` + `task_completed/failed/cancelled` + `dispatched`. Adapter `operatorManagedBackend.ts:754,927` emits `'operator-session.completed'` and `'operator-session.cancelled'` (unprefixed). `shared/types/runTraceEvent.ts:57-67,320-348` defines parallel `eventType` union with `'chain_link_started'`, `'task_terminal_completed'`, `'task_terminal_failed'` (different names again). `RunTraceEventRenderer.tsx:161,211,220` listens on the runTraceEvent.ts names — so the Run Trace never receives the chain-link/task lifecycle events that the adapter actually emits.
  - Suggested approach: pick spec § 4.7 names as canonical. Update (1) adapter line 754 to emit `'operator-session.task_completed'` or `'operator-session.chain_link_completed'` depending on `action`; (2) adapter line 927 to emit `'operator-session.task_cancelled'`; (3) `runTraceEvent.ts` lines 57-67 + 320-348 to use spec names; (4) `RunTraceEventRenderer.tsx` to listen on spec names. The WebSocket payload shapes also need to match spec § 4.7 per-event fields (the adapter currently sends `{operatorRunId, chainSeq, parentStatus, action}` for `operator-session.completed`; the spec's `task_completed` payload is `{agent_run_id, total_chain_links, total_wall_clock_ms}`).
  - Resolved: 2026-05-13 by commit `4106ad2b`. Adapter line 754 (now ~767) emits `chain_link_completed/failed/cancelled` based on `terminalState.status`; adapter line 927 (now ~940) emits `task_cancelled`. `runTraceEvent.ts` renamed `chain_link_started → dispatched`, `task_terminal_completed → task_completed`, `task_terminal_failed → task_failed`; added `chain_link_cancelled` and `task_cancelled` discriminated union members. `RunTraceEventRenderer.tsx` switch cases use canonical names + new variant renderers. Verified PASS by Round 2 spec-conformance.
## Deferred adversarial findings — personal-assistant-v1 (2026-05-12)

Source: adversarial-reviewer Phase 1 pass on branch `claude/synthetos-personal-assistant-0kaIM`.
Confirmed holes fixed inline before pr-reviewer. Deferred items below.

### createDraftWithProposal non-atomic (likely-hole)
`server/services/eaDrafts/eaDraftService.ts:58-88` — `actionService.proposeAction` and the
subsequent `db.insert(eaDrafts)` are not wrapped in a single transaction. `proposeAction` does
not accept a caller transaction handle. Fix requires refactoring `actionService.proposeAction`
to accept an optional `tx` parameter, or extracting its insert logic into a shared helper.
Phase 1.5 work item. Risk: orphaned `actions` row on `ea_drafts` insert failure.

### dispatch() missing organisationId filter on integrationConnections lookup (worth-confirming)
`server/services/triggers/externalSourceTriggers.ts:38-52` — add
`eq(integrationConnections.organisationId, ctx.organisationId)` for defence-in-depth.

### dispatch() rate-cap count not scoped by organisationId (worth-confirming)
`server/services/triggers/externalSourceTriggers.ts:87-97` — add organisationId filter to
rate-cap count query.

### assembleThreadSummaryPrompt future prompt-injection surface (worth-confirming)
`server/services/slack/slackActionService.ts:267` — when Slack thread summarisation ships,
the raw Slack message content must be XML-escaped or sandboxed in a structured prompt turn
before being passed to the LLM.

## Deferred from spec-conformance review — personal-assistant-v1 (2026-05-12)

**Captured:** 2026-05-12T13:15:07Z
**Source log:** `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md`
**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`

- [ ] REQ-C4 — `voice_profiles` schema diverges from spec §7.4 contract
  - Spec section: §7.4 + §21.1
  - Gap: Missing `name` column (display); single `source` column (string) replaced by `sources text[]` array; missing `source_config jsonb` (per-sampler config); missing `refresh_config jsonb` (per-policy config). Renames: `sample_size`→`sample_count`, `last_derived_at`→`last_refreshed_at`, `opt_out_at`→`opted_out_at`.
  - Suggested approach: Decide whether to bring schema into spec alignment (migration adds 4 cols, drops 1, renames 3) OR amend the spec to match the simpler implementation. The simpler schema is functional but breaks the spec's per-sampler config envelope.

- [ ] REQ-CAL2 — Calendar `create_event` / `update_event` risk tier mismatch
  - Spec section: §8.2 table + §6.3 rationale
  - Gap: Code uses Tier 6 (max); spec specifies Tier 4 with action-level `defaultGate: review`. The spec rationale (third-party visibility is consent-based) supports Tier 4. Either change works at runtime since both are review-gated, but tier classification drives downstream policy decisions (budget caps, audit categorisation).
  - Suggested approach: Confirm with the risk-tier rubric authors whether `create_event` is Tier 4 (record-write, consent-based visibility) or Tier 6 (broadcast). Update either the spec or the action registry.

- [ ] REQ-T8 — Dedup key formats diverge from spec §7.1
  - Spec section: §7.1 + §24.1
  - Gap: Slack dedup key uses `channelId@messageTs` not `slack_event_id`. Calendar dedup key uses `eventId@startAt@minutesUntilStart` not `{calendarId}@{eventId}@{startAtISO8601}@{lookaheadMinutes}`. Both work as unique keys but diverge from spec's explicit shapes (which were chosen for multi-calendar support + recurring occurrence handling).
  - Suggested approach: Update `deriveDedupKey` in `externalSourceTriggersPure.ts` to match spec format, or amend spec §7.1 to match the simpler keys.

- [ ] REQ-C1 — `ExternalSourceTriggerEvent` schema simplified from spec §7.1
  - Spec section: §7.1
  - Gap: Spec specifies envelope with `provider`, `externalEventId`, `subaccountId`, `organisationId`, `integrationConnectionId`, and per-type `messageMetadata`/`eventMetadata`/`mentionMetadata` objects. Code's union has flat field shape (no envelope, owner-only). Loses some downstream consumer affordances (e.g. integration_connection_id passing through).
  - Suggested approach: Confirm with downstream consumers whether the simplified shape suffices. If not, expand schema to match spec.

- [ ] REQ-EA1 — EA default skill allowlist incomplete vs spec §13.2
  - Spec section: §13.2
  - Gap: `0332_executive_assistant_seed.sql` `default_org_skill_slugs` lists 16 entries. Spec §13.2 names additionally: `read_inbox`, `send_email`, `read_data_source`, `web_search`, `fetch_url`, `scrape_structured`, `ask_clarifying_question`, `request_clarification`, `read_workspace`, `update_memory_block`, `notify_operator`, `read_priority_feed`, `search_agent_history`.
  - Suggested approach: Verify whether the missing skills are auto-enabled via universal-skills (per §13.2: "Universal skills per `server/config/universalSkills.ts` are always available regardless of allowlist"). If yes, allowlist is correct. If no, add the missing slugs to the seed.

- [ ] REQ-EA3 — Partial unique index axis differs from spec §13.4
  - Spec section: §13.4 concurrency guard
  - Gap: Code uses `agents(organisation_id, owner_user_id) WHERE slug='executive-assistant'`. Spec specifies `agents(subaccount_id, owner_user_id) WHERE slug='executive-assistant'`. Difference matters when a user has access to multiple subaccounts in the same org: spec's axis allows one EA per subaccount per user; code allows only one EA per user per org.
  - Suggested approach: Align with the multi-subaccount product intent; if users routinely access multiple subaccounts, change the index. If V1 dogfood is single-subaccount only, leave as-is and amend spec.

- [ ] REQ-EA4 — EA `home_widget` refreshPolicy differs from spec §13.1
  - Spec section: §13.1
  - Gap: Seed uses `every_5m`; spec says `on_login`. The `every_5m` policy creates more API load per user; `on_login` lazily refreshes on route entry (and is what `useHomeWidgets` invalidates on).
  - Suggested approach: Change seed to `on_login` unless there's a UX reason for periodic refresh.

- [ ] REQ-EA5 — EA `home_widget.titleTemplate` hardcoded
  - Spec section: §13.1 + §13.6 (display name renaming)
  - Gap: Seed hardcodes `"Personal Assistant"`; spec specifies `'${agent.displayName}'`. Once users rename their EA via Settings (§13.6), the home widget should reflect the new name.
  - Suggested approach: Update seed to use template string; ensure homeWidgetService substitutes `${agent.displayName}` when rendering.

- [ ] REQ-M15 — Personal nav group placement
  - Spec section: §14.1
  - Gap: Spec says Personal group renders at the TOP of the sidebar, above Operate/Build/Govern. Code places it mid-list per `client/src/config/sidebar.ts` ordering comment ("top → work → projects → agents → personal → company → ...").
  - Suggested approach: Move Personal group higher in `buildNavItems` if matching the spec is important for the "first thing the user sees" framing.

- [ ] REQ-C3 — `slack.list_channels` Zod schema missing `types` filter
  - Spec section: §7.3
  - Gap: Spec input shape includes `types?: Array<'public_channel' | 'private_channel' | 'mpim' | 'im'>`. Code's Zod schema has no `types` field — callers cannot filter channel types.
  - Suggested approach: Add `types` to the action Zod schema and pass through to the Slack handler.

- [ ] REQ-CAL3-naming — Calendar write-action error codes differ from spec §8.4
  - Spec section: §8.4 step 2
  - Gap: Spec says `code: 'missing_draft_context'` (422) for missing/invalid `eaDraftId` or owner mismatch. Code uses `DRAFT_NOT_APPROVED`, `DRAFT_NOT_FOUND`, `DRAFT_SEND_IN_FLIGHT` (no `missing_draft_context`). Also: no owner-mismatch check (`ea_drafts.ownerUserId !== agent.ownerUserId`).
  - Suggested approach: Either add the `missing_draft_context` mapping when `eaDraftId` is absent, OR amend spec to use the more granular code set the code emits. Add the owner-mismatch assertion either way (defence-in-depth).

- [ ] REQ-M9 — Stall job 7-day proposal expiry path
  - Spec section: §5.2 (`workflowGateStallNotifyJob` modification clause) + §20.4 + §22.2
  - Gap: Spec prose says stall job should "transition expired proposal rows (`createdAt + 7d`) to approval state `expired`" for EA-linked drafts. Code's `eaDraftStallResetHandler` only resets `sending → idle`. Existing `actions` primitive expiry may already cover this, but the spec's explicit clause says it should be added to the stall job for EA-linked rows.
  - Suggested approach: Verify whether existing `actions` expiry handles this; if not, extend the stall job to query `actions WHERE metadata_json->>'kind' = 'ea_draft' AND status='pending_approval' AND suspend_until < now()` and transition to `expired`/`rejected`.

- **Active sprint / current focus:** `tasks/current-focus.md`
- **Archive (pre-2026-05-13 backlog):** `tasks/todo-archive/2026-Q2.md`
- **Triage inventory (what moved where):** `tasks/todo-triage-inventory.md`
- **Spec stubs (38 SHIP items):** `tasks/builds/<slug>/spec.md`
- **ADRs:** `docs/decisions/`
- **Knowledge patterns:** `KNOWLEDGE.md`
- **Architectural rules:** `architecture.md`

---

## Deferred from spec-conformance review — fleet-and-codebase-health (Branch 2 codebase-health) (2026-05-13)

**Captured:** 2026-05-13T01-17-33Z
**Source log:** `tasks/review-logs/spec-conformance-log-fleet-and-codebase-health-branch-2-2026-05-13T01-17-33Z.md`
**Spec:** `tasks/builds/fleet-and-codebase-health/spec.md`
**Plan:** `tasks/builds/fleet-and-codebase-health/plan.md`

- [ ] REQ-FCH-B1-gate-red — `verify-no-db-in-routes.sh` is RED on branch tip; 2 violations from upstream merge
  - Spec section: §4.B1 + §9 (final acceptance: "GREEN on the branch tip with all 9 violators migrated")
  - Gap: After the operator-backend merge (`c2c7adca`), two new route files entered the branch with direct `db` imports: `server/routes/operatorSessions.ts:18` and `server/routes/operatorTasks.ts:35`. They are not in the spec's original 9-violator list (came in after Chunk 1 ran). Spec §9 still requires the gate exits 0 at branch tip.
  - Suggested approach: Either (a) migrate both routes per the same T2 pattern used for the original 9 (likely a new pass extending whichever services own those operator domains), or (b) document a guard-ignore with a new ADR if the routes have a legitimate exception parallel to `workspaceInboundWebhook.ts`. Operator decision required — these routes are part of the active operator-backend feature so a service migration is the expected path.

- [ ] REQ-FCH-C2-knowledge-over-target — KNOWLEDGE.md is 3,846 lines, spec target ≤2,500
  - Spec section: §5.C2 + §9 (final acceptance: "KNOWLEDGE.md ≤2,500 lines")
  - Gap: Chunk 12 sweep reduced KNOWLEDGE.md from 3,785 → 3,692 lines (per `06eb8d05` commit message). The post-origin/main-merge file is 3,846 lines, well above the spec target. The sweep was applied but did not converge on the target.
  - Suggested approach: Either (a) accept the current 3,846-line state as "sweep done, further trimming deferred" and amend the spec's ≤2,500 target as aspirational rather than mandatory, or (b) run a follow-up compression pass to hit the target. The non-deletion rule (§5.C2) limits how aggressive a second pass can be — the next round must rely on more ADR promotions and/or duplicate-group compression. Operator decision required.

- [ ] REQ-FCH-C4-new-prototypes — three new top-level `prototypes/` dirs landed post-merge from active builds
  - Spec section: §5.C4 (archive convention)
  - Gap: After Chunk 3 ran, the operator-backend / personal-assistant-v1 / memory-improvements merges introduced new top-level `prototypes/{operator-backend, personal-assistant-v1, memory-improvements}/` directories that are referenced by their owning specs in `docs/superpowers/specs/`. The spec's intent (visual separation of historical artefacts) is partly defeated — top-level `prototypes/` now has both archived material via the rename trail and new live material. Both can be true simultaneously.
  - Suggested approach: Either (a) the `_archive/` convention applies only to PAST artefacts and new builds may freely use top-level `prototypes/` (current de-facto behaviour — needs documenting in `_archive/README.md` and CLAUDE.md), or (b) extend the archive convention to ALL prototypes regardless of vintage and re-locate the three new dirs. (a) is the lower-cost outcome. Operator decision required.
