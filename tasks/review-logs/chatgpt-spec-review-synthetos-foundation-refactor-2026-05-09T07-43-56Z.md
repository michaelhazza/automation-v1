# ChatGPT Spec Review Session — synthetos-foundation-refactor — 2026-05-09T07-43-56Z

## Session Info
- Spec: tasks/builds/synthetos-foundation-refactor/spec.md
- Branch: claude/openclaw-worker-mode-VnjQT
- PR: #149 — https://github.com/michaelhazza/automation-v1/pull/149
- Mode: manual
- Started: 2026-05-09T07:43:56Z

---

## Round 1 — 2026-05-09T07-43-56Z

### ChatGPT Feedback (raw)

I'll pressure-test it against internal consistency, buildability, invariants, and hidden implementation traps. I'll focus on things that could cause PR churn or downstream ambiguity rather than wording polish.

I've found a few build-affecting inconsistencies, not just polish. The main pattern is that the spec is strong architecturally, but a few enforcement/default mappings need to be pinned before build.

Thought for 26s

Reviewed the spec. It is close to build-ready, but I would tighten 7 items before locking. Most are consistency issues that could cause builder confusion or PR churn. Review based on the uploaded spec:

Recommendation: Do one final spec pass before acceptance. No fundamental architecture changes needed. These are mostly precision fixes.

#### High-impact fixes

**1. controllerStyle backfill conflicts with native_only default**

The spec says existing rows default to native, existing browser/dev runs can be downgraded to native when the agent is native_only, and native_only is the conservative default. But the backfill later force-updates all historical claude-code, iee_browser, and iee_dev runs to operator. That creates a mismatch: new iee_browser runs under native_only derive to native, historical iee_browser rows backfill to operator. Fix: remove or constrain the backfill. ChatGPT's preference: remove the backfill.

**2. allowed_environments does not match executionMode**

Schema default is `allowed_environments DEFAULT ARRAY['browser', 'api_tool']` but enforcement compares against raw `executionMode` values (`api | headless | claude-code | iee_browser | iee_dev`). Fix: add a closed mapping function `executionModeToEnvironment` (returning `'api_tool' | 'headless' | 'browser' | 'terminal_repo'`). Also reconsider the default — defaulting to only `browser` and `api_tool` may break existing headless agents.

**3. Risk Tier acceptance scenario contradicts preserved gateLevel**

INV-8 says existing gateLevel wins unless policy overrides it, but acceptance scenario 3 says "Tier 6 action without explicit policy override is blocked" — only true for new actions. Fix: rewrite scenario 3 to "New Tier 6 action blocks by default" and add a separate regression scenario for existing-action gate preservation.

**4. Run Trace terminal timestamp is under-specified**

Ordering uses `(timestamp, COALESCE(sequence_number, 0), source_table, source_id)` but `run_terminated.timestamp` source is not pinned. Fix: define `run_terminated.timestamp = agent_runs.terminated_at ?? agent_runs.completed_at ?? agent_runs.updated_at`. Define `late: true` as `event.timestamp > runTerminated.timestamp`.

**5. Policy Envelope failure path needs a hard gate**

Spec says the snapshot is written after creating the run row, but does not say what happens if snapshot resolution fails after the run row exists. Fix: add invariant that no agent loop may start unless snapshot persisted; on failure transition run to `failed` with reason `policy_envelope_resolution_failed`. Add log code `foundation.policy_envelope.resolution_failed`.

**6. CI gate script likely will not run against TS/ESM**

