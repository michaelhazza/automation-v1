# ChatGPT Spec Review Log — sandbox-isolation

**Spec:** `tasks/builds/sandbox-isolation/spec.md` (1559 lines)
**Anchoring brief:** `docs/synthetos-governed-agentic-os-brief-v1.2.md`
**Started:** 2026-05-11T02-09-36Z
**Mode:** manual (operator pastes ChatGPT-web responses)
**Driver:** main-session Claude (Opus), spec-coordinator playbook Step 8 adopted inline

**Pre-review state:**
- spec-reviewer (Codex) verdict: READY_FOR_BUILD after 4 iterations; 36 mechanical fixes applied; 2 directional deferrals routed to `tasks/todo.md` (SANDBOX-DEF-EGRESS-MECH, SANDBOX-DEF-LOG-SCHEMA).
- Master architecture v1.2 alignment pass applied AFTER spec-reviewer (§4.1, §6 table additions, §7.2 notes, §14.4a, §22).
- Main re-synced (PR #284 pre-test-hardening merged in clean — sandbox-orthogonal).

---

## Round 1

**Status:** Awaiting ChatGPT-web response.
**Prompt:** `tasks/builds/sandbox-isolation/chatgpt-review-round-1-prompt.md`
**Sent at:** 2026-05-11T02-09-36Z

### ChatGPT response

**Verdict:** CHANGES_REQUESTED. 5 required fixes (F1-F5) + 6 recommended tightenings (R1-R6).

**F1 — SANDBOX-DEF-LOG-SCHEMA is schema-affecting; close it now or add explicit C0 gating.** Recommendation: lock to dedicated `sandbox_logs` table.

**F2 — Cost ceiling enforcement contradiction.** §10.2 says provider-side cost API is best-effort; §28 #4 claims hard terminate at cost ceiling regardless. Add fallback estimator: wall-clock × template resource class × configured max vCPU rate; worker terminates when estimated cost reaches ceiling; final billing uses provider-reported cost at harvest/correction.

**F3 — Pending-start idempotency deadlocks after worker crash between INSERT and provider start.** Add lease/claim model: `provider_sandbox_id`, `start_claimed_at`, `start_claim_expires_at`, `start_attempt_count`. Retry may reclaim a pending row if no `provider_sandbox_id` and lease expired.

**F4 — RLS claim says (org, subaccount) but policy only scopes by org.** Choose Option B: state RLS is org-boundary; subaccount enforcement is service-level filtering. Aligns with existing app patterns.

**F5 — §19.4 says 5 columns added to `llm_requests` but §12.3 actually adds 6 (including `correction_sequence`).**

**R1 — Split `sandbox_input_rejected` out of `sandbox_telemetry_events.event_type` enum.** It's a calling-run failure trace event, not a DB telemetry row (no execution exists).

**R2 — Clarify `sandboxCeilingMonitorJob` shape.** Two models conflated; pick recurring/re-enqueued checks + final wall-clock kill (safer with pg-boss).

**R3 — Add `outputSchemaRef` to §8.1's required input descriptor list.** It's in §20.1 contract but missing from §8.1 prose.

**R4 — Rename "cost-correction events" → "cost-correction ledger rows".** No telemetry event for corrections; they're `llm_requests` rows only.

**R5 — Remove `pending → sandbox_input_rejected_*` from state transition list in §13.1.** Pre-state failure, no row written; listing it confuses implementation.

**R6 — Clarify `CURRENT_VERSION` commit ownership.** Developer commits in tag PR; CI verifies coherence, never auto-mutates repo.

### Triage

All 11 findings classified as **technical** per the chatgpt-spec-review agent's user-opt-out posture (user does not approve internal-quality items like forward references, missing contracts, internal type/service shapes, RLS posture, idempotency mechanics, migration column counts, state machine cleanup).

Zero **user-facing** findings in this round — none of the issues touch end-user-visible features, copy, workflows, permissions visible to customers, pricing, or defaults users build muscle memory around. The brief locked the user-facing surface in §6 (25 invariants).

Auto-apply all 11 fixes per the agent's recommendations.

### Auto-applied technical fixes

All 11 findings (F1-F5 + R1-R6) applied as technical fixes (user opted out of approving technical-only items per the agent's contract).

**F1 — sandbox_logs table locked.** Added: §8.4 step 9 rewritten; §17.1 + §17.3 + §17.4 updated; §19.1 new files (`server/db/schema/sandboxLogs.ts`, `server/jobs/sandboxLogsPruneJob.ts`); §19.4 migration now lists `sandbox_artefacts_telemetry_logs.sql`; §20.8 new full contract with row shape + indexes + RLS + retention + "why dedicated table" rationale; §21.1 sandbox_logs row added to coverage table; §22 sandbox_logs prune in execution model; §27 closes SANDBOX-DEF-LOG-SCHEMA as resolved; §29.2 + §29.7 updated. `tasks/todo.md` SANDBOX-DEF-LOG-SCHEMA marked `[x]` CLOSED with rationale.

**F2 — Cost ceiling fallback estimator.** Added in §10.2: pure helper `estimateSandboxCostCents(elapsedMs, templateResourceClass)` formula `elapsedMs/1000 × maxCostCentsPerSecond`; `maxCostCentsPerSecond` pinned per template in `CURRENT_VERSION`; worker terminates on estimate ≥ ceiling; final billing uses provider-reported cost at harvest, deltas captured as cost-correction ledger rows. §28 #4 revised to lock the model and resolve the contradiction with §10.2.

**F3 — Pending-start lease/claim model.** §8.1 idempotency rewritten with lease columns + retry semantics + `MAX_START_ATTEMPTS` cap; §13.1 state transitions add `pending → pending (lease reclaim)` and clarify `pending → provider_unavailable` is cap-driven; §20.3 new columns `provider_sandbox_id` + `start_claimed_at` + `start_claim_expires_at` + `start_attempt_count`, new partial index on `provider_sandbox_id`, new CHECK constraint; §24.1 provider-start idempotency posture updated.

**F4 — RLS wording.** §14.4, §20.3, §20.4, §20.5, §20.6, §21.1, §21.3, §21.4, §21.5 all updated: RLS enforces **organisation boundary**; subaccount filtering is **service-layer**. Matches existing app convention. The "queryable only within (organisationId, subaccountId)" prose replaced with two-layer enforcement statement throughout.

**F5 — 5→6 columns in `llm_requests` extension migration.** §19.4 updated: `sandbox_compute_correction` added to sourceType enum; `correction_sequence` listed as the 6th column; partial unique index on `(sandbox_execution_id, correction_sequence) WHERE source_type = 'sandbox_compute_correction'`.

**R1 — Split `sandbox_input_rejected`.** §14.2 reformatted with two surfaces: Surface A (`sandbox_telemetry_events.event_type` closed enum, table-rows-only) + Surface B (pre-row failure trace events). `sandbox_input_rejected` moved to Surface B (calling run's failure trace only); no DB telemetry row.

**R2 — Ceiling monitor shape.** §10.2 rewritten to pick the safer pg-boss model: monitor re-enqueues every `monitorIntervalMs` with `singletonKey = sandbox_execution_id` + one-shot `sandbox-wall-clock-kill` job scheduled at `startAfter = wallClockMs + buffer` as belt-and-braces. Both idempotent on `sandbox_execution_id`. Added new file `server/jobs/sandboxWallClockKillJob.ts` to §19.1.

**R3 — outputSchemaRef in §8.1.** Added to the required input descriptor field list in §8.1, matching §20.1 contract example.

**R4 — Cost-correction wording.** §24.4 updated: "cost-correction events" renamed to "cost-correction ledger rows"; explicit clarification that these are `llm_requests` rows with `source_type = 'sandbox_compute_correction'`, NOT `sandbox_telemetry_events` rows; no `sandbox_cost_corrected` event type in the §14.2 enum.

**R5 — Remove pending → sandbox_input_rejected_* from state machine.** §13.1 state transition list cleaned: that line removed; replaced with a paragraph clarifying that preflight input rejection is a pre-row failure path (no `sandbox_executions` row written).

**R6 — CURRENT_VERSION ownership.** §15.2 rewritten: developer / build agent commits `CURRENT_VERSION` in the PR / tag commit (NOT auto-mutated by CI); CI verifies built-digest equals `CURRENT_VERSION`-declared digest; CI publishes a separate attestation PR (opt-in, bounded) rather than writing back to the runtime repo. Avoids the "CI mutates repo" failure mode.

### User-facing decisions requiring approval

**None.** All 11 findings classified as technical per the chatgpt-spec-review agent contract. No user-facing-feature, copy, workflow, permission, pricing, or default decisions surfaced. The brief locked the user-facing surface in §6.

### Outcome (Round 1)

All 11 findings closed. Spec moved from 1517 → 1630 lines. Round 2 prompt being prepared to verify the fixes and check for new findings introduced by the changes.

---

## Round 2

**Status:** Response received, applying fixes.
**Prompt:** `tasks/builds/sandbox-isolation/chatgpt-review-round-2-prompt.md`
**Continued from:** Round 1's ChatGPT-web conversation (same thread).

### ChatGPT response

**Verdict:** CHANGES_REQUESTED (small batch). 3 required fixes (F1-F3) + 5 tightenings (R1-R5) + 5 smaller nits. Recommendation: apply the 3 required fixes, then lock.

**F1 — File inventory / migration counts inconsistent after F1+R2 changes from Round 1.** §14.4 still says "four tables"; §19.3 `rlsProtectedTables.ts` missing `sandbox_logs`; §19.3 `server/jobs/index.ts` says 5 jobs but is now 7; §19.4 says "five migrations" but one is a script.

**F2 — CURRENT_VERSION pre-CI-build digest is fragile** unless the build is fully reproducible. Either lock deterministic-build requirements OR change the flow so CI computes the final digest (advisory locally; CI is authoritative).

**F3 — `templateResourceClass.maxCostCentsPerSecond` introduced in §10.2 / §28 #4 but not in `CURRENT_VERSION` contract.** §15.2 declares only `version=` + `digest=`. Need to define the full `CURRENT_VERSION` shape once.

**R1 — Phase plan C1 chunk scope outdated** (still says four schemas, four migrations, no lease columns).
**R2 — `sandboxWallClockKillJob` not in C11 scope.**
**R3 — `sandboxLogsPruneJob` not in C11 scope.**
**R4 — §14.4a Run Trace virtual view says 4 sources** but `sandbox_logs` makes 5.
**R5 — Start-claim CHECK constraint wording confusing.** Recommend simpler `(provider_sandbox_id IS NULL OR status <> 'pending')` + add `start_attempt_count >= 0` + add running/harvesting → provider_sandbox_id NOT NULL invariant.

**Nits:** §17.3 typo "at run" → "at runtime"; §14.4 "four tables"; §25.3 "four new tables"; §29.7 "six new tables"; §26.1 "four new migrations + llm_requests extension migration".

### Triage

All 8 findings + 5 nits classified as **technical** per agent contract:
- F1, F2, F3, R1-R5: internal-quality items (file counts, contract shape, build pattern, chunk scope, CHECK predicate wording). No user-facing surface change.
- Nits: pure mechanical count alignment.

Zero **user-facing** findings. Auto-apply all.

### Auto-applied technical fixes

All 8 findings + 5 nits applied. Summary by ID:

**F1 — File inventory / migration counts.** Updated: §4.1 "five new ledgers"; §6 primitives table "five new tables"; §14.4 "All five tables"; §14.4a "five new join sources"; §17.3 "at runtime"; §19.3 `rlsProtectedTables.ts` row → 5 entries; §19.3 `server/jobs/index.ts` → 7 jobs; §19.4 "four SQL migrations + one sequencing script"; §25.3 "five new tables"; §26.1 "five new schemas / seven new jobs / four SQL migrations + one sequencing script"; §29.7 "five new tables plus the extended `llm_requests` row shape"; §29.7 inventory checklist row updated.

**F2 — CURRENT_VERSION reproducibility.** §15.2 rewritten with two-file split: `CURRENT_VERSION` (human-committed: version, template_resource_class, max_cost_cents_per_second, base_image_digest, deps_lockfile_hash) + `PUBLISHED_VERSION` (CI-attestation-PR-committed: version, image_digest, ci_build_commit, registry_published_at, scanner_result_hash). Deterministic-build requirements locked: digest-pinned base images, committed lockfiles, `--platform linux/amd64`, no build-arg timestamps. CI is the final-digest source of truth. §15.3 updated to read `PUBLISHED_VERSION.image_digest` at execution-start time. §10.2 updated to reference `max_cost_cents_per_second` field name explicitly.

**F3 — `templateResourceClass.maxCostCentsPerSecond` contract.** Folded into F2's full `CURRENT_VERSION` contract. §10.2 + §15.2 + §19.1 all reference the same field shape now. Added `server/services/sandbox/templateVersionParserPure.ts` to §19.1 as the canonical parser surface.

**R1 — C1 chunk scope.** §23 C1 row updated: five Drizzle schemas (incl. `sandboxLogs.ts`), four SQL migrations + one sequencing script, RLS manifest updates for all five tables, `FailureReason` extension.

**R2 — `sandboxWallClockKillJob` in C11.** Added to §23 C11 row with dependency chain (C7/C8/C9/C10/C12) and to §23.1 graph notes.

**R3 — `sandboxLogsPruneJob` in C11.** Added to §23 C11 row.

**R4 — §14.4a Run Trace virtual view → 5 sources.** Added `sandbox_logs` as the fifth join source with Round 1 F1 cross-reference.

**R5 — CHECK constraint wording.** §20.3 rewritten as four CHECKs: closed-enum status; `(provider_sandbox_id IS NULL OR status <> 'pending')`; `(status NOT IN ('running', 'harvesting') OR provider_sandbox_id IS NOT NULL)` (captures the real invariant per ChatGPT recommendation); `(start_attempt_count >= 0)`.

**Nits** (all five resolved inline): §14.4 "five tables"; §17.3 "at runtime"; §25.3 "five new tables"; §29.7 "five new tables plus the extended llm_requests row shape"; §26.1 aligned with §19.4.

### User-facing decisions requiring approval

**None.** All 8 findings + 5 nits classified as technical. Counts, contract shape, CI build pattern, CHECK constraints — none are user-facing decisions per the agent contract.

### Outcome (Round 2)

ChatGPT's Round 2 verdict explicitly said *"I'd apply the three required fixes above, then lock."* All required fixes (F1-F3) AND all tightenings (R1-R5) AND all 5 nits applied. Spec moved from 1630 → 1677 lines.

**Spec is now lock-ready per ChatGPT's stated criteria.** Operator elected Round 3 verification for due diligence.

---

## Round 3

**Status:** APPROVED — LOCK after all 6 fixes applied.
**Prompt:** `tasks/builds/sandbox-isolation/chatgpt-review-round-3-prompt.md`
**Continued from:** Round 2's ChatGPT-web conversation (same thread).

### ChatGPT response

**Verdict:** CHANGES_REQUESTED (final small batch — 2 required + 4 optional). Recommendation: *"After those two required fixes, I'd lock it. The remaining tightenings are consistency polish, but worth applying because they are low effort and prevent builder confusion. Architecturally, the spec is now in good shape."*

**Required:**
- **F1.** C1 incorrectly includes `FailureReason` extension; it's already C2's scope. Duplicate ownership.
- **F2.** §22.1 still says "all five new jobs" but the spec now has seven; retention jobs aren't execution-scoped so their idempotency key is different.

**Optional tightenings:**
- **R1.** §14.4a "All four are keyed on runId" → five.
- **R2.** §6 RLS manifest row omits `sandbox_logs`.
- **R3.** §6 `createWorker` row omits `sandboxWallClockKillJob` + `sandboxLogsPruneJob`.
- **R4.** `verify-template-version-coherence.sh` description in §19.2 + §25.2 stale — needs to reflect the F2 two-file contract from Round 2.

### Triage

All 6 findings (2 required + 4 optional) classified as **technical** per the chatgpt-spec-review agent contract — counts, contract descriptions, scope conflicts, idempotency-key shapes. Zero user-facing decisions.

Operator instruction: *"final feedback, decide what to implement and then lock it"* — applied all 6 (the 4 optional tightenings are explicitly low-effort + prevent builder confusion; cost of applying is < cost of having Phase 2 builders trip over the inconsistencies).

### Auto-applied technical fixes

- **F1:** §23 C1 row updated — removed `FailureReason` extension from C1 scope (it lives in C2). Note added: "FailureReason extension lives in C2 — not duplicated here."
- **F2:** §22.1 rewritten with two clauses:
  - Execution-scoped jobs idempotent on `sandbox_execution_id`: harvest reconciliation, ceiling monitor, wall-clock kill, artefact purge.
  - Cutoff-scoped retention jobs idempotent on `(table, cutoff_date)`: telemetry prune, logs prune, egress audit prune.
- **R1:** §14.4a "All four are keyed on `runId`" → "All five are keyed on `runId`".
- **R2:** §6 RLS manifest row — added `sandbox_logs` to the five-table list.
- **R3:** §6 `createWorker` row — updated to list all seven jobs (harvest-reconciliation, ceiling-monitor, wall-clock-kill, telemetry-prune, logs-prune, egress-audit-prune, artefact-purge).
- **R4:** Both §19.2 and §25.2 descriptions of `verify-template-version-coherence.sh` rewritten to reflect the Round 2 F2 two-file contract: five-field `CURRENT_VERSION` (incl. `max_cost_cents_per_second`), paired git tag, `PUBLISHED_VERSION` attestation grace window, version-match invariant.

### Outcome (Round 3)

**LOCKED.** All 6 fixes applied. Spec moved from 1677 → 1679 lines. ChatGPT's stated lock criterion ("after those two required fixes, I'd lock it") was met by F1 + F2; the 4 optional tightenings were applied as well for builder hygiene.

**Total across 3 rounds:** 30 findings (11 + 13 + 6) closed. Zero user-facing decisions. Zero unresolved items.

**Spec status:** `accepted`. Frontmatter updated. Build slug `sandbox-isolation` ready for Phase 2 kickoff.

---

## Session summary

| Round | Findings | Verdict | Auto-applied | User-facing | Spec lines after |
|---|---|---|---|---|---|
| spec-reviewer (Codex) | 38 (36 mechanical + 2 deferred) | READY_FOR_BUILD | 36 | 0 | 1517 |
| v1.2 alignment pass | — | — | — | — | 1558 |
| Round 1 (ChatGPT) | 11 (F1-F5 + R1-R6) | CHANGES_REQUESTED → resolved | 11 | 0 | 1630 |
| Round 2 (ChatGPT) | 13 (F1-F3 + R1-R5 + 5 nits) | CHANGES_REQUESTED → resolved | 13 | 0 | 1677 |
| Round 3 (ChatGPT) | 6 (F1-F2 + R1-R4) | APPROVED — LOCK | 6 | 0 | 1679 |
| **Total** | **68** | **LOCKED** | **66** | **0** | **1679** |

(2 from spec-reviewer routed as `SANDBOX-DEF-EGRESS-MECH` build-time decision and the now-CLOSED `SANDBOX-DEF-LOG-SCHEMA` deferral.)

---
