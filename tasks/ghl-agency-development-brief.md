# GHL Agency Development Brief — Updated 2026-04-06

**Purpose:** What's left to build, what to configure, what to sell, and what to ask the agency owner.
**Codebase state:** Post-merge with main (migration 0065, 82 services, 83 schema files, 70 UI pages)

---

## Part 1: What's Left to Build

The org-level agents spec has 56 task groups across 5 phases. Many items are already built — the spec's task list shows all items unchecked, but the codebase has moved significantly since spec creation. Here's the honest delta.

### Phase 1: Org-Level Agent Execution — ~70% Complete

**Already built:**
- Migration 0043 landed (nullable subaccountId on agent_runs, review_items, actions; execution_mode, result_status, config_snapshot columns)
- `orgAgentConfigs` schema + service (140 lines) + routes
- `agentExecutionService` updated with execution mode routing, kill switch, config loading branches
- `agentScheduleService` updated with org-level job queues (`agent-org-scheduled-run`)
- Org-level review queue routes exist
- Org agent configs UI page exists

**Still needed:**
| Item | What | Effort |
|------|------|--------|
| 1.6 guards | Complete all guards in `agentExecutionService` for null subaccountId (workspace memory, board context, dev context, triggers, insights extraction) | 1-2 days |
| 1.7 skill executor | Audit all 47 tool executor functions for null subaccountId handling — return clear errors for subaccount-only skills when in org mode | 1-2 days |
| 1.11 authority rules | Cross-scope guards: validate `allowedSubaccountIds`, prevent subaccount agents from accessing org memory, log authority violations | 1 day |
| 1.12 kill switch UI | Toggle in org settings (route exists, UI partially built in OrgSettingsPage) | Half day |
| 1.14 testing | End-to-end verification of org-level agent run | 1 day |

**Estimated effort: ~1 week**

---

### Phase 2: Integration Layer + GHL Connector — ~60% Complete

**Already built:**
- Migration 0044 landed (connector_configs, canonical entity tables)
- `canonicalEntities.ts` schema (170 lines) + `canonicalAccounts.ts` (30 lines)
- `canonicalDataService.ts` (354 lines) — query methods for metrics
- `connectorConfigService.ts` (131 lines) — CRUD
- `connectorConfigs` routes + UI page
- `ghlAdapter.ts` (342 lines) — OAuth, contact creation, data ingestion stubs, webhook verification, rate limiting
- `connectorPollingService.ts` (157 lines) — polling job with sync phases
- `integrationConnectionService.ts` (591 lines) — full OAuth token lifecycle
- GHL webhook route exists
- Webhook deduplication (new)
- Rate limiter (extended)

**Still needed:**
| Item | What | Effort |
|------|------|--------|
| 2.3 GHL ingestion | Implement `fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue` in ghlAdapter — real GHL API calls with pagination + normalisation | 2-3 days |
| 2.5 webhook processing | Complete GHL webhook event normalisation for ContactCreate, OpportunityStageUpdate, ConversationCreated, AppointmentBooked | 1-2 days |
| 2.6 sync phase transitions | Wire backfill → transition → live state machine with webhook queue replay | 1 day |
| 2.9 data confidence | Add `dataStatus`, `dataFreshnessScore`, staleness cutoffs, connector health derivation to canonical queries | 1 day |
| 2.10 sync audit | Log sync events, webhook events, reconciliation with operator visibility | 1 day |
| 2.11 testing | End-to-end with real GHL account | 1 day |

**Estimated effort: ~1.5 weeks**

---

### Phase 3: Cross-Subaccount Intelligence — ~40% Complete

**Already built:**
- Migration 0045 landed (cross-subaccount intelligence schema)
- `subaccountTags` schema + service + routes + UI page
- `orgMemories` schema + `orgMemoryService` (now 81+ lines) + routes + UI page (183 lines)
- Intelligence skill definitions exist as .md files (all 8 intelligence skills)
- `intelligenceSkillExecutor.ts` (485 lines) — executor framework
- Skills registered in action registry
- Skill executor has cases for intelligence skills

