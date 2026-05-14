# MCP server publishing and A2A inbound: dev-session brief

**Status.** DEFERRED. Stored for revisit. Not on the active build list.
**Earliest revisit window.** Approximately 2-3 months from brief authoring (post product launch and stability work).
**Owner.** Product (Synthetos).
**Source material.** Three independent deep-research passes on MCP server publishing and A2A inbound (Claude, Gemini, ChatGPT). See `tasks/research-briefs/01-mcp-server-and-a2a.md` for the research prompt; raw outputs archived separately.

**Key framing.** Unlike the closed-loop and staged-rollout briefs, the three research outputs **disagree on timing** (Claude/Gemini: invest now scoped; ChatGPT: wait 6 months). The user has resolved this externally by prioritising launch and stability first. When this brief is picked up:
- Phase 1 is a 2-3 week PoC to answer three specific architectural questions (§7), not a public launch.
- Public launch is a separate decision, gated on the explicit trigger conditions in §4 plus PoC outcomes.
- A2A inbound is deferred entirely, with no PoC even at the revisit point.

**Revisit checklist (before picking this brief back up):**
- Confirm Synthetos has launched and the `docs/spec-context.md` posture has flipped accordingly.
- Re-check MCP spec status; the current target is 2025-11-25 but a newer version may be live.
- Re-check whether peer agent platforms have shipped MCP inbound (Make, n8n, Zapier, Tray, Mindstudio).
- Re-check published incident reports; the Asana / Atlassian / GitHub failure class may have new entries that change the mitigation set.
- Confirm A2A v1.x has accumulated named multi-tenant production references (or has not, in which case A2A remains deferred).

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 Why a PoC, not a full build
3. Architectural decisions for the PoC
   - 3.1 Scope (read-only, five to ten skills)
   - 3.2 Authentication and tenancy model
   - 3.3 Discovery and transport
   - 3.4 Security envelope
   - 3.5 Observability and audit
   - 3.6 A2A inbound (deferred, not even a PoC)
4. Decision criteria for full launch
5. Sequencing inside the PoC
6. Open questions for the dev session
7. Success criteria (decisional, not operational)
8. Known failure modes we are designing against
9. What this brief is not

---

## 1. One-paragraph summary

We are building a small, time-boxed proof-of-concept of an MCP server that publishes five to ten read-only Synthetos skills to external AI hosts (Claude Desktop, Cursor, ChatGPT Apps directory). Goal is not public launch; goal is to answer three architectural questions cheaply before the question becomes urgent post-launch: does the three-tier scope model map to RFC 8707 audience-bound tokens; does the capability taxonomy survive contact with real MCP host clients; what is the actual operational overhead per call. PoC runs locally and on a single test endpoint, with five named Synthetos staff as the only authenticated users. Public launch is a separate, gated decision that depends on the PoC outcomes plus explicit trigger conditions. A2A inbound is deferred entirely, with no PoC. The research is unambiguous that A2A v1.0 multi-tenancy is unproven in production and no horizontal SaaS peer has shipped it; revisit Q4 2026 / Q1 2027.

## 2. Context

### 2.1 Glossary

