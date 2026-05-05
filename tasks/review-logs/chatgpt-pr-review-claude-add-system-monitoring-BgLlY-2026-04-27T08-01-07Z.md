# ChatGPT PR Review Session — claude-add-system-monitoring-BgLlY — 2026-04-27T08-01-07Z

## Session Info
- Branch: claude/add-system-monitoring-BgLlY
- PR: #215 — https://github.com/michaelhazza/automation-v1/pull/215
- Title: fix(system-monitor): close 6 directional gaps from spec-conformance pass
- Started: 2026-04-27T08:01:07Z

---

## Round 1 — 2026-04-27T08:01:07Z

### ChatGPT Feedback (raw)
Executive summary

Strong PR. This is a fully formed subsystem, not a patch. Architecture is coherent end-to-end: ingest → heuristics → baselines → triage → incidents → UI. The key invariants you've been pushing across other specs show up here consistently: idempotency, purity boundaries, and deterministic outcomes.

That said, there are 5 areas that still need tightening before this is "production hard". None are redesigns, but a few are important enough that I wouldn't ship without addressing them.

1. Idempotency + concurrency: one missing "last mile" guarantee
   - Multiple independent writers can converge on the same incident (heuristic fires, synthetic checks, triage escalation, manual/operator).
   - Without a uniqueness boundary all roads enforce, can get duplicate incidents / split clustering.
   - Lock in: canonical incident_fingerprint = hash(org_id, entity_scope, normalized_signal_type, time_bucket); enforce at DB partial unique index on active incidents; all writers must upsert via this key.

2. Heuristic purity is good, but boundary leakage risk exists
   - Heuristics depend on baselines, historical windows, derived stats — if not snapshot-resolved, non-determinism + replay mismatch.
   - Tighten: pass a frozen evaluation context object into heuristics; forbid any DB calls below that layer (even indirectly).

3. Baseline drift and reset semantics under-specified
   - When system behaviour legitimately shifts (model rollout, agent version), system flags everything as anomalous, can corrupt future baselines.
   - Add: baseline epoching tied to agent_version, model_config, prompt_hash; old baseline read-only; "no baseline update allowed while anomaly rate > threshold".

4. Triage system: missing learning closure
   - No closed loop between diagnosis → system improvement → heuristic adjustment.
   - Add minimal feedback layer: tag each incident resolution as confirmed_bug | false_positive | expected_behavior | tuning_required. Feed into heuristic weighting, threshold adjustment, suppression rules.

5. UI state logic clean but slightly inconsistent with backend guarantees (DiagnosisAnnotation.tsx)
   - (a) "validationFailed" detection is weak: agentDiagnosis !== null && investigatePrompt === null. Backend should explicitly return diagnosis_status: valid | invalid | partial.
   - (b) In-flight window time-based only: Date.now() - lastTriageAttemptAt < 5 min. Can misrepresent crashed triage jobs / stuck queues. Backend should provide triage_status: pending | running | failed | completed.

6. Synthetic checks strong, missing system-wide invariants
   - (1) Write success vs declared success mismatch (system-wide): % of runs marked success where no side effects occurred.
   - (2) Incident silence detection: no incidents created in X hours despite activity.

7. Minor but important
   - Event type registry: add CI gate so no new event type without registry update.
   - Rate limiting: rate limiting must be idempotent-safe; retries should not increment attempt count incorrectly.
   - Logging: correlation id must propagate across ingest → heuristic → triage → incident. Enforce as invariant, not convention.

Final verdict: Quality high, architecture strong, separation of concerns excellent. Not done because of: no global incident identity contract, baseline drift handling missing, heuristic purity boundary not formally locked, no learning feedback loop, UI infers backend state instead of consuming it.

