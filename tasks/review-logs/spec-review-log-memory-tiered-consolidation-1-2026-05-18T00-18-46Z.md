# Spec Review Log — memory-tiered-consolidation — Iteration 1

**Spec:** `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`
**Codex output:** `tasks/review-logs/_codex_memory-tiered-consolidation_iter1_2026-05-18T00-18-46Z.txt`
**Codex findings raised:** 35
**Rubric findings raised:** 0 (subsumed by Codex output)

---

## Findings classification & disposition

(See chunked sections below.)

## Findings 1-10

### FINDING #1 — §2 ABCd "~10 files" vs §8 ~20 files
- Source: Codex. Section: §2 Build row. Description: ABCd "~10 files" contradicts §8's roughly 20 touched/new files.
- Classification: **mechanical** — numeric drift. Disposition: **auto-apply**.

### FINDING #2 — Decay job role contradiction (§3 Goal 2 vs §6 Phase 2 vs §11.2)
- Source: Codex. Description: Three different statements: "maintains last-access markers" / "materialises last_accessed_at projections" / "writes only to logs".
- Classification: **mechanical** — contradiction. Disposition: **auto-apply** — pin as logging-only (reinforcementBatch.ts owns `last_accessed_at` writes); §17 Open Question already recommends this.

### FINDING #3 — Retrieved tier payload nullability conflict (Goal 8 / Phase 1 / §9.6)
- Source: Codex. Description: Goal 8 says event always carries tier; Phase 1 success says `tier: null`; §9.6 says null when flag-OFF.
- Classification: **mechanical** — clarify interim Phase 1 state vs runtime contract. Disposition: **auto-apply**.

### FINDING #4 — "Byte-identical" claim conflicts with new payload fields (§12 G1 vs §9.6)
- Source: Codex. Description: G1 claims byte-identical OFF state, but new nullable event fields are emitted (as null) in OFF mode.
- Classification: **mechanical** — overclaim. Disposition: **auto-apply** — narrow invariant to retrieval ordering/scoring/prompt-inputs.

### FINDING #5 — `extract.ts` named as producer but listed as untouched (§9.1 vs §8)
- Source: Codex. Description: §9.1 names `extract.ts` as initial-tier producer; §8 marks it explicitly untouched.
- Classification: **mechanical** — file-inventory drift. Disposition: **auto-apply** — move initial-tier defaulting into schema column DEFAULT `'episodic'`; remove `extract.ts` reference from §9.1.

