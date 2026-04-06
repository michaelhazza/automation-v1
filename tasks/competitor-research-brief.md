# Competitor Research Brief — Automation OS

## Objective

Research and analyse competitors to our Automation OS platform. For each competitor, identify what they do well, where they fall short, and what we can learn from them. Output should be actionable — not just a list, but insights we can use to improve our product.

---

## What Our Product Does

Automation OS is an **AI agent orchestration platform** built for agencies and businesses managing multiple clients. Key capabilities:

### Core Architecture
- **Three-tier agent model**: System Agents (platform IP) → Org Agents (business-level) → Subaccount Agents (per-client). This lets agencies deploy standardised AI agents across all their clients while allowing per-client customisation.
- **Multi-tenant by design**: Organisations manage multiple subaccounts (clients), each with their own board, agents, and configurations.

### Agent System
- **Autonomous AI agents** that run on schedules (heartbeat system) or are triggered by events
- **Agent hierarchy** with orchestrator and specialist roles
- **Sub-agent spawning** — agents can delegate work to other agents (up to 5 levels deep)
- **41 built-in skills** including: task management, code review, web search, email, screenshot capture, anomaly detection, churn risk scoring, health scoring, architecture planning, Playwright testing, and more
- **Custom skill creation** at org level

### Task & Workflow
- **Kanban board** per subaccount with customisable columns
- **Subtask system** with reactive orchestration — completing a subtask automatically wakes the orchestrator
- **Human-in-the-loop (HITL)** review gates — agents can escalate for human approval before acting
- **Policy engine** — rules that constrain agent behaviour (require escalation, block actions, etc.)

### Integrations & Infrastructure
- **GitHub App integration** — issues/comments create tasks automatically
- **Workspace memory** with embeddings for semantic search — agents accumulate context across runs
- **Real-time WebSocket updates** to the UI
- **Cost tracking & budget enforcement** per-run and per-org with LLM token tracking
- **Audit logging** for all significant actions

### Target Users
- Digital agencies managing multiple client accounts
- Businesses wanting to deploy AI agents for operational automation
- Teams needing human oversight of AI agent actions

---

## Research Categories

### Category 1: AI Agent Platforms (Direct Competitors)
Platforms that let users build, deploy, and manage autonomous AI agents.

Research these specifically:
- **CrewAI** — multi-agent orchestration framework
- **AutoGen (Microsoft)** — multi-agent conversation framework
- **LangGraph / LangChain** — agent framework with graph-based orchestration
- **Relevance AI** — no-code AI agent platform
- **Lindy AI** — AI agent builder for business workflows
- **Cassidy AI** — AI agent platform for teams
- **AgentOps** — agent monitoring and observability
- **Composio** — tool/integration layer for AI agents

### Category 2: AI Workflow / Automation Platforms
Platforms that automate workflows using AI, even if not agent-centric.

- **n8n** (with AI nodes) — open-source workflow automation
- **Make.com** (formerly Integromat) — visual automation with AI capabilities
- **Zapier** (with AI features) — automation with AI actions
- **Activepieces** — open-source automation alternative
- **Respell** — AI workflow builder

### Category 3: AI-Powered Agency/Client Management
Platforms specifically targeting agencies with AI capabilities.

- **GoHighLevel** — agency CRM/automation (increasingly AI-focused)
- **Vendasta** — white-label platform for agencies
- **DashClicks** — agency automation platform
- **SEMrush / Agency tools** with AI features

### Category 4: Emerging / Novel Approaches
New entrants or novel approaches worth tracking.

- **OpenAI Agents SDK** — OpenAI's own agent framework
- **Anthropic Claude with tool use** — as a direct agent runtime
- **Devin / Cognition Labs** — autonomous AI developer
- **PraisonAI** — multi-agent framework (we've already looked at this — see tasks/praisonai-learnings.md)
- **Semantic Kernel (Microsoft)** — enterprise AI orchestration
- Any other notable entrants found during research

---

## For Each Competitor, Answer

1. **What is it?** — One-paragraph summary of the product and its positioning
2. **Target audience** — Who are they built for?
3. **Core differentiator** — What's their unique angle?
4. **Agent model** — How do they structure agent capabilities? Single agent, multi-agent, hierarchical?
5. **Skill/tool system** — How do agents gain capabilities? Plugin marketplace, API integrations, custom code?
6. **Human oversight** — Do they have HITL, approval gates, or policy controls?
7. **Multi-tenancy** — Can one org manage multiple client accounts?
8. **Pricing model** — How do they charge? Per agent, per run, per seat, usage-based?
9. **Strengths** — What do they do better than us or that we don't do at all?
10. **Weaknesses** — Where do they fall short?
11. **What we can learn** — Specific, actionable takeaways for our product

---

## Synthesis Questions

After researching all competitors, answer these strategic questions:

1. **Positioning gap**: Is there a clear market position that no one owns that we could claim?
2. **Feature gaps**: What capabilities do multiple competitors have that we lack?
3. **Over-engineering risk**: Are we building things no competitor bothers with? If so, is that a moat or wasted effort?
4. **Agency angle**: How strong is our agency/multi-tenant positioning vs. competitors? Is anyone else doing this well?
5. **Skill marketplace**: Should we have a public skill marketplace? Who does this well?
6. **Pricing insights**: What pricing models seem to work? What should we consider?
7. **Integration priorities**: Based on competitor offerings, what integrations should we prioritise next?
8. **UX patterns**: What UX patterns or metaphors do successful competitors use that we should consider?
9. **Go-to-market**: How are competitors acquiring users? What channels work?
10. **Moat assessment**: What aspects of our architecture (three-tier model, skill system, HITL, policy engine) are genuine differentiators vs. table stakes?

---

## Output Format

Structure the output as:
1. **Executive summary** (1 page) — key findings and top 5 actionable recommendations
2. **Competitor profiles** — one section per competitor using the template above
3. **Comparison matrix** — feature comparison table
4. **Strategic recommendations** — detailed answers to synthesis questions
5. **Priority actions** — ranked list of what to do based on findings

---

## Notes

- Focus on depth over breadth. A thorough analysis of 10 competitors is better than a shallow scan of 30.
- Prioritise competitors that target similar users (agencies, multi-client businesses).
- Include pricing where publicly available.
- Flag any competitors that have raised significant funding recently — indicates market validation.
- Check Product Hunt, G2, and Capterra for user sentiment where available.