### Recommendations and Decisions
| # | Finding | Triage | Recommendation | Final Decision | Severity | Scope | Rationale |
|---|---------|--------|----------------|----------------|----------|-------|-----------|
| 1 | Canonical incident identity contract: deterministic fingerprint + DB partial unique index on active incidents + all writers UPSERT via key | technical | reject | auto (reject) | high (would-be) | standard | Already implemented. Migration 0224 creates `system_incidents_active_fingerprint_idx` as a partial unique index on `(fingerprint) WHERE status IN ('open','investigating','remediating','escalated')`. All writer paths (synthetic, sweep, triage manual-test) route through `recordIncident()` in `incidentIngestor.ts` which uses raw SQL UPSERT against this index. ChatGPT misread the diff |
| 2 | Heuristic purity boundary: pass frozen evaluation context; forbid live DB reads inside heuristics | technical | defer | defer (escalated to user) | medium | architectural | Touches all 24 heuristic modules + types + CI gate. Current `BaselineReader` does live reads on demand; "frozen context" requires orchestrator-side pre-materialisation. Real benefit (replay determinism) but design-level work. Carveout: technical-defer + architectural — surfaced |
| 3a | Baseline epoching tied to entity-change markers (prompt_hash / model / version) with reset semantics | technical | reject | auto (reject) | medium (would-be) | standard | Already implemented. Spec §7.6 + `system_monitor_baselines.entity_change_marker` column. Refresh job resets `sample_count = 0` on marker mismatch and re-accumulates from `created_at >= entity_changed_at` |
| 3b | "No baseline update allowed while anomaly rate > threshold" guard | technical | defer | defer (escalated to user) | low | standard | Genuine gap (separate from epoching). Self-corrupting baselines under hot-anomaly conditions is a known risk but a tuning concern post-launch. Carveout: technical-defer — surfaced |
| 4 | Learning closure: resolution-tag taxonomy (confirmed_bug / false_positive / expected_behavior / tuning_required) feeding heuristic weighting | user-facing | defer | (user) | medium | architectural | Operators see new resolution categories — workflow-shaping. Spec §11 already captures `prompt_was_useful` + free-text feedback; richer taxonomy + auto-tuning loop is post-launch work |
| 5 | UI state logic: backend-driven `diagnosis_status` + `triage_status` instead of UI inference | user-facing | implement | (user) | medium | standard | Real correctness issue: validationFailed inferred from `investigatePrompt === null` is fragile; in-flight inferred from a 5-min time window misrepresents crashed jobs. Adding explicit backend status fields tightens the contract on a single component (DiagnosisAnnotation.tsx) and changes when each banner state shows |
| 6 | New synthetic checks: (a) write-success vs declared-success mismatch; (b) incident silence detection | user-facing | defer | (user) | medium | standard | Each new check produces incidents operators see — feature-surface decision. Spec lists the day-one synthetic-check set deliberately; expanding it on a directional-fix PR is scope creep |
| 7a | CI gate: no new event type without registry update | technical | reject | auto (reject) | low (would-be) | standard | Already implemented. `scripts/verify-event-type-registry.sh` cross-checks every `eventType: 'literal'` against `shared/types/systemIncidentEvent.ts` and fails on unregistered values |
| 7b | Rate-limit retry idempotency: triageAttemptCount must not double-increment on pg-boss retries | technical | defer | defer (escalated to user) | medium | standard | Real concern: `triageHandler.ts:270` increments `triage_attempt_count + 1` before the LLM tool loop runs; if pg-boss retries the message after that point, count climbs without a real attempt. Fix is small (idempotency key keyed on job-id) but touches the outbox/queue path. Carveout: technical-defer — surfaced |
| 7c | Correlation ID propagation enforced as invariant across ingest → heuristic → triage → incident | technical | defer | defer (escalated to user) | low | architectural | Cross-cutting logging convention. `recordIncident` accepts correlationId, but no enforcement that downstream handlers thread it. Worth doing but design-level (gate? logger context? required field?). Carveout: technical-defer + architectural — surfaced |

