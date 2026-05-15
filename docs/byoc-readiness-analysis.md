# Bring Your Own Compute — Readiness Analysis

_Date: 2026-05-15_  
_Purpose: assess how far we are from shipping a customer-facing "Bring Your Own Compute" (BYOC) capability, so the founder can talk confidently about it on roadmap calls in the next 1–3 months._

## Contents

- TL;DR
- Two features, not one
- Current state — execution backend layer
- Current state — LLM provider layer
- Current state — integration UX patterns
- Gaps for BYO LLM
- Gaps for BYO Compute
- Cross-cutting gaps
- Recommended release tiers
- What to say to customers today
- What NOT to do
- References

---

## TL;DR

BYOC is **on the architectural roadmap and substantially more built than it looks at first glance**. The execution-backend adapter pattern is shipped, and the LLM-provider abstraction is **already in place** (Anthropic, OpenAI, Gemini, OpenRouter adapters all live behind a single `LLMProviderAdapter` interface). What is missing is small, well-scoped wiring rather than missing architecture.

BYOC splits into two distinct features that customers will conflate:

1. **Bring Your Own LLM (which model your agents call)** — the use case the founder described (powerful local server running LLMs). Provider abstraction exists; the blocker is the absence of a `baseURL` override on the adapters and a per-tenant config table to hold a custom endpoint and key. **~2 weeks to MVP, ~6 weeks to polished.**
2. **Bring Your Own Compute (where the agent runtime executes)** — point us at your hardware so agent orchestration, browser automation, and code execution run on your box. The `ExecutionBackend` adapter contract is shipped and a reserved Phase 5 slot (`operator_external`) already exists. **~3–4 months for a credible MVP**, dependent on first hardening the existing delegated-execution lifecycle.

These slip independently. BYO LLM ships first; it does not need BYO Compute to land.

The hard problems are not the adapter code. They are: failure-mode UX (what happens when their endpoint dies mid-run), cost/billing reconciliation when the customer is paying their own bill, capability negotiation (local models may not support tool use, vision, or 200K context), and explainable routing.

---

## Two features, not one

Customers will say "BYOC" and mean different things. Be ready to disambiguate on the first call.

| What they say | What they want | Where it runs | Why they want it |
|---|---|---|---|
| "Bring your own compute" | Their model, our platform | LLM call goes to their server; everything else stays in our cloud | Cost control, data residency for prompts, latency, model choice (Llama / Qwen / DeepSeek) |
| "Self-host" or "on-prem" | Our entire runtime on their box | Agent loop, browser automation, code execution all happen on customer infrastructure | Compliance, air-gap, regulated industries, full data sovereignty |

The first is **BYO LLM**. The second is **BYO Compute** (the OpenClaw-style external worker). They are wildly different in scope and risk. Conflating them in conversation makes us sound either over- or under-committed.

---

## Current state — execution backend layer

The `ExecutionBackend` adapter contract is shipped (`server/services/executionBackends/`). Five backends are registered today:

| Backend ID | Lifecycle | Purpose |
|---|---|---|
| `api` | in-process | Standard agentic loop |
| `headless` | in-process | Headless agentic variant |
| `claude-code` | subprocess | Claude Code CLI runner |
| `iee_browser` | delegated | Browser automation via E2B-hosted worker |
| `iee_dev` | delegated | Code execution / terminal via E2B-hosted worker |

The adapter interface declares `dispatch`, plus for delegated backends `loadTerminalState`, `finalise`, `reconcile`. Capability flags (`browser_automation`, `code_execution`, `terminal_repo`, `cancellation`, `long_running`, `session_identity`) are declared per-adapter and validated at boot.

Per-run binding is persisted on `agent_runs` (`executionMode`, `backendId`, `backendTaskId`, `ieeRunId`). Per-agent configuration on `agents` (`executionMode`, `modelProvider`, `modelId`, `allowModelOverride`). Soft budget primitive exists as `computeReservations` (15-min TTL).