- **MCP (Model Context Protocol).** Open protocol governed by the Linux Foundation for AI hosts to discover and call tools, data sources, and prompts on remote servers. Spec on roughly quarterly release cadence; current target is 2025-11-25.
- **MCP server.** A service that publishes tools, resources, and prompts callable by MCP-compatible AI hosts. Synthetos becomes one of these if we publish.
- **MCP host / client.** The AI application that calls an MCP server. Production hosts in scope: Claude Desktop, ChatGPT (via Apps directory), Cursor, Windsurf, GitHub Copilot, Microsoft Copilot Studio.
- **A2A (Agent-to-Agent).** Protocol for agent-to-agent delegation across organisational boundaries. Governed by Linux Foundation. v1.0 shipped March 2026. Complementary to MCP, not competing.
- **A2A inbound.** Exposing Synthetos as a delegation target for external agents. Distinct from A2A outbound (Synthetos delegates to external agents), which is not in scope here either.
- **Streamable HTTP.** The transport mandated by MCP spec 2025-06-18 onward, replacing Server-Sent Events (SSE). Enables horizontal scaling and stateless operation behind load balancers.
- **RFC 8707 resource indicators.** OAuth 2.1 mechanism for audience-binding tokens to a specific resource server, so a token issued for one MCP server cannot be replayed against another.
- **PKCE.** Proof Key for Code Exchange. OAuth 2.1 mandate. Prevents authorization code interception.
- **CIMD (Client ID Metadata Documents).** MCP spec 2025-11-25 preferred client registration mechanism over Dynamic Client Registration (DCR). Static metadata document published at a well-known URL; clients self-register by reference.
- **`.well-known/oauth-protected-resource`.** RFC 9728 endpoint where an MCP server publishes its OAuth metadata (which authorization servers are trusted, what scopes are available).
- **Confused deputy.** Security failure class where a privileged process (the MCP server) is tricked by an unprivileged caller (the AI host) into using its authority to access resources the caller should not be able to reach. Root cause of the Asana, Atlassian, and GitHub MCP incidents in 2025.
- **Toxic agent flow.** Specific instance of confused deputy where prompt-injection content embedded in tenant data (e.g., a support ticket) causes an internal agent to exfiltrate data when the agent executes with elevated permissions.

### 2.2 What exists today (with file paths)

Everything below is operational on `main`. The PoC builds on top of these; no rework in scope.

**MCP outbound (we already consume):**
- `server/services/scraplingFetcher.ts` — Tier 3 Scrapling MCP sidecar via stdio transport (`uvx scrapling mcp`). One inbound MCP integration.
- `server/config/mcpPresets.ts` — slug `scrapling` registered.
- `server/db/schema/mcpToolInvocations.ts` — `mcp_tool_invocations` audit ledger (migration 0154), append-only, cost aggregation. Critical: this is the substrate the PoC reuses for outbound audit of inbound calls.
- `/api/iee/usage?tab=mcp` — operator-facing usage reporting.

**Capability taxonomy (the moat candidate):**
- `docs/integration-reference.md` — normalised read and write capabilities across 50+ integrations. ~25 read capabilities (`inbox_read`, `deal_list`, `contact_list`, etc.); ~40 write capabilities (`send_email`, `update_contact`, etc.).
- `server/services/integrationReferenceService.ts` — runtime parser, 60s TTL cache.

**Skill registry (the source of tool definitions):**
- `server/skills/*.md` — 100+ system skills with YAML frontmatter and parameter docs.
- `server/db/schema/systemSkills.ts` — DB-backed skill rows; `definition` (jsonb), `instructions` (text), `visibility` enum.
- `server/services/skillService.ts` — runtime resolution.

**Three-tier scope model (maps onto RFC 8707):**
- `server/db/schema/systemSkills.ts` (system tier), `server/db/schema/skills.ts` (org / subaccount tiers).
- Per-org auth boundaries enforced at the application layer. Subaccounts are tenant-isolated; cross-subaccount access is impossible by current design.

**Audit ledger (the security backstop):**
- `mcp_tool_invocations` (migration 0154) for MCP outbound calls today.
- `agent_runs`, `task_activity` for run-level audit.

**Operational posture:**
- `docs/spec-context.md` — pre-launch, no live customers, `rollout_model: commit_and_revert`. The PoC respects this; it is internal-staff-only on a non-production endpoint.

### 2.3 Why a PoC, not a full build

Three reasons:

1. **The three deep-research outputs disagree on timing.** Claude says invest now, scoped. Gemini says invest now (MCP) and defer A2A 6-9 months. ChatGPT says wait 6 months on both. When the research disagrees, the right move is to convert "guess at timing" into "measure architectural fit cheaply." The PoC produces evidence; the full build is a downstream decision.

2. **The user explicitly deferred MCP work earlier in the planning conversation** ("We aren't live yet so we will loop back to MCP later"). That signal stands. The PoC is not a contradiction of it; it is a small, decision-shaping artefact that costs 2-3 engineer weeks and produces information that would otherwise have to be guessed at launch.