### Triage summary (pre-implementation)
- Auto-accepted (technical): 0 implement, 3 reject, 0 defer (findings #1, #3a, #7a — all already implemented)
- Escalated to user: 6 — findings #2, #3b, #4, #5, #6, #7b, #7c

### Implemented (auto-applied technical)
None — all auto-applied decisions are rejects (no code change).

### Awaiting user decisions
Findings #2, #3b, #4, #5, #6, #7b, #7c — see prompt to user.

### User decisions — received 2026-04-27T08:14:00Z

User reply: **all: as recommended** with one annotation. Decisions applied verbatim:

| # | Triage | Final user decision | Rationale (user) |
|---|--------|---------------------|------------------|
| 2 | technical (escalated, defer) | defer | as recommended |
| 3b | technical (escalated, defer) | defer | as recommended |
| 4 | user-facing (recommend defer) | defer (split) | Taxonomy is straight defer; auto-tuning feedback loop is defer-as-investigate. Operator-feedback-driven auto-tuning is a footgun without a dedicated spec covering signal weighting, decay, consensus thresholds, A/B isolation, operator visibility, rollback. |
| 5 | user-facing (recommend implement) | **implement** | Real correctness issue — backend-published `triage_status` + `diagnosis_status` replaces UI-side inference. |
| 6 | user-facing (recommend defer) | defer | both checks (write-success-vs-declared AND incident-silence) — feature surface; defer per recommendation. |
| 7b | technical (escalated, defer) | defer | as recommended |
| 7c | technical (escalated, defer) | defer | as recommended |

**Routing override:** all six defers route to a NEW dedicated file
`tasks/post-merge-system-monitor.md` (not `tasks/todo.md`), grouped under three
headings — Correctness fixes, Observability, Architectural — to keep the
system-monitor follow-up stack triageable as a single bucket.

### Implemented (round 1 — user-approved user-facing only)

Item #5 — backend-published `diagnosis_status` + `triage_status` replacing UI inference in `DiagnosisAnnotation.tsx`:

- `[user]` `migrations/0237_system_incidents_status_fields.sql` — adds two
  columns (`triage_status` enum `pending|running|failed|completed`,
  `diagnosis_status` enum `none|valid|partial|invalid`) with CHECK constraints
  and a defensive backfill that derives values from existing
  `agentDiagnosis` / `investigatePrompt` / `triageAttemptCount` columns.
- `[user]` `migrations/0237_system_incidents_status_fields.down.sql` — reversal.
- `[user]` `server/db/schema/systemIncidents.ts` — added two new types
  (`SystemIncidentTriageStatus`, `SystemIncidentDiagnosisStatus`) and the two
  new columns to the Drizzle schema.
- `[user]` `server/services/systemMonitor/triage/triageHandler.ts` — sets
  `triage_status='running'` at attempt start (alongside the attempt-counter
  increment), `'completed'` on terminal success, `'failed'` on terminal failure.
- `[user]` `server/services/systemMonitor/skills/writeDiagnosis.ts` — sets
  `diagnosis_status='valid'` when called with a validated `investigatePrompt`,
  `'partial'` when called without one. Validation failure path stays in the
  caller (skill returns `PROMPT_VALIDATION_FAILED` retryable error before any
  DB write, so the row is never updated on failure — matching the existing
  retry-up-to-2× contract).
- `[user]` `client/src/pages/SystemIncidentsPage.tsx` — added `triageStatus` and
  `diagnosisStatus` to the `SystemIncident` interface; updated the
  `<DiagnosisAnnotation>` prop pass to consume them and drop
  `investigatePrompt` / `lastTriageAttemptAt` (no longer needed by the child).
- `[user]` `client/src/components/system-incidents/DiagnosisAnnotation.tsx` —
  removed the `IN_FLIGHT_WINDOW_MS` constant and the `isInFlight()` helper.
  `validationFailed` now reads `diagnosisStatus === 'partial' || 'invalid'` (was
  `agentDiagnosis !== null && investigatePrompt === null`). The "Triaging…"
  banner now reads `triageStatus === 'running'` (was the 5-min time-window
  inference, which misrepresented crashed jobs).

### Deferred (round 1)

All six deferred items written to `tasks/post-merge-system-monitor.md` per the
user's routing override:

- `[auto]` Item #2 — frozen heuristic evaluation context (Architectural)
- `[auto]` Item #3b — baseline-update guard during anomaly storms (Architectural)
- `[user]` Item #4 (split) — resolution-tag taxonomy (Architectural, straight TODO)
- `[user]` Item #4 (split) — auto-tuning feedback loop (Architectural, investigate-first)
- `[user]` Item #6a — synthetic check: write-success-vs-declared mismatch (Observability)
- `[user]` Item #6b — synthetic check: incident-silence detection (Observability)
- `[auto]` Item #7b — rate-limit retry idempotency on triage attempts (Correctness)
- `[auto]` Item #7c — correlation-ID propagation invariant (Observability)

### Verification

- Pre-existing typecheck errors confirmed unrelated to this round (verified
  by stashing the round-1 changes and re-running `npx tsc --noEmit` — same
  errors in `client/src/components/ClarificationInbox.tsx` and
  `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` exist on
  the prior commit).
- No new typecheck errors introduced by round-1 files.
- Existing pure tests pass: `systemIncidentServicePure.test.ts` (14/14) and
  `triageAdmit.test.ts` (14/14).

### Round 1 summary

- Top themes: backend_state_publication, ui_inference_removal, deferred_observability, deferred_architecture
- Auto-accepted (technical): 0 implement, 3 reject, 0 defer (findings #1, #3a, #7a — all already implemented; no code change)
- User-decided: 1 implement (#5), 0 reject, 6 defer (#2, #3b, #4, #6, #7b, #7c)
- Files changed this round: 5 modified, 2 new (migration up/down)
- Deferred items routed to: `tasks/post-merge-system-monitor.md` (per user routing override)

---

## Round 2 — 2026-04-27T08-30-00Z

### ChatGPT Feedback (raw)

(Round 2 raw text not pasted into this session — user supplied per-item
decisions directly: items 1+2 implement, items 3+4 defer to
`tasks/post-merge-system-monitor.md` § Correctness. Round 2 followed up on
the round-1 implementation of backend-published `triage_status` /
`diagnosis_status` and surfaced four further refinements on the same
`DiagnosisAnnotation.tsx` / `SystemIncidentsPage.tsx` surface.)

### Recommendations and Decisions
| # | Finding | Triage | Recommendation | Final Decision | Severity | Scope | Rationale |
|---|---------|--------|----------------|----------------|----------|-------|-----------|
| 1 | Differentiate `triage failed` copy from generic fallback in `DiagnosisAnnotation.tsx` (both branches currently render identical "Triage attempted but no diagnosis recorded yet." text) | user-facing | implement | implement | medium | standard | Visible operator copy. Failed-terminal vs not-yet-run are different states; identical copy hides the distinction the migration-0237 fields enable. User approved as recommended |
| 2 | Split `partial` (amber) vs `invalid` (red) banners in `DiagnosisAnnotation.tsx` (currently both render the same red "Prompt validation failed" line) | user-facing | implement | implement | medium | standard | Visible operator copy. `partial` (diagnosis recorded, no validated investigate prompt — operator review recommended) is a softer state than `invalid` (validation terminally failed — operator must investigate). Severity-of-banner should match severity-of-state. User approved as recommended |
| 3 | Filter semantics for `triageStatus=failed AND diagnosisStatus=none` on the incidents list filter pill | user-facing | defer | defer | low | standard | Real workflow gap (operators can't isolate "auto-triage attempted but failed" cleanly) but UI string + filter contract need spec design. Defer to `tasks/post-merge-system-monitor.md` § Correctness per user routing override |
| 4 | Backend staleness guard for worker-death recovery (stale `triageStatus='running'` if worker dies mid-run) | technical | defer | defer (escalated to user) | medium | architectural | Real correctness concern but requires picking a pattern (sweep flip vs heartbeat TTL). Likely converges with the round-1 deferred correlation-ID propagation invariant. Carveout: technical-defer + architectural — surfaced; user confirmed defer. Routed to `tasks/post-merge-system-monitor.md` § Correctness per user routing override |

### Triage summary (pre-implementation)
- Auto-accepted (technical): 0 — finding 4 is technical but escalated (architectural defer), no auto-applies
- Escalated to user: 4 — findings 1, 2, 3, 4

### User decisions — received 2026-04-27T08-25-00Z

User reply: **all: as recommended**. Decisions applied verbatim. Routing
override (carried from round 1): the two defers route to
`tasks/post-merge-system-monitor.md` § Correctness rather than
`tasks/todo.md`.

### Implemented (round 2 — user-approved user-facing)

- `[user]` `client/src/components/system-incidents/DiagnosisAnnotation.tsx` —
  - Item 1: failed-triage copy now reads "Auto-triage failed — manual escalate available." in an amber-banner style matching the rate-limited state, distinguishing terminal failure from "not yet run" (which keeps the existing slate-italic fallback).
  - Item 2: split the diagnosis-status banner into two branches — `invalid` renders red "Prompt validation failed — operator should investigate manually." (pre-existing copy); `partial` renders amber "Diagnosis recorded without a validated investigate prompt — operator review recommended." (new). The combined `validationFailed` flag is removed.
  - Top-of-file comment updated to describe the new banner contract.

### Deferred (round 2)

Both deferred items written to `tasks/post-merge-system-monitor.md` §
Correctness fixes per the user's routing override:

- `[user]` Item 3 — list filter semantics for `failed AND none`
- `[user]` Item 4 — backend staleness guard for worker-death recovery

### Verification

- `npx tsc --noEmit` shows ONLY the same two pre-existing errors confirmed in
  round 1 (`ClarificationInbox.tsx`, `SkillAnalyzerExecuteStep.tsx`) — neither
  file touched by this round, no new typecheck errors introduced.
- `npm run lint` does not exist in this repo (no `lint` script in
  `package.json`); typecheck is the canonical mid-iteration check per the
  CLAUDE.md gate-cadence rule.
- `DiagnosisAnnotation.tsx` is a leaf component with no companion `*Pure.test.ts`
  — visual rendering is exercised through the parent page; no automated test
  to update.

### Round 2 summary

- Top themes: ui_copy_differentiation, banner_severity_split, deferred_filter_semantics, deferred_backend_staleness
- Auto-accepted (technical): 0 implement, 0 reject, 0 defer
- User-decided: 2 implement (#1, #2), 0 reject, 2 defer (#3, #4)
- Files changed this round: 1 modified (`DiagnosisAnnotation.tsx`), 1 modified (`tasks/post-merge-system-monitor.md`)
- Deferred items routed to: `tasks/post-merge-system-monitor.md` § Correctness fixes (per user routing override)

---

## Round 3 — 2026-04-27T08-37-11Z

### ChatGPT Feedback (raw)

(Round 3 raw text not pasted into this session — user supplied per-item
decisions directly. Round 3 produced three findings on the same
`DiagnosisAnnotation.tsx` surface plus a defer-enrichment proposal on the
deferred staleness-guard item:
1. Tighten `partial`-banner copy to read as a stronger call-to-action
   rather than the current advisory wording.
2. Reorder the `triageAttemptCount > 0` branch so the explicit
   `triageStatus === 'failed'` check fires before the rate-limited check
   (currently rate-limit precedence wins when both conditions hold).
3. Enrich the deferred staleness-guard item (round 2 #4) in
   `tasks/post-merge-system-monitor.md` with implementation-coordination
   notes — specifically: (a) the staleness flip MUST emit an incident
   event, not just a silent column flip, and (b) the staleness recovery
   path MUST coordinate with the deferred rate-limit retry idempotency
   fix (item 7b) so a single never-completed attempt is not double-counted.)

### Recommendations and Decisions
| # | Finding | Triage | Recommendation | Final Decision | Severity | Scope | Rationale |
|---|---------|--------|----------------|----------------|----------|-------|-----------|
| 1 | Tighten `partial`-banner copy in `DiagnosisAnnotation.tsx` | user-facing | reject | reject | low | standard | Visible operator copy. Current "Diagnosis recorded without a validated investigate prompt — operator review recommended." was deliberately set in round 2 to an amber-advisory tone to differentiate from the red-imperative `invalid` banner. Strengthening the copy collapses the round-2 severity split. User approved as recommended (reject, keep current) |
| 2 | Reorder rate-limited-before-failed banner precedence in `DiagnosisAnnotation.tsx` | user-facing | reject | reject | low | standard | Visible operator behaviour. Rate-limit (≥ TRIAGE_ATTEMPT_CAP) is a structural-stop state — once an incident is rate-limited, it cannot be retried regardless of the last attempt's outcome, so surfacing the rate-limit banner first is the correct precedence. Reordering would let a `failed` banner mask the rate-limit signal. User approved as recommended (reject, keep current) |
| 3 | Enrich deferred staleness-guard item (round 2 #4) with implementation-coordination notes — staleness flip MUST emit an incident event + MUST NOT double-count attempts (coordinate with item 7b) | technical | implement | auto (implement) | medium | standard | Defer-enrichment on a deferred item, not new code. Coordinating constraints between two deferred fixes (7b rate-limit retry idempotency + staleness guard) is documentation work that prevents the post-launch implementer from building one fix on top of the other's not-yet-finished assumptions. Mechanical edit, low blast radius — auto-applied per technical-implement path |

### Triage summary (pre-implementation)
- Auto-accepted (technical): 1 implement (#3 — defer-enrichment notes), 0 reject, 0 defer
- Escalated to user: 2 — findings 1, 2 (both user-facing copy/precedence calls)

### User decisions — received 2026-04-27T08-37-11Z

User reply: **all: as recommended**. Decisions applied verbatim:
- 1: reject (keep current partial-banner copy)
- 2: reject (keep current rate-limited-before-failed banner precedence)

### Implemented (round 3 — auto-applied technical)

- `[auto]` `tasks/post-merge-system-monitor.md` — appended **Implementation
  notes** subsection under deferred item 4 (backend staleness guard for
  worker-death recovery) capturing two coordinating constraints: (a) the
  staleness flip MUST emit an incident event mirroring `triage_failed`, not
  a silent column flip, and (b) the staleness recovery path must idempotency-
  key on `(incidentId, jobId)` to coordinate with deferred item 7b (rate-
  limit retry idempotency) so a never-completed attempt is not double-charged.
  Calls out that 7b + staleness guard share a failure surface and should be
  implemented together.

### Deferred (round 3)

None — both user-decided items were rejects.

### Verification

- `npx tsc --noEmit` not re-run this round; the only edit is to a markdown
  file (`tasks/post-merge-system-monitor.md`). No code change → no typecheck
  surface affected.
- No lint script in this repo (confirmed round 2). Markdown-only edit does not
  require code-side gates.

### Round 3 summary

- Top themes: ui_copy_preservation, banner_precedence_preservation, defer_enrichment_documentation
- Auto-accepted (technical): 1 implement (#3 — defer-enrichment notes), 0 reject, 0 defer
- User-decided: 0 implement, 2 reject (#1, #2), 0 defer
- Files changed this round: 1 modified (`tasks/post-merge-system-monitor.md`)
- Deferred items routed to: none this round

---

## Final Summary

- Rounds: 3
- Auto-accepted (technical): 1 implement | 3 reject | 4 defer
  - Implement: round 3 #3 (defer-enrichment notes on staleness-guard item)
  - Reject: round 1 #1, #3a, #7a (all already implemented before this PR — ChatGPT misread the diff)
  - Defer: round 1 #2 (heuristic frozen context), #3b (baseline-update guard), #7b (rate-limit retry idempotency), #7c (correlation-ID propagation invariant)
- User-decided: 3 implement | 2 reject | 4 defer
  - Implement: round 1 #5 (backend-published `triage_status` + `diagnosis_status`), round 2 #1 (failed-triage copy), round 2 #2 (partial vs invalid banner split)
  - Reject: round 3 #1 (keep current partial-banner copy), round 3 #2 (keep current rate-limited-before-failed precedence)
  - Defer: round 1 #4-split-1 (resolution-tag taxonomy), round 1 #4-split-2 (auto-tuning feedback loop), round 1 #6a (synthetic check: write-success-vs-declared), round 1 #6b (synthetic check: incident-silence detection), round 2 #3 (filter semantics for `failed AND none`), round 2 #4 (backend staleness guard for worker-death recovery)
- Total findings reviewed across the session: 17
- Index write failures: 0
- Deferred to `tasks/post-merge-system-monitor.md` (per user routing override; NOT `tasks/todo.md`):
  - § Correctness fixes
    - [auto] Rate-limit retry idempotency on triage attempts (round 1 #7b) — pg-boss retries can double-increment `triage_attempt_count` before the LLM tool loop runs
    - [user] List filter semantics for `triageStatus=failed AND diagnosisStatus=none` (round 2 #3) — workflow gap; UI string + filter contract need spec design
    - [user] Backend staleness guard for worker-death recovery (round 2 #4) — eternal "Triaging…" if worker dies mid-run; round 3 added implementation notes coordinating with 7b
  - § Observability
    - [user] Synthetic check: write-success-vs-declared mismatch (round 1 #6a) — surfaces silent agent failures
    - [user] Synthetic check: incident-silence detection (round 1 #6b) — catches "monitoring system is broken" case
    - [auto] Correlation-ID propagation enforced as invariant (round 1 #7c) — design level: gate? logger context? required field?
  - § Architectural
    - [auto] Frozen heuristic evaluation context (round 1 #2) — touches all 24 heuristic modules + types + CI gate
    - [auto] Baseline-update guard during anomaly storms (round 1 #3b) — self-corrupting baselines under hot-anomaly conditions
    - [user] Resolution-tag taxonomy (round 1 #4 split-1) — `confirmed_bug | false_positive | expected_behavior | tuning_required`
    - [user] Auto-tuning feedback loop from resolution tags (round 1 #4 split-2) — investigate first; spec required before implementation
- Architectural items surfaced to screen (user decisions):
  - Frozen heuristic evaluation context (round 1 #2) — defer (as recommended)
  - Resolution-tag taxonomy + auto-tuning feedback loop (round 1 #4) — defer + investigate-first split
  - Correlation-ID propagation invariant (round 1 #7c) — defer (as recommended)
  - Backend staleness guard (round 2 #4) — defer (as recommended)
- Consistency Warnings: none. Reject pattern (3 auto-rejects in round 1 for already-implemented findings; 2 user-rejects in round 3 to preserve round-2 design choices) is internally consistent — round 3 rejects defended decisions made in round 2, so round 2's user-implements and round 3's user-rejects are coherent across the session.
- KNOWLEDGE.md updated: yes (3 entries — see Pattern Extraction below)
- architecture.md updated: no
- PR: #215 — ready to merge at https://github.com/michaelhazza/automation-v1/pull/215

### Pattern Extraction

Three patterns surfaced across the 3 rounds, each meriting a KNOWLEDGE.md entry:

1. **ChatGPT default-to-additions on a strong-architecture PR — already-implemented findings dominate round 1 rejects** (3/3 round 1 auto-rejects were "this is already in the diff"). Mirrors the spec-review pattern from 2026-04-26 (post-merge observations: PR #196) but with a code-level twist: the misread is on the migration index (0224 partial unique index) and the CI gate script (`verify-event-type-registry.sh`) — both files small enough that a careful read would have caught them. Promote: when a reviewer recommends adding an invariant that a partial unique index or a CI gate already enforces, the rejection is "show the existing mechanism" — don't re-litigate. Updates existing entry `2026-04-25 Gotcha — Partial unique index predicate must match the upsert WHERE clause exactly` (related but distinct — that's about the predicate matching, this is about the reviewer not seeing the predicate exists).

2. **Round-2 design splits get tested in round 3** (2/2 round 3 user-rejects defended round-2 decisions: amber-advisory `partial` vs red-imperative `invalid` split, and rate-limit-precedence-over-failed). When a reviewer proposes "tighten the copy" on a banner that was deliberately split into two severity tones in the previous round, the round 2 rationale IS the round 3 rejection rationale — surface the round-2 design intent in the round 3 reject, don't re-derive it from scratch. New pattern (no existing entry).

3. **Defer-enrichment as a technical auto-apply** (round 3 #3). When a reviewer surfaces a coordination constraint between two deferred items (here: 7b rate-limit retry idempotency + staleness guard share a `triage_attempt_count` write surface), enriching the deferred entry with the constraint is documentation work that prevents the post-launch implementer from building one fix on top of the other's not-yet-finished assumptions. Auto-apply path: technical-implement, low blast radius (markdown-only), no user gate. New pattern (no existing entry).

