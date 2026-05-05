# chatgpt-spec-review log — pre-launch-phase-3 (narrow spec)

## Table of contents

1. Session Info
2. Spec metadata
3. Pre-round triage adjustment (operator paste interpretation)
4. Round 1 — 2026-05-06T00-00-00Z
   1. ChatGPT Feedback (raw)
   2. Recommendations and Decisions
   3. Auto-execution summary
   4. User-facing approvals / Operator decisions
   5. Applied (auto-applied technical)
   6. Integrity check (post-edit pass)
   7. Round 1 summary
5. Session close-out

## 1. Session Info

- **Started:** 2026-05-06T00:00:00Z
- **Mode:** manual
- **Spec:** `tasks/builds/pre-launch-phase-3/spec.md` (narrow 7-item spec authored by Michael)
- **Spec commit at start:** `1d13a97e`
- **Branch:** `claude/pre-launch-phase-3`
- **Coordinator:** main session (Opus, inline — chatgpt-spec-review sub-agent type unavailable in this Claude Code web session)
- **Driving rule:** operator copies the spec + prompt into ChatGPT-web; pastes ChatGPT's response back here. Coordinator triages each finding (technical → auto-implement; user-facing → operator approval).
- **Project context loaded:** CLAUDE.md, docs/spec-context.md (read previously this session and earlier).

## 2. Spec metadata

- 489 lines pre-round-1, 7 sections of items in §4 (L1–L6 launch / strong-rec, H1–H4 hygiene + runbook).
- Two distinct specs co-exist on the branch following an S1 collision rename: this narrow one and the broader `pre-launch-phase-3-deferred-backlog/spec.md` (24 items, finalised through 5 chatgpt-spec-review rounds in a parallel session). They share the branch but cover different scopes.

## 3. Pre-round triage adjustment (operator paste interpretation)

The operator pasted ChatGPT feedback labelled with codes `L1, L2, L3, L4, L5, H4` plus minor consistency notes. An earlier (mistaken) reading of this same paste tried to apply the findings to the deferred-backlog spec under the assumption that the L/H codes were ChatGPT-internal severity labels. Cross-referencing each finding against the actual spec content for both candidate specs shows the codes are §4 section identifiers in **this** narrow spec (`L1` → §4.L1 webhook secret enforcement; `L2` → §4.L2 subaccount permission denial event; `L3` → §4.L3 per-email-only login rate-limit bucket; `L4` → §4.L4 idempotency-invariant test for measureInterventionOutcomeJob; `L5` → §4.L5 optimiser cost-gate measured in CI; `H4` → §4.H4 operator runbook for conditional re-evaluation triggers). All findings are in-scope.

The operator chose Option 2 ("salvage findings on top of remote") under the earlier framing. The salvage path resolves cleanly here — apply the full feedback to the correct narrow spec.

## 4. Round 1 — 2026-05-06T00-00-00Z

### 4.1 ChatGPT Feedback (raw)

