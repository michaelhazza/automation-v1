# ChatGPT Spec Review Session — agentic-commerce — 2026-05-03T06-56-32Z

## Session Info
- Spec: `tasks/builds/agentic-commerce/spec.md`
- Branch: `claude/agentic-commerce-spending`
- PR: #255 — https://github.com/michaelhazza/automation-v1/pull/255
- Mode: manual
- Started: 2026-05-03T06:56:32Z

---

## Round 1 — 2026-05-03T06:56:32Z

### ChatGPT Feedback (raw)

> Here's a final spec-review pass focused on correctness, edge-case gaps, and build-risk. Overall this is very strong and implementation-ready, but there are a few non-obvious risks and inconsistencies worth fixing before locking.
>
> **Executive Summary**
> Spec quality: High. Clear invariants, strong state machine, good separation of pure/impure.
> Biggest risks:
> - Worker-hosted execution path ambiguity around Stripe vs non-Stripe merchants
> - Idempotency + worker completion race conditions
> - Approval + execution timing edge collisions
> - Ledger vs aggregate consistency under rare sequences
>
> Fixing these now will prevent painful post-launch bugs.
>
> **1. Critical Issues (Fix before build)**
> - 1.1 Worker-hosted-form + Stripe model is slightly contradictory — ChatGPT proposes `execution_source: 'stripe' | 'merchant_form'` discriminator on the ledger row.
> - 1.2 Worker completion vs webhook race condition — ChatGPT proposes WorkerSpendCompletion may only set `provider_charge_id` OR transition `executed → failed`; webhook always wins for `executed → succeeded`.
> - 1.3 Idempotency hole on worker retries — ChatGPT proposes invariant that args used in idempotency must be strictly canonical and deterministic, or call must fail; alternatively whitelist-hash specific fields.
> - 1.4 Approval + execution window collision — ChatGPT proposes resetting `expires_at` fresh at `pending_approval → approved`, not reusing the original window.
> - 1.5 "executed" state meaning is overloaded — ChatGPT proposes `execution_path: 'main_app_stripe' | 'worker_hosted_form'` and `execution_state: 'initiated' | 'awaiting_confirmation'`.
>
> **2. Important Improvements (Should fix)**
> - 2.1 Spend aggregation timing edge — Document explicitly that aggregates reflect settled spend only.
> - 2.2 Kill switch + race condition — Re-check kill switch immediately before execution step.
> - 2.3 Approval channel race visibility — Explicit invariant that every channel response (responder, timestamp, channel) is stored on `actions`.
> - 2.4 Shadow vs live response inconsistency (minor) — Unify response: `{ outcome: 'success', mode: 'shadow' | 'live', ... }`.
>
> **3. Minor Gaps / Clarifications**
> - 3.1 Currency enforcement — `charge.currency === budget.currency` should be invariant.
> - 3.2 Negative or zero amounts — Enforce positive integer at schema or guard level.
> - 3.3 Merchant allowlist normalization — Define trimming, punctuation removal, unicode handling.
> - 3.4 Retry semantics UX — Explicitly require UI grouping behaviour by `intent_id`.
>
> Bottom Line: very close to "build with confidence."
> Must-fix before locking: 1.1, 1.2, 1.3, 1.4
> Strongly recommended: 1.5, 2.1, 2.2

### Triage rationale (preamble)

The Phase-1 spec has been through 5 rounds of spec-reviewer (Codex). The deep state-machine semantics, three-table approval model, and append-only ledger are already locked in. Round 1 ChatGPT feedback re-raises some areas that overlap with already-resolved Codex iterations (the `executionPath` field, terminal-state semantics) and surfaces three genuinely new gaps:

1. Webhook-vs-WorkerSpendCompletion precedence under race (no explicit invariant)
2. `expires_at` reset on the HITL `pending_approval → approved` path (spec says "set at proposed → approved", silent on the HITL path)
3. Kill switch re-check immediately before Stripe execution (spec only lists kill switch as a propose-time gate)