The Phase 5 slot `operator_external` is **reserved as a type** in the execution-mode enum but rejected at runtime registration in V1. Architectural intent — "external customer-hosted worker registers outbound, gets signed short-lived job leases" — is documented in `docs/openclaw-strategic-analysis.md § Phase 5`.

**This is the substrate we'd build BYO Compute on. It exists. It is honest. It is in production.**

---

## Current state — LLM provider layer

This was the area I initially under-estimated. The platform **already has a clean provider abstraction**.

- **`LLMProviderAdapter` interface** at `server/services/providers/types.ts` — minimal contract: `call(params)` → `Promise<ProviderResponse>` with optional `stream()`.
- **Live adapters**: `anthropicAdapter`, `openaiAdapter`, `geminiAdapter`, `openrouterAdapter`. All implemented against the same interface, using raw `fetch()` (no vendor SDK lock-in at the wiring layer).
- **Registry** at `server/services/providers/registry.ts` — simple `{ anthropic, openai, gemini, openrouter }` map. Adding a new provider is "implement the interface, register it".
- **Tool-calling shape normalised** to Anthropic semantics; adapters translate inbound/outbound (e.g. `toOpenAITools()`).
- **Router** at `server/services/llmRouter.ts` — every LLM call funnels through `routeCall()` which handles cost attribution, budget enforcement, idempotency. **One choke point.**
- **Model assignment** stored in `agents.modelProvider` and `agents.modelId` — database-configurable per agent today.

What is **missing** is narrow:

1. **No `baseURL` override on adapters.** Endpoints are hard-coded (`https://api.openai.com/v1/chat/completions`, `https://api.anthropic.com/v1/messages`). This is the single biggest blocker for "point us at your local Ollama" — the change is ~30 lines across two files.
2. **No per-tenant config table.** API keys come from environment variables only. Adding `org_llm_configs` (org_id, provider, base_url, encrypted_api_key, model_id) gives us tenant-owned endpoints and credentials. The infrastructure for encrypted tenant secrets exists (`integrationConnections`, `organisationSecrets`).
3. **No per-org capability overrides.** `modelRegistry.ts` is a static code-level registry. A customer's local `mistral-7b` is not in it, so cost estimation and capability checks would fall back to defaults.
4. **No streaming on the openai_compatible path.** SSE is supported by Ollama, vLLM, LM Studio; the adapter would need to implement `stream()` to unlock streaming UI for BYOC.

Net: **the architecture is correct.** The remaining work is plumbing, schema, and UI — not a fundamental rebuild.

---

## Current state — integration UX patterns

The platform already has a strong pattern for "user pastes credentials, we test, we save":

- `client/src/pages/govern/ConnectionsPage.tsx` + `AppIntegrationsTab.tsx` — gallery + modal pattern for OAuth and API-key integrations. Per-card status badge ("1 connected" / "Not connected") with green dot.
- `client/src/pages/AdminEnginesPage.tsx` — org-level "engines" registry (n8n, GHL, Make, Zapier, custom webhook) with name / type / base URL / API key form. **This is the closest existing surface to a BYOC settings page** and the natural anchor.
- `client/src/components/subaccount-agent-edit/ExecutionTab.tsx` — per-agent execution-environment selection (already exists; the equivalent for "which model" is what BYO LLM would add).

A second "Compute" tab under the subaccount Connections page would host workspace-scoped BYOC bindings. Org admins set defaults at `AdminEnginesPage`; subaccount admins pick per workspace.

What the UI does **not** surface today (and BYOC will need): a "is this endpoint alive right now?" health indicator, a latency trend, and a per-agent failure policy (fail / retry / fall back to cloud).

---

## Gaps for BYO LLM