**Still needed:**
| Item | What | Effort |
|------|------|--------|
| 3.4 org memory full | Complete org memory service: `extractOrgInsights` (LLM extraction), semantic search with embeddings, dedup, summary regeneration | 2-3 days |
| 3.7 Portfolio Health Agent | Create system agent seed: slug, masterPrompt, default skills, execution scope, heartbeat config | 1 day |
| 3.8 template service org routing | Update `loadToOrg` to check execution scope and create `orgAgentConfigs` for org-scoped agents | 1 day |
| 3.10 intelligence executors | Wire `executeComputeHealthScore`, `executeDetectAnomaly`, `executeComputeChurnRisk`, `executeGeneratePortfolioReport`, `executeTriggerAccountIntervention` to real canonical data | 3-5 days |
| 3.11 org memory in execution | Inject org memory into org agent system prompt, extract org insights post-run | 1 day |
| 3.14 testing | End-to-end intelligence pipeline | 1-2 days |

**Estimated effort: ~2 weeks**

---

### Phase 4: Configuration Template System — ~50% Complete

**Already built:**
- Migration 0046 landed (template extension fields)
- `systemHierarchyTemplates` + `systemHierarchyTemplateSlots` schema
- `systemTemplateService.ts` (684 lines) — Paperclip import, load to subaccount
- `hierarchyTemplateService.ts` (676 lines) — org template management
- Hierarchy templates UI page exists

**Still needed:**
| Item | What | Effort |
|------|------|--------|
| 4.2 loadToOrg | Extend template service: handle `executionScope`, `requiredConnectorType`, `operationalDefaults`, `memorySeedsJson`, schedule org heartbeats | 2-3 days |
| 4.4 GHL Agency Template seed | Insert the actual template data: agents, slots, weights, memory seeds, operator inputs | 1 day |
| 4.5 activation routes | `POST /api/system-templates/:id/activate` + operator input submission | 1 day |
| 4.6 activation UI | Template library, activation wizard, post-activation dashboard | 2-3 days |
| 4.7 customisation UI | Health score weight sliders, anomaly sensitivity, scan frequency, alert destinations | 1-2 days |
| 4.9 testing | Template activation end-to-end | 1 day |

**Estimated effort: ~1.5 weeks**

---

### Phase 5: Org-Level Workspace — ~30% Complete

**Already built:**
- Migration 0047 landed (org-level workspace schema changes)
- Org connections routes + page exist
- Inbox service (514 lines) already aggregates across subaccounts
- Goals system (283 lines) supports org-level

**Still needed:**
| Item | What | Effort |
|------|------|--------|
| 5.2 org triggers | Widen trigger event types, org-level trigger handling | 1 day |
| 5.3 org tasks | Nullable subaccountId on task service CRUD | 1 day |
| 5.5 org workspace routes | Org board, org tasks, org scheduled tasks, org triggers APIs | 2 days |
| 5.6 cross-boundary writes | `targetSubaccountId` on create_task from org context, HITL-gated | 1-2 days |
| 5.7 org board UI | Kanban view for org-level tasks | 2-3 days |
| 5.8 testing | End-to-end org workspace | 1 day |

**Estimated effort: ~1.5 weeks**

---

### Total Remaining Effort: ~7.5 weeks

| Phase | Remaining | Priority for GHL Demo |
|-------|-----------|----------------------|
| Phase 1: Org Execution | ~1 week | **Critical** — must work |
| Phase 2: GHL Connector | ~1.5 weeks | **Critical** — data must flow |
| Phase 3: Intelligence | ~2 weeks | **Critical** — this IS the product |
| Phase 4: Templates | ~1.5 weeks | **High** — the "click to deploy" story |
| Phase 5: Org Workspace | ~1.5 weeks | **Medium** — nice for demo, not essential |

**Minimum viable demo: Phases 1-3 (~4.5 weeks)**
**Full product demo: Phases 1-4 (~6 weeks)**

---

## Part 2: GHL Agency Template Configuration

The template is designed but not seeded. Here's what needs to be configured and what should be validated with the agency owner.

### Template: "GHL Agency Intelligence"

**Agents provisioned:**
| Agent | Scope | Role | Key Skills |
|-------|-------|------|-----------|
| Orchestrator | Subaccount | Coordinator | Task management, spawn sub-agents, reassign tasks |
| BA Agent | Subaccount | Specialist | Triage intake, task creation, inbox processing |
| Portfolio Health Agent | Org | Analyst | Health scoring, anomaly detection, churn risk, portfolio reports, account intervention (HITL-gated) |

