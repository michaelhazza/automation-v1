# NVIDIA NIM Free Tier — Viability Research Brief for Synthetos

**Status:** Research / pre-decision. Not a spec, not a plan.
**Branch context:** `claude/nvidia-api-integration-4JXE1` (exploration only).
**Audience:** A separate Claude session tasked with verifying claims and producing a go / no-go recommendation.

---

## 1. What we already think we know (verify or refute)

- **Endpoint:** `https://integrate.api.nvidia.com/v1` — OpenAI-compatible chat completions.
- **Free tier (personal account):** 1,000 lifetime inference credits, 40 RPM rate limit, no credit card required.
- **Free tier (developer program / business email):** *claimed* ~4,000–5,000 credits — **UNVERIFIED, this is the key claim to confirm**.
- **Catalogue:** 100+ models including open-weight families (Llama, Mistral, Gemma, DeepSeek variants) and NVIDIA's own Nemotron series. The originating marketing post named several models with version numbers that do not match any model I can verify (e.g. "GPT-5.4", "GLM-5.1", "DeepSeek V4 Pro", "MiniMax M2.7", "Gemma 4 31B"). Treat the catalogue claims as marketing hype until checked against `build.nvidia.com` directly.
- **Metering:** believed to be per-request (1 credit = 1 inference call), not per-token. Verify.

## 2. Questions the research session must answer

### Tier & quota mechanics
1. Confirm the exact free-tier quota structure as of the research date — personal vs. developer-program vs. business-account distinctions.
2. Is the 1,000-credit pool **lifetime** or **resetting** (monthly / daily)?
3. Is metering per-request, per-token, or model-tier-weighted?
4. What's the actual rate limit (RPM, TPM, concurrent requests)?
5. What happens when credits hit zero — hard cutoff, throttle, or paid-card prompt?