Proposed `node --eval "const reg = require('./server/config/actionRegistry.ts')"` is fragile. Fix: use `tsx scripts/verify-risk-tier-assigned.ts` (matches repo's existing tsx pattern in `verify-visibility-parity.sh`).

**7. Credential facade migration should include a guard against new direct calls**

Spec says new callers must use CredentialBrokerService but no static guard enforces it. Fix: add a lightweight grep gate or strengthen the acceptance item. Optional script: `scripts/verify-no-direct-credential-service-calls.sh`. Can be advisory in Phase 1.

#### Medium-value polish

**8. Do not ship a dead "Coming soon" details link**

The Run Trace headline "Details" link is deferred to Phase 1.5 but the link is still present and reads "Coming soon." Violates the default-hidden / one-primary-action discipline. Fix: hide the link entirely until Phase 1.5, or show it only behind a disabled tooltip.

**9. Acceptance should mention subaccount_constraint source explicitly**

Because subaccount_constraint is applied after pure deriveGateLevel, add acceptance checks that prove `riskTier > max_risk_tier` becomes block, `riskTier >= require_approval_at_tier` upgrades auto to review, and Run Trace payload reports `gateLevelSource: 'subaccount_constraint'`.

**10. Lock the allowed_environments enum**

The spec closes `controller_style` and `controller_style_allowed`, but does not close `allowed_environments`. Add: `allowed_environments` is closed to `'api_tool' | 'headless' | 'browser' | 'terminal_repo'`.

#### Verdict

Not blocked architecturally. Do not start build until the 7 high-impact fixes are applied.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: controllerStyle backfill drop | technical | apply | auto (apply) | medium | Spec already says historical accuracy is low value; default `controller_style_allowed = 'native_only'` would no-op the backfill in practice; dropping resolves the contradiction with no UI/data downside. Cleaned §3.6 execution-safety table, §6.4 backfill jobs table, §10 risk-register row. |
| F2: allowed_environments mapping + default reconsider | technical-escalated (severity high) | apply (combined fix) | apply (user said "as recommended") | high | Mapping function `executionModeToEnvironment` added in §4.2.8 (closed enum, exhaustiveness check). Schema default broadened to `['api_tool', 'headless', 'browser']` to preserve backward compatibility with existing headless agents. UI mockup §5.2.3 updated to show the three checked defaults. New shared type file + test added to §4.2.9 code-change table and §7.2 test inventory. |
| F3: Tier 6 acceptance scenario wording | technical | apply | auto (apply) | medium | Rewrote acceptance scenario 3 → "New Tier 6 action blocks by default"; added scenario 4 (existing-action gate preservation regression for INV-8) and scenario 5 (subaccount_constraint regression — also closes F9). Total scenarios in §7.6 grew from 5 to 7; updated §9.2 and §8.6 references. |
| F4: Run Trace terminal timestamp pin | technical | apply | auto (apply) | medium | Verified schema has `completedAt` and `updatedAt`, no `terminated_at`. Pinned terminal timestamp to `completed_at ?? updated_at` in §4.4.4 + late-event predicate `event.timestamp > runTerminated.timestamp`. Mirrored short version in §3.6 terminal-event paragraph. |
| F5: Policy Envelope failure hard gate | technical-escalated (severity high) | apply | apply (user said "as recommended") | high | New invariant INV-19 added to §3.3 — no agent loop starts without successfully persisted snapshot; failure transitions run to `failed` with reason `policy_envelope_resolution_failed`. New log code added to §3.5. Implementation sketch in §4.5.6 expanded with try/catch + re-read failure path + `transitionRunToFailed` call. INV-6 NULL-tolerance reconciled via "INV-19 governs new runs only" clause. §9.4 acceptance now lists seven log codes. |
| F6: CI gate script TS loader fix | technical | apply | auto (apply) | medium | Replaced broken `node --eval require('./....ts')` with bash wrapper + `npx tsx scripts/verify-risk-tier-assigned.ts` harness (matches `verify-visibility-parity.sh` precedent). New `.ts` harness file added to §4.2.9 code-change table. |
| F7: Credential facade direct-call guard | technical | apply (advisory deferral) | auto (apply) | medium | Added `verify-no-direct-credential-service-calls.sh` to §11 deferred items as advisory gate sketch (matches existing `verify-controller-style-mapping.sh` treatment). Phase 1 advisory; promoted to hard gate in Phase 1.5 if drift observed. |
| F8: "Coming soon" link UI noise | user-facing | apply (hide link entirely) | apply (user said "as recommended") | low | §5.1.4 rewritten — Phase 1 omits the link entirely (no placeholder, no disabled element). §11 deferred-items entry updated to indicate both link and panel ship together in Phase 1.5. |
| F9: subaccount_constraint source acceptance scenarios | technical | apply | auto (apply) — covered by F3 edit | medium | Combined into §7.6 scenario 5 added by F3 (single edit, three sub-checks). No separate edit needed. |
| F10: Lock allowed_environments enum | technical | apply | auto (apply) | medium | Closure paragraph in §3.6 extended to include `allowed_environments` with the four-value closed enum; notes that closure is enforced in code (Zod / TypeScript) rather than at the Postgres `text[]` layer. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] **F1** Dropped retroactive `controller_style` backfill in §4.1.8; cleaned §3.6 execution-safety table, §6.4 backfill jobs table, §10 risk-register row to match the forward-only posture.
- [auto] **F3** Rewrote §7.6 acceptance scenarios — split scenario 3 into "new Tier 6 blocks" + new "existing-action gate preservation" regression (INV-8) + new "subaccount_constraint" regression (covers F9). Updated §9.2 and §8.6 to reference the seven scenarios.
- [auto] **F4** Pinned `run_terminated.timestamp` to `agent_runs.completed_at ?? agent_runs.updated_at` in §4.4.4 + §3.6; defined `late: true` predicate as `event.timestamp > runTerminated.timestamp`.
- [auto] **F6** Replaced broken `node --eval` with `npx tsx` harness in §4.2.7; added new `scripts/verify-risk-tier-assigned.ts` row to §4.2.9 code-change table.
- [auto] **F7** Added `verify-no-direct-credential-service-calls.sh` advisory gate sketch to §11 deferred items.
- [auto] **F9** Covered by F3 edit (same row).
- [auto] **F10** Extended §3.6 closure paragraph with `allowed_environments` enum closure.
- [user] **F2** Added closed `ExecutionEnvironment` enum + `executionModeToEnvironment` mapping function in §4.2.8 with exhaustiveness check; broadened §5.2.9 schema default from `['browser', 'api_tool']` to `['api_tool', 'headless', 'browser']` to preserve backward compat with existing headless agents; added inline schema comment + §8.3 rollout note explaining the broadening; updated §5.2.3 UI mockup; added new shared type file + test to §4.2.9 and §7.2 inventories.
- [user] **F5** Added INV-19 in §3.3 (no agent loop without persisted snapshot; failure → run.status = failed); added new log code `foundation.policy_envelope.resolution_failed` to §3.5; expanded §4.5.6 implementation sketch with try/catch + re-read failure path; updated §9.4 acceptance to list seven log codes.
- [user] **F8** Removed the Phase-1 "Coming soon" link entirely from §5.1.4; updated §11 deferred-items entry to ship link + panel together in Phase 1.5.

### Integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Rationale: cross-checked closure rule (§3.6), mapping function (§4.2.8), schema default (§5.2.9), UI mockup (§5.2.3), code-change table (§4.2.9), test inventory (§7.2), and rollout doc (§8.3) for `allowed_environments` — internally consistent. Cross-checked terminal timestamp short version (§3.6) and full pin (§4.4.4) — consistent. Cross-checked INV-19 (§3.3), new log code (§3.5), implementation sketch (§4.5.6), acceptance count (§9.4) — consistent. INV-19 vs INV-6 NULL-tolerance reconciled explicitly via "INV-19 governs new runs only" clause. F1 backfill removal cleaned in three places (§3.6, §6.4, §10).

---

## Round 2 — 2026-05-09T08-01-19Z

### ChatGPT Feedback (raw)

Round 2 looks materially stronger. The seven previous blockers were addressed cleanly. I would not run another broad review loop. I'd apply 3 small final tightenings, then lock.

Verdict: Ready to lock after minor patch. No architectural blockers remain. The remaining items are precision fixes to prevent builder interpretation drift.

**Final tightenings**

1. **Fix `controller_style_decided` payload source union** — In §4.1.6 `ControllerStyleSource` includes `'override' | 'execution_mode_default' | 'subaccount_constraint'` but the Run Trace event type in §4.4.4 only allows `'override' | 'execution_mode_default'`. That omits the downgrade path added for `native_only`. Add `'subaccount_constraint'` to the union.