3. **The pre-launch window is the cheapest moment to test architectural fit.** No installed base to migrate; no customers to communicate with; no production traffic to protect. Mistakes in the PoC are cheap. The same mistakes 12 months from now would require a customer-communication ring and a real rollback story.

What the PoC does NOT do:
- Public launch on a `mcp.synthetos.com` endpoint.
- Submission to ChatGPT Apps directory or Claude Connectors.
- Write tools (read-only only).
- A2A inbound (no work at all on A2A this phase).
- Cross-region or per-region serving.
- Production-grade rate limiting or DDoS protection.

## 3. Architectural decisions for the PoC

### 3.1 Scope (read-only, five to ten skills)

The PoC exposes a carefully chosen subset of system skills. All reads, no writes. Specific recommended set:

| Skill slug (existing) | Why included |
|---|---|
| `list_agents` | Tests discovery: can a host see what agents an authenticated org has? |
| `list_skills` | Recursive: lets a host introspect Synthetos' own taxonomy. Tests how the taxonomy renders as MCP tool descriptions. |
| `read_agent_run` | Tests run-level audit lookup. High-value for buyers who want "what did the agent do last week." |
| `read_memory_block` | Tests the memory layer's externalisation. Tests scope enforcement (an org admin can read their own memory blocks, not another org's). |
| `query_capability` | Tests the capability taxonomy as an MCP-callable surface. |
| `read_audit_log` | Tests RFC 8707 audience binding: a token issued for `mcp.synthetos.com` must not let the caller query a different audience's logs. |

Recommended set is six skills. Stay under ten. Atlassian's MCP server is 10k tokens just for tool descriptions; we need to measure our token weight before adding more.

