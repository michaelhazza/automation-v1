# Spec Review Iteration 3 — agentic-commerce

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Iteration:** 3 of 5
**Started:** 2026-05-03T05-48-20Z
**Reviewer:** Claude Opus 4.7 (1M context) + Codex (`codex exec --sandbox read-only`)

## Codex output

10 distinct findings. All 10 land in mechanical bucket. No directional. The substantive themes were:
- Live execution architecture: TWO paths (main-app-direct Stripe vs worker-hosted-form) needed explicit disambiguation
- `provider_charge_id` flow on the worker-hosted-form path
- Post-terminal override carve-out for late Stripe webhooks
- Webhook routing order safety
- Several smaller naming / cardinality / sequencing fixes

## Findings 1-5

### FINDING #3.1 — Two live execution architectures conflated

- Source: Codex (#1)
- Section: §6.1, §7.2, §8.2
- Description: §6.1 says "On approved + live mode: call Stripe via SPT, write executed row" — the main app executes Stripe. §7.2 says the worker fills the merchant's payment form. Both can't be the live execution owner.
- Classification: mechanical
- Reasoning: The spec actually has two live paths (main-app-direct for Stripe API skills like pay_invoice/issue_refund; worker-hosted-form for hosted-checkout skills like purchase_resource/subscribe_to_service/top_up_balance) but never disambiguated them.
- Disposition: auto-apply

[ACCEPT] §6.1 + §7.1 + §7.2 + §8.2 + §6.2 — Two live execution paths now explicitly defined: `main_app_stripe` and `worker_hosted_form`. Per-skill assignment declared on `ActionDefinition.executionPath` (added to actionRegistry.ts modifications). §7.1 skill table now carries the executionPath column. §6.1 impure responsibilities split into two `approved + live` branches, one per path. §8.2 ChargeRouterResponse has executionPath + providerChargeId-or-chargeToken discriminator.

### FINDING #3.2 — provider_charge_id flow on worker-hosted-form path missing

- Source: Codex (#2)
- Section: §5.1, §7.2, §7.5
- Description: The schema sets provider_charge_id "after executed", but on the worker-hosted-form path the worker observes the merchant outcome — there was no contract for the worker to report back the merchant payment ID.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §8.4a (new) + Chunk 11 + §18.1 — Defined `WorkerSpendCompletion` contract on new `agent-spend-completion` pg-boss queue (worker → main app). Worker emits this after the merchant form-fill resolves; main app updates the row with provider_charge_id (state stays executed until Stripe webhook drives executed → succeeded). Chunk 11 + §18.1 file inventory updated.

### FINDING #3.3 — `failed` is terminal but webhook can override

- Source: Codex (#3)
- Section: §4 Rules, §7.5, §8.6, §9.4
- Description: §4 said failed is terminal; §7.5 said Stripe takes precedence on failed rows.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §4 Rules + §9.4 + §5.1 trigger note — Carved out a single explicit `failed → succeeded` post-terminal override for inbound Stripe webhooks. Override is whitelisted in stateMachineGuards AND in the DB trigger, gated on caller identity (must be `stripeAgentWebhookService`). All other post-terminal transitions still raise.

### FINDING #3.4 — `denied` should not appear in immediate WorkerSpendResponse

- Source: Codex (#4)
- Section: §7.2 step 3, §8.4
- Description: WorkerSpendResponse listed `denied` as an immediate decision but step 6 made clear HITL outcomes (including denial) come via workflow-resume channel.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §8.4 + §7.2 — WorkerSpendResponse decision union now `'approved' | 'blocked' | 'pending_approval'` only. `denied` and late `approved` from HITL arrive via workflow-resume per step 6. Note added explaining the bounded scope.

### FINDING #3.5 — §13.2 step 4 bypasses chargeRouterService policy revalidation

- Source: Codex (#5)
- Section: §13.2 step 4, §9.3, §16.3
- Description: §13.2 had channels updating agent_charges directly via UPDATE, but §9.3/§16.3 require revalidation through chargeRouterService.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §13.2 step 4 — Channels NEVER update agent_charges directly. They submit decisions to `chargeRouterService.resolveApproval(actionId, decision)` which performs the optimistic compare-and-set + policy revalidation per §9.3. Superseded responses recorded on the actions row only.

## Findings 6-10

### FINDING #3.6 — Execution window unnamed primitive

- Source: Codex (#6)
- Section: §12, §4 rules, §5.1 expires_at, §18.1 jobs
- Description: "Execution window" referenced repeatedly but never given a duration / constant name / config source.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §4 rules + §18.1 + §18.2 — Named the primitive: `EXECUTION_TIMEOUT_MINUTES` (default 30) in `server/config/spendConstants.ts` (also home for `CHARGE_KEY_VERSION`). `expires_at` set at `proposed → approved`. Job scans every minute for expired rows.

### FINDING #3.7 — Webhook route order: ACK before dedupe

- Source: Codex (#7)
- Section: §7.5
- Description: Acknowledge 200 came BEFORE dedupe in the original list — Stripe retries on non-2xx but if dedupe runs after the ACK, duplicate enqueues are possible.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §7.5 — Route responsibilities are now in strict numbered order: raw parser → connectionId resolve → signature verify → tenant resolve → dedupe → enqueue → ACK 200. Note added explaining the dedupe-before-enqueue requirement.

### FINDING #3.8 — Conservative defaults template merchant identifier shape

- Source: Codex (#8)
- Section: §14
- Description: Template lists "Namecheap, OpenAI, Anthropic, Cloudflare, Twilio, Stripe" without specifying whether these are descriptors or Stripe IDs.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §14 — Template payload now spelt out as concrete `{ id, descriptor, source }` array using `source: 'descriptor'` for all entries (Stripe merchant IDs aren't stable seeds across deployments). Operators can swap individual entries to `source: 'stripe_id'` as Stripe IDs are discovered. Descriptors are uppercase-normalised matching `chargeRouterServicePure` normalisation.

### FINDING #3.9 — "the org admin" / "the sub-account admin" singular wording

- Source: Codex (#9)
- Section: §11.1
- Description: Default-grant prose used singular "the admin" but multiple admins can exist per scope.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §11.1 — Default-grant prose now states "ALL users currently holding the admin role" for both org and sub-account scopes. Drift behaviour (admins added or removed AFTER budget creation) is now explicitly defined as no-implicit-sync — explicit operator action only.

### FINDING #3.10 — `stateMachineGuards` extension in §18.3 SQL migration scope

- Source: Codex (#10)
- Section: §18.3
- Description: Migration scope listed "stateMachineGuards extension" which is shared TypeScript code, not SQL.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §18.3 + §17 Chunk 2 — `<NNNN+1>_agentic_commerce_schema.sql` scope now lists "DB-side state-machine validation in the trigger" only (the SQL part). `shared/stateMachineGuards.ts` extension stays in §17 Chunk 2 + §18.2 modified files (TS code, shipped in same PR as the migration but tracked separately).

## Iteration 3 Summary

- Mechanical findings accepted:  10
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set by commit step)

Stopping heuristic check: this iteration was mechanical-only. Iter 1 + Iter 2 were also mechanical-only. That's three consecutive mechanical-only rounds, which exceeds the two-consecutive threshold for early exit. However, iter 3 surfaced two genuinely substantive issues (live execution architecture being two paths instead of one; provider_charge_id flow). The pattern suggests Codex is still finding real issues each round rather than re-stating fixed ones. Run iteration 4 to verify convergence — only stop if iter 4 produces nothing materially substantive.