2. **Pin `foundation.controller_style.rejected` vs environment rejection naming** — §4.2.8 currently says environment rejection emits `foundation.controller_style.rejected`, but the rejected field is `executionMode | ExecutionEnvironment`, not controller style. Semantically muddy. Preferred fix: add a separate `foundation.execution_environment.rejected` log code with payload `{ runId, agentId, executionMode, executionEnvironment, allowedEnvironments, reason: 'execution_mode_not_allowed_for_agent' }`. Update §3.5 and §9.4 log-code count from 7 to 8. Alternative: rename to a broader governance rejection event. ChatGPT prefers the separate code.

3. **Clarify failure headline for Policy Envelope resolution failure** — §4.5.6 says envelope failure transitions the run to failed but the headline reads "blocked by policy" or equivalent. That confuses operators because the failure is infrastructure/config, not policy. Fix: reserve "blocked by policy" for actual policy decisions; use "Native/Operator run · failed before execution · $0.00" for the INV-19 fail-closed path. Optional detail: "Policy settings could not be resolved, so the run was stopped before any tools or model calls executed."

**Smaller optional improvement**

Add `allowed_environments` validator to acceptance: an acceptance checkbox stating "Application-layer validation rejects any `allowed_environments` value outside `'api_tool' | 'headless' | 'browser' | 'terminal_repo'` on create/update." Avoids relying on the prose-only closure.

**Lock recommendation**

Apply the three final tightenings above. Then mark the spec accepted and move to build planning. Would not ask for another full review unless these edits introduce new structural changes.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| R2-1: ControllerStyleSource union mismatch in §4.4.4 event payload | technical | apply | apply (user delegated decision: "decide what to implement from here and then finalise") | medium | Pure type-consistency fix; missing third union value would cause TypeScript to reject the downgrade event the spec already specifies in §4.1.6 |
| R2-2: Separate `foundation.execution_environment.rejected` log code | technical | apply (per ChatGPT's preferred fix) | apply (user delegated) | medium | INV-16 says log codes are stable consumer contracts; overloading a single code for two distinct rejection classes complicates dashboards and search. Separate code is cleaner. Updated §3.5 (added the new code) + §4.2.8 (enforcement reference) + §9.4 (count 7 → 8) |
| R2-3: Failure-headline copy distinction | user-facing | apply | apply (user delegated decision; ChatGPT's wording adopted verbatim) | medium | Headline copy is non-technical-operator-facing. ChatGPT's "failed before execution" wording is more accurate than "blocked by policy" for the INV-19 fail-closed path. §4.5.6 failure-path observability paragraph rewritten + §5.1.3 headline variations extended with two new lines |
| R2-Optional: Application-layer validator for `allowed_environments` | technical | apply | apply (user delegated) | low | Closure paragraph in §3.6 is prose-only because the column is `text[]`. Acceptance checkbox in §9.1 makes the runtime backstop a durable verification item |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] **R2-1** Added `'subaccount_constraint'` to the `controller_style_decided` event payload source union in §4.4.4.
- [auto] **R2-2** Added `foundation.execution_environment.rejected` to §3.5 with payload schema; rewrote §4.2.8 enforcement reference to use the new code; updated §9.4 acceptance to list eight log codes.
- [auto] **R2-Optional** Added application-layer validator acceptance checkbox to §9.1 anchored on §3.6 closure rule.
- [user-delegated] **R2-3** Replaced the "blocked by policy or equivalent" headline copy in §4.5.6 with explicit "failed before execution" rule; added two new headline variations to §5.1.3 with cross-reference notes pinning each copy to its trigger condition.

### Integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Rationale: cross-checked log-code count (§3.5 8 entries; §9.4 8 listed) — consistent. Cross-checked `controller_style_decided` source union (§4.1.6 type union, §4.4.4 payload union) — now match. Cross-checked headline copy rules (§4.5.6 prohibits "blocked by policy" for envelope failure; §5.1.3 reserves "blocked by policy" for policy decisions, adds "failed before execution" for envelope failure) — consistent and non-overlapping. The R2-2 separation cleanly partitions controller-style-rejection (`foundation.controller_style.rejected`) from environment-rejection (`foundation.execution_environment.rejected`); §4.2.8 enforcement now references the correct code.