1. **`baseURL` override on adapters.** ~30 lines across `openaiAdapter.ts` and `anthropicAdapter.ts`. Add optional `baseUrl`/`apiKeyOverride` to `ProviderCallParams`, use it when present.
2. **`org_llm_configs` table.** Stores `(organisation_id, provider, base_url, encrypted_api_key, model_id, is_active, is_byoc)`. Encryption pattern is already in `organisationSecrets`.
3. **Router wiring.** In `llmRouter.ts`, before adapter dispatch, look up the org's custom config and populate `baseUrl`/`apiKeyOverride`. ~50 lines.
4. **Cost-attribution gate.** When `is_byoc=true`, skip platform-margin billing for that call. Tag `llm_requests` with `cost_attribution: 'tenant'`.
5. **Capability-override schema.** Optional per-org overrides for `maxContextTokens`, `toolCallingReliability`, `costPerKTokens`. Without these, BYOC models silently fall back to default platform assumptions.
6. **UI: org-level "Custom Model Endpoint" form** under Engines, plus per-agent "Override Model" picker in `ExecutionTab`.
7. **Streaming.** Implement `stream()` on the openai-compatible adapter so the agent UI streams tokens from the customer's Ollama/vLLM box just like it does from Anthropic today.
8. **Capability gating.** Local models often lack vision, tool-calling reliability, prompt caching, or 200K context. The model picker must surface these constraints so users don't assign a tool-calling agent to a model that can't tool-call.
9. **Fallback policy.** Per-agent: fail / retry-with-backoff / fall back to vendor LLM. Data-residency customers will reject silent fallback.

**Total scope: roughly 2 weeks to a demoable MVP, 6 weeks to production-grade.**

---

## Gaps for BYO Compute

This is OpenClaw Phase 5 in `docs/openclaw-strategic-analysis.md`. Order-of-magnitude larger than BYO LLM.

1. **External worker registration protocol.** Customer's server registers outbound to us; we hand it signed short-lived job leases. Not built. No `operator_external` adapter yet.
2. **Per-tenant backend endpoint binding.** Today every backend has one global address. Need `tenant_backend_config` table binding `(org, backend_id) → (endpoint_url, auth_token, region_policy)`.
3. **Secret handoff.** Workers currently read tenant secrets (OAuth tokens, API keys) from our main DB at runtime. A customer-hosted worker should not phone home for every credential. Needs a secure handoff or sealed-envelope mechanism. **This is the hardest sub-problem.**
4. **Health, latency, and failure-policy UX.** No "is your box alive right now?" indicator, no latency trend, no per-agent fallback policy.
5. **Cost reconciliation.** Every compute event today lands in `llm_requests` with a vendor-attributed cost. For customer-hosted compute that is `$0 to us, $X to them`. UI must say so explicitly or we silently misattribute.
6. **Explainable routing.** Once two backends exist, "why did this run end up here?" becomes a top-three support question. Per-run routing audit (chosen backend, fallback chain, reason) is committed in architecture but not surfaced.
7. **Precondition: IEE delegation lifecycle hardening.** Per the strategic doc, some delegated runs are currently marked complete *synthetically* before the work actually finishes. BYO Compute rides on the same delegation pattern. The pattern has to be honest first or every Tier 3 reliability problem is born broken. This is `Phase 0` work in the strategic doc.

**Total scope: roughly 3–4 months once the Phase 0 lifecycle work is done.**

---

## Cross-cutting gaps

1. **Onboarding wizard.** Today's pattern is OAuth-redirect-and-validate. BYOC needs a "test endpoint → run sample agent → confirm working" wizard the customer can re-run after a config change.
2. **Pricing and packaging.** No SKU or billing tier for "you brought your own; we discount". This is a CEO call, not engineering, but worth flagging. Customers will ask immediately.
3. **Documentation.** No customer-facing setup guide for either feature. Both need one before public launch.
4. **Failure-mode UX** — the genuinely non-obvious one. When the customer's endpoint dies mid-run, what does the agent do, and what does the user see? Today's UX hides infra failures because the infra is ours. Once it is theirs, failures must be visible, actionable, and configurable. We do not have a primitive for this; "Run Resilience" or "Failure Policy" is a new surface, not an extension of an existing one.

---

## Recommended release tiers

### Tier 1 — "BYO LLM lite" (≈2 weeks)

Smallest customer-credible version.

