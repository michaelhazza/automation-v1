# Research brief: MCP server publishing and A2A inbound — invest now or wait?

## Context

I run product on a multi-agent business automation platform (Synthetos) aimed at agencies managing many client subaccounts. We already consume one MCP sidecar inbound (Scrapling for web fetching). We do **not** publish our own skills as an MCP server, and we have no agent-to-agent (A2A) inbound surface.

We have:

- A registry of 100+ skills, each with metadata, parameter schemas, and a runtime handler.
- A three-tier scope model: system, organisation, subaccount, with per-org auth boundaries.
- An audit ledger covering tool invocations, costs, and run lineage.
- A capability taxonomy that normalises 50+ OAuth integrations into a common read/write vocabulary.

We are pre-launch (no live external customers yet). Deciding whether to invest in MCP-server publishing and A2A inbound as a top-three near-term initiative, or defer 6 to 12 months.

## What would change my mind?

I want a structured pressure-test of treating MCP-server-and-A2A as a top-three near-term investment. Specifically:

1. **Spec maturity as of mid-2026.** Has A2A consolidated on a single specification, or is the landscape still fragmented across competing protocols? Where is MCP itself in terms of breaking changes, multi-tenant auth conventions, and discovery patterns?

2. **Production patterns from MCP server publishers.** What discovery, auth (especially OAuth bearer flows), rate-limit, and observability patterns are settling for SaaS systems exposing capability via MCP? What specifically has broken for early adopters?

3. **Multi-tenant MCP serving.** For a system where each tenant has its own auth boundary, what's the right shape? Per-org endpoint URLs, dynamic capability registration, scoped tokens? Reference architectures from public deployments would help.

4. **Is it moving deals yet?** Concrete evidence that being MCP-callable or A2A-callable is shifting buyer or partner decisions in 2026, vs. still being a novelty checkbox.

5. **The skeptic's case.** Make the strongest argument against investing in 2026 specifically. What would a thoughtful CTO say is wrong with this bet?

## Output I want

A short verdict (invest now, invest in 6 months, don't invest) plus the strongest two arguments for each option, anchored to specific public examples, GitHub repos, blog posts, or papers from the last 12 months. No generic overview content. If a question can't be answered from public sources, say so explicitly.