Plus 4 small but real invariant gaps: currency match, positive-amount CHECK constraint, merchant-descriptor normalisation algorithm, settled-vs-in-flight aggregate clarity.

Two findings (1.1 add `execution_source`, 1.5 add `execution_state`) are duplicative with the existing `executionPath` discriminator on `ActionDefinition` — recommended REJECT but surfaced because ChatGPT classed them critical.

One finding (2.4 unify shadow/live response) is a directional API-design preference. The spec's existing two-discriminator pattern (`executed` vs `shadow_settled`) is intentional for log/audit observability, with a strong "callers must not branch on mode" rule. Recommended REJECT.

One finding (3.4 UI grouping) is user-facing — a UX rule for the Spend Ledger dashboard. Surfaced for operator decision.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1.1 | Worker-form vs Stripe contradiction (add `execution_source` ledger column) | technical | reject | _pending operator_ | critical | Spec already discriminates via `executionPath` on `ActionDefinition` (§6.1, §7.1); SPT-only model (§7.4) means Stripe is always the financial source of truth. Adding a column is duplicative. Surfaced for severity-carveout ack. |
| 1.2 | Worker completion vs webhook race | technical | apply | _pending operator_ | high | Real gap — spec doesn't explicitly state webhook-wins precedence. Trigger restricts WorkerSpendCompletion to `executed`-state rows (§5.1), but the invariant isn't surfaced as a rule. |
| 1.3 | Idempotency hole on worker retries (args drift) | technical | apply | _pending operator_ | high | Real gap — spec relies on `canonicaliseJson` but does not name "deterministic-args invariant" for spend-enabled skills. Lighter fix (invariant + convention) preferred over whitelist hashing for v1. |
| 1.4 | Approval + execution window collision (`expires_at` reset) | technical | apply | _pending operator_ | high | Real gap — §4 says "set at `proposed → approved`" but is silent on `pending_approval → approved`. Without reset, an HITL-approved charge could enter `approved` with an already-passed window. |
| 1.5 | "executed" overloaded (add `execution_state`) | technical | reject | _pending operator_ | critical (per ChatGPT) | Existing `executionPath` + `provider_charge_id` nullability already discriminates. Adding `execution_state` is duplicative. Will instead add a clarifying paragraph in §6.1 explaining that `executed` means the same thing on both paths (external action initiated, awaiting webhook). |
| 2.1 | Aggregation: settled vs in-flight | technical | apply | auto (apply) | medium | Real clarification gap — §7.6 doesn't explicitly say aggregates reflect settled spend only. Operator UX risk is real; cheap to clarify. |
| 2.2 | Kill switch race (re-check before execution) | technical | apply | _pending operator_ | high | Real gap — spec only lists kill-switch as a propose-time gate. Without re-check between policy resolution and Stripe call, a fire-while-in-flight kill switch leaks one charge through. |
| 2.3 | Approval channel audit trail | technical | apply | auto (apply) | medium | Spec already captures this implicitly via `actions.responseStatus = 'superseded'` (§9.3) — making it an explicit invariant in §10 closes the doc gap. |
| 2.4 | Unify shadow/live response shape | technical | reject | auto (reject) | low | Two-discriminator pattern is intentional. The "must not branch on mode" rule is a coding discipline; the discriminator gives free observability in logs and event streams. Unifying removes signal. |
| 3.1 | Currency enforcement (`charge.currency === budget.currency`) | technical | apply | auto (apply) | medium | Real invariant gap — never explicitly enforced. Add to §10 + reject path in `chargeRouterServicePure.evaluatePolicy`. |
| 3.2 | Positive-amount CHECK | technical | apply | auto (apply) | medium | Real schema gap — `amount_minor integer NOT NULL` lacks `CHECK (amount_minor > 0)`. Trivial DB-level fix. |
| 3.3 | Merchant allowlist normalisation algorithm | technical | apply | auto (apply) | medium | Real spec gap — "uppercase normalised" is mentioned but the algorithm isn't defined. Locking now prevents drift. |
| 3.4 | Retry UX grouping by `intent_id` | user-facing | apply | _pending operator_ | low | UI/UX behaviour for the Spend Ledger dashboard — operator-visible. Already mentioned in §16.1 ("`intent_id` groups retries in the UI") but not enforced as a Chunk 14 deliverable. |

