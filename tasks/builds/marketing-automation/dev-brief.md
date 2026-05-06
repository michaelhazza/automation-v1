# Development Brief — Marketing Automation Surface

**Date:** 2026-05-06
**Branch:** `claude/build-marketing-automation-9FwNf`
**Author:** Main session (Opus 4.7) handing off to a future session
**Slug:** `marketing-automation`

This brief is the consolidated handoff from a one-session conversation that started with "can we build GrowOS?" and ended with "Meta just shipped a hosted MCP." It captures context, current position, recommendations, open questions, and risks so a fresh session can pick up cleanly.

It is **not** a spec. The next step (if approved) is `spec-coordinator` against this brief.

---

## Contents

1. Origin
2. Existing artefacts on this branch
3. Current position
4. Strategic framing
5. Proposed initial scope (Phase 1)
6. My thoughts (subjective)
7. Open questions for the operator
8. Risks and watch-outs
9. Suggested next step
10. Related artefacts (read order)

---

## 1. Origin

Two prompts drove this work:

1. **GrowOS reference** — a marketing-automation product that markets itself as "30+ marketing workflows, one system, zero hires." Runs locally inside Claude Code on a single user's laptop. Pitch: replaces the marketing team for solo operators and small businesses. Newsletters, social, FB ads, landing pages, video editing, carousels, YouTube thumbnails, competitor research, voice profile, scheduled publishing.
2. **Meta Ads MCP announcement** — Meta has shipped an official hosted MCP at `mcp.facebook.com/ads` with 29 tools (campaign / ad-set / targeting / copy / pixel / catalog / reporting). Free during beta. Authorised via Facebook OAuth from a Claude client. Third-party messaging is "replace the agency."

The question on the table: **what should automation-v1 build to enter this surface, and how is the build smaller / different now that hosted SaaS MCPs are landing?**

---

## 2. Existing artefacts on this branch

Both already committed and pushed:

- `tasks/builds/marketing-automation/growos-gap-analysis.md` — full capability matrix, Tier 1/2/3 build estimates, Meta MCP §7 addendum.
- `KNOWLEDGE.md` — two new entries dated 2026-05-06: (a) MCP runtime is stdio-only with file:line pointers; (b) strategic — integration moat is moving to MCP-as-transport.

A future session should read those before doing anything else. This brief assumes they exist.

---

## 3. Current position (one paragraph)

