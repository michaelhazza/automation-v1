# ChatGPT Spec Review Session — oss-pattern-lifts-bundle — 2026-05-18T12-58-54Z

## Session Info
- Spec: `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
- Branch: `spec-review/oss-pattern-lifts-bundle`
- PR: #355 — https://github.com/michaelhazza/automation-v1/pull/355
- Mode: manual
- Started: 2026-05-18T12:58:55Z
- **Verdict:** APPROVED (2 rounds — Round 1 cleared 5 operator-mandated findings + 3 delegated-routed, Round 2 cleared the remaining 3 technical fixes)

---

## Round 1 — 2026-05-18T12-58-54Z

### ChatGPT Feedback (raw)

ChatGPT response captured externally — operator pasted nine numbered findings (F1–F9) with explicit instruction: "fix findings 1, 2, 3, 4, and 5 before plan-gate. Route 6, 7, 8, 9 as you see fit." Overall verdict: CHANGES_REQUESTED.

Verbatim findings (preserved for audit):

- **F1 (high / implementation readiness)** — Migration number likely stale / collision-prone. Spec hard-codes `0378_waitpoints_primitive.sql`; require pre-implementation migration-number collision check before committing.
- **F2 (high / architecture)** — Approval waitpoint stores plaintext token but no consumer path needs user-entered token. Plaintext acts as long-term internal secret. Prefer storing only the waitpoint hash/id reference on the action, or make explicit why plaintext is required.
- **F3 (medium / clarity)** — `resume_queue` is misleading for approval waitpoints (`'workflow-resume'` stored but spec says completion must not enqueue it). Rename to nullable `resume_queue`, require null for approval, or add CHECK/contract.
- **F4 (medium / bug)** — Telemetry §9 ("all events emit to live execution log when bound_run_id is set") conflicts with §7.3 ("approval events carry actionId and stepRunId instead of runId"). Define where approval telemetry goes, or explicitly say structured-log only.
- **F5 (high / architecture)** — §5.3 says to replicate `failStepRunInternal` column writes manually under admin role — brittle. Require reuse/extraction of shared helper, or add acceptance criterion verifying replicated column set exactly matches the helper.
- **F6 (medium / improvement)** — No DB CHECK enforces oauth `bound_run_id` requirement. Add `(kind <> 'oauth' OR bound_run_id IS NOT NULL)`.
- **F7 (low / clarity)** — `completeWaitpoint(token, payload)` from the brief became `completeWaitpoint({ plaintext, organisationId })` with no completion payload. Note this deliberate narrowing.
- **F8 (medium / implementation readiness)** — Pure tests won't cover DB transactionality / idempotent completion / admin-role expiry SQL. Add static grep gates or minimal SQL-level verification scripts.
- **F9 (low / clarity)** — Deferred cleanup says remove `agentResumeService.resumeFromIntegrationConnect`, but §7.2 keeps the route delegating to that method under the flag. Cleanup should say "remove or simplify legacy implementation".

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1 — Migration number collision | technical | apply | auto (apply) | high | Real collision: `0378_vision_inference_calls.sql` already on `main`. Switched §4.1, §12 manifest, §13 to `<NNNN>` placeholder per `DEVELOPMENT_GUIDELINES.md §6.2`. Operator-mandated. |
| F2 — Plaintext stored long-term for approval | technical | apply | auto (apply) | high | Internal contract decision, no user surface impact. Introduced dual input shape on `completeWaitpoint` (`{plaintext}` for OAuth, `{waitpointId}` for internal kinds). `createWaitpoint` returns `{id, plaintext, expiresAt}`; approval persists `id` in `actions.metadataJson.waitpointId` and discards plaintext. Operator-mandated. |
| F3 — `resume_queue` misleading for approval | technical | apply | auto (apply) | medium | Schema-clarity fix. Made `resume_queue` nullable; added CHECK constraints `kind <> 'oauth' OR resume_queue IS NOT NULL` and `kind <> 'approval' OR resume_queue IS NULL`. Service-layer validator catches violations earlier. §7.3 approval create site now passes `resumeQueue: null`. Operator-mandated. |
| F4 — Telemetry conflict on approval events | technical | apply | auto (apply) | medium | Internal observability contract. Rewrote §9 routing: live-execution-log iff `bound_run_id IS NOT NULL`; otherwise structured-log-only. Approval events explicitly structured-log-only in V1 (no `runId` field — carries `actionId/stepRunId/workflowRunId`). Operator-mandated. |
| F5 — Manual replication of `failStepRunInternal` columns | technical | apply | auto (apply) | high | Brittle column-set duplication. Extracted `buildFailStepRunColumnSet(reason, currentVersion, now)` into new `stepLifecyclePure.ts`; both `stepLifecycle.failStepRunInternal` AND `waitpointService.expireWaitpoints` consume it. Column-parity unit test pins the live shape so future writers either update the helper or fail CI. Added new files to §13 inventory (file count 7→9; modified 12→13). Operator-mandated. |
| F6 — No DB CHECK for oauth `bound_run_id` | technical | apply | auto (apply) | medium | Pure schema hardening; defence-in-depth alongside service-layer validation. Added CHECK `kind <> 'oauth' OR bound_run_id IS NOT NULL` to §4.1. |
| F7 — Note completion-payload narrowing | technical | apply | auto (apply) | low | One-paragraph clarification in §5.2 before the dual-shape discussion. Lists the brief's `payload` argument as deliberate omission and points future expansion at create-time `resumePayload` instead. |
| F8 — Testing posture too light for transactional behaviour | technical | defer | auto (defer) — escalated per carveout, operator pre-authorised | medium | Adding SQL-level / integration gates would contradict `docs/spec-context.md`'s `runtime_tests: pure_function_only` and `convention_rejections`. F6 (DB CHECK) and F5 (pure helper) already strengthen the static surface. Routed to `tasks/todo.md § Spec Review deferred items / oss-pattern-lifts-bundle (2026-05-18)` tagged `[auto]`. Trigger to revisit: `testing_posture` flip in `spec-context.md`. Per rules, technical-defer is an escalation carveout; operator pre-authorised "as you see fit" for F6–F9. |
| F9 — Cleanup list over-specific | technical | apply | auto (apply) | low | Softened §17 wording: `agentResumeService.resumeFromIntegrationConnect` is "simplified, not necessarily removed" — implementer's choice based on call-site count at cleanup time. |

### Applied (auto-applied technical)

- [auto] **F1** — switched `0378_waitpoints_primitive.sql` to `<NNNN>` placeholder in §4.1, §12 manifest, §13 file inventory; added merge-time renaming note.
- [auto] **F2** — restructured §5.2 `completeWaitpoint` to dual input shape (`{plaintext}` | `{waitpointId}`); extended §5.1 return to `{id, plaintext, expiresAt}`; §7.3 approval create site now persists `id` not plaintext; §8.1 rewritten for kind-split persistence rule.
- [auto] **F3** — §4.1 `resume_queue` nullable + per-kind CHECK constraints; §7.3 approval create passes `resumeQueue: null`; §8.2 row contract updated; §8.4 Path B clarification rewritten; service-layer validator extended; type signature updated.
- [auto] **F4** — §9 rewritten with two-target routing table; structured-log-only stance for approval explicit; §5.1 emission rule reworded.
- [auto] **F5** — extracted `buildFailStepRunColumnSet` pure helper; refactored `failStepRunInternal` consumer; added `stepLifecyclePure.ts` + parity test to §13 inventory; updated Chunk 2 in §14 sequencing; §13 totals 9/13 (was 7/12); §18 self-consistency reconciled.
- [auto] **F6** — added CHECK `kind <> 'oauth' OR bound_run_id IS NOT NULL` to §4.1.
- [auto] **F7** — added "Deliberate narrowing from the brief" paragraph before §5.2 dual-shape section.
- [auto] **F9** — softened §17 old-path cleanup wording for `agentResumeService.resumeFromIntegrationConnect`.

### Deferred (routed to tasks/todo.md)

- [auto] **F8** — see `tasks/todo.md § Spec Review deferred items / oss-pattern-lifts-bundle (2026-05-18)`.

### Integrity check

One pass run after applying edits. Three issues found, all auto-fixed mechanically (still under the F1–F7/F9 umbrella, no new findings beyond the original triage):

- §12 RLS checklist still referenced `0378_waitpoints_primitive.sql` literal — fixed to `<NNNN>` placeholder.
- §5.1 emission rule "if `boundRunId` is set" contradicted the new §9 always-emit-but-route policy — reworded to "always emit; route per §9".
- Line 280 referenced the legacy `workflow-resume` queue's optional/required field semantics as if it were the consumer of the approval payload — clarified that `workflow-resume` is NOT dispatched by approval waitpoints in V1 (Path B reaffirmation); `workflowStepRunId` is REQUIRED so the §5.3 sweep can act on timeout.

No second integrity pass required (recursion guard). Post-integrity sanity (4c) clean: no broken headings, no empty sections.

**Integrity check: 3 issues found this round (auto: 3, escalated: 0).**

### Round summary

Auto-accepted (technical): 8 applied, 0 rejected, 1 deferred.
User-decided: 0 applied, 0 rejected, 0 deferred — operator pre-authorised the F1–F5 batch and delegated F6–F9 routing with "as you see fit".

---

## Round 2 — 2026-05-18T13:30:00Z (approx — second pass after Round 1 commit)

### ChatGPT Feedback (raw)

ChatGPT re-reviewed the updated spec after Round 1's edits committed. Overall verdict: **CHANGES_REQUESTED** — 3 remaining findings, all technical, all auto-applicable. No new directional questions.

Verbatim findings (preserved for audit):

- **R2-F1 (high / consistency)** — Stale migration number in §14 Chunk 1. §4.1 and §13 correctly use `<NNNN>_waitpoints_primitive.sql` placeholder after Round 1's F1 fix, but §14 Chunk 1 still hard-codes `migration 0378`. Fix §14 to use the same placeholder wording.

- **R2-F2 (medium / edge case)** — Expired-but-unswept completion case needs explicit mapping. `completeWaitpoint` handles 0-row update by reading `status`, but a row can be `pending` with `expires_at <= now()` before the 5-minute sweep marks it. The optimistic `UPDATE WHERE status='pending' AND expires_at > now()` returns 0 rows in this case, the row is still `status='pending'`, and the current §5.2 maps only `status='completed'` → `already_completed` and `status='expired' or missing` → 410. Add explicit mapping for `status='pending' AND expires_at <= now()` → HTTP 410 `RESUME_TOKEN_EXPIRED` (de-facto expired regardless of sweep).

- **R2-F3 (low / implementation readiness)** — OAuth resumeQueue needs runtime non-null assertion. DB CHECK guarantees `resume_queue IS NOT NULL` for `kind='oauth'`, but TypeScript sees `string | null`. Add a fail-closed guard in the OAuth branch of `completeWaitpoint` before calling `getJobConfig(resumeQueue)` / `sendWithTx`. If `resumeQueue` is null at runtime (defensive check), throw a server error rather than passing null to `sendWithTx`.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| R2-F1 — Stale `0378` migration ref in §14 | technical | apply | auto (apply) | high | Mechanical placeholder propagation. §4.1, §12 manifest, §13 file inventory already use `<NNNN>` placeholder; §14 Chunk 1 missed the sweep. Fixed in same wording: `<NNNN>_waitpoints_primitive.sql (number is a placeholder claimed at merge time per §4.1)`. |
| R2-F2 — Pending-but-unswept completion mapping | technical | apply | auto (apply) | medium | Edge case is real per §8.4 source-of-truth precedence (`status='pending' AND expires_at < now()` is "effectively expired"). Rewrote §5.2 "0 rows updated" into a closed-set mapping with four explicit branches: `completed` → 200 already_completed; `expired` → 410; `pending AND expires_at <= now()` → 410 (de-facto expired); row missing → 410. Also updated §15.1 idempotency entry to match. No special-case branch surfaces the unswept timing window — caller experience identical. |
| R2-F3 — OAuth resumeQueue null-guard | technical | apply | auto (apply) | low | TS sees `string \| null` despite the §4.1 CHECK. Added fail-closed guard in §5.2 oauth branch: assert `row.resumeQueue !== null` and `throw failure('INTERNAL_ERROR', '<msg>')` (corrected from initially-drafted `INTERNAL_STATE_INVARIANT` — the integrity-check pass found that code is not in `shared/types/errorCodes.ts`; `INTERNAL_ERROR` is canonical). Treats invariant violation as fail-closed; silent default-queue coercion is a worse failure mode. |

### Applied (auto-applied technical)

- [auto] **R2-F1** — §14 Chunk 1 row updated to use `<NNNN>_waitpoints_primitive.sql` placeholder wording, parenthetical pointer to §4.1.
- [auto] **R2-F2** — §5.2 "0 rows updated" bullet rewritten as an explicit closed-set mapping with four branches; cross-reference to §8.4 source-of-truth precedence. §15.1 idempotency entry updated to point at the same closed-set mapping and explicitly call out unswept-but-expired treatment.
- [auto] **R2-F3** — §5.2 oauth branch extended with a `Runtime non-null guard` paragraph naming the CHECK constraint as the source-of-truth, the TS nullability gap, and the fail-closed throw before `getJobConfig` / `sendWithTx`. Uses `INTERNAL_ERROR` from `shared/types/errorCodes.ts`.

### Integrity check

One pass run after applying edits. One issue found and auto-fixed mechanically:

- §5.2 R2-F3 initially specified `failure('INTERNAL_STATE_INVARIANT', ...)`, but a code-check against `shared/types/errorCodes.ts` showed that code does not exist in the registry (line 91 has `INTERNAL_ERROR`; nothing matches `INTERNAL_STATE_INVARIANT`). The spec was using `failure()` as a helper that takes codes from `errorCodes.ts` (e.g. the existing `VALIDATION_FAILED` usage in §5.1 matches line 178), so the new throw site MUST use a valid registered code. Replaced with `INTERNAL_ERROR` + a descriptive message.

No second integrity pass required (recursion guard). Post-integrity sanity (4c) clean: no broken headings, no empty sections, no dangling cross-references after the placeholder propagation.

**Integrity check: 1 issue found this round (auto: 1, escalated: 0).**

### Round summary

Auto-accepted (technical): 3 applied, 0 rejected, 0 deferred.
User-decided: 0 applied, 0 rejected, 0 deferred — all three findings triaged technical; R2-F3 the only one with severity-low/non-trivial fix surface, all under the auto-execute path per spec-review rules.

---

## Final Summary

- **Rounds:** 2
- **Auto-accepted (technical):** 11 applied | 0 rejected | 1 deferred
  - Round 1: 8 applied (F1, F2, F3, F4, F5, F6, F7, F9), 0 rejected, 1 deferred (F8)
  - Round 2: 3 applied (R2-F1, R2-F2, R2-F3), 0 rejected, 0 deferred
- **User-decided:** 0 applied | 0 rejected | 0 deferred — operator pre-authorised F1–F5 and delegated F6–F9 routing with "as you see fit"; Round 2 was all-technical
- **Index write failures:** 0
- **Consistency check:** clean — no contradictory decisions across rounds. Round 2 R2-F1 propagated the Round 1 F1 placeholder to a missed reference site (additive, not contradictory). Round 2 R2-F2 extended the Round 1-touched §5.2 mapping with a previously-unenumerated branch (additive). Round 2 R2-F3 hardened the Round 1 F2-restructured OAuth branch with a defensive null-guard (additive).
- **Implementation readiness checklist:** all five clean
  - Inputs defined: yes (§5.1, §5.2, §6)
  - Outputs defined: yes (§5.1, §8.1, §8.2, §8.3)
  - Failure modes covered: yes (§5.2 closed-set mapping post-R2-F2; §15)
  - Ordering guarantees explicit: yes (§14 chunk deps verified, §11 execution model)
  - No unresolved forward references: yes (R2-F1 placeholder propagation complete; full grep-sweep verified)
- **Deferred to `tasks/todo.md` § Spec Review deferred items / oss-pattern-lifts-bundle (2026-05-18):**
  - [auto] Stronger transactionality / admin-role SQL verification gates (F8) — already in `tasks/todo.md` from Round 1. Reason: posture-blocked by `static_gates_primary`; revisit on `testing_posture` flip.
- **KNOWLEDGE.md updated:** yes (3 entries: "DB CHECK constraint vs TypeScript nullability — runtime null-guard at fail-closed boundaries"; "migration-number placeholders must propagate everywhere the migration is named, including downstream sections"; "closed-set mapping for state-row predicates (avoid 'default to 410' silent branches)")
- **architecture.md updated:** no — checked `waitpoint`, `waitpointService`, `WAITPOINT_PRIMITIVE_ENABLED`, `agent-run-resume-from-waitpoint`, `waitpoint-expiry-sweep`, `buildFailStepRunColumnSet`, `stepLifecyclePure`, `oss-pattern-lifts`; zero hits in `architecture.md`. The spec's own Chunk 7 (per §13 file inventory) handles the architecture.md waitpoint section at build time — spec-review is description-of-work, not record-of-shipped-work. Current `architecture.md:4015` integration-resume description remains accurate until the cleanup PR ships.
- **capabilities.md updated:** n/a: docs-only change
- **integration-reference.md updated:** n/a — no integration scope, status, write-capability, OAuth provider, MCP preset, capability slug, or alias change. Spec touches OAuth resume internals (a primitive) but doesn't change integration-reference's domain.
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** no — checked `waitpoint`, `waitpointService`, `RESUME_TOKEN_EXPIRED`, `WAITPOINT_PRIMITIVE_ENABLED`; zero stale references. No new build-discipline rule, no convention change, no agent-fleet change introduced by these edits.
- **spec-context.md updated:** no — current framing (pre-production, `static_gates_primary`, `runtime_tests: pure_function_only`) applies cleanly. F8 deferral explicitly cited this file's `convention_rejections`. `last_reviewed_at: 2026-05-11` is within the 60-day staleness window.
- **frontend-design-principles.md updated:** n/a — backend primitive, no UI surface.
- **PR:** #355 — https://github.com/michaelhazza/automation-v1/pull/355