### Auto-applied (this round, before operator gate)

These were auto-executed per the agent's `technical` triage rule (severity ≤ medium, not escalation-carveout):
- [auto] 2.1: §7.6 — aggregates reflect settled spend only; in-flight reserved capacity queried separately.
- [auto] 2.3: §10 — new invariant 17 "Approval audit trail" recording all channel responses on `actions`.
- [auto] 2.4: REJECTED — unified-response shape would erase the two-discriminator observability pattern.
- [auto] 3.1: §10 — new invariant 18 "Currency consistency" + `currency_mismatch` reject reason.
- [auto] 3.2: §5.1 — `amount_minor integer NOT NULL CHECK (amount_minor > 0)` + §10 invariant 19.
- [auto] 3.3: new §16.12 — `normaliseMerchantDescriptor` algorithm (NFKC, trim, collapse, uppercase, strip punctuation).

### Surfaced for operator decision

7 findings escalated:
- 1.1, 1.5: severity-critical reject (operator should ack the rationale).
- 1.2, 1.3, 1.4, 2.2: severity-high apply (operator should review the proposed wording).
- 3.4: user-facing UI behaviour (operator owns user-visible decisions).

### Operator response

Operator reply: **"as recommended"** with rationale "too technical to engage with the wording — trust your judgement". Translation: every escalated finding handled per the agent's recommendation column. The two optional clarifying paragraphs offered alongside the rejects (1.1 in §6.1, 1.5 in §4) were also applied — they close the underlying ambiguity that prompted ChatGPT's findings even though the schema-change proposals were rejected, and the operator's blanket "as recommended" carries clear intent.

### Final decisions for round 1 (post operator gate)

| # | Finding | Triage | Final Decision | Spec sections touched |
|---|---------|--------|----------------|----------------------|
| 1.1 | Worker-form vs Stripe contradiction | technical-escalated | reject + clarification (user-approved) | §6.1 (new "Stripe is universally the financial source of truth" sub-bullet) |
| 1.2 | Webhook precedence over WorkerSpendCompletion | technical-escalated | apply (user-approved) | §10 (new invariant 20), §17 Chunk 11 (handler note) |
| 1.3 | Idempotency deterministic-args | technical-escalated | apply (user-approved) | §10 (new invariant 21), §9.1 (key-mismatch reject reason note), §20 (whitelist hashing deferred) |
| 1.4 | `expires_at` reset on every approved transition | technical-escalated | apply (user-approved) | §4 rules (rule reset language), §5.1 (mutable allowlist updated) |
| 1.5 | "executed" overloaded | technical-escalated | reject + clarification (user-approved) | §4 (state table description rewritten) |
| 2.1 | Aggregation: settled vs in-flight | technical | auto (apply) | §7.6 (new "Settled vs in-flight rule" paragraph) |
| 2.2 | Kill switch double-check | technical-escalated | apply (user-approved) | §4 transitions (new `approved → blocked` line), §10 (invariant 7 strengthened), §15 (new "Late kill-switch re-check" subsection), §17 Chunk 5 (executeApproved + late re-check note) |
| 2.3 | Approval audit trail | technical | auto (apply) | §10 (new invariant 17) |
| 2.4 | Unify shadow/live response | technical | auto (reject) | (no spec change — discriminator pattern preserved) |
| 3.1 | Currency match | technical | auto (apply) | §10 (new invariant 18), §17 Chunk 4 (currency-match in evaluatePolicy) |
| 3.2 | Positive-amount CHECK | technical | auto (apply) | §5.1 (CHECK constraint), §10 (new invariant 19), §18.3 (migration scope) |
| 3.3 | Merchant descriptor normalisation | technical | auto (apply) | new §16.12, §17 Chunk 4 (normaliseMerchantDescriptor) |
| 3.4 | UI grouping by `intent_id` | user-facing | apply (user-approved) | §17 Chunk 14 (Spend Ledger dashboard retry-grouping requirement) |