> Executive summary: This is tight, disciplined, and aligned with your operating model. No structural gaps or hidden scope creep. The only things worth addressing before build are a few edge-condition clarifications and operational enforcement details that could otherwise become post-launch friction. Nothing here blocks build.
>
> What's solid (no changes needed)
> - Scope discipline is excellent. Every item ties cleanly to a verified gap.
> - Use of existing primitives is consistent (`inboundRateLimiter`, `recordSecurityEvent`, pure-function test pattern) — avoids architectural drift.
> - Testing posture is correctly constrained — pure + CI gate only. No sneaky E2E creep.
> - L5 (cost gate) is done properly — measured not assumed; secret-absence handled correctly (fail not skip); tied to real PR surface.
>
> High-signal refinements:
> 1. L1 — webhook enforcement edge case (dev friction). "In dev, an unset secret throws" creates avoidable dev friction. Tighten: production must exist + ≥32 (hard fail); non-production allow missing BUT `verifyCallbackToken` must fail closed not throw.
> 2. L2 — audit event reliability under failure. `void recordSecurityEvent(...)` swallows errors. Edge risk: silent loss of forensic signal under load/outage. Tighten: emit `security.audit.write_failed` structured log on failure. No retries.
> 3. L3 — rate limit bucket interaction clarity. "Either bucket tripping returns 429" — but headers may come from one bucket only. Tighten: response headers reflect the most-restrictive bucket (shortest remaining window, lowest remaining quota).
> 4. L4 — test naming vs scope mismatch. `measureInterventionOutcomeJob.idempotency.test.ts` does not test idempotency, it tests decision ordering. Tighten: rename or add comment.
> 5. L5 — cost gate drift risk. Pinned model + token rates protect against model drift but not prompt drift. Tighten: test logs include tokens-per-call, number-of-calls, average-tokens-per-recommendation.
> 6. H4 — operator runbook completeness. Add L5 trigger: "If optimiser cost approaches 80% of threshold in consecutive runs → review prompt + batching strategy."
>
> Minor: organisationId vs orgId terminology consistency; L1 wording cleanup after fix above.
>
> Final verdict: APPROVED. Status: Ready to build. No blockers. Recommended for clean merge: L3 header rule, L5 logging detail, L4 naming clarification.

### 4.2 Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | L1 — webhook secret in non-prod: fail-closed return (false + one-shot warn) instead of throw | technical | apply | auto (apply) | medium | Real dev-loop tightening that preserves the security invariant. The current spec phrasing "dev throws" added friction without strengthening the invariant — `verifyCallbackToken` returning `false` is the canonical fail-closed pattern. Boot validator (step 1) still hard-fails prod, so the runtime branch is unreachable in prod and only matters in non-prod. |
| F2 | L2 — `recordSecurityEvent` write-failure structured log (`security.audit.write_failed`) | technical | apply | auto (apply) | low-medium | One-line addition in `securityAuditService.ts:40-46` catch branch; pure observability, no retry / queue / escalation. Phase 3 expands the set of `recordSecurityEvent` call sites (subaccount permission-denied, plus existing call sites unchanged) so the without-this-fix risk is "sustained audit-DB outage produces silent void"; with this fix, it produces a structured log stream. New `*Pure.test.ts` covers it. |
| F3 | L3 — 429 headers selected from most-restrictive bucket across all four (existing `ip:email` short + long, plus new `email`-only burst + sustained) | technical | apply | auto (apply) | medium | Real correctness improvement. With four buckets, "same headers as existing" is ambiguous and a single bucket's headers can mislead a caller's retry strategy into the non-binding constraint and trigger an immediate second 429. The handler already needs all four bucket states for the union-trip decision, so the additional cost is just the selection logic. |
| F4 | L4 — leading docstring on the new `describe` block stating "decision-ordering, not idempotency; DB-level single-outcome deferred to §13" | technical | apply | auto (apply) | low | Test-file rename rejected as ripple-cost not justified (CI / docs / KNOWLEDGE.md all reference the path). Docstring is the canonical clarity fix and matches the spec's existing scoping note in §4.L4. |
| F5 | L5 — cost-gate test emits diagnostic numbers (`totalTokens`, `numberOfRenderCalls`, `averageTokensPerRecommendation`, `totalCostDollars`) on every run, in stdout + GitHub annotation form | technical | apply | auto (apply) | medium | Concrete diagnostic improvement. The PASS/FAIL number alone gives no attribution for the drift vector (model rate vs prompt length vs call count); the four-number breakdown makes the cause visible immediately without re-running with extra instrumentation. Implementation cost is small — the logger spy already needs per-call records for the running total; we just retain them. |
| F6 | H4 — runbook 7th trigger: cost-gate proactive 80% trigger ("≥ $0.016/sa/day on two consecutive runs → review prompt + batching strategy") | technical | apply | auto (apply) | low-medium | Sensible runbook addition. Complements L5's reactive fail-on-overrun. The "two consecutive runs" qualifier is important — single-run noise from the seeded fixture's variance band is below the gate fail threshold but above the 80% mark, so a single trigger would be noisy. Also mirrored into `operator-runbook.md` as a 7th entry. |
| F7 | Minor — organisationId / orgId naming consistency | mechanical (no-op) | reject | auto (reject) | trivial | Spec uses `organisationId` for the resolved value, `req.orgId` for the Express middleware variable (canonical naming for that field), and `user.organisationId` for the DB column form. The "alternation" is contextual — each name is correct for its source. No ambiguity. |
| F8 | Minor — L1 wording cleanup after fix | mechanical | apply | auto (apply) | trivial | Folded into F1 fix above (both §4.L1 and §3 file inventory line for `webhookService.ts`). |