- Single field on org settings under the existing Engines tab: "OpenAI-compatible endpoint" (base URL + API key + default model name)
- `baseURL` override on the OpenAI adapter; populated from `org_llm_configs` in the router
- Limit to text chat completions; document upfront that tool use, vision, and prompt caching may not work on customer endpoint
- No fallback; if endpoint is down, agent fails with clear error
- No streaming; non-streaming response only

Captures the Ollama / LM Studio / vLLM / OpenRouter audience. The founder's described use case ("powerful local server running LLMs") is satisfied by this.

### Tier 2 — "BYO LLM proper" (≈6 weeks total)

- Multi-provider support: OpenAI-compatible, Anthropic-direct, Bedrock, Vertex
- Per-agent model override in `ExecutionTab`
- Streaming via `stream()` on the openai-compatible adapter
- Health check + latency display
- Configurable fallback policy (fail / retry / fall back to vendor)
- Cost reconciliation with `cost_attribution: 'tenant' | 'vendor'` tagging on `llm_requests`
- Capability override fields on `org_llm_configs`

### Tier 3 — "BYO Compute" (≈3–4 months after Phase 0)

- `operator_external` adapter — outbound worker registration, signed short-lived job leases
- Subaccount-scoped trust + revocation
- Worker health dashboard
- Secret-handoff protocol
- Failure-policy UI per agent
- Explainable routing surface
- Customer-facing setup documentation

Depends on the IEE delegation lifecycle being **fully honest** (Phase 0 in the strategic doc) — currently some delegated runs are marked complete synthetically before the work finishes. Fix that first or every Tier 3 reliability issue is born broken.

---

## What to say to customers today

If a prospect raises BYOC on a sales call:

> "It's on our near-term roadmap and splits into two phases. **For customers who want to run their own LLM** — Ollama, vLLM, a local Llama or Qwen deployment — we have the underlying provider abstraction in place already, so we expect to ship support via an OpenAI-compatible endpoint configuration in the next sprint or two. The agent platform stays in our cloud; only the model calls go to your hardware. **For customers who want to run the full agent runtime on their own infrastructure** — typically for data-residency, compliance, or air-gap reasons — that is a quarter-scale piece of work. The adapter contract is already shipped, the architectural commitment is documented, and an external-worker slot is reserved in the execution-mode enum. We are not promising a ship date on that one until the underlying delegation lifecycle is hardened."

This is **accurate**, frames it as planned and partially built rather than aspirational, and gives the prospect a concrete near-term win (BYO LLM) without overcommitting on the harder one.

---

## What NOT to do

- **Do not ship BYOC without explainable routing and visible failure modes.** Silent fallback turns a feature into a billing complaint.
- **Do not pitch BYOC as the primary differentiator.** It removes an objection; it does not win deals on its own. The real moat is the agency-grade multi-tenant boundary, canonical data, and OAuth isolation.
- **Do not let BYO Compute scope creep block the OpenClaw managed-worker phases.** External worker is Phase 5 for a reason — the managed worker is higher leverage and a precondition.
- **Do not ship BYO LLM without surfacing capability limits.** A user who assigns a vision-required agent to a text-only local model and gets silent failures will not return.

---

## References

- `docs/execution-contracts.md` — current adapter contract
- `docs/openclaw-strategic-analysis.md § Phase 5` — external-worker strategic framing
- `docs/iee-development-spec.md`, `docs/iee-on-e2b-rollout.md` — current delegated-execution implementation
- `tasks/builds/execution-backend-adapter-contract/` — shipped substrate work
- `server/services/executionBackends/types.ts` — adapter interface source of truth
- `server/services/executionBackends/registry.ts` — registered backends
- `server/services/providers/types.ts` — `LLMProviderAdapter` interface
- `server/services/providers/registry.ts` — provider map
- `server/services/providers/{anthropic,openai,gemini,openrouter}Adapter.ts` — live adapters
- `server/services/llmRouter.ts` — single LLM choke point
- `client/src/pages/AdminEnginesPage.tsx` — closest existing UX pattern to extend
- `client/src/pages/govern/ConnectionsPage.tsx` — gallery + modal pattern
- `client/src/components/subaccount-agent-edit/ExecutionTab.tsx` — per-agent execution config