**No write tools in the PoC.** Reasoning:
- 80% of public MCP traffic is reads anyway (CData's customer data).
- Write tools require the step-up authorization flow (SEP-835) and human-in-the-loop confirmation, which are MCP-spec features not yet stable across hosts.
- Write tools are the failure mode in Asana, Atlassian, and Replit incidents.

**Skill description format.** Each PoC skill exports an MCP tool definition with:
- `name`: human-friendly slug (e.g. `synthetos.read_agent_run`).
- `description`: one-paragraph capability description sourced from the existing skill metadata. Test how the AI host renders this; iterate.
- `inputSchema`: JSON Schema 2020-12 (MCP spec 2025-11-25 mandate).
- `_meta.synthetos.capability`: the taxonomy capability slug, exposed for clients that want to do taxonomy-aware tool selection.

### 3.2 Authentication and tenancy model

**Recommendation: OAuth 2.1 with PKCE, RFC 8707 audience binding, CIMD-first client registration with DCR fallback.** Settled industry pattern per spec 2025-11-25.

**Mapping the three-tier scope model onto the token claims:**

```
Token audience: "https://mcp.synthetos.com"  (RFC 8707 binding)
Token claims (custom):
  synthetos:tier        = "system" | "org" | "subaccount"
  synthetos:org_id      = uuid (always present)
  synthetos:subaccount_id = uuid | null
  synthetos:scopes      = ["read:agents", "read:skills", "read:memory_blocks", ...]
```

The MCP server validates the token on every request, extracts the tier and scope claims, and rejects any tool call that would access data outside the token's scope. This is the core defence against the Asana failure mode.

**Per-request tenant re-validation.** Each tool invocation re-validates that the requested resource belongs to the authenticated subaccount. Do not cache "this user is in tenant X" across requests; the Asana incident's root cause was caching tenant context without re-verification.

**Token lifetime: short.** Access tokens 1 hour. Refresh tokens 30 days. PoC uses static configuration; production would inherit from the existing user-auth lifetime policy.

**Authorization server: question for the dev session.** Options:
- (a) Stand up a minimal authorization server inside Synthetos.
- (b) Use an external auth-as-a-service (Stytch, Auth0, Descope, WorkOS Connect).
- (c) Use a managed MCP gateway provider (Cloudflare `workers-oauth-provider`).

Recommendation for PoC: (b) Stytch Connected Apps or equivalent. Cheapest to stand up; lets us validate the architecture without burning weeks on an OAuth server. Decision to keep external in production is a separate question.

**No DCR open to the public in the PoC.** Client registration is manual: we pre-register the test clients (Claude Desktop test instance, Cursor test instance) by hand. DCR/CIMD comes with public launch.

### 3.3 Discovery and transport

**Transport: Streamable HTTP.** Mandated by MCP spec 2025-06-18 onward. SSE is deprecated and sunsetting; do not implement.

**Discovery endpoints:**
- `https://mcp-poc.synthetos.com/mcp` — the MCP server endpoint.
- `https://mcp-poc.synthetos.com/.well-known/oauth-protected-resource` — RFC 9728 OAuth metadata.
- `https://mcp-poc.synthetos.com/.well-known/mcp/server.json` — MCP server card (capabilities, transports, version).

**Protocol version negotiation.** MCP spec 2025-06-18+ requires the `MCP-Protocol-Version` HTTP header on every request. PoC targets `2025-11-25` and supports negotiation back to `2025-06-18` (one minor version of backwards compatibility, no further).

**Subdomain choice.** The PoC uses `mcp-poc.synthetos.com` (distinct subdomain) so that nothing about the PoC bleeds into production DNS or branding. Public launch would move to `mcp.synthetos.com` with a fresh deployment.

**Endpoint shape: single endpoint, scope-via-token.** Major SaaS publishers (Linear, Atlassian, Stripe) all converged on a single global endpoint with OAuth scoping rather than per-tenant URLs. ChatGPT Apps directory and Claude Connectors both expect a single `.well-known` per server. Per-tenant URLs are an option for internal-only use but break public distribution.

### 3.4 Security envelope

The confused-deputy and toxic-agent-flow failure classes are structural to MCP, not implementation bugs. The PoC must demonstrate the mitigations work before any public launch is contemplated.

**Mandatory mitigations in the PoC:**

1. **RFC 8707 audience-bound tokens.** Token audience claim must match the MCP server's resource identifier. Reject any token whose `aud` claim does not match. Tested by attempting to replay a token issued for a test resource against the MCP server; the call must be rejected.

2. **Per-request tenant re-validation.** Every tool invocation re-checks that the requested resource belongs to the authenticated subaccount. No tenant context caching across requests. Tested by issuing two consecutive calls with the same token but different `resource_id` parameters that span tenant boundaries; the second must fail.

3. **Token-scope-driven tool allowlist.** The set of MCP tools visible to a caller is computed from the token's scope claims at request time. A read-only token cannot see write tools even if they exist on the server. Tested by inspecting tool discovery (`tools/list` MCP method) with different tokens.

4. **No DCR open to the public in the PoC.** Public Dynamic Client Registration is a known abuse vector; static pre-registered clients only.

5. **Prompt-injection isolation.** Tool descriptions, parameter schemas, and result payloads must never include unsanitised tenant data that could re-enter the host's prompt. Specifically: result strings are returned as data, not as instructions; the description field is static per-skill, not templated from tenant content.

6. **Step-up authorization scaffolding.** No write tools in the PoC, but the auth layer scaffolds the SEP-835 step-up flow so future write tools can require an additional scope grant per destructive action.

**Threat model the PoC must address explicitly:**

| Threat | Mitigation tested in PoC |
|---|---|
| Asana-style cross-tenant data leak | Per-request tenant re-validation; RFC 8707 audience binding |
| Atlassian-style prompt injection from tenant data | Result payloads returned as data, not instructions; no tool description templating from user content |
| GitHub-style toxic agent flow | Read-only PoC; tool allowlist driven by token scope |
| Token replay across tenants | Audience-bound tokens (RFC 8707); short token lifetime |
| Confused deputy via cached credentials | No cross-request tenant caching; explicit re-validation |

**Threat model the PoC explicitly does NOT address (deferred to launch):**
- DDoS / rate limiting (the PoC is internal-staff-only).
- Token theft / refresh token compromise at scale.
- Insider abuse (Synthetos staff with elevated credentials).
- Supply-chain attack on MCP SDK dependencies.

### 3.5 Observability and audit

**Reuse the existing `mcp_tool_invocations` ledger.** That table already captures MCP outbound calls; the PoC extends it to capture inbound calls as well. Every inbound MCP tool invocation writes a row containing:

- Token claims (org_id, subaccount_id, tier, scopes, audience).
- AI agent identity (client_id from CIMD or DCR record).
- Distinct user identity (sub claim from OAuth, if the host forwards user context).
- Tool name, input parameters, output payload size, latency, cost.
- Trace ID for distributed tracing across the call chain.

**The distinction between AI agent identity and user identity is load-bearing.** Asana's root cause was treating these as the same. Synthetos's ledger must record both: who authorised the call (user) and what is making the call (AI host / agent).

**OpenTelemetry GenAI semantic conventions.** The dev session should adopt the standard `gen_ai.*` attribute names on the trace spans so any downstream observability tooling can interpret them. Specifically:
- `gen_ai.agent.name`, `gen_ai.agent.id` — the calling AI host.
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` — token attribution.
- W3C trace context propagation so a single trace covers host → MCP server → Synthetos run → underlying integration.

**Audit-driven anomaly detection (deferred to launch, not PoC).** At launch, the audit ledger should drive automated alerts on:
- Cross-tenant resource access attempts (count should be zero in steady state; non-zero = either bug or attack).
- Unusual tool-invocation patterns per token (volume spikes, off-hours bursts).
- New client_id registrations bypassing pre-approval.

### 3.6 A2A inbound (deferred, not even a PoC)

All three deep-research outputs agree: A2A inbound is not appropriate for Synthetos in this phase.

**Reasoning:**
- A2A v1.0 (March 2026) ships multi-tenancy support on paper, but named production references are pairwise integrations (PayPal/Google, ServiceNow/Google), not horizontal SaaS-to-many-tenants exposure.
- No peer agent platform (Make, n8n, Zapier, Tray) has shipped A2A inbound at the time of writing.
- A2A's economic primitives (metering, billing, liability across agent boundaries) are immature.
- The security model for A2A multi-tenant inbound is even less battle-tested than MCP's.

**Trigger to revisit:** Q4 2026 / Q1 2027, conditional on at least one of:
- A horizontal SaaS peer ships A2A inbound and publishes a multi-tenant reference architecture.
- A2A v1.x ships native standardised billing primitives (AP2 integration matures).
- A Synthetos customer specifically asks for A2A delegation (concrete buyer signal, not speculative).

**What we do NOT do now:**
- No A2A reference reading or experimentation.
- No A2A-shaped code in the MCP PoC.
- No A2A in the public messaging.

The brief leaves a placeholder for A2A in the architecture (the MCP audit ledger and capability taxonomy are protocol-neutral), but commits no engineering effort.

## 4. Decision criteria for full launch

PoC outcomes plus external triggers together determine whether to proceed to public launch. Three possible verdicts:

**Pull forward to public launch (build full MCP server within one quarter)** if all of the following are true:
- PoC's three architectural questions (§7) returned green answers.
- At least one of: (a) a peer agent platform (Make, n8n, Zapier, Tray, Mindstudio) shipped MCP inbound and reported an attached deal; (b) two of the first ten paying Synthetos customers in discovery raised MCP-callability unprompted; (c) a strategic partner explicitly requested MCP support as a deal precondition.
- MCP spec is stable for at least one minor release cycle without breaking changes.
- No new Asana-class cross-tenant incident in the previous quarter from a multi-tenant MCP publisher.

**Hold steady (PoC stored, revisit per natural trigger)** if:
- PoC answered green but no external buyer signal yet.
- Or spec moved sufficiently that the PoC needs refresh before public launch.

This is the default state and is consistent with the user's "2-3 months away" framing.

**Strip back or skip entirely** if any of:
- PoC reveals the three-tier scope model does not map cleanly to RFC 8707 (would need significant scope-model rework before public launch).
- PoC reveals cost-per-call overhead is high enough to change unit economics.
- A cross-tenant near-miss in the audit ledger takes more than 24 hours to triage during PoC.
- After launch, the first ten paid prospects collectively raise MCP-callability zero times in discovery and at least three raise CRM/Slack integration depth.

## 5. Sequencing inside the PoC

Time-boxed to 2-3 engineer weeks. Not on the critical path; runs alongside launch work.

**Step 1 (2 days). Reference reading + spec lock.** Read MCP spec 2025-11-25, RFC 8707, RFC 9728, OAuth 2.1 specs. Pick auth provider (Stytch / Auth0 / Descope / WorkOS). Pick deployment target (Cloudflare Workers / Synthetos own infra). Write a one-pager design before code.

**Step 2 (3-4 days). Endpoint + auth.** Stand up `mcp-poc.synthetos.com/mcp` with Streamable HTTP transport. Wire OAuth 2.1 with PKCE through the chosen provider. Implement RFC 8707 audience binding in token validation. Pre-register two test clients (Claude Desktop, Cursor). Publish `.well-known/oauth-protected-resource` and `.well-known/mcp/server.json`.

**Step 3 (3-4 days). Five to six tools.** Wire the six skills from §3.1 as MCP tools. Build the tool-definition pipeline that converts existing skill metadata into JSON Schema 2020-12. Test that each tool round-trips correctly through Claude Desktop and Cursor.

**Step 4 (2-3 days). Audit and observability.** Extend `mcp_tool_invocations` ledger to capture inbound. Add OpenTelemetry GenAI semantic conventions to the trace spans. Confirm that distinct AI agent identity and user identity are both recorded.

**Step 5 (2-3 days). Security tests.** Execute the threat-model tests from §3.4: token replay across tenants, cross-tenant resource access, prompt injection from tool result payloads, tool-scope enforcement. Document outcomes. Any failure pauses the PoC for design review before public launch is considered.

**Step 6 (2 days). Outcome write-up.** Answer the three success-criteria questions from §7. Write a one-page outcome doc. Recommend pull-forward / hold-steady / strip-back per §4.

## 6. Open questions for the dev session

1. **Authorization server: external SaaS or build in-house?** Recommended for PoC: external (Stytch or Auth0). Production decision is separate.
2. **Deployment target: Cloudflare Workers or Synthetos own infra?** Workers is faster to stand up and is the most-published reference architecture, but introduces a dependency. Recommend Workers for PoC; production decision deferred.
3. **Token-claim shape: standard OAuth scopes or custom Synthetos claims?** Standard scopes are interoperable; custom claims map more cleanly to the three-tier model. Recommended: hybrid — standard scopes for action class (read / write), custom claims for tier and IDs.
4. **Tool selection beyond the six PoC skills.** Which five additional read skills are most valuable to test? Recommended: pick after the first six land, based on what AI hosts actually call.
5. **Operator visibility: do customers see what an MCP host is doing via the MCP integration?** This is an open product question. Recommended for PoC: log everything to `mcp_tool_invocations` and defer the UI surface. Customers should see this at launch; PoC ships without it.
6. **Naming: `mcp-poc.synthetos.com` vs other subdomain.** Cosmetic but worth deciding upfront so DNS, certificate, and CIMD documents are consistent.
7. **Documentation: minimal `docs/mcp-server.md` or full publication?** Recommended: minimal internal doc only; no public-facing docs until the launch decision is made.

## 7. Success criteria (decisional, not operational)

The PoC succeeds if it produces clear answers to three architectural questions. It does NOT succeed by passing a synthetic benchmark or being feature-complete.

**Question 1: Does the three-tier scope model map cleanly to RFC 8707 audience-bound tokens?**

Green answer: token validation enforces tenant boundaries with no application-layer fallbacks. Cross-tenant access attempts (deliberately tested) are rejected at the token-validation layer. The auth substrate scales naturally to write tools and new scopes without rework.

Amber answer: it works but requires non-trivial bespoke claim parsing or application-layer checks. Production launch is possible but adds risk.

Red answer: the three-tier model does not map onto OAuth scopes without significant rework. Pull the brief back to product; the scope-model question becomes a separate architectural decision.

**Question 2: Does the capability taxonomy survive contact with real MCP host clients?**

Green answer: AI hosts (Claude Desktop, Cursor) reliably select the right Synthetos tool from natural-language user requests, without hallucinating non-existent parameters. Tool descriptions sourced from the taxonomy render usefully in the host UI.

Amber answer: works for simple cases but breaks on edge cases (ambiguous user requests trigger wrong tool selection more than 20% of the time). Investigation needed.

Red answer: taxonomy descriptions confuse the AI hosts; tool selection fails frequently. Requires re-write of the taxonomy or a different tool-description strategy.

**Question 3: What is the actual operational overhead per call?**

Concrete metrics to measure across at least 200 PoC calls:
- Token weight of tool definitions (Atlassian's 10k for two products is the cautionary anchor; ours should be <3k for six tools).
- Median latency overhead vs. direct skill invocation (target: <300ms additional).
- Audit ledger write cost per call.
- Auth provider cost per request (if external).

Green answer: numbers are within targets. Public launch unit economics work.
Amber answer: overhead is high but not prohibitive. Optimisation work required before launch.
Red answer: overhead breaks unit economics. Re-architect or shelve.

## 8. Known failure modes we are designing against

All anchored to public incidents from the last 18 months.

- **Asana cross-tenant data leak (June 2025, ~1,000 customers, 12 days offline).** Root cause: MCP server cached responses without re-verifying tenant context per request; user-token auth without AI-agent identity layer. *Mitigation:* per-request tenant re-validation (no caching); RFC 8707 audience binding; distinct AI agent and user identity in audit ledger.
- **Atlassian Jira Service Management toxic agent flow (June 2025, Cato Networks PoC).** External user submits ticket with prompt-injection payload; internal engineer invokes MCP-driven action; payload executes with engineer's permissions; tenant data exfiltrates. *Mitigation:* result payloads returned as data, not instructions; no tool description templating from user content; step-up authorization scaffolding for any future write tools.
- **GitHub MCP toxic agent flow (May 2025, Invariant Labs).** Same shape as Atlassian. *Mitigation:* as above.
- **Anthropic Git MCP server CVEs (CVE-2025-68143/68144/68145, patched mcp-server-git 2025.12.18).** Injection-chain bugs in a first-party server. *Mitigation:* SDK dependencies pinned; quarterly review of MCP-related CVEs.
- **Asana-style operational failure: 24-hour-plus rollback.** *Mitigation:* PoC is internal-only; no public users to disconnect; full rollback is a DNS flip.
- **Spec churn (28% of dead MCP servers killed by the post-batching/post-session-refactor break).** *Mitigation:* target spec 2025-11-25 explicitly; don't ship support for the previous version unless a strategic host requires it; budget one engineer-week per quarter for spec maintenance in any post-launch operation.
- **Token bloat from tool definitions.** Atlassian's 10k tokens for two products' tools breaks production agent loops. *Mitigation:* hard cap of <3k tokens for the six PoC tools; if breached, the taxonomy needs work before more tools are added.
- **Confused deputy via cached credentials.** *Mitigation:* explicit no-caching rule on tenant context; per-request validation; tested deliberately in the PoC security suite.
- **DCR-typosquatting / poisoned-well attacks.** *Mitigation:* no public DCR in PoC; static pre-registered clients only; CIMD-first when public.

## 9. What this brief is not

Not a spec. The PoC dev session produces the spec for the PoC itself.

Not a commitment to ship the PoC in the next sprint. The user has deferred this work explicitly until after product launch (~2-3 months out). This brief is stored for revisit.

Not a commitment to public launch. The PoC is decisional. Public launch is a separate decision gated on §4.

Not an A2A inbound brief. A2A is deferred entirely, no PoC, no exploration this phase.

Not a marketing pitch. Public framing, when it happens, is "Synthetos exposes its skills as standard MCP tools so any AI host can call them." Never "we have an agent protocol strategy."