### 4.3 Auto-execution summary

- **Auto-applied (6):** F1, F2, F3, F4, F5, F6 (plus F8 folded into F1).
- **Auto-rejected (1):** F7 (no real inconsistency).
- **Escalated to operator (0):** none.

### 4.4 User-facing approvals / Operator decisions

None. All findings classified `technical` (apply) or `mechanical-noop` (reject). No "silent technical defers" — the rejected F7 is logged with explicit rationale rather than being silently dropped. No operator decisions pending.

### 4.5 Applied (auto-applied technical)

- [auto F1 + F8] §4.L1 — `verifyCallbackToken` in non-prod returns `false` (fail-closed) with one-shot `logger.warn` instead of throwing. Boot validator unchanged. Prod is unreachable post-boot-fail. §3 file inventory row for `webhookService.ts` updated to match. §12 done definition L1 line updated.
- [auto F2] §4.L2 — added "Audit write-failure observability (L2 sub-fix)" sub-bullet specifying the `security.audit.write_failed` structured log on `recordSecurityEvent`'s catch branch; added new pure-function test file `server/services/__tests__/securityAuditServiceWriteFailureLogPure.test.ts` `[NEW]` to §3 inventory + §10 testing posture; §3 also adds a new `server/services/securityAuditService.ts` modify-row to capture the catch-branch addition; §12 done-definition L2 line updated to mention the new single-source-of-truth claim.
- [auto F3] §4.L3 — replaced "On deny, return 429 with the same headers as the existing buckets" with the most-restrictive header selection rule (across all four buckets); §3 file inventory row for `routes/auth.ts` updated; §12 done definition L3 line updated.
- [auto F4] §4.L4 — added test-file naming clarification sub-bullet specifying the leading docstring on the new `describe` block. File rename rejected with rationale.
- [auto F5] §4.L5 — replaced steps 3+4 with the diagnostic-logging requirement (four numbers on every run, stdout + GitHub annotation); §12 done definition L5 line updated.
- [auto F6] §4.H4 — added 7th bullet (L5 cost-gate proactive 80% trigger). `operator-runbook.md` updated with the corresponding 7th entry, mirroring the structure of the other six. §3 doc inventory row for `operator-runbook.md` updated to mention 7 triggers. §12 done definition H4 line updated.
- [auto F7 → REJECT] no spec change. Naming convention is contextual.

### 4.6 Integrity check (post-edit pass)

- Forward references: §4.L1 references §3 file inventory row for `webhookService.ts` (updated). §4.L2 references §3 file inventory row for `securityAuditService.ts` (added) and §10 testing posture (updated). §4.L3 references §3 file inventory row for `routes/auth.ts` (updated). §4.L5 self-contained. §4.H4 references `operator-runbook.md` (updated). All hooks present.
- Contradictions: §12 done-definition lines for L1, L2, L3, L5, H4 updated to match the §4 changes. §11 doc-sync impact unchanged (no new docs introduced; operator-runbook.md was already listed).
- Missing inputs/outputs: F2's structured-log key (`security.audit.write_failed`) and payload (`{ eventType, organisationId, errorMessage, timestampIso }`) named explicitly. F3's selection rule (`min(retryAfterSeconds)`, `min(remainingQuota)`) named explicitly. F5's four diagnostic numbers and emission targets (stdout + GitHub annotation) named explicitly. F6's threshold (80% of $0.02 = $0.016/sa/day) and qualifier (two consecutive runs) named explicitly.
- Issues found this round: 0 mechanical, 0 directional. (Auto: 6 applied, 0 routed, 1 rejected.)
- File inventory (§3): one new pure test file added (`securityAuditServiceWriteFailureLogPure.test.ts`). One new code-modify row added (`server/services/securityAuditService.ts`). All other rows updated in place.

