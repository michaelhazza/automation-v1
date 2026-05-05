# NVIDIA NIM Free Tier — Research Findings for Synthetos

**Source brief:** `tasks/nvidia-nim-research-brief.md`
**Researched:** May 2026 (separate Claude session, web-enabled).
**Verdict:** **GO-FOR-EVAL-ONLY** — wire as env-gated non-prod provider, hard model allowlist, synthetic-data-only policy.

## Table of contents

- TL;DR
- Key Findings — claim verification table
- Key Findings — tier and quota mechanics (May 2026)
- Catalogue reality check (live on build.nvidia.com)
- Terms of Service — the decisive section
- OpenAI compatibility surface
- Decision against stated criteria
- Recommendations — implementation sketch
- Recommendations — architectural concerns
- Recommendations — staged rollout
- Caveats

---

## TL;DR

- **Recommendation: GO-FOR-EVAL-ONLY.** ToS explicitly permits internal testing/evaluation, OpenAI-compatibility surface is good enough to reuse `openrouterAdapter.ts` almost verbatim, catalogue has real frontier open-weight models worth benchmarking.
- **Two non-negotiable guardrails.** (1) §3.3(iv) of NVIDIA's API Trial ToS reserves the right to use prompt/response content to "improve NVIDIA products and services, including AI models" with **no opt-out** — NIM must never see real tenant CRM data. (2) Production use is contractually prohibited; the provider must be invisible in prod environments at the routing layer, not just disabled by config.
- **The "1,000 / 5,000 credits" claim is outdated.** NVIDIA retired the credit-based system in mid-2025 and replaced it with per-model rate limits for trial accounts. Any quota number from third-party blog posts is stale; the actual cap is rate-shaped (40 RPM documented default, per-model limits unpublished), not credit-shaped.

## Key Findings — claim verification table

| # | Claim | Verdict | Source |
|---|---|---|---|
| 1 | Endpoint `https://integrate.api.nvidia.com/v1` is OpenAI-compatible chat completions | **Verified** | Vercel AI SDK NIM provider docs; LiteLLM `nvidia_nim` provider docs; Spring AI NVIDIA LLM API guide; NVIDIA NIM API reference |
| 2 | Free tier (personal): 1,000 lifetime credits, 40 RPM, no card | **Refuted (outdated)** — NVIDIA staff "sophwats" confirmed Sep 2025: *"We no longer use a credit-based system for build.nvidia.com … this has been replaced by rate limits for trial usage. The rate limits vary for each model, and we do not publish those."* 40 RPM remains the documented default. | NVIDIA Developer Forums thread #344567 |
| 3 | Developer-program / business email gets ~4,000–5,000 credits ("Request More" button) | **Refuted** — same forum thread: the "Request More" (+4,000) button has been removed; trial use is now uncapped-by-credit but rate-limited per model. Older posts still show "5,000 points" balances on legacy accounts. | NVIDIA Developer Forums #344567 |
| 4 | Catalogue includes Llama, Mistral, Gemma, DeepSeek, Nemotron, 100+ models | **Verified** — build.nvidia.com/models lists DeepSeek V4 Pro/Flash, Kimi K2.6, MiniMax M2.1, GLM-5 / GLM-4.7, Llama 4 Maverick, Qwen3-coder-480b, Mistral Large 3, Llama-3.1-Nemotron-Ultra-253B, Nemotron 3 Nano Omni, Phi-4, Granite, etc. | build.nvidia.com/models; GitHub xRyul/pi-nvidia-nim |
| 5 | "GPT-5.4 / GLM-5.1 / DeepSeek V4 Pro / MiniMax M2.7 / Gemma 4 31B" appear fabricated | **Mixed** — DeepSeek V4 Pro/Flash, GLM-5.1, MiniMax M2.7, Kimi K2.6 are real and live on build.nvidia.com. "GPT-5.4" and "Gemma 4 31B" remain unverified — not present in any catalogue listing retrieved. | build.nvidia.com/models; artificialanalysis.ai |
| 6 | Metering is per-request (1 credit = 1 call), not per-token | **Refuted as currently relevant** — credit metering is no longer the live mechanism. Today the live mechanism is per-model RPM throttling, with HTTP 429 on overage and HTTP 402 only as a legacy code on accounts with stuck balances. | NVIDIA Developer Forums; decodethefuture.org |

## Key Findings — tier and quota mechanics (May 2026)