### Edits applied this round

- §4 state table: `executed` description rewritten to clarify same conceptual meaning across `executionPath`s, with `provider_charge_id` nullability as the only observable difference (per 1.5 clarification).
- §4 transitions: new `approved → blocked` (Kill Switch fired between propose and execute) line added (per 2.2).
- §4 rules: `expires_at` set on every transition INTO `approved`, both auto-approval and HITL-approval paths (per 1.4).
- §5.1 `agent_charges`: `amount_minor` constraint changed from `integer NOT NULL` to `integer NOT NULL CHECK (amount_minor > 0)` (per 3.2).
- §5.1 mutable allowlist: `expires_at` description updated to reflect every-approved-transition reset rule (per 1.4).
- §6.1: new sub-bullet "Stripe is universally the financial source of truth (both `executionPath` values)" explaining v1's SPT-only model (per 1.1 clarification).
- §7.6: new "Settled vs in-flight rule (clarification)" paragraph distinguishing aggregate read-paths from limit-evaluation read-paths (per 2.1).
- §9.1: key-mismatch reject reason updated to `'idempotency_args_drift'` with cross-ref to §10 invariant 21 (per 1.3).
- §10: new invariant 17 (approval audit trail), 18 (currency consistency), 19 (positive amounts), 20 (webhook precedence), 21 (deterministic args). Existing invariant 7 (Kill Switch) strengthened to "synchronous and double-checked" (per 2.2).
- §15: new "Kill Switch check location (double-check rule)" sub-section formalising the propose-time + execute-time double-check (per 2.2).
- §16.12: new sub-section "Merchant Descriptor Normalisation" defining the `normaliseMerchantDescriptor` algorithm (NFKC, trim, collapse, en-US uppercase, strip-punctuation) (per 3.3).
- §17 Chunk 4: currency-match, normaliseMerchantDescriptor, idempotency-args-drift handling added.
- §17 Chunk 5: `executeApproved` (kill-switch re-check), `expires_at` reset, new `approved → blocked` transition added.
- §17 Chunk 11: `agent-spend-completion` handler implements webhook-precedence rule.
- §17 Chunk 14: Retry-grouping by `intent_id` requirement added to Spend Ledger dashboard (per 3.4).
- §18.3: migration scope note now mentions the `amount_minor > 0` CHECK constraint (per 3.2).
- §20: new deferred item "Whitelist-based idempotency-args hashing" (per 1.3 follow-up).

### Integrity check (post-edit)

- Forward references: none broken. New `failure_reason` codes (`currency_mismatch`, `idempotency_args_drift`, `kill_switch_late`, `worker_completion_after_terminal`) are introduced and referenced consistently across the invariants section, state-machine section, and chunk plan.
- Contradictions: none introduced. `spend.blocked` terminal-event description in §9.4 already covered "system-enforced denial (policy, limits, Kill Switch, SPT failure)" — both `kill_switch` and `kill_switch_late` `failure_reason` values fall under it without §9.4 update needed.
- Missing inputs/outputs: none. New invariants cite their enforcement points (DB CHECK, trigger, pure-helper, impure-handler) and §17 chunks cite the new functions/handlers.

### Round summary

- Total findings: 13.
- Auto-applied (technical): 5 applied + 1 rejected = 6 auto.
- User-decided (escalated to operator gate): 5 applied + 2 rejected (with prose clarifications) = 7 user-decided. All 7 resolved per the agent's recommendation column on operator's "as recommended" reply.
- Deferred: 0 (whitelist-based idempotency hashing is a follow-up enhancement noted in §20, not a deferred review item).