**Operational defaults to validate with agency owner:**
| Setting | Default | Question to Ask |
|---------|---------|----------------|
| Health score weights | Pipeline velocity 30%, Conversation engagement 25%, Contact growth 20%, Revenue trend 15%, Platform activity 10% | "Which of these metrics matters most to you? If a client's pipeline stalls but conversations are up, is that a problem or normal?" |
| Anomaly threshold | 2.0 standard deviations | "How sensitive should alerts be? Would you rather get too many alerts or risk missing something?" |
| Scan frequency | Every 4 hours | "How often do you check on client accounts today? Would every 4 hours catch problems fast enough?" |
| Report schedule | Monday 8am | "When do you do your weekly client review? What day/time would a portfolio briefing be most useful?" |
| Alert destinations | Email + optional Slack | "Where do you want to get alerts — email, Slack, both? Do different severity levels go to different places?" |
| HITL gate on interventions | Always review before acting | "Would you ever want the system to take action on a client account without your approval first? Or always review?" |

**Connector requirements:**
- GHL OAuth connection (agency-level access to all sub-accounts)
- Maps GHL locations → AutomationOS subaccounts automatically
- Syncs: contacts, opportunities/deals, conversations, revenue/payments

**Memory seeds:**
- Pre-populated context: "This organisation manages a portfolio of client accounts. Monitor for pipeline stagnation, lead volume drops, and conversation engagement decline."
- Should be customised per agency based on their specific focus areas

---

## Part 3: Key Features and Benefits for a GHL Agency

### Feature → Benefit Map

| Feature | What It Does | Benefit to Agency Owner |
|---------|-------------|------------------------|
| **Cross-client health dashboard** | Single view of all clients with health scores (0-100), trend arrows, anomaly flags | Stop logging into each GHL sub-account individually. See who needs attention in 10 seconds. |
| **Automated anomaly detection** | AI monitors pipeline velocity, conversation rates, contact growth across all clients. Flags deviations from each client's baseline. | Catch problems before clients notice. "Your lead volume dropped 40% this week" — proactively, not reactively. |
| **Churn risk scoring** | Combines health trajectory, engagement patterns, and activity gaps into a risk score per client | Know which clients are at risk of leaving before they tell you. Intervene early. Reduce churn. |
| **Monday morning portfolio briefing** | AI-generated email/Slack message summarising: top issues, clients needing attention, wins to celebrate, upcoming risks | Replace the manual Monday morning "check all accounts" ritual with a 2-minute read. |
| **HITL-gated interventions** | When the system detects a problem, it proposes an action (pause a campaign, escalate to account manager, send a check-in email). You approve or reject with one click. | AI does the monitoring and thinking. You make the final call. Best of both worlds — automation with control. |
| **One-click template deployment** | Connect GHL once. System auto-discovers all client sub-accounts. Activates monitoring across all of them. | Go from "nothing" to "monitoring all 30 clients" in under an hour. Not per-client configuration. |
| **Policy engine** | Set rules like "never discuss pricing over $X" or "always escalate cancellation mentions to human" — enforced across all clients | Consistent quality standards across every client. No more hoping the AI follows instructions. |
| **Per-client cost tracking** | Know exactly what each client's AI operations cost per month. Set budget caps per client. | Price AI services to clients with real margin certainty. Turn AI from cost center to profit center. |
| **Workspace memory** | AI remembers each client's patterns, preferences, and history across runs. Gets smarter over time. | Stop re-explaining context every time. AI that actually knows your clients. Retention driver — harder to leave the longer you use it. |
| **Agent hierarchy** | Deploy a standardised agent team once. Customise per client. Update the template, changes propagate everywhere. | Manage 30 clients' AI with the same effort as managing 1. Scale without proportional ops burden. |

### The Elevator Pitch (for the agency owner)

"You connect your GHL account once. We auto-discover all your client sub-accounts. Within an hour, you have AI monitoring every client's pipeline, conversations, and revenue — scoring their health, catching anomalies, and predicting churn risk. Every Monday morning you get a portfolio briefing. When something needs action, the system proposes it and you approve with one click. You know exactly what it costs per client, and you can sell it as a service. One dashboard, all clients, AI that actually works."

---

## Part 4: Discovery Questions for the GHL Agency Owner

### Section A: Current Pain (validate the problem exists)

**Operational monitoring:**
1. "How many active client sub-accounts are you managing right now?"
2. "Walk me through your Monday morning routine — how do you check on all your clients?"
3. "How long does it take you to review all your client accounts each week?"
4. "When was the last time you missed something on a client account that you wish you'd caught earlier? What happened?"