### Catalogue reality check
6. Pull the live model catalogue from `build.nvidia.com` (or the API's `/v1/models` endpoint if available). List the open-weight frontier models actually available — names, parameter counts, context windows, latency tier.
7. Which models on the free tier are genuinely useful for **agentic / tool-use** workflows (not just chat)? OpenAI tool-call format must work end-to-end.
8. Are there per-model rate or quota differences? (Some providers gate frontier models behind separate allowlists even within "free".)

### Terms of service
9. Can the free tier be used for **commercial production** workloads, or is it dev / eval / personal use only? Read the actual ToS, not the marketing page.
10. Data handling: does NVIDIA train on inputs? Retain logs? Is there an opt-out? Critical for our multi-tenant posture — Synthetos handles customer CRM data via skills.
11. Region / data-residency commitments (EU customers will ask).
12. Per-account vs. per-organisation limits — does signing up multiple personal accounts violate ToS?

### OpenAI compatibility surface
13. Does the endpoint support tool-calling (`tools`, `tool_choice`)? Streaming? JSON mode / structured outputs? Vision inputs?
14. Are response shapes byte-compatible with `openaiFormat.ts` parsing, or are there NVIDIA-specific deviations (e.g. `usage` field shape, `finish_reason` values, tool-call ID formats)?
15. How are errors returned — same `error.message` envelope as OpenAI, or different? Affects `adapterErrors.ts` mapping.

## 3. Synthetos-specific context the researcher needs

### Where it would plug in
- **Provider adapter pattern:** `server/services/providers/` — `openaiAdapter.ts` (77 LOC), `anthropicAdapter.ts` (219 LOC), `geminiAdapter.ts` (182 LOC), `openrouterAdapter.ts` (80 LOC), `registry.ts` (127 LOC).
- **Best template:** `openrouterAdapter.ts` — already an OpenAI-compatible-with-different-base-URL adapter. An NVIDIA adapter would be a near-clone: change base URL, change `Authorization` header, drop `HTTP-Referer` / `X-Title`, reuse `openaiFormat.ts` helpers verbatim.
- **Estimated implementation:** ~80 LOC adapter + ~5 LOC registry entry + 1 env var (`NVIDIA_API_KEY`) + model allowlist in config. Half a day including tests, assuming compatibility holds.

### Where it would NOT fit
- **Production agent execution path.** The 40 RPM ceiling and ~1k–5k lifetime quota make this unsafe to wire as a primary or even fallback provider for live tenants. A single tenant with one busy automation can burn the budget in minutes; rate-limit storms would degrade unrelated tenants if it sat in a shared failover chain.
- **Customer-data workloads** until ToS § data-handling is verified clean.

### Where it WOULD fit
- **Internal model evaluation.** Compare candidate models on a fixed prompt suite before adding them to a paid provider's allowlist. The current path requires either local Ollama (limited model selection) or burning OpenRouter / OpenAI / Anthropic credits during eval.
- **Dev-environment fallback.** Engineers running the stack locally without per-developer paid keys.
- **Throwaway prototyping** for new agent skills before deciding whether the skill warrants production budget.
- **Skill analyzer / batch jobs** that run offline and can tolerate hitting a quota wall — see `server/jobs/skillAnalyzerJob.ts`.

### Architectural concerns the researcher should flag
- Per-tenant attribution: Synthetos already meters LLM spend per agent run via the LLM ledger (`server/jobs/llmLedgerArchiveJob.ts`, `agentSpendRequestHandler.ts`). Free-tier calls have zero cost but should still flow through the ledger for usage tracking — does the existing `cost` field tolerate `0`?
- Provider selection: today provider/model is selected via the agent's config. If NVIDIA gets added, who can select it — every tenant, or admin-only? Free-tier exhaustion would silently fail tenant runs.
- Failover: if NVIDIA is in the failover chain and credits are exhausted, the failure mode (HTTP 429? 402?) needs to map cleanly through `adapterErrors.ts` so the router skips it instantly rather than retrying.

## 4. Decision criteria — when is this worth wiring up?

Wire it in if all four hold:
1. Developer-tier quota is **≥4,000 credits OR resets monthly**.
2. ToS permits at least internal / dev / eval use without ambiguity.
3. Model catalogue includes ≥3 models we'd actually want to evaluate that aren't already accessible via OpenRouter at comparable quality.
4. OpenAI compatibility passes a real tool-use round-trip (not just plain chat).

Skip it if any of:
- Quota is per-account-per-month <2k credits (too small to matter, eval workloads alone burn that).
- ToS forbids commercial / production-adjacent use AND we can't reliably segregate.
- Catalogue is mostly NVIDIA-only branded models (Nemotron family) — we already have stronger reasoning models available via paid providers.
- Compatibility requires bespoke request/response shaping (defeats the "thin adapter" advantage).

If the answer is "wire in for eval only": ship as an env-gated provider visible only in non-prod environments, with a hard-coded model allowlist and a separate ledger tag so its usage doesn't pollute production cost analytics.

## 5. Sources to check

- `https://build.nvidia.com` — live model catalogue and per-model quota disclosure.
- NVIDIA Developer Program signup flow — actual quota shown post-signup, not marketing copy.
- NVIDIA NIM API docs — OpenAI-compatibility surface, error envelope, streaming spec.
- NVIDIA NIM Terms of Service and Acceptable Use Policy — commercial use, data handling, training opt-out.
- Recent (within 90 days) third-party teardowns / Hacker News threads — quota and ToS change frequently.
- The `/v1/models` endpoint on `integrate.api.nvidia.com` — ground truth for which models are actually callable, vs. what's listed in the showroom.

## 6. Output the research session should produce

A short report (≤2 pages) with:
- A table: claim → verified / refuted / unknown → source link.
- A "go / no-go / go-for-eval-only" recommendation against the criteria in §4.
- If go: a one-paragraph implementation sketch referencing `openrouterAdapter.ts` as the template, plus the specific model allowlist worth starting with.
- If no-go: the single most disqualifying finding, so we don't re-litigate it later.

Save the report alongside this brief: `tasks/nvidia-nim-research-findings.md`.