Top themes (round 1):
- Closing precedence races (webhook vs worker, late kill-switch).
- Tightening invariant surface (currency match, positive amounts, deterministic args, audit trail).
- Defining algorithms left implicit (merchant descriptor normalisation, expires_at reset, settled-vs-in-flight semantics).

---

## Round 2 — 2026-05-03T07:25:00Z (approx)

### ChatGPT Feedback (raw)

Senior-level review. ChatGPT flagged 7 areas:

1. **🔴 SPT exposure model (high risk)** — v1 accepts SPT-not-bound risk; ChatGPT pushes for a minimum binding constraint (Option A merchant+amount metadata, Option B short-lived proxy token, Option C spend-ceiling per response).
2. **🟠 Worker-hosted-form trust boundary** — Worker can transition `executed → failed` per round-1 invariant 20; ChatGPT argues worker should be observer-only, never change status (cleaner mental model: chargeRouter / webhook / timeout job are the only status writers).
3. **🟠 Reserved capacity edge cases** — long-lived pending approvals (already solved via approval_expires_at), executed-but-no-webhook (no max-bound), refund timing mismatch. Proposes time-bound carve-out for stuck `executed` rows.
4. **🟡 Webhook vs completion race** — same concern as 2, framed as actor-model simplification: only chargeRouter / webhook / timeout-job can change status, worker is metadata-only.
5. **🟡 Policy versioning + replay semantics** — Spec says retry = new row but doesn't explicitly name "retries use latest policy". ChatGPT proposes adding as an invariant.
6. **🟡 Operator UX gaps (3 sub-items)** — Empty allowlist UX risk, missing "top block reasons" aggregation, missing shadow-vs-live delta view.
7. **Minor tightening:**
   - 7A: Idempotency key includes raw `intent` string — wording drift could create duplicate. Recommend deterministic intent.
   - 7B: `&` strip in §16.12 normalisation collides ("AT&T" → "ATT" matches unrelated "ATT" merchants).
   - 7C: Single global `EXECUTION_TIMEOUT_MINUTES` may not fit subscriptions vs purchases.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | SPT exposure / amount-bound | technical-escalated | apply lightweight (webhook amount-match invariant 23); broader Options A/B/C deferred | apply (user-approved) | high | Webhook-amount-match is one new invariant + one webhook handler check; meaningful defense-in-depth without a token wrapper. |
| 2 | Worker observer-only model | technical-escalated | reject | reject (user-approved) | medium-high | Reversing round-1 invariant 20 means 30-min lockout for worker-observed failures. The `failed → succeeded` post-terminal override (§4) already mitigates the temporal-inconsistency case. |
| 3 | Reserved capacity time-bound | technical-escalated | reject + clarify §16.6 | reject + clarify (user-approved) | medium-high | Lockout from prolonged webhook outage is a production-incident path, not a normal-operation feature. Carve-out would mask outages. |
| 4 | Actor-model simplification | technical | reject (already covered by invariant 20) | auto (reject) | low | Same concern as 2; no spec change needed. |
| 5 | Replay-uses-latest-policy | technical | apply | auto (apply) | medium | Existing behaviour, just never named as an invariant. Add as invariant 22. |
| 6.1 | Empty-allowlist UX banner | user-facing | apply | apply (user-approved) | medium | Closes the perception gap on the create flow. |
| 6.2 | Top block reasons panel | user-facing | apply (small) | apply (user-approved) | medium | Single SELECT GROUP BY; high diagnostic value for policy tuning. |
| 6.3 | Shadow-vs-live delta panel | user-facing | defer | defer (user-approved) | medium | Non-trivial UI surface; existing Spend Ledger `mode = shadow` filter captures most value. |
| 7A | Deterministic intent (extension to invariant 21) | technical | apply | auto (apply) | medium | Same defence as args determinism; one-line extension. |
| 7B | Drop `&` from §16.12 strip set | technical | apply | auto (apply) | low-medium | False-positive collision risk outweighs the "AT&T = AT T" merge intent. |
| 7C | Per-skill execution-timeout overrides | technical-escalated | defer | defer (user-approved) | low | No production evidence yet; non-breaking when added later. |