**AI deployment experience:**
5. "How many of your clients have Conversation AI or Voice AI turned on?"
6. "Have you had any incidents where the AI said something wrong to a client's customer? What was the fallout?"
7. "How do you monitor what the AI is saying across all your clients right now?"
8. "Are you using GHL's Agent Studio? What's your experience been?"

**Cost and pricing:**
9. "How much are you spending on AI features per month across all sub-accounts? Do you know your per-client cost?"
10. "When you price your services, how do you factor in AI costs? Is AI a profit center or cost center for you?"

### Section B: Validate Specific Capabilities (show, don't tell)

**Cross-client intelligence:**
11. "If I showed you a single dashboard with a health score for every client — red/amber/green — and you could see at a glance who needs attention... would that change your Monday morning?"
12. "What metrics would you want in that health score? Pipeline movement? Conversation rates? New leads? Revenue?"

**Anomaly detection:**
13. "If the system automatically flagged 'Client X's lead volume dropped 40% from their baseline this week' — is that the kind of thing you'd want to know about immediately?"
14. "How sensitive should alerts be? Would you rather get a few false positives or risk missing a real problem?"

**Automation with control:**
15. "If the system detected a stalling pipeline and proposed 'pause campaign X and send a check-in email to the account manager' — and you just had to approve or reject — would you trust that workflow?"
16. "Are there any actions you'd NEVER want AI to take on a client account, even with your approval?"

**Template deployment:**
17. "If you could connect your GHL account and have monitoring running across all your clients within an hour — no per-client configuration — would that change how quickly you'd adopt this?"
18. "Would you want different monitoring configurations for different tiers of clients? (e.g. premium vs standard)"

### Section C: Commercial Validation (would they pay)

19. "What are you currently spending per month on tools to monitor client accounts — analytics platforms, reporting tools, dashboards?"
20. "If this existed today and worked as described, what would it be worth to you monthly?"
21. "Would you charge your clients for this? How much? As a separate line item or baked into your package?"
22. "If I told you the price was $200-300/month for up to 20 clients — does that feel like a no-brainer, fair, or too much?"

### Section D: Design Partner Qualification

23. "Would you be willing to connect your GHL account to a new platform to test this — with real client data?"
24. "How much time could you commit to giving feedback over the next 4-6 weeks? 30 minutes a week?"
25. "Is there someone on your team — technical or ops — who'd be the day-to-day user of something like this?"
26. "What would make you say 'yes, I'll use this' vs 'interesting but I'll wait'?"

### Red Flags (this isn't the right prospect)

- Fewer than 5 active clients with AI → pain isn't acute enough
- "GHL's AI works fine for us" → not feeling the governance gap
- Can't describe a single AI incident → may not be deploying AI seriously
- Not willing to connect GHL account → trust barrier too high for design partnership
- "We'd need to see it working for 6 months first" → too risk-averse for early stage

### Green Flags (ideal design partner)

- 10+ active sub-accounts, 5+ with AI features on
- Can describe at least one AI incident or near-miss
- Currently spending time/money on manual monitoring across clients
- Technical enough to understand orchestration vs chatbot
- Willing to connect GHL and commit 30 min/week feedback
- Asks "when can I start?" not "how long until it's perfect?"

---

## Part 5: Summary — The Path Forward

### Build priority for this thread:
1. **Phase 1 completion** — org-level execution guards + authority rules (~1 week)
2. **Phase 2 GHL ingestion** — real data flowing from GHL into canonical entities (~1.5 weeks)
3. **Phase 3 intelligence pipeline** — health scores, anomaly detection, churn risk on real data (~2 weeks)
4. **Phase 4 template + activation** — one-click deployment story (~1.5 weeks)

### The conversation this week:
- Validate pain (questions 1-10)
- Show the vision (questions 11-18)
- Test willingness to pay (questions 19-22)
- Qualify as design partner (questions 23-26)

### What you're NOT selling:
- Not a GHL replacement
- Not a CRM
- Not Voice AI or Conversation AI
- Not a white-label platform (yet)

### What you ARE selling:
- The AI governance and orchestration layer GHL agencies are missing
- Cross-client visibility that doesn't exist anywhere
- AI monitoring that works at scale without babysitting
- Predictable AI costs with real margin certainty