### FINDING #6 — Initial tier left "architect locks at plan" (§9.1)
- Source: Codex. Description: Says new rows default to `working`, but also says architect locks at plan.
- Classification: **mechanical**. Disposition: **auto-apply** — pin to `episodic` via schema DEFAULT (consistent with FINDING #5 resolution and backfill).

### FINDING #7 — `reinforcement_count` has no backing storage (§3 Goal 5 / §9.3 / §14.1)
- Source: Codex. Description: Only `last_accessed_at` stored (overwritten on flush); a count cannot be derived.
- Classification: **mechanical** — load-bearing claim without mechanism. Disposition: **auto-apply** — derive `reinforcementCount` from `agent_run_prompts` / `memory.retrieved` event traces over lookback window (same source as `crossSessionRecurrence`).

### FINDING #8 — "Distinct-day updates" cannot be audited from a single timestamp (§13 Check 5)
- Source: Codex. Description: Check 5 asks for distinct-day updates over 7 days; one timestamp column only preserves latest.
- Classification: **mechanical**. Disposition: **auto-apply** — rewrite Check 5 to count distinct days from retrieval-trace events.

### FINDING #9 — `crossSessionRecurrence` query source unpinned (§9.3)
- Source: Codex. Description: Says "run-history joins" without naming tables/columns.
- Classification: **mechanical** — under-specified. Disposition: **auto-apply** — pin to `agent_run_prompts` JOIN `agent_runs`.

### FINDING #10 — Decay drift check uses mutable state (§13 Check 4)
- Source: Codex. Description: Recomputes using ACTIVE config + CURRENT timestamp; original retrieval used trace-time values.
- Classification: **mechanical** — under-specified audit. Disposition: **auto-apply** — pin Check 4 to use trace-time `memoryConsolidationConfigVersion`, retrieval timestamp, `lastAccessedAtAtRetrieval` (latter added to §9.6).

## Findings 11-20

### FINDING #11 — Retrieval trace storage location undefined (§9.6 / §13 Check 4)
- Source: Codex. Description: §9.6 defines payload but not persistence path.
- Classification: **mechanical**. Disposition: **auto-apply** — pin storage to `agent_run_prompts` (the existing retrieval-trace persistence per spec-context).

### FINDING #12 — `writeLineageRowsForVersion` requires a version that promotion doesn't mint (§3 Goal 7 / §6 Phase 4 / §9.8)
- Source: Codex. **VERIFIED** in `server/services/memoryBlockLineageService.ts:62` — requires `blockVersionId` param.
- Classification: **mechanical** — load-bearing contract that breaks at first call. Disposition: **auto-apply** — pin: promotion mints a new `memory_block_versions` row (same content, bumped `version_number`, lineage_event_type `'tier_promotion'`); the new version's id is passed to `writeLineageRowsForVersion` whose lineage source is the prior version of the same block.

### FINDING #13 — Transactional event emission not specified as transaction-bound (§14.5)
- Source: Codex. Description: §14.5 says UPDATE + lineage + event in one transaction; LAEL emission path is not specified as accepting an active tx.
- Classification: **mechanical**. Disposition: **auto-apply** — pin as outbox: UPDATE + lineage inside `withOrgTx`; emit `memory.block.promoted` AFTER commit (best-effort with retry per tier-3 criticality). Soften §14.5's "if emission fails, transaction aborts" language to reflect outbox reality. Audit Check #2 detects missing events.

### FINDING #14 — Promotion event idempotency key includes `timestamp` (§14.4)
- Source: Codex. Description: Including `timestamp` makes retry-dedup impossible.
- Classification: **mechanical**. Disposition: **auto-apply** — change canonical key to `(blockId, oldTier, newTier, configVersion)`; the tuple is naturally distinct across consecutive promotions on the same block.

### FINDING #15 — LAEL `runId` assumption doesn't fit jobs (§14.2)
- Source: Codex. Description: Promotion job is not an agent run; no runId exists.
- Classification: **mechanical**. Disposition: **auto-apply** — specify: job-emitted `memory.block.promoted` uses `runId = NULL` and the pg-boss `job_id` as correlation id; idempotency derives from the deterministic key per FINDING #14, not from runId+sequence.

### FINDING #16 — Duplicate procedural review rows not prevented (§6 Phase 4 / §14.3)
- Source: Codex. Description: Each hourly run can insert another `memory_review_queue` row for the same candidate.
- Classification: **mechanical** — missing dedupe guard. Disposition: **auto-apply** — add partial unique index `(block_id, decision_type) WHERE status = 'pending' AND decision_type = 'promote_to_procedural'`; insert uses `ON CONFLICT DO NOTHING`. Update §14.6 to reflect that this build DOES introduce one unique constraint.

### FINDING #17 — Approve handler retry semantics conflict (§14.1 vs §14.6)
- Source: Codex. Description: §14.1 says idempotent re-submit = same result; §14.6 says already-resolved = 404.
- Classification: **mechanical**. Disposition: **auto-apply** — pin: return 200 (idempotent-success) when row already resolved with same target tier + same approver intent; return 409 when resolved differently (e.g. rejected); reserve 404 for "row does not exist".

### FINDING #18 — Rejection cooldown has no state contract (§6 Phase 4 / §14.3)
- Source: Codex. Description: Reject "bumps per-block cooldown timestamp" — but no column or table named.
- Classification: **mechanical**. Disposition: **auto-apply** — pin storage: `cooldown_until timestamptz` field on the `memory_review_queue` row that was rejected, set to `now() + cooldown_duration`. `evaluatePromotion` reads via "most recent rejected review-queue row for this block/transition; if `cooldown_until > now()`, treat as `cooldown_active`". No new table. Cooldown duration remains an Open Question per §17 (recommended 30 days).

### FINDING #19 — Permission key left as open question (§10.4 / §17)
- Source: Codex. Description: Approve/reject route MUST use permission check, but exact key in §17 Open Questions.
- Classification: **mechanical** (NOT directional — converting a "recommend reuse" to a "lock reuse" against the existing permission name is a discovery task, not a posture change).
- Disposition: **auto-apply** — pin: reuse existing review-approve permission. Architect locates exact symbol at plan; the DECISION (reuse vs new) is locked.

### FINDING #20 — Reinforcement flush SQL missing subaccount_id predicate (§10.1 / §6 Phase 2)
- Source: Codex. Description: Flush SQL is `WHERE id = ANY(...)` only. RLS handles org; defense-in-depth wants explicit org+subaccount.
- Classification: **mechanical** — belt-and-braces. Disposition: **auto-apply** — update §6 Phase 2 flush SQL example to include explicit `organisation_id = $orgId AND subaccount_id = $subId`.

## Findings 21-30

### FINDING #21 — Audit "admin scope" vs "never bypasses RLS" ambiguous (§10.5 / §10.6)
- Source: Codex. Description: Audit uses admin path AND claims it never bypasses RLS.
- Classification: **mechanical**. Disposition: **auto-apply** — clarify: per-tenant checks via `withOrgTx` (RLS enforced); cross-tenant aggregate reads (e.g. matview Check 6) via `withAdminConnection` (RLS bypassed for intentional cross-tenant aggregation).

### FINDING #22 — `mv_memory_utility_30d` is RLS-excluded but §10 claims no bypass (§13 Check 6)
- Source: Codex. Description: Audit reads the matview; matviews don't carry policies the same way.
- Classification: **mechanical** — same root cause as #21. Disposition: **auto-apply** — fold into #21 resolution; cite matview Check 6 as the named example.

### FINDING #23 — Weekly CI audit both in-scope and deferred (§6 Phase 5 vs §16 / §17)
- Source: Codex. Description: Phase 5 says "can ALSO run as a weekly CI job"; §16/§17 say deferred.
- Classification: **mechanical** — contradiction. Disposition: **auto-apply** — keep in §16 only; remove the Optional CI subsection from Phase 5; replace with a one-line pointer to §16.

### FINDING #24 — Four-pass gate has no enforcement mechanism (§12 G3 / §13.4)
- Source: Codex. Description: Trend logs are gitignored; CI auto-commit deferred; nothing operational ties "4 passes" to "flag flip allowed".
- Classification: **mechanical** — process spec needs concrete artefact. Disposition: **auto-apply** — pin: operator captures each of 4 weekly staging runs as a committed file `tasks/operational/memory-tiered-consolidation-staging-audit-<ISO-date>.json` (per-pass trend-log snapshot). Production flip requires 4 such files dated within a 4-to-6 week window.

### FINDING #25 — Audit fail conditions lack eligibility preconditions (§13 Checks 1, 2)
- Source: Codex. Description: Check 1 fails if any tier empty; Check 2 fails if any transition has zero events — but low-volume tenants or operator-gated procedural transitions may have no eligible candidates.
- Classification: **mechanical**. Disposition: **auto-apply** — pin: Check 1 `fail` requires ≥ 100 blocks per tenant; else `warn`/`n/a`. Check 2 procedural transitions: `fail` only if pending unresolved `promote_to_procedural` rows exist AND zero `memory.block.promoted` events for that transition in 30 days. Auto transitions: `fail` requires ≥ 10 source-tier blocks meeting promotion-signal thresholds during the window; else `warn`.

### FINDING #26 — Signal-dominance math under-specified (§13 Check 3)
- Source: Codex. Description: Compares one raw `signalValue` to `totalScore`, but totalScore is weighted sum — comparison of raw value to weighted sum yields garbage.
- Classification: **mechanical**. Disposition: **auto-apply** — pin formula: `weightedContribution(signal) = signalValue × signalWeight; dominanceFraction = weightedContribution(signal) / totalScore`. Weights from `config.promotionConfig.signalWeights`.

### FINDING #27 — `server/config/featureFlags.ts` does not exist (§8 / §11)
- Source: Codex. **VERIFIED** — `server/config/featureFlags.ts` does NOT exist; no `getFeatureFlag` helper exists either.
- Classification: **mechanical** — broken placeholder. Disposition: **auto-apply** — pin: Phase 1 creates `server/config/featureFlags.ts` with `getMemoryConsolidationTierEnabled(): boolean` (env-var-reader pattern). Update §8 inventory entry from `Modify` → `New`; update §6 Phase 1.

### FINDING #28 — Review-queue migration phase not locked (§8 / §6)
- Source: Codex. Description: §8 says architect decides Phase 1 vs Phase 4 for discriminator migration.
- Classification: **mechanical**. Disposition: **auto-apply** — pin to Phase 4 (preserves "no backward dependencies"); remove "architect decides" wording.

### FINDING #29 — "Post-launch runbook entry" has no file (§8 / §7)
- Source: Codex. Description: §7 names runbook entry as Phase 5 output; §8 doesn't list a runbook file.
- Classification: **mechanical** — file-inventory drift. Disposition: **auto-apply** — add `docs/runbooks/memory-tiered-consolidation-runbook.md` to §8 documentation table.

### FINDING #30 — REVIEW_GAP references not file-pinned (§12 G3)
- Source: Codex. Description: Spec cites "CLAUDE.md REVIEW_GAP protocol" without naming artefact path.
- Classification: **mechanical**. Disposition: **auto-apply** — pin: production-flag-flip REVIEW_GAP at `tasks/operational/memory-tiered-consolidation-flag-flip-override-<ISO-date>.md`, following the format in `CLAUDE.md § REVIEW_GAP artifact format`.

## Findings 31-35

### FINDING #31 — Active config version selection mechanism undefined (§9.2 / §9.8)
- Source: Codex. Description: Config history named; active-version selector not.
- Classification: **mechanical**. Disposition: **auto-apply** — pin: `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number` exported from same file; all consumers read `MEMORY_CONSOLIDATION_CONFIG_HISTORY.find(c => c.version === ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION)`.

### FINDING #32 — `null → procedural` guard deferred (§14.7)
- Source: Codex. Description: Architect adds guard at plan, but closure depends on it.
- Classification: **mechanical**. Disposition: **auto-apply** — pin: (a) `evaluatePromotion` early-returns `shouldPromote: false, reason: 'invalid_source_tier'` when `currentTier IS NULL`; (b) approve handler predicate `WHERE consolidation_tier IN ('episodic','semantic')`. No new DB CHECK needed.

### FINDING #33 — No shared transition validator (§14.7)
- Source: Codex. Description: SQL examples only predicate on oldTier and set newTier; no shared validator.
- Classification: **mechanical**. Disposition: **auto-apply** — pin a pure helper `isValidPromotionTransition(oldTier, newTier): boolean` in `shared/types/memoryConsolidation.ts`; all tier-write paths call it before the UPDATE; also used by §13 Check 2.

### FINDING #34 — Synthetic fail-to-todo test writes filesystem (§15)
- Source: Codex. Description: Pure-function test of routing helper would touch real filesystem.
- Classification: **mechanical**. Disposition: **auto-apply** — pin seam: split into `formatTodoEntry(finding): string` (pure, tested) and `routeTodoEntry(text, path): void` (i/o, verified manually).

### FINDING #35 — Mojibake (whole document encoding)
- Source: Codex. **VERIFIED FALSE** — `file` confirms UTF-8; arrow / section counts match expected.
- Classification: **mechanical**. Disposition: **REJECT** — Codex TUI rendering artefact, not a real file issue.

---

## Implementation log (applied changes per finding)

All 34 accepted findings have been applied to the spec via targeted Edits. Summary by finding:

- **F1** — §2 Build row updated to "~20 touched/new files per §8 inventory".
- **F2** — §3 Goal 2 + §6 Phase 2 + §11.1 + §17 + §18: decay job pinned as logging-only (writes structured per-tier distribution log lines; never mutates `last_accessed_at`). Open Question struck through with resolution.
- **F3** — §3 Goal 8 + §6 Phase 1 success criteria: clarified that Phase 1 `tier: null` is interim state; runtime contract is `tier` populated when flag ON post-Phase 2, `null` when flag OFF.
- **F4** — §12 G1 invariant narrowed: "retrieval ordering, scoring, and prompt inputs are byte-identical; event payload gains nullable observability fields that signal flag-off mode".
- **F5 + F6** — §6 Phase 1 schema + §9.1 + §8 memoryBlocks.ts + §14.1: moved initial-tier defaulting into schema column DEFAULT `'episodic'` (column is NOT NULL DEFAULT). Removed `extract.ts` from §9.1 producers; preserved §8's "extract.ts untouched" promise.
- **F7 + F9** — §9.3 PromotionSignals contract pinned: `reinforcementCount` and `crossSessionRecurrence` both derive from `agent_run_prompts` JOIN `agent_runs` (the persisted retrieval-trace path); `recency` continues to use `last_accessed_at`. Lookback window noted as 30 days (architect-locked at plan).
- **F8** — §13 Check 5 rewritten to count distinct days from `agent_run_prompts` (the only correct source for distinct-day signals).
- **F10** — §13 Check 4 pinned to use trace-time `memoryConsolidationConfigVersion`, `agent_runs.started_at`, and `lastAccessedAtAtRetrieval` (latter added to §9.6).
- **F11** — §9.6 expanded: pinned `agent_run_prompts` as the persisted retrieval-trace path; added `lastAccessedAtAtRetrieval` field; named `agentRunPromptService` as the producer.
- **F12** — §3 Goal 7 + §6 Phase 4 + §9.8 (5) + §18 Goal 7: pinned that every promotion mints a new `memory_block_versions` row (`lineage_event_type = 'tier_promotion'`, bumped `version_number`, same content) before invoking `writeLineageRowsForVersion`. **Verified** that `writeLineageRowsForVersion(params: { tx, blockVersionId, ... })` requires the version id (read at `server/services/memoryBlockLineageService.ts:62`).
- **F13** — §14.5 softened: UPDATE + lineage atomic inside `withOrgTx`; event emission moved to LAEL outbox pattern (post-commit, best-effort retry); audit Check #2 detects missing events. §9.8 closing line updated to reflect the order: validate → UPDATE → mint version → lineage → commit → outbox emit.
- **F14** — §14.4 canonical idempotency key changed to `(blockId, oldTier, newTier, configVersion)`; timestamp dropped. §9.5 consumer note updated.
- **F15** — §14.2 retry classification row for `memory.block.promoted` rewritten to handle both emission contexts: HTTP route uses standard `(runId, sequence)`; job uses `runId = NULL` + pg-boss `job_id`. Canonical key in §14.4 is the dedupe primitive in both cases.
- **F16** — §6 Phase 4 procedural insert uses `ON CONFLICT DO NOTHING` against a new partial unique index `memory_review_queue_pending_procedural_promotion_idx`. §8 review-queue entries split into table-modify + new migration file. §14.6 updated to acknowledge the one new unique constraint.
- **F17** — §14.6 HTTP-mapping rewritten: 200 OK on idempotent re-submit (matching tier + matching intent); 409 on optimistic-predicate failure OR resolved-with-different-outcome; 404 reserved for "row does not exist".
- **F18** — §6 Phase 4 reject path + §14.3 (b): pinned cooldown storage as `cooldown_until timestamptz` on the rejected `memory_review_queue` row. Added column to Phase 4 migration in §8. `evaluatePromotion` reads via "most recent rejected row for this block/transition; treat `cooldown_until > now()` as `cooldown_active`".
- **F19** — §10.4 + §17: pinned REUSE of existing review-queue approve permission (architect locates exact `ORG_PERMISSIONS.*` symbol at plan as a discovery task, not a design decision).
- **F20** — §6 Phase 2 flush SQL + §14.1: added explicit `AND organisation_id = $orgId AND subaccount_id = $subId` predicates (defense-in-depth alongside `withOrgTx` RLS).
- **F21 + F22** — §10.6 rewritten with two distinct postures: per-tenant checks use `withOrgTx` (RLS enforced); cross-tenant aggregate Check 6 explicitly uses `withAdminConnection` with named carve-out comment. §10.5 removed audit-script paragraph (moved to §10.6).
- **F23** — §6 Phase 5 + §17: removed the "Optional CI integration" subsection; replaced with one-line pointer to §16. §17 Open Question struck through.
- **F24 + F30** — §12 G3 rewritten: per-pass snapshots committed to `tasks/operational/memory-tiered-consolidation-staging-audit-<ISO-date>.json`; override REVIEW_GAP path pinned at `tasks/operational/memory-tiered-consolidation-flag-flip-override-<ISO-date>.md` following `CLAUDE.md § REVIEW_GAP artifact format`.
- **F25** — §13 Check 1 and Check 2 rewritten with eligibility preconditions (Check 1: ≥ 100 blocks per tenant; Check 2: auto needs ≥ 10 source-tier candidates with signal scores; procedural needs ≥ 1 pending review-queue row); ineligible = `n/a`.
- **F26** — §13 Check 3 pinned formula: `weightedContribution = signalContributions[s] × config.promotionConfig.signalWeights[s]; dominanceFraction = weightedContribution / event.totalScore`. Check uses `event.configVersion` (not active) for historical correctness.
- **F27** — §6 Phase 1 + §8 + §11 G1 contract + §13 Check 7: pinned that `server/config/featureFlags.ts` is a NEW file (verified does not exist); ships in Phase 1 with `getMemoryConsolidationTierEnabled(): boolean`. §8 inventory `Modify` → `New`. Check 7 now reads via the new helper.
- **F28** — §8 review-queue file inventory + §17: review-queue migration pinned to Phase 4 (not folded into Phase 1). Phase dependency check in §7 updated.
- **F29** — §8 documentation table: added `docs/runbooks/memory-tiered-consolidation-runbook.md` as a Phase 5 New file.
- **F31** — §9.2 + §9.8 (3) + §8 memoryConsolidationConfig.ts entry: active-config selector pinned. `MEMORY_CONSOLIDATION_CONFIG_HISTORY` + `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` both exported; consumers use `.find(c => c.version === ACTIVE_…)`.
- **F32 + F33** — §14.7 rewritten: null→procedural is structurally impossible (column is NOT NULL DEFAULT); shared `isValidPromotionTransition` helper in `shared/types/memoryConsolidation.ts` is called by every tier-write path (auto dispatcher, approve handler, `evaluatePromotion`) AND by §13 Check 2. §8 shared types entry updated; test file `shared/types/__tests__/memoryConsolidation.test.ts` added.
- **F34** — §6 Phase 5 success criteria: audit-script todo routing split into `formatTodoEntry` (pure, vitest-covered) and `routeTodoEntry` (i/o, manual verification only).
- **F35** — REJECTED (Codex hallucination; spec is proper UTF-8 per `file` check + char-count grep).

---

## Iteration 1 Summary

- Mechanical findings accepted:  34
- Mechanical findings rejected:  1 (F35 mojibake — Codex TUI rendering artefact, file is proper UTF-8)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (set after commit step)

This is a high-yield iteration — Codex correctly identified a single load-bearing contract break (F12: `writeLineageRowsForVersion` requires a `blockVersionId` that the spec's promotion path didn't mint), plus 33 other genuine mechanical issues (contradictions between sections, undefined storage paths, missing permission lock, missing dedupe guard, etc.). The spec now ships with these all pinned.

No directional findings were raised by Codex in this round — likely because the operator's 9-round grill upstream had already eliminated the "add a feature flag", "stage the rollout", "add more tests" classes of finding. The framing constraints in the Codex prompt also pre-empted those.