### Auto-applied (this round, before operator gate)

- [auto] Finding 4: log-only reject; no spec change (already covered by round-1 invariant 20).
- [auto] Finding 5: §10 — new invariant 22 "Retries always use the latest policy".
- [auto] Finding 7A: §10 — invariant 21 extended to require deterministic `args` AND `intent`.
- [auto] Finding 7B: §16.12 — `&` removed from punctuation strip set; updated note explains the false-positive concern.

### User-approved (post operator gate, "as recommended")

- [user] Finding 1 apply: §10 — new invariant 23 "Webhook amount-match"; §11.3 alert table — new "Ledger amount mismatch" critical row; §17 Chunk 12 — handler check note.
- [user] Finding 2 reject: no spec change; round-1 invariant 20 preserved.
- [user] Finding 3 reject + clarify: §16.6 — new "Lockout-by-design" paragraph explaining why no time-bound auto-release.
- [user] Finding 6.1 apply: §17 Chunk 14 — empty-allowlist banner requirement on Spending Budget create / detail flow.
- [user] Finding 6.2 apply: §17 Chunk 14 — "Top block reasons (last 7 days)" aggregation panel on Spend Ledger dashboard.
- [user] Finding 6.3 defer: §20 — added as deferred item.
- [user] Finding 7C defer: §20 — added as deferred item.

### Edits applied this round

- §10 invariant 21: extended to require deterministic `args` AND `intent` strings (per 7A).
- §10 invariant 22 (NEW): retries always use the latest policy (per 5).
- §10 invariant 23 (NEW): webhook amount-match (per 1).
- §11.3 alert table: new "Ledger amount mismatch" critical row (per 1).
- §16.6: new "Lockout-by-design" paragraph (per 3).
- §16.12: `&` removed from punctuation-strip regex; updated note explaining the false-positive risk (per 7B).
- §17 Chunk 12: webhook handler now performs amount-match check + `ledger_amount_mismatch` alert path (per 1).
- §17 Chunk 14: empty-allowlist banner + "Top block reasons" panel added (per 6.1, 6.2).
- §20 deferred items: shadow-vs-live delta panel; per-skill execution-timeout overrides (per 6.3, 7C).

### Integrity check (post-edit)

- Forward references: none broken. New invariant numbers (22, 23) are referenced from at least two locations each. New `ledger_amount_mismatch` failure-reason value cited from §10 invariant 23 + §11.3 alert table + §17 Chunk 12.
- Contradictions: none introduced. The reject of finding 2 preserves round-1 invariant 20 behaviour; the §16.6 clarification is additive (does not conflict with §10 invariant 9 reserved-capacity rule).
- Missing inputs/outputs: none. All new requirements cite their enforcement points (`stripeAgentWebhookService` for invariant 23; Chunk 12 handler; Chunk 14 UI banner / panel).

### Round summary

- Total findings: 11 (after splitting 6 into 3 sub-items and 7 into A/B/C).
- Auto-applied (technical): 3 applied + 1 rejected (log-only) = 4 auto.
- User-decided (escalated to operator gate): 3 applied + 2 rejected + 2 deferred = 7 user-decided. All 7 resolved per the agent's recommendation column on operator's "as recommended" reply.
- Deferred: 2 (6.3 shadow-vs-live delta panel, 7C per-skill execution-timeout overrides).

Top themes (round 2):
- Defense-in-depth on the SPT exposure surface (invariant 23 amount-match) without adopting full token-wrapping.
- Naming the unstated (replay uses latest policy, deterministic intent).
- Operator UX hardening (empty-allowlist banner, top block reasons panel) — non-correctness gains that still affect production usability.
- Pushing back on "fixes" that would mask production incidents (§16.6 lockout-by-design).
- One reversal of a round-1 decision: §16.12 `&`-strip removed (false-positive collision concern beats the "match AT&T == AT T" merge intent).