The substrate is shipped. Workflows V1 Phase 2 (PR #258), agentic commerce (PR #255), GHL Module C OAuth (PR #254), F1 sub-account baseline (PR #263), pre-launch hardening (PR #261) all landed on `main`. We have multi-tenant tiers, approval gates, agentic spending, persistent memory, scheduling, and a full MCP client primitive (30+ presets, agent links, invocation ledger). What is **not** shipped: live ad-platform writes, video composition, carousels, YouTube thumbnails, adaptive voice profile, scheduled competitor monitoring. And there is one blocking gap in the MCP runtime: it is stdio-only, so we cannot consume Meta's hosted MCP today.

---

## 4. Strategic framing (the thinking, not yet a decision)

Two viable product framings. Both work on the existing substrate.

**Option A — multi-tenant SaaS (the "agency-in-a-box" pitch).** Sell hosted accounts. Use existing org/subaccount tiers as account/brand. Pitch is "run marketing for 5+ brands with approvals, budgets, audit, scheduling." Differentiation against a solo operator wiring Meta MCP into Claude Desktop themselves is governance + multi-tenant + always-on. Strong fit for agencies. Weaker fit for the "runs on my laptop" GrowOS narrative.

**Option B — marketing skillpack on top of automation-v1 (smallest wedge).** Ship the playbook library + voice-profile capture + ad-platform MCP presets as a tenant template. Sells into existing automation-v1 customers immediately. No new platform code beyond items A1–A4 (see §5). This is probably the smallest viable shipped product.

**My read:** B is the right starting wedge — ship in 4–6 weeks, validate demand with existing customers, then decide whether to invest in a separate SaaS framing. The substrate makes both viable simultaneously, but trying to do both at once dilutes focus.

The bigger strategic point: **the integration moat is collapsing.** When Meta, Google, LinkedIn, Stripe etc. all ship their own MCPs, "we built an X adapter" stops being a differentiator. The durable moat is the governance layer that wraps MCPs: per-tenant OAuth, approval gates, spending policies, memory, scheduling, audit ledger. That layer is what Claude Desktop doesn't give you.

---

## 5. Proposed initial scope (Phase 1)

Ordered by leverage. Each item is independently shippable.

| # | Item | Effort | Why first |
|---|---|---|---|
| A1 | HTTP/SSE transport in `mcpClientManager.ts` | 2–4 days | **Blocking everything else.** Without this, no hosted MCP is consumable. Use `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk@^1.29.0`. Widen preset schema `transport: 'stdio' \| 'http'`. Branch in connect path. |
| A2 | Meta Ads MCP preset | hours | Trivial entry in `server/config/mcpPresets.ts`. OAuth provider `'facebook'`. Tool allowlist. Per-tool approval-gate flags for write tools. |
| A3 | Per-tenant Facebook OAuth → MCP credential injection | 3–5 days | Subaccount OAuth flow. Token storage in existing `connector_*` tables. Runtime token attachment. Reuse the GHL Module C two-tier token pattern (PR #254). |
| A4 | Approval-gate wrapper for MCP write tools | 3–5 days | Mark Meta MCP write tools with `requiresApproval: true` / `requiresSpend: true`. Route through existing HITL queue + agentic-commerce charge router before invocation. **This is the moat.** |
| A5 | MCP marketplace UI for subaccounts | 1 wk | Surface enabled MCPs per subaccount, OAuth connect button per preset, per-tool allowlist editor. |
| A6 | Adaptive voice profile capture | 2–3 wk | "Analyse N sample posts → extract tone signature → store in tier-1 memory." Hooks into F1 baseline artefacts already shipped. |
| A7 | Scheduled competitor monitoring playbook template | 1 wk | Wrap existing `generate_competitor_brief` skill in a scheduled playbook with delta detection + alert via email/Slack. |
| A8 | Marketing playbook library (10 starter templates) | 2–3 wk authoring | Weekly newsletter, daily social calendar, Meta ad campaign launch, landing page sprint, competitor weekly digest, lead-magnet kit, etc. Authored, not coded. |

**Total Phase 1:** ~6–8 engineer-weeks. Lands the core "marketing automation on automation-v1" product.

**Explicitly deferred to Phase 2** (consider after Phase 1 ships and gets feedback):
- Live Google Ads / LinkedIn Ads / TikTok integrations (likely also via hosted MCPs as they ship)
- Video editing / carousels / YouTube thumbnails (largest single cost; defer until demand confirmed)
- Mailgun / Twilio / SMS adapters
- Reporting Agent month-over-month delta narratives (depends on F3 baseline-capture finishing)

---

## 6. My thoughts (subjective, push back as needed)

- **A1 first, no exceptions.** Every other hosted-MCP integration depends on it. Two days of transport work unlocks an entire category.
- **Don't skip A4.** The temptation will be "Meta's MCP already validates, we don't need approval gates." That's wrong. The agency-replacement pitch turns into agency-blow-up the moment an agent launches a $5k campaign without a human check. Approval gates + spending policies are the moat, not a nice-to-have.
- **The "30+ workflows" GrowOS pitch is mostly playbook authoring, not engineering.** Once A1–A5 are in, the playbook library (A8) is markdown work, not platform work. This shifts effort allocation — most of Phase 1's perceived weight is documentation + template authoring, not new code.
- **Video editing is a trap.** 4–6 wk for a thin MVP, partner APIs are expensive, and the GrowOS demo videos are doing a lot of lifting visually. Strong recommendation: defer entirely, ship without video, see if customers ask for it.
- **The skillpack framing (Option B) compounds with existing customers.** Every existing automation-v1 tenant immediately gets marketing capability. The SaaS framing (Option A) requires net-new go-to-market. Start with B.
- **F3 baseline-capture is in PLANNING and dovetails with this.** Adaptive voice profile (A6) should coordinate with F3 — both are "the system learns about your business." Don't build twice.

---

## 7. Open questions for the operator

These need human decisions before a spec is meaningful.

1. **Framing — A, B, or both?** Recommend B as the wedge. Confirm.
2. **Is video / carousels / YouTube thumbnails in scope for Phase 1?** Recommend defer. Confirm.
3. **Live Meta API write actions — opt-in per subaccount, or default-on with allowlist?** Recommend opt-in + allowlist. Beta API risk argues for conservative default.
4. **Who authors the 10 starter playbook templates?** Engineer, content-marketer, or operator personally? They are the visible product to customers.
5. **Spending posture — what daily/monthly limit defaults make sense for marketing agents (newsletter sends, ad budgets)?** Agentic commerce can enforce; the policy values are a product decision.
6. **Pricing model if Option A (SaaS) is on the table at all** — per-subaccount, per-MCP-preset enabled, per-approval-gated-action? Defer until Option B validates demand.
7. **Is GHL the only CRM we expect customers on, or do we need HubSpot / Salesforce parity in Phase 1?** Existing skills point to HubSpot but live integration depth is unclear.

---

## 8. Risks and watch-outs

- **Meta MCP is in beta.** Tool surface, OAuth shape, and pricing can change. Treat as opt-in per subaccount with a feature flag. Have a fallback plan: direct Marketing API adapter if the hosted MCP gets deprecated or paywalled.
- **OAuth may assume interactive Claude session.** Meta MCP may not have first-class server-to-server credential flows. Verify A3 feasibility before committing engineering hours; if blocked, fallback is direct Marketing API.
- **Tool allowlisting matters.** 29 Meta tools is a wide blast radius. Default-deny write tools; explicitly enable per-subaccount with approval-gate flag.
- **Cost attribution.** Hosted MCP may not surface per-call cost. Tie `agent_charges` ledger to MCP invocation IDs, not just direct API spend.
- **Don't deprecate the substrate.** Resist skipping approval gates / spending limits because "Meta will sanity-check." We are the layer that prevents agency-replacement from becoming agency-blow-up.
- **Integration churn.** As more SaaS ships hosted MCPs, expect schema breakage. Invest in MCP version pinning + tool-schema diff alerting in the invocation ledger.

---

## 9. Suggested next step

**For the receiving session:**

1. Read this brief end-to-end.
2. Read `tasks/builds/marketing-automation/growos-gap-analysis.md` (capability matrix + Meta MCP §7 addendum).
3. Read the two new `KNOWLEDGE.md` entries dated 2026-05-06.
4. Bring the Open Questions in §7 to the operator for decisions. Do not draft a spec until §7 is resolved.
5. Once §7 is resolved, the natural sequence is:
   - `spec-coordinator` against a refined brief that incorporates the operator's §7 answers.
   - That produces `tasks/builds/marketing-automation/spec.md`.
   - Then `feature-coordinator` for Phase 1 implementation.
6. Phase 1 should treat A1 (HTTP/SSE transport) as the first chunk regardless of other §7 answers — it is unconditionally required.

**Status of this branch:** No code changes yet. Documentation only. Safe to delete the branch and start fresh from main if a different framing emerges; the gap-analysis + KNOWLEDGE entries are the only durable artefacts and they are committed.

---

## 10. Related artefacts (read in this order)

1. `tasks/builds/marketing-automation/growos-gap-analysis.md`
2. `KNOWLEDGE.md` — entries dated 2026-05-06
3. `architecture.md` — re-read sections on MCP, skill system, agentic commerce, sub-account tier
4. `docs/capabilities.md` — re-read for full skill / integration registry
5. `tasks/builds/baseline-capture/` — F3 spec (in PLANNING) intersects with A6 voice profile
6. `server/config/mcpPresets.ts` — current MCP preset registry
7. `server/services/mcpClientManager.ts` — runtime, file:line for stdio-only branch

---

*End of brief.*
