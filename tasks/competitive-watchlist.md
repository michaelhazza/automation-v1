# Competitive Watchlist

**Purpose:** Pre-written decision criteria for external events that would change Automation OS's strategic direction. The value of this file is not the tracking — it is that **the decision is written down in advance**, so when one of these events happens, the response is a reflex, not a debate.

**How to use:**
- When you read news or release notes about any entry below, check whether "What to watch for" matches what shipped.
- If it does, execute the "If any of those ship, we" clause. Do not re-derive the decision from scratch.
- Update "Last checked" every time you look, even if nothing changed.
- Add a new entry when a new credible threat surfaces. Archive entries that are no longer relevant at the bottom under `## Archived`.

**What does NOT belong here:**
- Tactical features other products ship that don't change our positioning (those go in `tasks/todo.md`).
- Model benchmarks / leaderboards (noise — ignore unless a capability jump directly invalidates a bet).
- News we have no decision attached to. If you find yourself adding an entry without a pre-written "if X, we do Y", you are not watching it — you are collecting it. Skip it.

---

## Claude Managed Agents (Anthropic)

- **What it is:** Hosted agent runtime with sandboxed execution, scoped permissions, spend limits. Launched April 8, 2026.
- **Why it matters:** Commoditises our IEE worker and parts of our governance stack (confidence-escape, reflection loop, budget enforcement).
- **What to watch for:**
  1. **Multi-tenant mode for agencies** — ability to run child tenants with isolated state, policy, and billing under a single parent account.
  2. **Per-sub-account policy scoping** — rules that apply at a nested tenant level, not just at the org level.
  3. **Cost attribution across child tenants** — per-sub-account cost reporting that an agency could resell.
- **If any of those ship, we:**
  - Stop further IEE investment. Freeze the worker at current feature level.
  - Evaluate offloading execution to Managed Agents while keeping our orchestration, multi-tenant, and portfolio-reporting layer on top. Treat IEE as a short-term substrate that is being replaced.
  - Reposition the product pitch so "we manage Managed Agents across all your clients" is explicit rather than "we ship our own execution environment."
- **If none ship within 12 months:**
  - IEE remains substrate. Keep investing in audit trail, per-tenant quotas, and worker hardening.
- **Last checked:** 2026-04-11 — GA launch confirmed, no multi-tenant mode in public docs, no agency tier announced.

---

## Microsoft Agent Governance Toolkit

- **What it is:** Open-sourced April 2, 2026. Sub-millisecond policy enforcement across the OWASP agentic AI risks, semantic intent classification, automated kill switches.
- **Why it matters:** Directly commoditises parts of our middleware pipeline (topic filtering, policy engine, kill switch). If it reaches feature parity with our preTool middleware, governance stops being a differentiator even as table stakes.
- **What to watch for:**
  1. **Multi-tenant policy scoping** — the ability to apply different policy rules per downstream tenant, not just per org.
  2. **Integration with non-Microsoft agent frameworks** — whether it works outside Copilot Studio / Azure AI Foundry, or stays inside the Microsoft walled garden.
  3. **Adoption signal** — meaningful enterprise deployments where AGT is the governance layer rather than a bolted-on checkbox.
- **If any of those ship, we:**
  - Stop positioning the middleware pipeline as a differentiator.
  - Migrate our framing to "multi-tenant portfolio operations" (which AGT does not address) and make governance invisible substrate.
  - Evaluate whether we can consume AGT as the policy-enforcement engine rather than maintaining our own.
- **If it stays inside the Microsoft stack:**
  - Keep the middleware pipeline as substrate. The commoditisation argument only applies if AGT is actually adoptable by non-Microsoft platforms.
- **Last checked:** 2026-04-11 — open-sourced on GitHub, no multi-tenant scoping documented, adoption outside Microsoft stack unclear.

---

## GoHighLevel Agent Studio

- **What it is:** GHL's native AI agent authoring and deployment surface. Currently supports chat and voice agents in the AI Employee Suite at $97/month. MCP support announced. Roadmap includes expanded agent types.
- **Why it matters:** This is the single biggest existential risk. If GHL ships per-sub-account governance and cross-location reporting natively in Agent Studio, our GHL-agency wedge closes before we reach market. They own the distribution channel, the identity layer, and the billing relationship with the agencies we want to sell to.
- **What to watch for:**
  1. **Per-sub-account governance** — ability for an agency to set different policy rules, approval flows, or budget caps per client location from one dashboard.
  2. **Cross-location reporting** — portfolio-level analytics that roll up health scores, costs, and activity across all sub-accounts in an agency's roster.
  3. **Multi-agent orchestration** — native support for agents that hand off work to other agents, or playbook-style multi-step workflows.
  4. **Pricing changes to AI Employee Suite** — drop from $97/month towards $20-30/month, or a free tier, signalling GHL wants to commoditise this themselves.
- **If (1) or (2) ship before we have 5 paying design-partner agencies, we:**
  - Pivot away from a pure GHL-agency wedge.
  - Evaluate Pivot Option B (Vertical Agent Factory — Marketing Agency Edition) from the research brief as the replacement.
  - Keep the multi-tenant architecture — it is still substrate — but stop targeting GHL specifically.
- **If (3) ships:** Less urgent, because Playbooks is genuinely differentiated on DAG semantics, side-effect classification, and mid-run editing. Watch for whether GHL's version handles the edge cases we do.
- **If (4) ships:** It means GHL is treating AI as table stakes, not a premium add-on. Reconsider whether agencies will pay us for a layer on top of a commodity.
- **If none of these ship within 6 months:** the wedge is still open. Keep executing.
- **Last checked:** 2026-04-11 — AI Employee Suite confirmed at $97/month, MCP support announced, no per-sub-account governance documented, no cross-location reporting surfaced in the agency dashboard.

---

## Archived

*(None yet. Add entries that are no longer actionable here with a note on why, so the history is preserved.)*

---

## Review cadence

- **Weekly pass:** 5 minutes of scanning the three entries above during your strategic thinking time. Update "Last checked" on each.
- **On major model release:** re-check the "scaffolding vs substrate" implications for every bet the frontier model now absorbs natively.
- **On GHL announcement:** read the announcement in full, compare against the "What to watch for" bullets for GHL Agent Studio, and act if any trigger fires.
- **On entering a new sales conversation:** re-read this file. Agencies may know about one of these events before you do.

The review cadence matters less than the pre-written decisions. If you never review this file but a news item lands in your feed that happens to match a watch bullet, the file still works — because the decision was made in advance.
