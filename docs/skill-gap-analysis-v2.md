# Automation OS -- Skill Gap Analysis
### System Agent Skill Inventory, Gaps, and Design Notes

**Version:** 2.0
**Date:** April 2026
**Status:** Pre-implementation reference -- produced before any new skill specs are written
**Source documents:** System Agents Master Brief v5.0, System Skills Inventory (53 skills), Claude Code initial analysis, marketingskills repository (coreyhaines31/marketingskills) research pass

---

## Table of Contents

- [Summary](#summary)
- [Skill Gap by Agent](#skill-gap-by-agent)
  - [Agent 1: Orchestrator (COO)](#agent-1-orchestrator-coo)
  - [Agent 2: Business Analyst](#agent-2-business-analyst)
  - [Agent 3: Dev Agent](#agent-3-dev-agent)
  - [Agent 4: QA Agent](#agent-4-qa-agent)
  - [Agent 5: Support Agent](#agent-5-support-agent)
  - [Agent 6: Social Media Agent](#agent-6-social-media-agent)
  - [Agent 7: Ads Management Agent](#agent-7-ads-management-agent)
  - [Agent 8: Email Outreach Agent](#agent-8-email-outreach-agent)
  - [Agent 9: Strategic Intelligence Agent](#agent-9-strategic-intelligence-agent)
  - [Agent 10: Finance Agent](#agent-10-finance-agent)
  - [Agent 11: Content and SEO Agent](#agent-11-content-and-seo-agent)
  - [Agent 12: Client Reporting Agent](#agent-12-client-reporting-agent)
  - [Agent 13: Onboarding Agent](#agent-13-onboarding-agent)
  - [Agent 14: CRM and Pipeline Agent](#agent-14-crm-and-pipeline-agent)
  - [Agent 15: Knowledge Management Agent](#agent-15-knowledge-management-agent)
- [Cross-Agent Analysis](#cross-agent-analysis)
- [Architecture Decisions Required Before Writing Specs](#architecture-decisions-required-before-writing-specs)
- [Research-Informed Additions (v2.0)](#research-informed-additions-v20)
- [Recommended Order for Writing Skill Specs](#recommended-order-for-writing-skill-specs)
- [On External Research](#on-external-research)

---

## Summary

The 15-agent roster requires a total of **44 skill slot references** that point to skills not yet in the codebase. After deduplication (some skills are shared between agents), this resolves to **41 unique new skill files** to write.

**Change from v1.0:** A research pass against the marketingskills open-source repository identified 5 genuine gaps not present in the original analysis. Agent 9 (Strategic Intelligence) is no longer fully covered -- it was missing two structured output skills that the original analysis overlooked by treating raw web search as sufficient. Agent 11 (Content and SEO) gains two additional skills. Agent 14 (CRM and Pipeline) gains one additional skill. The research-informed additions are marked throughout with a `[v2 addition]` tag and are consolidated in a dedicated section at the end of this document.

Two agents are fully covered by existing skills: the Orchestrator (Agent 1) and the Dev Agent (Agent 3). The Dev Agent remains the most skill-complete agent in the system, reflecting the depth of investment in the MVP engineering toolchain.

The heaviest gap remains the Ads Management Agent (Agent 7), which requires 7 new skills -- the largest single-agent gap in the roster.

Additionally, 6 existing skills are underutilised: they exist in the codebase but are not assigned to agents that clearly need them. These are catalogued in the cross-agent section.

---

## Skill Gap by Agent

### Agent 1: Orchestrator (COO)
**Phase:** MVP | **Gate model:** Internal only | **Missing skills:** 0

| Skill | Status | Gate |
|---|---|---|
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |
| `move_task` | EXISTS | auto |
| `spawn_sub_agents` | EXISTS | auto |
| `triage_intake` | EXISTS | auto |

Fully covered. No new skill definitions required.

---

### Agent 2: Business Analyst
**Phase:** MVP | **Gate model:** Internal + review (specs) | **Missing skills:** 2 new + 1 existing unassigned

| Skill | Status | Gate |
|---|---|---|
| `read_workspace` | EXISTS | auto |
| `read_codebase` | EXISTS | auto |
| `draft_requirements` | **MISSING** | auto |
| `write_spec` | **MISSING** | review |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |
| `triage_intake` | EXISTS | auto |
| `ask_clarifying_question` | EXISTS -- NOT ASSIGNED | auto |
| `add_deliverable` | EXISTS -- NOT ASSIGNED | auto |
| `request_approval` | EXISTS -- NOT ASSIGNED | auto |
| `update_task` | EXISTS -- NOT ASSIGNED | auto |

#### `draft_requirements` (auto gate)

Internal reasoning skill -- no external API call. Takes a board task brief as input and produces a structured output object: user stories in INVEST format, Gherkin ACs with Given/When/Then blocks (including at least one negative scenario per story), a ranked list of open questions (high/medium/low risk), and a Definition of Done checklist.

The output should be a typed schema rather than free text, so the downstream `write_spec` skill can package it cleanly into the review queue without re-parsing. This is the same pattern used by `draft_architecture_plan` and `draft_tech_spec` on the Dev Agent.

Every acceptance criterion in the output must be traceable to the brief input. If the brief is too ambiguous to produce a spec, the skill should return a structured "clarification required" response listing the blocking questions, rather than generating an incomplete spec.

#### `write_spec` (review gate)

Wraps the `draft_requirements` output and creates a review item in the HITL queue. Structurally analogous to `write_patch` for the Dev Agent -- it is the mechanism that places the BA's work in front of a human before the Dev Agent can act on it.

The skill must generate a stable spec reference ID on submission. The Dev Agent and QA Agent both need to retrieve the approved spec from workspace memory by this ID. The review item should present the full spec in a human-readable format: user stories, Gherkin ACs, open questions, and Definition of Done.

On human approval, the skill writes the spec to `workspace_memories` and updates the board task status to `spec-approved`.

#### Notes on unassigned existing skills

- `ask_clarifying_question` (skill 33) is explicitly required for the BA's clarification mode. When high-risk questions block the spec, the BA must formally pause and surface those questions via this skill. It needs to be added to the BA's skill configuration -- it is not a new skill to write.
- `add_deliverable` (skill 7) should be assigned so the BA can attach the approved spec as an artifact on the board task.
- `request_approval` (skill 10) is the underlying mechanism `write_spec` invokes. Whether it is exposed directly to the agent or wrapped inside the `write_spec` skill is an implementation decision, but it should be accessible.
- `update_task` (skill 4) is needed when the BA updates task status to `spec-approved` after approval.

---

### Agent 3: Dev Agent
**Phase:** MVP | **Gate model:** Review (code), Block (deploys) | **Missing skills:** 0

| Skill | Status | Gate |
|---|---|---|
| `read_codebase` | EXISTS | auto |
| `search_codebase` | EXISTS | auto |
| `read_workspace` | EXISTS | auto |
| `draft_architecture_plan` | EXISTS | auto |
| `draft_tech_spec` | EXISTS | auto |
| `review_ux` | EXISTS | auto |
| `review_code` | EXISTS | auto |
| `write_patch` | EXISTS | review |
| `run_command` | EXISTS | review |
| `create_pr` | EXISTS | review |
| `request_approval` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |

Fully covered. The most complete skill set in the system.

---

### Agent 4: QA Agent
**Phase:** MVP | **Gate model:** Auto | **Missing skills:** 1

| Skill | Status | Gate |
|---|---|---|
| `derive_test_cases` | **MISSING** | auto |
| `run_tests` | EXISTS | auto |
| `analyze_endpoint` | EXISTS | auto |
| `capture_screenshot` | EXISTS | auto |
| `run_playwright_test` | EXISTS | auto |
| `report_bug` | EXISTS | auto |
| `read_codebase` | EXISTS | auto |
| `search_codebase` | EXISTS | auto |
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |

#### `derive_test_cases` (auto gate)

The most architecturally important missing skill in the MVP set. Takes a BA spec (specifically its Gherkin AC blocks) as input and produces a structured test case manifest.

Output schema for each test case: a test case ID, the source Gherkin AC ID it traces to, a human-readable description, the input setup (preconditions matching the Given block), the action to perform (matching the When block), and the expected assertion (matching the Then block). Negative scenario Gherkin blocks produce separate test case entries -- they are not variations of the positive case.

The test case manifest is written to workspace memory and becomes the contract that all subsequent test runs check against. When `report_bug` fires, it must reference both the test case ID and the originating Gherkin AC ID so every bug report is traceable back to the BA spec.

Without this skill, the QA Agent cannot satisfy the Gherkin traceability requirement introduced in v5.0. Tests would exist but without formal linkage to acceptance criteria, undermining the audit trail that makes the Dev/QA loop trustworthy.

---

### Agent 5: Support Agent
**Phase:** 2 | **Gate model:** Review (outbound) | **Missing skills:** 3

| Skill | Status | Gate |
|---|---|---|
| `read_inbox` | EXISTS | auto |
| `classify_email` | **MISSING** | auto |
| `draft_reply` | **MISSING** | auto |
| `send_email` | EXISTS | review |
| `create_task` | EXISTS | auto |
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `search_knowledge_base` | **MISSING** | auto |
| `add_deliverable` | EXISTS -- NOT ASSIGNED | auto |
| `update_task` | EXISTS -- NOT ASSIGNED | auto |

#### `classify_email` (auto gate)

Internal reasoning skill. Input: raw email or ticket content. Output: a structured classification object with the following fields:

- `type`: billing / bug / feature-request / onboarding / general / complaint
- `urgency`: P1 (immediate) / P2 (same day) / P3 (routine)
- `sentiment`: positive / neutral / frustrated / angry
- `routing`: draft-reply / escalate-immediately / create-task-only / no-action
- `board_task_reference`: if the email references an issue already on the board, the task ID

The board task reference field is important: if a customer is writing about a known bug already being tracked, the classification output should link them rather than producing a duplicate task. The skill should check workspace memory for matching patterns before classifying.

#### `draft_reply` (auto gate)

Generates a reply draft for human review before the `send_email` skill fires. This is not a simple template fill -- it requires context assembly before generating:

1. Retrieve the `classify_email` result for this email
2. Call `search_knowledge_base` for relevant resolution guidance
3. Read workspace memory for this customer's prior ticket history (if any)
4. Read the current Orchestrator directive for active context (outages, campaigns, promotions)

The tone should be configurable via workspace memory (formal / professional / conversational) rather than hardcoded.

The output is a structured draft: subject line, greeting, body, closing, and a confidence score. Low-confidence drafts (below a configurable threshold) should include a note flagging the uncertainty for the human reviewer rather than presenting a confident-sounding reply.

#### `search_knowledge_base` (auto gate)

Semantic search over the internal knowledge base: FAQs, resolution notes, SOP documents, and prior resolutions written to workspace memory.

**Architecture decision required before writing this spec:** Does the knowledge base live in workspace memory (as memory blocks), or in a separate document store? If memory blocks, this skill is a typed semantic search adapter over `read_data_source` (skill 46, already exists). If a separate document structure, it needs its own integration. This distinction should be resolved before the spec is written, as it determines the implementation path significantly.

The output should be a ranked list of relevant knowledge base entries with relevance scores, not a summarised synthesis -- the `draft_reply` skill handles synthesis. Keeping these concerns separate makes both skills more testable.

---

### Agent 6: Social Media Agent
**Phase:** 3 | **Gate model:** Review (publish) | **Missing skills:** 3 new (recommendation: merge publish + schedule)

| Skill | Status | Gate |
|---|---|---|
| `web_search` | EXISTS | auto |
| `read_workspace` | EXISTS | auto |
| `draft_post` | **MISSING** | auto |
| `publish_post` | **MISSING** | review |
| `schedule_post` | **MISSING** (recommend: merge with publish_post) | review |
| `read_analytics` | **MISSING** | auto |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |

#### `draft_post` (auto gate)

Generates platform-specific content for review. Input: topic or brief, target platform, tone directive from workspace memory (brand voice), and relevant workspace context (recent product updates, active campaigns, competitor findings from Strategic Intelligence).

The skill must have platform awareness embedded in its prompt: LinkedIn posts require different structure, length, and register than Twitter/X threads, Instagram captions, or Facebook updates. Recommendation: implement as one skill with a `platform` enum parameter rather than separate skills per platform. Platform-specific formatting rules live inside the skill's system prompt, not in separate skill files.

Output: the draft content, a rationale statement (why this topic, why now, how it connects to current context), and a suggested posting time based on the platform's engagement patterns.

#### `publish_post` (review gate)

Integration adapter that publishes an approved draft to the target social platform. Connects via Buffer, Later, or native platform APIs depending on workspace configuration. Credentials come from `integration_connections`.

**Recommendation: merge `publish_post` and `schedule_post` into one skill.** The only difference between the two is the presence of a `scheduled_at` timestamp. If omitted, publish immediately. If provided, schedule. This halves the skill surface area without losing capability, and avoids the agent having to decide between two skills that are functionally identical except for timing. The merged skill should be called `publish_post` with an optional `scheduled_at` parameter.

#### `read_analytics` (auto gate)

Pulls engagement metrics from connected social platforms: impressions, reach, engagement rate, follower change, link clicks. Must support a `platform` parameter since the agent typically monitors multiple platforms simultaneously.

Critical design requirement: the output must be a normalised schema across all platforms. The agent's analysis logic should not need to branch on platform type -- it should receive consistent field names and data types regardless of whether the source is LinkedIn, Instagram, or Twitter/X. Platform-specific API quirks are handled inside the skill, invisible to the agent.

Parameters: `platform` (enum or "all"), `period` (last-7-days / last-30-days / since-last-run).

---

### Agent 7: Ads Management Agent
**Phase:** 3 | **Gate model:** Review (bids/copy), Block (budget/pause) | **Missing skills:** 7

This is the heaviest single-agent gap in the roster. All 7 missing skills are genuinely distinct -- there are no consolidation opportunities here.

| Skill | Status | Gate |
|---|---|---|
| `read_campaigns` | **MISSING** | auto |
| `analyse_performance` | **MISSING** | auto |
| `draft_ad_copy` | **MISSING** | auto |
| `update_bid` | **MISSING** | review |
| `update_copy` | **MISSING** | review |
| `pause_campaign` | **MISSING** | block |
| `increase_budget` | **MISSING** | block |
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |

#### `read_campaigns` (auto gate)

Pulls campaign performance data from connected ad platforms: spend, impressions, clicks, conversions, CPA, ROAS, CTR, budget pacing, and quality scores where available. Must support a `platform` parameter (Google Ads / Meta / LinkedIn Ads / TikTok).

Same normalised schema requirement as `read_analytics` for social: the agent's analysis logic must not branch on platform type. Integration adapters per platform handle the API translation internally.

Design note: the GHL platform is likely the primary integration vector for agency clients who manage ads through GHL. For direct platform access, the skill needs OAuth tokens from `integration_connections`. Clarify which path is v1 before writing the spec.

Time window parameter required: the agent runs every 6 hours and needs to compare the current window against the previous run's snapshot to detect trends.

#### `analyse_performance` (auto gate)

Pure internal reasoning skill -- no API call. Takes `read_campaigns` output and produces a structured performance assessment:

- Anomaly list: each anomaly with a type (CPA-spike / CTR-drop / budget-pacing-issue / ROAS-decline), the specific campaigns affected, magnitude of deviation from baseline, and time window
- Trend direction per campaign: improving / stable / declining
- Ranked recommendation list: each recommendation with a type (bid-adjustment / copy-swap / audience-modification / pause-candidate / budget-review), confidence score, and supporting evidence from the campaign data
- Competitor activity notes (if `read_workspace` surfaced Strategic Intelligence findings)

The output feeds directly into `draft_ad_copy`, `update_bid`, and `update_copy`. The skill should not generate those downstream actions itself -- it produces the assessment that the agent then uses to decide which action skills to invoke.

#### `draft_ad_copy` (auto gate)

Generates ad copy variants based on the performance assessment from `analyse_performance` and brand context from workspace memory.

For each variant, output: the copy text (headline, description, CTA as appropriate to the platform), the performance hypothesis (what this variant is testing and why), the audience segment or ad group it is intended for, and a reference to the underperforming copy it is designed to replace.

Must check workspace memory for prior tested variants before generating -- avoid proposing copy that has already been tested and rejected.

#### `update_bid` (review gate)

Proposes a bid adjustment for a specific campaign or ad group. The review item must present full context for meaningful human approval:

- Current bid and proposed bid
- Percentage change and direction
- Explicit reasoning (the specific metric deviation that triggered this, with numbers)
- Which `analyse_performance` finding motivated the proposal
- Expected impact statement (conservative estimate, not a promise)

The skill must not fire if it cannot produce a data-backed reasoning statement. "Bid looks high" is not sufficient -- the specific metric, threshold, and observation window must be named.

#### `update_copy` (review gate)

Proposes swapping an active ad creative for a new variant from `draft_ad_copy`. Review item must include:

- The current creative being replaced (text and performance metrics)
- The proposed replacement (text and hypothesis)
- Performance comparison between the two
- Which ad group and campaign this affects

Structurally analogous to `write_patch` -- it is a diff proposal, not an execution. The human sees exactly what is changing before approving.

#### `pause_campaign` (block gate)

Block gate: this skill can never execute autonomously under any circumstances. The skill definition exists in the action registry so the agent can surface a pause recommendation, but the gate model prevents autonomous execution regardless of confidence.

The skill's function is to create a structured recommendation record: the campaign to be paused, the specific performance signals triggering the recommendation, and the expected impact of pausing. This record surfaces to the human via the board, not via automatic execution.

Implementation note: the skill's executor response should always include an explicit log entry noting that the block gate prevented autonomous execution. This ensures the audit trail is unambiguous -- there is never any question about whether the action fired.

#### `increase_budget` (block gate)

Same pattern as `pause_campaign`. Block gate, no autonomous execution. Creates a recommendation record with: campaign, current budget, proposed increase, performance data supporting the recommendation, and projected impact.

The block gate is non-negotiable per the brief: budget increases are effectively irreversible (you cannot un-spend budget) and the financial consequence warrants hard human control regardless of agent confidence.

---

### Agent 8: Email Outreach Agent
**Phase:** 3 | **Gate model:** Review (send) | **Missing skills:** 3

| Skill | Status | Gate |
|---|---|---|
| `web_search` | EXISTS | auto |
| `enrich_contact` | **MISSING** | auto |
| `draft_sequence` | **MISSING** | auto |
| `send_email` | EXISTS | review |
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |
| `update_crm` | **MISSING** | review |

#### `enrich_contact` (auto gate)

Pulls additional contact data from enrichment integrations (Apollo, Clay, Hunter, or similar configured provider). Input: email address or LinkedIn URL. Output: company name, company size, industry, the contact's role and seniority, recent company news, funding status if relevant, and any signals useful for personalisation.

Cost and rate limit management are critical for this skill. Enrichment APIs charge per lookup. The skill should check workspace memory and `processed_resources` before calling the external API -- if this contact was enriched within a configurable recency window (default: 30 days), return the cached result without making a new API call. Idempotency via a contact-hash key.

The suppression list check should also occur here, not in `draft_sequence`. If a contact is on the suppression list, `enrich_contact` should return a structured error immediately, preventing any further processing of that contact in the current run.

#### `draft_sequence` (auto gate)

Generates a complete multi-touch outreach sequence -- not a single email. The entire sequence is treated as a single review item: the human sees all touches before approving the first send.

Input: enriched contact data (from `enrich_contact`), ICP criteria and campaign theme from workspace memory, sequence length and cadence (e.g. touch 1 now, touch 2 in 3 days, touch 3 in 7 days).

Output: an ordered array of email drafts. Each draft includes: subject line, body, send delay from previous touch, and personalisation rationale (what specific detail from enrichment informed this message and why).

The review item should present the complete sequence as a flow, not individual emails reviewed separately. This allows the human to evaluate the arc and consistency of the outreach before approving.

Suppression list enforcement: if `enrich_contact` returned a suppression error for a contact, `draft_sequence` must refuse to draft and return a structured error. The suppression check is not repeated inside this skill -- it is the responsibility of the calling agent to ensure enrichment ran first.

#### `update_crm` (review gate)

Shared with CRM and Pipeline Agent (Agent 14). One skill definition serves both agents.

Creates or updates contact and deal records in the connected CRM. Creates new contacts from enrichment data after a first reply; updates existing records after meetings, calls, or stage changes.

Every invocation must produce a diff in the review item: what field is changing, from what value to what value, and why. The human approves or rejects the specific change, not the abstract operation.

Must handle the create-vs-update distinction gracefully: before writing, check for an existing record matching the contact's email. If found, propose an update. If not found, propose a new record creation. Never silently create duplicates.

---

### Agent 9: Strategic Intelligence Agent
**Phase:** 4 | **Gate model:** Internal only | **Missing skills:** 2 [v2 addition]

**Change from v1.0:** Previously marked "fully covered." The original analysis treated `web_search` and `fetch_url` as sufficient for all intelligence tasks. The marketingskills research pass identified two structured output capabilities that raw web search does not satisfy: competitive intelligence synthesis and voice-of-customer synthesis. Both require a defined output schema that downstream agents (Content/SEO, Email Outreach, Ads Management) can consume from workspace memory reliably.

| Skill | Status | Gate |
|---|---|---|
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `web_search` | EXISTS | auto |
| `fetch_url` | EXISTS | auto |
| `create_task` | EXISTS | auto |
| `move_task` | EXISTS | auto |
| `generate_competitor_brief` | **MISSING** [v2 addition] | auto |
| `synthesise_voc` | **MISSING** [v2 addition] | auto |

#### `generate_competitor_brief` (auto gate) [v2 addition]

Internal reasoning skill that transforms raw competitive research (gathered via `web_search` and `fetch_url`) into a structured competitive brief written to workspace memory.

The original analysis assumed that web search output, written to workspace memory as unstructured text, was sufficient for the Ads Management, Content/SEO, and Social agents to consume. In practice, those agents need structured, queryable competitor data -- not a free-text research dump -- because their own skills (`analyse_performance`, `draft_content`, `draft_post`) reference competitor findings as part of their reasoning context.

Input: one or more competitor identifiers (domain, brand name) plus a research scope (pricing / messaging / product features / ad strategy / content coverage).

Output schema written to workspace memory:
- `competitor_id`: stable key for this competitor record
- `positioning_summary`: how the competitor describes itself and its primary value proposition
- `pricing`: plan names, price points, and feature tier structure (where discoverable)
- `messaging_themes`: recurring themes from homepage, ads, and content
- `content_gaps`: topics the competitor covers that the client does not, and vice versa
- `ad_signals`: observable paid ad activity (keywords, creative themes, platform presence)
- `recent_changes`: product or messaging changes detected since the last run
- `last_updated`: timestamp

This structured output replaces ad-hoc text entries in workspace memory and gives all consuming agents a consistent schema to reference. The skill should update an existing record rather than create a duplicate if a competitor record already exists for the given `competitor_id`.

#### `synthesise_voc` (auto gate) [v2 addition]

Voice-of-customer synthesis skill. Gathers and structures customer language, sentiment, and recurring themes from public sources: review platforms (G2, Capterra, Trustpilot), app stores, Reddit, and community forums.

This is not a support ticket analysis skill -- that belongs to the Support Agent. This skill captures the unprompted language customers use when talking about the product category, the client's brand, and competitor brands in public forums. The distinction matters: support tickets reflect existing customers with active problems; VOC sources reflect the full market including non-customers and churned customers.

Input: brand name(s) and category terms, source scope (which platforms to search), and a lookback window.

Output schema written to workspace memory:
- `source`: platform and URL
- `sentiment`: positive / neutral / negative
- `theme`: the recurring topic this entry represents (onboarding / pricing / reliability / competitor-comparison / feature-request / praise)
- `verbatim_phrases`: up to five short phrases (under 10 words each) that represent authentic customer language for this theme -- these feed directly into `draft_content` and `draft_sequence` for voice-matched copy
- `frequency_signal`: how often this theme appeared across the source set (high / medium / low)
- `last_updated`: timestamp

The verbatim phrases output is the primary value for downstream agents. Authentic customer language outperforms agency-written copy in both ad creative and email outreach. This is the mechanism that gives the Ads and Email agents access to real market language without requiring a separate research workflow.

---

### Agent 10: Finance Agent
**Phase:** 4 | **Gate model:** Auto (reads), Review (record changes) | **Missing skills:** 4

| Skill | Status | Gate |
|---|---|---|
| `read_revenue` | **MISSING** | auto |
| `read_expenses` | **MISSING** | auto |
| `analyse_financials` | **MISSING** | auto |
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `update_financial_record` | **MISSING** | review |
| `create_task` | EXISTS | auto |
| `update_memory_block` | EXISTS -- NOT ASSIGNED | auto |

#### `read_revenue` (auto gate)

Pulls revenue data from payment integrations: Stripe, GoHighLevel payments, or other configured processors. Output is a normalised financial snapshot for the run period:

- Total revenue for the period
- MRR / ARR (if subscription-based, calculated from active subscriptions)
- Transaction list with amount, customer, date, and status
- Failed payment list with customer, amount, and failure reason
- Refunds processed

The snapshot must include a period marker (start and end timestamps) so the Finance Agent can compare against the previous run's snapshot when detecting anomalies. Every run produces a new snapshot -- they accumulate as a time series in workspace memory.

#### `read_expenses` (auto gate)

Pulls expense data from connected accounting integrations: Xero, QuickBooks, or similar. Output:

- Software subscription costs with renewal dates
- Ad spend (cross-referenceable with Ads Agent data for reconciliation)
- Contractor or payroll costs if configured
- Any other categorised expenses

Normalised schema required across accounting providers. The category taxonomy should be configurable via workspace memory rather than hardcoded, so agencies can define their own chart of accounts without requiring a code change.

#### `analyse_financials` (auto gate)

Internal reasoning skill. Takes `read_revenue` and `read_expenses` outputs and produces:

- Gross margin calculation for the period
- Burn rate vs configured benchmark
- Anomaly list: each anomaly with type (unusual-charge / failed-payment / overdue-invoice / budget-overrun / subscription-price-change), amount, and affected line item
- Trend direction: revenue and expense trends vs the previous N periods

Key design principle: anomaly detection thresholds must be configurable via workspace memory, not hardcoded. An agency's definition of "unusual charge" depends on their scale and cost structure. The skill reads threshold configuration from a memory block before running its analysis, and flags any expense that deviates beyond the configured threshold.

#### `update_financial_record` (review gate)

Proposes corrections to miscategorised expenses. The review item must include:

- The specific transaction
- Current category assignment
- Proposed category
- Reasoning (why the current assignment is incorrect)

Analogous in structure to `write_patch` for the Dev Agent -- a diff proposal with explicit reasoning, never an automatic write.

#### Note on `update_memory_block`

The Finance Agent should be assigned `update_memory_block` (skill 47, already exists) for maintaining its financial snapshot memory block. The current skill inventory does not assign this skill to any agent explicitly, but the Finance Agent has the clearest need for it.

---

### Agent 11: Content and SEO Agent
**Phase:** 4 | **Gate model:** Review (publish) | **Missing skills:** 4 new (2 original + 2 v2 additions)

**Change from v1.0:** Two new skills added. The original analysis covered content creation and publishing but left a significant gap on the SEO audit and technical health side. A content agent that can only produce and publish content, but cannot audit what is already published, is incomplete for an agency context. A lead magnet creation skill is also added, reflecting a distinct content production mode (gated assets vs. open content) not covered by `draft_content`.

| Skill | Status | Gate |
|---|---|---|
| `web_search` | EXISTS | auto |
| `fetch_url` | EXISTS | auto |
| `read_workspace` | EXISTS | auto |
| `draft_content` | **MISSING** | auto |
| `publish_content` | **MISSING** (see note) | review |
| `update_content` | **MISSING** (see note) | review |
| `audit_seo` | **MISSING** [v2 addition] | auto |
| `create_lead_magnet` | **MISSING** [v2 addition] | review |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |

**Architecture decision required:** `publish_content` and `update_content` may be the same skills as `publish_page` (skill 45) and `update_page` (skill 44), which already exist. If the Content and SEO Agent publishes to the same CMS that the page skills target, creating separate `publish_content` and `update_content` skills would introduce redundant integration code. Before writing new specs, confirm whether the underlying integration target is the same. If yes, assign `publish_page` and `update_page` to this agent and skip writing `publish_content` / `update_content`. If the agent targets a different content system (e.g. a headless CMS, WordPress, or Webflow), new skills are warranted.

#### `draft_content` (auto gate)

Generates long-form content: blog posts, SEO articles, case studies, landing page copy.

Context assembly before drafting:
1. Keyword focus and search intent from the triggering brief or board task
2. Competitor content coverage gaps from Strategic Intelligence memory entries (specifically `generate_competitor_brief` output)
3. Brand voice and style guidelines from workspace memory
4. VOC verbatim phrases from `synthesise_voc` output in workspace memory -- these should be surfaced directly in the draft where appropriate to ensure copy reflects authentic customer language
5. Internal linking opportunities from published content index (if maintained in memory)

Output: structured document with title, meta title, meta description, H2/H3 heading structure, body text, and internal linking recommendations with anchor text.

The skill must check for content conflicts: if any factual claim in the draft contradicts a position stored in workspace memory, the draft must flag the conflict rather than silently producing conflicting content.

For longer pieces, the brief recommends the agent produces a content brief as a board task for human sign-off before drafting the full article. Whether this is enforced in the skill or in the agent's system prompt is an implementation detail, but the pattern should be specified.

#### `audit_seo` (auto gate) [v2 addition]

Technical and on-page SEO audit skill. Distinct from `draft_content` in that it analyses existing published content and site health rather than generating new content.

Input: domain or specific URL(s), audit scope (technical / on-page / both), and a crawl depth parameter.

This skill uses `fetch_url` to retrieve page content and then applies structured SEO analysis. It does not require a third-party SEO API for v1 -- the initial implementation should cover what is determinable via direct URL fetching and workspace memory cross-referencing.

Output schema:
- `page_url`: the audited URL
- `title_tag`: present / missing / too-long / duplicate
- `meta_description`: present / missing / too-long / duplicate
- `h1_status`: present / missing / multiple
- `keyword_coverage`: whether the target keyword appears in title, H1, and body (requires keyword input)
- `content_length`: word count
- `internal_links`: count and list of outbound internal links detected
- `broken_links`: any href targets that returned non-200 status on fetch
- `page_speed_signal`: load time estimate where determinable
- `schema_markup`: whether JSON-LD structured data is present and its type
- `issues`: ranked list of issues by severity (critical / warning / info)
- `recommendations`: ordered action list addressing each detected issue

The output is written to workspace memory and surfaces as a board task for the Content Agent's next drafting cycle. The audit informs which pages need updating before new content is created -- avoiding the anti-pattern of producing new pages while existing ones have unresolved technical issues.

#### `create_lead_magnet` (review gate) [v2 addition]

Generates a gated content asset designed to capture email addresses or qualify leads: checklists, templates, calculators, mini-guides, swipe files, or email courses.

Distinct from `draft_content` in several ways: lead magnets are gated (not indexed), structured for download or delivery rather than on-page reading, and optimised for conversion rather than search. They require a different output format and a different evaluation criterion -- completion rate and lead quality, not rankings.

Input: lead magnet type (checklist / template / mini-guide / swipe-file / email-course), target audience segment from workspace memory, the specific problem or outcome the asset addresses, and the campaign or funnel it supports.

Output: the structured content asset in a format appropriate to its type, plus:
- A suggested title and subtitle
- A conversion-focused description (for the landing page or popup promoting the asset)
- A delivery mechanism recommendation (email gate / in-app download / PDF)
- A suggested CTA for the promotion touchpoint

Review gate is appropriate because lead magnets represent a commitment of the client's brand to a deliverable. The human should confirm the asset is accurate, on-brand, and genuinely useful before it enters the acquisition funnel.

Note on ownership: `create_lead_magnet` lives on Agent 11 because it is a content production skill. However, the Email Outreach Agent (Agent 8) is the primary consumer of the leads captured by the asset. The two agents should coordinate via workspace memory: Agent 11 writes the lead magnet delivery detail to a memory block; Agent 8 reads it to configure the follow-up sequence for leads captured through that asset.

---

### Agent 12: Client Reporting Agent
**Phase:** 5 | **Gate model:** Review (delivery) | **Missing skills:** 2

| Skill | Status | Gate |
|---|---|---|
| `read_workspace` | EXISTS | auto |
| `draft_report` | **MISSING** | auto |
| `deliver_report` | **MISSING** | review |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |
| `add_deliverable` | EXISTS -- NOT ASSIGNED | auto |
| `send_to_slack` | EXISTS -- NOT ASSIGNED | review |

#### `draft_report` (auto gate)

Assembles report content from workspace memory (all agent outputs for the reporting period), applies client-specific narrative templates, and produces a structured report object.

The skill must handle missing data gracefully: if an agent did not run during the reporting period, the skill must flag the data gap in the report rather than producing a report with silent holes.

Output is a structured data object, not a pre-formatted document:
- Metrics section: key performance numbers for the period with period-over-period comparison
- Narrative sections: templated but personalised commentary on each metric area
- Anomaly flags: significant changes that need human attention before the report sends
- Client context: goals and benchmarks for this specific client (from workspace memory)

Format rendering (PDF, slide deck, email summary) should be handled by a separate step or by existing delivery skills -- the draft skill should not embed format logic. This separation makes both the draft and delivery testable independently.

#### `deliver_report` (review gate)

Sends or publishes the approved report via the client's configured delivery method. This is an orchestration layer over existing communication skills:

- Email delivery: calls `send_email` with the formatted report
- Slack delivery: calls `send_to_slack` with the report
- PDF delivery: produces a formatted PDF and sends via email

The case for keeping this as a distinct skill rather than calling `send_email` directly: it adds a named, auditable event to the action log specifically tagged as "report-delivery", which is useful for tracking delivery history and for compliance. The Orchestrator can also see report delivery events distinctly in its workspace reads.

**`add_deliverable`** should be explicitly assigned to this agent. The report artifact should be attached to the board task as a deliverable before delivery, creating a permanent record of what was sent.

**`send_to_slack`** (skill 32) should be explicitly assigned for Slack delivery path.

---

### Agent 13: Onboarding Agent
**Phase:** 5 | **Gate model:** Review (external setup) | **Missing skills:** 1

| Skill | Status | Gate |
|---|---|---|
| `read_workspace` | EXISTS | auto |
| `write_workspace` | EXISTS | auto |
| `fetch_url` | EXISTS | auto |
| `web_search` | EXISTS | auto |
| `analyze_endpoint` | EXISTS | auto |
| `configure_integration` | **MISSING** | review |
| `send_email` | EXISTS | review |
| `create_task` | EXISTS | auto |

#### `configure_integration` (review gate)

The most operationally sensitive skill in the Phase 5 set. Validates and activates integration connections for a new client subaccount. This includes connecting GHL accounts, social platforms, payment processors, email providers, and CRM systems.

The review gate is essential and non-negotiable: no integration should be marked active without explicit human confirmation that credentials are correct and permissions are appropriately scoped.

Output is a structured integration checklist rather than a binary success/failure:

For each integration:
- Integration type and platform name
- Validation status: pass / fail / partial
- If pass: confirmed connection details and permission scopes granted
- If fail: specific error code and resolution guidance (wrong API key / insufficient OAuth scope / missing permission / rate limit hit)
- If partial: which capabilities are available and which are missing

Failed integrations surface with enough context that the human knows exactly what to correct without needing to re-run the onboarding flow from scratch.

The skill must never store credentials or secrets in workspace memory. It confirms that a connection is configured and working -- it does not persist the raw credentials.

---

### Agent 14: CRM and Pipeline Agent
**Phase:** 5 | **Gate model:** Review (CRM writes) | **Missing skills:** 4 new (3 original + 1 v2 addition) + 1 shared

**Change from v1.0:** One new skill added. The original analysis covered pipeline management and follow-up drafting but had no skill for retention and churn signal detection. The CRM Agent is the right owner for churn risk: it has access to deal and contact history, engagement signals, and communication patterns -- the same data required for detecting at-risk accounts. Adding `detect_churn_risk` closes the gap between pipeline management (winning new business) and account health monitoring (keeping existing business).

| Skill | Status | Gate |
|---|---|---|
| `read_crm` | **MISSING** | auto |
| `read_workspace` | EXISTS | auto |
| `analyse_pipeline` | **MISSING** | auto |
| `draft_followup` | **MISSING** | auto |
| `detect_churn_risk` | **MISSING** [v2 addition] | auto |
| `send_email` | EXISTS | review |
| `update_crm` | **MISSING** (shared with Agent 8) | review |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |

#### `read_crm` (auto gate)

Pulls deal and contact data from the connected CRM. The GHL CRM is the primary integration target given the platform's agency focus.

Output per deal:
- Deal ID, name, stage, and associated contact
- Last activity date and activity type
- Engagement signals: email opens, link clicks, meeting history, proposal views (where available)
- Deal value and expected close date
- Associated notes and communication history

Output enables both the stale deal detection (no activity beyond configurable threshold) and the engagement scoring that `analyse_pipeline` uses.

#### `analyse_pipeline` (auto gate)

Internal reasoning skill. Takes `read_crm` output and produces:

- Deal health scores (composite score based on engagement recency, stage velocity, and ICP fit)
- Stale deal flags: deals with no activity beyond the configured threshold, ranked by deal value
- Engagement scoring: high / medium / low per deal, based on signal recency
- Priority ranking: ordered list of opportunities most deserving human attention this run
- Pre-call briefs: for any deals with meetings scheduled in the next 48 hours, a context summary for the human

The scoring methodology must be configurable via workspace memory, not hardcoded. The inactivity threshold, ICP fit criteria, and weighting of engagement signals should all be adjustable without a code deployment. This is a direct application of the "configuration over code" principle from the platform's design philosophy.

#### `draft_followup` (auto gate)

Generates a follow-up message for a specific stalled deal. Distinct from `draft_sequence` (outbound prospecting) in that it operates entirely within the context of an ongoing relationship.

Context assembly before drafting:
1. Full deal history from `read_crm` output
2. Prior communication history and the prospect's response patterns
3. Current engagement signals (what they have and have not engaged with)
4. Deal stage and what the appropriate next step is at this stage

The draft must not include any commitments on pricing, scope, or timelines -- this is a hard constraint, not a soft preference. The review item should flag if the draft approaches this boundary.

Tone calibration by deal stage: early-stage follow-up is lighter and more exploratory; late-stage re-engagement is more direct and offers concrete next steps.

#### `detect_churn_risk` (auto gate) [v2 addition]

Retention and churn signal detection skill. Operates on existing customer accounts (as distinct from `analyse_pipeline`, which operates on open deals). Takes `read_crm` output filtered to customers (closed-won deals) and analyses engagement decay and cancellation signals.

This skill is the mechanism that converts the CRM Agent from a new-business tool into a full account health monitor.

Input: customer account list from `read_crm`, engagement signal history, and configurable risk threshold parameters from workspace memory.

Output schema per account:
- `account_id` and account name
- `risk_level`: high / medium / low / healthy
- `risk_signals`: the specific indicators driving the risk classification. Possible signals:
  - `login_decay`: login frequency below configurable threshold
  - `feature_disengagement`: reduction in feature usage breadth
  - `support_volume_spike`: elevated ticket volume in recent period
  - `payment_failure`: failed or disputed payment detected
  - `engagement_absence`: no email opens or link clicks in configurable window
  - `contract_approaching`: renewal date within configurable window with no renewal signal
- `recommended_action`: no-action / send-check-in / escalate-to-human / schedule-retention-call
- `urgency`: immediate / this-week / monitor

All risk thresholds -- login frequency floor, support volume spike definition, contract proximity window -- must be configurable via workspace memory, not hardcoded. Agencies have different retention patterns and the risk model must adapt without a code deployment.

When `risk_level` is high and `recommended_action` is escalate-to-human, the skill should create a board task with full context so the human can act immediately. This task creation should be explicit in the skill spec, not left to the agent's discretion.

---

### Agent 15: Knowledge Management Agent
**Phase:** 5 | **Gate model:** Review (documentation updates) | **Missing skills:** 3

| Skill | Status | Gate |
|---|---|---|
| `read_workspace` | EXISTS | auto |
| `read_codebase` | EXISTS | auto |
| `read_docs` | **MISSING** | auto |
| `propose_doc_update` | **MISSING** | review |
| `write_docs` | **MISSING** | review |
| `write_workspace` | EXISTS | auto |
| `create_task` | EXISTS | auto |
| `search_codebase` | EXISTS -- NOT ASSIGNED | auto |
| `update_memory_block` | EXISTS -- NOT ASSIGNED | auto |

#### `read_docs` (auto gate)

Reads current documentation and knowledge base entries.

**Architecture decision required before writing this spec (same as `search_knowledge_base` for Agent 5):** Where does the knowledge base live? Options:

1. Workspace memory blocks -- in which case `read_docs` is a typed filtered read over `read_data_source` and `read_workspace`, and may not need to be a distinct skill
2. A database table dedicated to documentation records -- a straightforward database read adapter
3. A file structure on the server -- requires file system access, similar to `read_codebase`
4. An external document platform (Notion, Confluence) -- requires an integration adapter

This decision should be made once and applied consistently across `read_docs`, `write_docs`, `propose_doc_update`, and `search_knowledge_base`. All four skills depend on the same underlying storage architecture.

#### `propose_doc_update` (review gate)

Proposes a documentation change for human review. The review item presents:

- The documentation entry being modified (title and current content)
- The proposed revision with a clear diff (what is being changed)
- The trigger for this change: codebase change detected / SOP pattern identified / knowledge gap flagged by another agent / doc not reviewed within the staleness window
- Confidence level: how certain the agent is that this update is needed

Documentation updates that are wrong are worse than gaps, because they actively mislead agents that read them on subsequent runs. The review gate is essential for the same reason that `write_spec` is gated for the BA: the human should see the proposed change before it becomes the authoritative reference.

#### `write_docs` (review gate)

Applies an approved documentation update. The implementation depends on the underlying storage architecture (see `read_docs` above).

On approval, the skill:
1. Writes the updated content to the documentation store
2. Records the change in a documentation version history
3. Updates the documentation health score for this knowledge area in workspace memory
4. Writes a change log entry to `workspace_memories` for the Orchestrator's awareness

**`search_codebase`** should be explicitly assigned to this agent -- the Knowledge Management Agent needs to detect when codebase changes affect documented behaviour, which requires searching the codebase, not just reading workspace memory.

**`update_memory_block`** should be assigned for maintaining the documentation health score memory block.

---

## Cross-Agent Analysis

### Shared skills (one definition, multiple consumers)

| Skill | Agents | Status |
|---|---|---|
| `update_crm` | Email Outreach (8), CRM/Pipeline (14) | Write once |
| `read_workspace` | All 15 agents | EXISTS |
| `write_workspace` | All 15 agents | EXISTS |
| `create_task` | All 15 agents | EXISTS |
| `send_email` | Support (5), Email Outreach (8), Onboarding (13), CRM/Pipeline (14) | EXISTS |
| `web_search` | Strategic Intel (9), Social (6), Email Outreach (8), Content/SEO (11), Onboarding (13) | EXISTS |

### New cross-agent data flows introduced in v2.0

Two of the v2 additions create new workspace memory data flows that multiple agents consume. These should be noted during implementation to ensure consuming agents are configured to read the correct memory blocks.

| Memory block written by | Consuming agents | Data |
|---|---|---|
| `generate_competitor_brief` (Agent 9) | Ads Management (7), Content/SEO (11), Social (6) | Structured competitor records keyed by `competitor_id` |
| `synthesise_voc` (Agent 9) | Content/SEO (11), Email Outreach (8), Ads Management (7) | VOC theme records including verbatim phrase arrays |
| `create_lead_magnet` (Agent 11) | Email Outreach (8) | Lead magnet delivery detail for follow-up sequence configuration |
| `detect_churn_risk` (Agent 14) | Orchestrator (1) via board task creation | High-risk account alerts requiring immediate human action |

### Existing skills not yet assigned to agents that need them

| Skill | Currently assigned to | Should also be assigned to |
|---|---|---|
| `ask_clarifying_question` (33) | No agent explicitly | Business Analyst (2) |
| `add_deliverable` (7) | No agent explicitly | Business Analyst (2), Client Reporting (12) |
| `update_task` (4) | No agent explicitly | Business Analyst (2), QA Agent (4), Support (5) |
| `send_to_slack` (32) | No agent explicitly | Client Reporting (12) |
| `request_approval` (10) | Dev Agent (3) only | Business Analyst (2) |
| `read_data_source` (46) | No agent explicitly | Strategic Intelligence (9), Client Reporting (12), Knowledge Management (15) |
| `update_memory_block` (47) | No agent explicitly | Finance Agent (10), Knowledge Management (15) |
| `search_codebase` (21) | Dev Agent (3), QA Agent (4) | Knowledge Management (15) |

---

## Architecture Decisions Required Before Writing Specs

Three decisions affect multiple skill definitions. They should be resolved before any specs are written, as the implementation paths diverge significantly depending on the answer.

### 1. Where does the knowledge base live?

Affects: `read_docs`, `write_docs`, `propose_doc_update` (Agent 15), `search_knowledge_base` (Agent 5)

Options: workspace memory blocks / dedicated database table / server file structure / external platform

Recommendation: a dedicated database table for documentation records is the cleanest solution at the current scale. It gives the Knowledge Management Agent a clear target, supports version history natively, and avoids conflating documentation with transient workspace memory entries. It is also queryable by other agents without pulling the entire memory state.

### 2. Are publish_post and schedule_post one skill or two?

Affects: Social Media Agent (6)

Recommendation: merge into one `publish_post` skill with an optional `scheduled_at` parameter. If omitted, publish immediately. If provided, schedule. No functional loss, reduced skill surface area.

### 3. Are publish_content / update_content the same as publish_page / update_page?

Affects: Content and SEO Agent (11)

Resolution: check whether the Content Agent targets the same CMS as the page skills. If yes, assign `publish_page` (45) and `update_page` (44) to Agent 11 and skip writing new skills. If the agent targets a different content system, write `publish_content` and `update_content` as distinct integrations.

---

## Research-Informed Additions (v2.0)

### Source

A structured analysis of the coreyhaines31/marketingskills open-source repository (17.4k stars, MIT licence) was conducted as part of this revision. The repository contains 34 marketing and sales skill definitions covering CRO, copywriting, SEO, analytics, paid ads, email, social, and growth strategy.

### Methodology

Each marketingskills skill was mapped against the existing gap analysis to determine whether the capability it described was: (a) already covered by an existing Automation OS skill, (b) covered by a skill already in the gap analysis, or (c) a genuine gap not previously identified.

The majority of marketingskills capabilities are covered by existing Automation OS skills or by skills already in the gap analysis. The five skills added in v2.0 represent category (c) -- genuine gaps that the original analysis missed.

### Skills added

| Skill | Agent | What the research revealed |
|---|---|---|
| `generate_competitor_brief` | Strategic Intelligence (9) | The `competitor-alternatives` and `marketing-psychology` marketingskills revealed that competitive intelligence requires a structured output schema, not just a web search result. Consuming agents need queryable competitor records, not free-text notes. |
| `synthesise_voc` | Strategic Intelligence (9) | The `customer-research` marketingskill (not currently in the installed skill set) covers review mining, Reddit research, and VOC synthesis as a distinct discipline. No Automation OS skill or agent was performing structured VOC analysis. |
| `audit_seo` | Content and SEO (11) | The `seo-audit` marketingskill covers technical SEO, crawl health, Core Web Vitals, and on-page analysis as a distinct capability from content creation. An agent that can only produce content but not audit it is incomplete for an agency context. |
| `create_lead_magnet` | Content and SEO (11) | The `lead-magnets` marketingskill (not currently in the installed skill set) revealed a distinct content mode -- gated assets optimised for conversion rather than search -- that `draft_content` does not cover. |
| `detect_churn_risk` | CRM and Pipeline (14) | The `churn-prevention` marketingskill revealed that retention signal detection is absent from the gap analysis entirely. The CRM Agent has the necessary data access; it simply lacked a skill to perform structured churn analysis on existing accounts. |

### Skills considered but not added

| Candidate | Reason not added |
|---|---|
| `optimise_ai_search` | AEO/GEO/LLMO optimisation is a real and growing discipline, but is sufficiently covered by incorporating AI search best practices into `draft_content`'s system prompt at v1. Revisit when the Content Agent is proven in production. |
| `run_ab_test` | A/B testing is a valid capability gap, but no current agent owns web experimentation. Adding it now without a clear agent owner would create an orphan skill. Flag for the Phase 5 expansion when the platform's testing posture is clearer. |
| `generate_competitor_battle_card` | Covered by `generate_competitor_brief` with appropriate output scope. Separate battle card generation would be redundant at current scale. |

---

## Recommended Order for Writing Skill Specs

Skills should be specced in phase order, and within each phase: integration adapter skills before internal reasoning skills (because the reasoning skills' output schemas often depend on what the adapter skills produce).

| Priority | Skill(s) | Rationale |
|---|---|---|
| 1 | `draft_requirements`, `write_spec` | Unblocks MVP BA agent seeding |
| 2 | `derive_test_cases` | Unblocks MVP QA agent Gherkin traceability |
| 3 | Assign existing unassigned skills to BA, QA, Support | Zero writing required -- configuration only |
| 4 | `classify_email`, `draft_reply`, `search_knowledge_base` | Phase 2 Support agent |
| 5 | `draft_post`, `publish_post` (merged), `read_analytics` | Phase 3 Social Media agent |
| 6 | All 7 Ads Management skills | Phase 3 -- most complex single-agent set |
| 7 | `enrich_contact`, `draft_sequence`, `update_crm` | Phase 3 Email Outreach |
| 8 | `read_revenue`, `read_expenses`, `analyse_financials`, `update_financial_record` | Phase 4 Finance |
| 9 | `generate_competitor_brief`, `synthesise_voc` | Phase 4 Strategic Intelligence -- write before Content/SEO agent because their output feeds `draft_content` and `draft_ad_copy` |
| 10 | `draft_content`, `audit_seo`, `create_lead_magnet`, resolve publish_content question | Phase 4 Content/SEO -- spec `draft_content` after Agent 9 skills are defined so the VOC memory block schema is known |
| 11 | `draft_report`, `deliver_report` | Phase 5 Client Reporting |
| 12 | `configure_integration` | Phase 5 -- most operationally sensitive single skill |
| 13 | `read_crm`, `analyse_pipeline`, `draft_followup`, `detect_churn_risk`, `update_crm` | Phase 5 CRM/Pipeline -- spec `detect_churn_risk` after `read_crm` output schema is finalised |
| 14 | Resolve docs architecture, then `read_docs`, `propose_doc_update`, `write_docs` | Phase 5 Knowledge Management -- spec last because it depends on knowing what all other agents write to workspace memory |

---

## On External Research

Research into external skill databases, MCP servers, and agent framework tool libraries is worth conducting -- but after the skill list is locked, not before. The skill list should be driven by the agent design. External research then validates and refines the integration layer underneath the skills that require external API access.

Of the 41 new skills (up from 36 in v1.0), approximately 14 are integration adapter skills that talk to external APIs:

- `read_campaigns`, `update_bid`, `update_copy`, `pause_campaign`, `increase_budget` (ads platforms)
- `read_analytics`, `publish_post` (social platforms)
- `read_revenue`, `read_expenses`, `update_financial_record` (payment / accounting platforms)
- `enrich_contact` (contact enrichment platforms)
- `read_crm`, `update_crm` (CRM platforms)
- `configure_integration` (integration management)

The remaining ~27 are internal reasoning skills where external research adds minimal value.

**What the research should focus on:**

1. MCP server ecosystem for each integration category. Before writing custom adapter specs, check whether high-quality MCP servers already exist for the specific platforms targeted (GHL, Stripe, Meta Ads, Google Ads, Apollo). If a solid MCP server handles the API layer, the skill definition can be a thin adapter rather than a full implementation.

2. Input/output schema patterns from established agent framework tool libraries (Mastra, LangGraph, CrewAI). The goal is not to copy their designs, but to validate whether the normalised output schemas proposed here are missing any common patterns -- particularly around error handling, rate limit management, partial success responses, and pagination.

3. GoHighLevel API coverage specifically, since GHL is the primary integration target. Understanding what the GHL API exposes (and what it does not) will directly determine whether some skills need to call GHL or bypass it to go direct to the underlying platform.

**Research brief for Claude Code:** For each integration category (CRM, ads, social, finance, email enrichment), identify the three highest-quality MCP servers or tool libraries, assess their input/output schemas, and flag where they diverge from the normalised schemas the Automation OS skill specs need to produce. Present findings as a gap list per integration category, not as a general survey.

---

*This document should be read alongside the System Agents Master Brief v5.0 and the Skill Spec documents (skill-spec-architecture-plan.md, skill-spec-tech-spec.md, skill-spec-ux-review.md, skill-spec-pr-review.md, skill-spec-triage-intake.md). Next step: resolve the three architecture decisions above, then proceed to skill spec writing in the priority order defined in the final section.*