### 4.7 Round 1 summary

- **Auto-accepted (technical):** 6 applied, 1 rejected, 0 deferred.
- **User-decided:** 0 pending.

Top theme: tight clarifications that close ambiguity in already-good design. ChatGPT's "ready to build" verdict is preserved — no structural changes; six 1-3-line specifications that lock down operational details (what the dev `curl` loop sees, what a sustained audit-DB outage produces, which bucket's headers go on the 429, how a future reader of the test file knows what's asserted, how a future cost-gate failure is diagnosed, how the operator catches drift before the gate fails).

## Round 2 — 2026-05-06T00-30-00Z

### ChatGPT Feedback (raw)

> Looks clean. Round-1 feedback was applied correctly and the F7 rejection is reasonable.
>
> One minor issue in the updated spec: §14 checklist is now stale. It says net-new artifacts are limited to "one CI workflow (L5), one new pure-function test file (L2), and extensions to two existing test files," but §3 now lists multiple new test files and a workflow. Update that checklist line so the pre-review checklist matches the inventory.
>
> Other than that: ready for next review/build pass.

### Triage and Decision

| # | Finding | Triage | Decision | Severity | Rationale |
|---|---------|--------|----------|----------|-----------|
| F9 | §14 pre-review checklist "net-new artifacts" line stale post round-1 — undercounts new pure test files and omits the new operator-runbook.md docs file | mechanical | auto (apply) | low | Pure documentation-consistency fix; the checklist is the auditable record of "no new application primitives" so it must enumerate the actual net-new artifacts. Updated line names all six artifacts (one CI workflow, three new pure test files, two extensions to existing test files, one new docs file) plus their source-of-finding (L1, L2, L2-sub-fix, L3, L4, L5, H4). |

### Auto-execution summary

- **Auto-applied (1):** F9.
- **Auto-rejected (0):** none.
- **Escalated to operator (0):** none.

### Applied (auto-applied technical)

- [auto F9] §14 pre-review checklist — replaced the "net-new artifacts" summary line with an explicit enumeration: one CI workflow (`.github/workflows/optimiser-cost-gate.yml`, L5); three new pure-function test files (`webhookSecretValidatorPure.test.ts` for L1; `requireSubaccountPermissionPure.test.ts` for L2; `securityAuditServiceWriteFailureLogPure.test.ts` for the L2 audit-write-failure observability sub-fix); extensions to two existing test files (`measureInterventionOutcomeJob.idempotency.test.ts` for L4; `rateLimitKeysPure.test.ts` for L3); one new docs file (`operator-runbook.md` for H4). All other changes extend existing files in place.

### Integrity check

- §14 line now matches §3 inventory exactly (cross-checked file by file).
- No other staleness detected.

### Round 2 summary

- **Auto-accepted (mechanical):** 1 applied.
- **User-decided:** 0.

ChatGPT verdict: "Ready for next review/build pass."

## 5. Session close-out

- Round 1: 6 applied, 1 rejected.
- Round 2: 1 applied (mechanical checklist sync).
- Total: 7 applied, 1 rejected.
- ChatGPT verdict: APPROVED both rounds. Round 2 explicit "ready for next review/build pass."
- No further rounds required for this spec on this feedback. Spec status flips to **READY_FOR_BUILD** for the chatgpt-spec-review gate. Next gate: feature-coordinator (Phase 2 build) — note the architect-invocation gap flagged in commit `1d13a97e` (Claude Code web session does not expose the Task/Agent tool needed to invoke the architect sub-agent; operator decision required — run architect playbook inline OR defer plan-phase to a Claude Code CLI session).