- **Quota structure:** NVIDIA has consolidated to a single "trial" tier covering personal-email and business-email signups under the NVIDIA Developer Program. Staff define "trial" as *"any use for prototyping, research, development, testing, learning"* with **no time-period limit** (forum #344567).
- **Credit pool:** Effectively non-existent for new signups. Legacy accounts may show 1,000 / 5,000 balances that no longer decrement.
- **Rate limits:** 40 RPM is the documented default, confirmed by at least a dozen NVIDIA Developer Forums threads filed April–May 2026, each explicitly stating *"Current Limit: 40 RPM, Requested Limit: 200 RPM"* (e.g. threads #368862 dated May 4 2026, #368791, #368798, #368830, #368866). Per-model limits are explicitly **not published** by NVIDIA.
- **TPM / concurrent requests:** Not published.
- **Failure mode at limit:** HTTP 429 on RPM overage; HTTP 402 with body `{"status":402,"title":"Payment Required","detail":"Account 'XXX': Cloud credits expired - Please contact NVIDIA representatives"}` on legacy credit-exhausted accounts. Both must be treated as terminal-skip in the router (no retry).

## Catalogue reality check (live on build.nvidia.com)

Real, available, tool-calling-capable frontier open-weight models worth evaluating:

- **deepseek-ai/deepseek-v4-pro** — 1M context, reasoning, tool-calling ✓ (caveat: streaming + tool-calling has known parser bugs per forum thread #368085).
- **deepseek-ai/deepseek-v4-flash** — Mixture-of-Experts, 284B total parameters, **13B active parameters**, 1M-token max context (per `docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-flash`, official reference, added April 23 2026).
- **moonshotai/kimi-k2.6** — 256K context, tool-calling ✓.
- **z-ai/glm-5** and **z-ai/glm-4.7** — 128K, agentic-optimised, tool-calling ✓ (see Caveats — GLM-5 deprecation in flight).
- **qwen/qwen3-coder-480b-a35b-instruct** — 256K, tool-calling ✓.
- **meta/llama-4-maverick-17b-128e-instruct** — 1M context.
- **nvidia/llama-3.3-nemotron-super-49b-v1.5** — 128K, tool-calling ✓, NVIDIA-distilled reasoning.
- **nvidia/llama-3.1-nemotron-ultra-253b-v1** — 128K, tool-calling ✓.
- **mistralai/mistral-large-3-675b-instruct-2512** — 256K (262,144 tokens) per `docs.api.nvidia.com/nim/reference/mistralai-mistral-large-3-675b-instruct-2512`; 675B MoE with 41B active parameters, trained on 3,000 NVIDIA H200 GPUs (Mistral AI Dec 2025 release; HF model card).
- **openai/gpt-oss-120b** — 128K (note: tool-calling has a Harmony-parser streaming bug per NIM release notes; non-streaming works).

## Terms of Service — the decisive section

The NVIDIA API Trial Terms of Service (v. Sep 19, 2025) governs build.nvidia.com hosted endpoints. Verbatim clauses:

- **§1.2 Trial Access Rights:** *"NVIDIA will provide you access to the API Service for limited trial purposes only and without use of the API Service or Generated Content in production."*
- **§1.4:** *"Unless you purchase a Subscription from NVIDIA or a Service Provider … you may only use the API Service for internal testing and evaluation purposes, not in production."*
- **§2.3:** *"Except as stated below in Section 2.4 or unless expressly disclosed to you for an API Service, NVIDIA will not store or use User Content or Generated Content at the end of each API Service session."*
- **§3.3:** *"NVIDIA will collect the following data, without identifying specific users, to operate and improve the API Services and other products and services: (i) session metrics … (ii) error logs and execution logs … (iii) your feedback … and **(iv) User Content and Generated Content to improve NVIDIA products and services, including AI models.** Your use of the API Services will be logged for security, fraud or abuse monitoring and shared with third party service providers for this purpose."*
- **§4.2 / §4.12:** No redistribution of the API or Generated Content; cannot use to build competing products.
- **§14.4:** Opt-out exists only for the arbitration clause. **No opt-out exists for §3.3(iv) AI-training data use.**

§2.3 and §3.3(iv) are in tension on their face. A NVIDIA forum staff response (June 10, 2025, sophwats) leans toward the §2.3 interpretation but does not formally amend the ToS. **For a compliance decision the literal §3.3(iv) controls.** Hard blocker for any real customer-CRM data.

- **Region/data-residency:** No commitments. Endpoints hosted on NVIDIA DGX Cloud; export-control language in §15.4 is the only geographic clause. **GDPR-sensitive EU customer data should not flow through this endpoint.**
- **Multi-account:** §4 contains no express prohibition on multiple personal accounts, but §4.5 (*"misuse, disrupt, or exploit … for any unauthorized use"*) could be invoked. Stick to one organisational account.

## OpenAI compatibility surface

- **Tool-calling (`tools`, `tool_choice`):** Supported on a model-gated subset (Llama 3.x, Mistral 7B+, Nemotron, DeepSeek V4, Kimi K2.6, GLM-5/4.7, Qwen3). `parallel_tool_calls` supported on a narrower subset. Forced tool choice supported.
- **Streaming:** Supported, but **streaming + tool-calling is known-broken** on multiple models — NIM release notes explicitly state *"Tool calling is not supported when the stream parameter is set to true"* for several containers, and the GPT-OSS Harmony parser intermittently fails on streamed tool calls. **Workaround: use `stream:false` for tool-call round-trips.**
- **JSON mode / structured outputs:** Supported on Llama 3.3 70B Instruct and similar (per Vercel AI SDK docs).
- **Vision inputs:** Reported broken for OpenAI-style multi-part `content` arrays on at least Llama 3.1 405B (forum #327077: error `urn:inference-service:problem-detail`). Treat as broken in the adapter.
- **Response shapes:** Mostly byte-compatible. Reported deviations: invalid `role` values produce non-OpenAI-compliant error envelopes; the `developer` role triggers HTTP 500 on NIM (must coerce to `system`); `chat_template_kwargs` is a NIM-specific request extension some reasoning models require.
- **Errors:** Returned as structured objects but the schema is sometimes the RFC 7807 problem-detail shape (`type`, `title`, `detail`, `status`) rather than OpenAI's `{error: {message, type, code}}`. The router must handle both envelopes.
- **`max_tokens` is mandatory** — omitting it returns a server error (per Spring AI docs).

## Decision against stated criteria

**Wire-it-in (go) test:**

1. ❌→✅ Quota ≥4,000 credits OR resets monthly — **fails as written** (no credits any more), but the underlying intent (sufficient capacity for eval) **passes**: rate-limited unlimited usage at 40 RPM is generous for human-in-the-loop eval.
2. ✅ ToS permits internal/dev/eval — **passes unambiguously** (*"internal testing and evaluation purposes, not in production"*).
3. ✅ ≥3 worthwhile models not already on OpenRouter — **passes**: Nemotron Ultra 253B, Nemotron Super 49B v1.5, and the NVIDIA-hosted FP-precision deployments of DeepSeek V4 Pro / Kimi K2.6 are differentiated.
4. ⚠️ OpenAI tool-use round-trip — **passes only with `stream:false`**. Streaming + tools is broken on multiple models.

**No-go disqualifiers:**

- Quota <2k/month: doesn't apply (rate-limited model).
- ToS forbids commercial use AND can't segregate: commercial production is forbidden, **but segregation is straightforward** via env-gating — passes.
- Catalogue mostly NVIDIA-only: catalogue is broad — passes.
- Bespoke request/response shaping required: partial trigger — quirks (RFC 7807 errors, mandatory `max_tokens`, `developer`→`system` coercion, no-streaming-tools) require ~30 LOC of NIM-specific shimming on top of the OpenRouter-style base adapter. Tolerable.

**→ Verdict: GO-FOR-EVAL-ONLY.**

## Recommendations — implementation sketch

Use `openrouterAdapter.ts` as the template:

1. New file `nvidiaNimAdapter.ts` (~80 LOC). Change base URL to `https://integrate.api.nvidia.com/v1`. Change `Authorization: Bearer ${NVIDIA_API_KEY}`. Drop `HTTP-Referer` and `X-Title` headers. Reuse `openaiFormat.ts` helpers verbatim for request body construction and response parsing.
2. Add NIM-specific shims:
   - Coerce `role: "developer"` → `role: "system"` in request transform.
   - Force `max_tokens` to a default (e.g. 2048) if caller omits it.
   - Force `stream: false` whenever `tools` or `tool_choice` is present (with a warning logged).
   - Error parser: try OpenAI envelope first, fall back to RFC 7807 (`detail` → `error.message`).
   - Map HTTP 402 and HTTP 429 both to a `PROVIDER_EXHAUSTED` terminal-skip error so the router does not retry.
3. Registry entry (~5 LOC): `provider: "nvidia-nim"`, `displayName: "NVIDIA NIM (eval)"`, `envGated: ["dev","staging"]`, `requiresAdmin: true`, `costPerCallUsd: 0`.
4. One env var: `NVIDIA_API_KEY` (prefix `nvapi-`).
5. Hard model allowlist in config — start with these eight, all confirmed live and tool-call-capable:
   - `nvidia/llama-3.3-nemotron-super-49b-v1.5`
   - `nvidia/llama-3.1-nemotron-ultra-253b-v1`
   - `deepseek-ai/deepseek-v4-pro` (non-streaming for tool-use)
   - `deepseek-ai/deepseek-v4-flash`
   - `moonshotai/kimi-k2.6`
   - `z-ai/glm-4.7` (preferred over `z-ai/glm-5` — see Caveats on GLM-5 deprecation)
   - `qwen/qwen3-coder-480b-a35b-instruct`
   - `meta/llama-4-maverick-17b-128e-instruct`

## Recommendations — architectural concerns

- **LLM ledger `cost` field tolerates 0.** Add an explicit assertion test that `cost: 0` records as a valid usage row. Tag the row with `provider: "nvidia-nim"` and `costMode: "free-tier"` so finance dashboards don't double-count it as missing data.
- **Provider selection is admin-only.** Surface NIM only in the admin-side eval console, never in tenant-facing model pickers. §1.4 of the ToS makes any tenant-visible exposure a contractual breach.
- **429/402 → terminal-skip.** Both codes mean "this provider is unusable right now." Map both to the same router error type that triggers immediate fall-through with no retry/backoff.
- **Synthetic-data-only policy.** Eval suites pointed at NIM must use synthetic or public-corpus prompts only. Add a CI check or env-flag (`SYNTHETOS_ALLOW_REAL_DATA=false` enforced in the NIM adapter) that refuses requests if the calling context is tagged as containing customer data. This is the §3.3(iv) compliance fence.
- **No EU PII.** The lack of region/residency commitment combined with §3.3(iv) makes any GDPR-classified personal data a hard no.

## Recommendations — staged rollout

1. **Week 1:** Land adapter + allowlist behind `FEATURE_NVIDIA_NIM=false`. Run full eval harness against three models (Nemotron Super, DeepSeek V4 Flash, Kimi K2.6) using synthetic prompts. Verify ledger writes 0-cost rows correctly. Verify 429 path skips cleanly.
2. **Week 2:** Enable in dev + staging only. Run tool-call round-trip integration test on each allowlisted model with `stream:false`. Document which models actually round-trip cleanly.
3. **Trigger to revert:** If NVIDIA reintroduces credit caps below 2k/month per account, or if the ToS is amended to remove the §1.4 internal-testing carve-out, pull the provider.

## Caveats

- **Quota opacity is real and ongoing.** NVIDIA explicitly does not publish per-model rate limits. Plan capacity by measurement, not by spec sheet. Some models (DeepSeek V4 Pro, Llama 4 Maverick) are reported by users to hit 429s during peak hours.
- **The catalogue moves fast and silently.** NVIDIA Developer Forums thread #366610 (filed April 14, 2026) reports the GLM-5 deployment page showing *"This API will be deprecated on 04/20/2026"* with the deprecation notice appearing 6 days before the deadline and no working replacement endpoint at the time. The allowlist must be reviewed monthly, not pinned, and adapters must tolerate sudden 404s on previously-working model IDs.
- **§2.3 vs §3.3(iv) ToS tension is unresolved.** A NVIDIA staff forum post (June 2025) suggests data is not retained beyond a session, but this is not a contractual amendment. Treat the literal §3.3(iv) text as the binding obligation.
- **Streaming + tool-calling is partially broken.** Until NIM fixes the Harmony-parser and DeepSeek V4 streaming-tool issues, the adapter must enforce non-streaming for tool calls. Eval reports must note tokens/sec measured under non-streaming, which is not directly comparable to other providers' streaming numbers.
- **The "100+ models" marketing number is real but inflated by non-LLM endpoints.** Speech (Riva, Parakeet), vision (NV-CLIP, Nano VL), embedding/rerank, BioNeMo, FourCastNet weather models, and image/video generation all counted. The pure-text LLM count usable for Synthetos eval is closer to 30–40.
- **"GPT-5.4" and "Gemma 4 31B" remain unconfirmed.** Treat the original marketing list with continued scepticism; the verified frontier names are the DeepSeek V4 / GLM-5 / MiniMax M2.x / Kimi K2.6 / Qwen3-coder / Llama 4 Maverick / Mistral Large 3 / Nemotron Ultra & Super set.
