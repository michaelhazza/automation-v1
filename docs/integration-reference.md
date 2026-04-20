# Integration Reference

Machine-parseable source of truth for what the Synthetos platform can do per integration. Consumed at runtime by the `list_platform_capabilities` skill; maintained by hand by the Synthetos team.

**Maintenance rules:**

1. Any PR that changes integration behaviour (new scope, new skill, changed status, new write capability) updates the matching integration block in the same commit.
2. `last_verified` is bumped whenever the Synthetos team reviews an entry.
3. A new integration is not "shipped" until its block exists. CODEOWNERS requires Synthetos team review on every slug addition to the taxonomy.
4. `scripts/verify-integration-reference.ts` runs in `run-all-gates.sh` and blocks drift — every OAuth provider in `oauthProviders.ts` must have a block, every MCP preset in `mcpPresets.ts` must have a block, every slug in `skills_enabled` must match a skill in `server/skills/`, and every capability slug referenced anywhere must appear in the `capability_taxonomy` block below.

See `docs/orchestrator-capability-routing-spec.md` for the full design rationale.

---

## Schema version

```yaml integration_reference_meta
schema_version: "1.0.0"
last_updated: "2026-04-17"
```

---

## Capability taxonomy

Every capability slug referenced in any integration block below must appear in this taxonomy. Aliases are used by the decomposition pipeline's normalisation step to canonicalise LLM-produced slugs. Naming conventions: read capabilities use `<resource>_read` or `<resource>_list`; write capabilities use `<verb>_<resource>`; skills match their own slug; primitives are lowercase compound nouns.

```yaml capability_taxonomy
read_capabilities:
  - slug: inbox_read
    aliases: [read_inbox, inbox_reading, email_read, mailbox_read, messages_read]
    description: Read message headers and metadata from a provider's inbox
  - slug: email_body_read
    aliases: [read_email_body, message_body_read, fetch_email]
    description: Fetch full email body content for a specific message
  - slug: calendar_read
    aliases: [read_calendar, events_read, calendar_list]
    description: List calendar events
  - slug: contact_list
    aliases: [contacts_read, list_contacts, read_contacts]
    description: List contacts from a CRM or address book
  - slug: deal_list
    aliases: [deals_read, list_deals, pipeline_read, opportunities_list]
    description: List deals/opportunities from a CRM pipeline
  - slug: payment_list
    aliases: [payments_read, list_payments, transactions_read]
    description: List payments or transactions
  - slug: customer_list
    aliases: [customers_read, list_customers]
    description: List customers from a billing or CRM system
  - slug: board_read
    aliases: [read_board, board_list, project_read]
    description: Read board/project structure and items
  - slug: page_read
    aliases: [read_page, document_read, doc_read]
    description: Read pages or documents
  - slug: database_read
    aliases: [read_database, records_read, rows_read]
    description: Read records from a structured database
  - slug: channel_messages_read
    aliases: [read_channel, slack_messages_read, channel_history]
    description: Read messages from a chat channel
  - slug: subaccount_read
    aliases: [read_subaccount, location_read]
    description: Read subaccount/location metadata from a multi-tenant CRM
  - slug: clientpulse.config.read
    aliases: [pulse_config_read, clientpulse_config_list]
    description: Read ClientPulse operational_config values (scoring factors, churn bands, intervention defaults, alert limits)
  - slug: clientpulse.config.history
    aliases: [pulse_config_history, config_audit_trail]
    description: Browse the config_history audit trail for ClientPulse operational_config changes

write_capabilities:
  - slug: send_email
    aliases: [email_send, compose_email, mail_send]
    description: Send an email message
  - slug: modify_labels
    aliases: [apply_label, label_email, change_labels, add_labels, remove_labels]
    description: Apply or remove labels on a provider's messages
  - slug: create_event
    aliases: [event_create, calendar_event_create, schedule_event]
    description: Create a calendar event
  - slug: create_contact
    aliases: [contact_create, add_contact, new_contact]
    description: Create a new contact in a CRM
  - slug: update_contact
    aliases: [contact_update, modify_contact]
    description: Update fields on an existing contact
  - slug: create_deal
    aliases: [deal_create, opportunity_create, add_deal]
    description: Create a new deal/opportunity
  - slug: update_deal
    aliases: [deal_update, advance_deal_stage, modify_deal]
    description: Update fields on an existing deal
  - slug: post_message
    aliases: [send_message, channel_post, slack_post]
    description: Post a message to a chat channel
  - slug: create_page
    aliases: [page_create, document_create, new_page]
    description: Create a page or document
  - slug: update_database_record
    aliases: [record_update, row_update, upsert_record]
    description: Create or update a record in a structured database
  - slug: clientpulse.config.update
    aliases: [pulse_config_update, config_patch, operational_config_update]
    description: Apply a single dot-path patch to ClientPulse operational_config (sensitive paths route through the review queue)
  - slug: clientpulse.config.reset
    aliases: [pulse_config_reset, config_factory_reset]
    description: Revert ClientPulse operational_config (or a specific path) to hierarchy template defaults

skills:
  - slug: classify_email
    aliases: [email_classify, categorise_email, label_email_classify]
    description: Classify an email into one of a set of categories
  - slug: read_inbox
    aliases: [inbox_scan, fetch_inbox]
    description: Read a batch of messages from a linked inbox (skill wrapper over inbox_read capability)
  - slug: send_email
    aliases: [mail_compose, email_compose]
    description: Compose and send an email
  - slug: analyse_performance
    aliases: [performance_analyse, perf_review]
    description: Analyse performance metrics and produce a summary
  - slug: compute_health_score
    aliases: [health_score, account_health]
    description: Compute a health score for an account or workspace
  - slug: config_update_hierarchy_template
    aliases: [pulse_config_update_skill, clientpulse_config_skill]
    description: Configuration Agent skill — apply a single dot-path patch to a hierarchy template's operational_config JSONB with sensitive-path gating (Phase 4.5)

primitives:
  - slug: scheduled_run
    aliases: [schedule, recurring_run, cron_run, heartbeat]
    description: Execute an agent on a recurring schedule
  - slug: webhook_receiver
    aliases: [webhook, inbound_webhook]
    description: Accept inbound webhook events
  - slug: task_board
    aliases: [kanban, work_board]
    description: Track work as tasks on a board
  - slug: oauth_connection
    aliases: [oauth, oauth2]
    description: OAuth 2.0 connection handshake and token management
  - slug: mcp_server
    aliases: [mcp, model_context_protocol]
    description: Model Context Protocol server for tool access
  - slug: hierarchy_templates
    aliases: [hierarchy_template, config_template, operational_config_template]
    description: Per-org reusable blueprint that stores `operational_config` JSONB (ClientPulse scoring + governance knobs)
  - slug: config_history
    aliases: [audit_log, config_audit]
    description: Append-only audit log for config entity changes (version + snapshot + change_source)
```

---

## Integrations

### Gmail

```yaml integration
slug: gmail
name: Gmail
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - inbox_read
  - email_body_read
write_capabilities:
  - send_email
  - modify_labels
skills_enabled:
  - read_inbox
  - send_email
  - classify_email
primitives_required:
  - oauth_connection
  - scheduled_run
auth_method: oauth2
required_scopes:
  - https://www.googleapis.com/auth/gmail.readonly
  - https://www.googleapis.com/auth/gmail.send
  - https://www.googleapis.com/auth/gmail.modify
setup_steps_summary: Connect your Google account and approve the Gmail read/send/modify scopes.
setup_doc_link: null
typical_use_cases:
  - Triage incoming emails by category
  - Send automated follow-ups
  - Label messages by sender or subject pattern
broadly_useful_patterns:
  - Inbox triage
  - Email classification and labelling
  - Automated reply drafting
known_gaps:
  - Thread-level operations (archive whole threads) not yet exposed
  - Attachment download not yet supported
client_specific_patterns:
  - Filters referencing specific client email addresses or domains
  - Label names tied to a single agency's workflow
implemented_since: "2026-03-01"
last_verified: "2026-04-17"
owner: platform-team
```

### Google Calendar

```yaml integration
slug: google-calendar
name: Google Calendar
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - calendar_read
write_capabilities:
  - create_event
skills_enabled: []
primitives_required:
  - oauth_connection
  - scheduled_run
auth_method: oauth2
required_scopes:
  - https://www.googleapis.com/auth/calendar.readonly
  - https://www.googleapis.com/auth/calendar.events
setup_steps_summary: Connect your Google account and approve calendar read/events scopes.
setup_doc_link: null
typical_use_cases:
  - Scheduled reporting on calendar load
  - Creating follow-up meetings after deals advance
broadly_useful_patterns:
  - Meeting recap summaries
  - Calendar-based workload reporting
known_gaps:
  - Attendee availability checks not yet exposed
  - Recurring event modification limited
client_specific_patterns:
  - Meeting templates tied to a specific client's booking preferences
implemented_since: "2026-03-01"
last_verified: "2026-04-17"
owner: platform-team
```

### Slack

```yaml integration
slug: slack
name: Slack
provider_type: oauth
status: fully_supported
visibility: public
read_capabilities:
  - channel_messages_read
write_capabilities:
  - post_message
skills_enabled: []
primitives_required:
  - oauth_connection
  - webhook_receiver
auth_method: oauth2
required_scopes:
  - channels:read
  - channels:history
  - chat:write
  - groups:read
setup_steps_summary: Install the Synthetos Slack app into your workspace and select channels to listen on.
setup_doc_link: null
typical_use_cases:
  - Alert channel notifications
  - Agent-initiated posts to client channels
  - Listening to specific channels for triggers
broadly_useful_patterns:
  - Agent alerts on exception events
  - Scheduled summary posts to channels
known_gaps:
  - DM-level operations not yet supported
  - File upload API not yet wrapped
client_specific_patterns:
  - Channel IDs unique to one workspace
  - Bot display names branded per agency
implemented_since: "2026-02-15"
last_verified: "2026-04-17"
owner: platform-team
```

### HubSpot

```yaml integration
slug: hubspot
name: HubSpot
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - contact_list
  - deal_list
write_capabilities:
  - create_contact
  - update_contact
  - create_deal
  - update_deal
skills_enabled:
  - compute_health_score
primitives_required:
  - oauth_connection
  - scheduled_run
  - webhook_receiver
auth_method: oauth2
required_scopes:
  - crm.objects.contacts.read
  - crm.objects.contacts.write
  - crm.objects.deals.read
  - crm.objects.deals.write
setup_steps_summary: Install the Synthetos HubSpot app and approve contact and deal scopes.
setup_doc_link: null
typical_use_cases:
  - Automated contact creation from inbound leads
  - Deal stage progression based on email or meeting signal
  - Pipeline health reporting
broadly_useful_patterns:
  - CRM pipeline reporting
  - Lead triage and scoring
  - Deal stage automation
known_gaps:
  - Custom properties discovery is partial
  - Company-level operations not yet exposed
client_specific_patterns:
  - Custom properties tied to one agency's schema
  - Stage names unique to a single pipeline
implemented_since: "2026-03-10"
last_verified: "2026-04-17"
owner: platform-team
```

### Stripe

```yaml integration
slug: stripe
name: Stripe
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - payment_list
  - customer_list
write_capabilities: []
skills_enabled: []
primitives_required:
  - oauth_connection
  - webhook_receiver
auth_method: oauth2
required_scopes:
  - read_only
setup_steps_summary: Connect your Stripe account in read-only mode for reporting.
setup_doc_link: null
typical_use_cases:
  - Revenue reporting
  - Customer payment health
  - Churn detection signals
broadly_useful_patterns:
  - Revenue dashboards
  - Failed payment alerts
known_gaps:
  - Write operations (create charge, refund) not yet supported
  - Subscription lifecycle events partial
client_specific_patterns:
  - Tier/plan naming tied to one merchant
implemented_since: "2026-03-15"
last_verified: "2026-04-17"
owner: platform-team
```

### Monday.com

```yaml integration
slug: monday
name: Monday.com
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - board_read
write_capabilities:
  - update_database_record
skills_enabled: []
primitives_required:
  - oauth_connection
  - webhook_receiver
auth_method: oauth2
required_scopes:
  - boards:read
  - boards:write
setup_steps_summary: Install the Synthetos Monday app and grant board access.
setup_doc_link: null
typical_use_cases:
  - Project status summaries
  - Automated task creation from external signals
broadly_useful_patterns:
  - Project reporting dashboards
  - Cross-tool task sync
known_gaps:
  - Board column discovery is manual
client_specific_patterns:
  - Board IDs unique to one team
  - Column mappings per agency
implemented_since: "2026-03-20"
last_verified: "2026-04-17"
owner: platform-team
```

### GoHighLevel

```yaml integration
slug: ghl
name: GoHighLevel
provider_type: oauth
status: fully_supported
visibility: public
read_capabilities:
  - contact_list
  - deal_list
  - subaccount_read
write_capabilities:
  - create_contact
  - update_contact
skills_enabled: []
primitives_required:
  - oauth_connection
  - webhook_receiver
  - scheduled_run
auth_method: oauth2
required_scopes:
  - contacts.readonly
  - contacts.write
  - opportunities.readonly
  - opportunities.write
  - locations.readonly
  - users.readonly
  - calendars.readonly
  - funnels.readonly
  - conversations.readonly
  - conversations/message.readonly
  - businesses.readonly
  - saas/subscription.readonly
scope_behavior: |
  Expanded scopes (ClientPulse Phase 1, added 2026-04-18) apply to new OAuth
  authorisations only. Existing connections with the original 3-scope token
  continue working for their originally-granted endpoints; endpoints that
  require the new scopes (funnels, calendars, users, locations, saas) gate
  themselves and mark observations `unavailable_missing_scope` when absent.
  Re-consent is surfaced via a pilot-stage banner (Phase 5 surface).
webhook_events:
  - ContactCreate
  - ContactUpdate
  - OpportunityStageUpdate
  - OpportunityStatusUpdate
  - ConversationCreated
  - ConversationUpdated
  - INSTALL
  - UNINSTALL
  - LocationCreate
  - LocationUpdate
setup_steps_summary: Install the Synthetos GHL app and authorise sub-account access.
setup_doc_link: null
typical_use_cases:
  - Multi-tenant agency CRM automation
  - Per-subaccount pipeline reporting
  - Contact enrichment flows
  - ClientPulse Staff Activity Pulse (weighted activity score from canonical CRM mutations)
  - ClientPulse Integration Fingerprint Scanner (detects third-party tools from conversation providers, workflow action types, webhook domains, tag prefixes, custom-field prefixes, and contact sources)
broadly_useful_patterns:
  - CRM pipeline reporting
  - Multi-location contact management
  - Sub-account lifecycle tracking via INSTALL/UNINSTALL webhook events
known_gaps:
  - Custom field propagation not fully automated
  - SaaS-tier AI feature usage endpoint pending (ai_feature_usage signal currently placeholder)
client_specific_patterns:
  - Subaccount IDs per agency client
implemented_since: "2026-02-20"
last_verified: "2026-04-19"
owner: platform-team
```

### Notion

```yaml integration
slug: notion
name: Notion
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - page_read
  - database_read
write_capabilities:
  - create_page
  - update_database_record
skills_enabled: []
primitives_required:
  - oauth_connection
auth_method: oauth2
required_scopes:
  - read_content
  - update_content
  - insert_content
setup_steps_summary: Share specific Notion pages or databases with the Synthetos integration.
setup_doc_link: null
typical_use_cases:
  - Meeting notes capture into a shared database
  - Automated report pages from upstream analysis
broadly_useful_patterns:
  - Documentation automation
  - Report publishing
known_gaps:
  - Workspace-level operations not supported
  - Block-level editing is coarse
client_specific_patterns:
  - Database schemas unique to one team
implemented_since: "2026-04-01"
last_verified: "2026-04-17"
owner: platform-team
```

### Airtable

```yaml integration
slug: airtable
name: Airtable
provider_type: oauth
status: partial
visibility: public
read_capabilities:
  - database_read
write_capabilities:
  - update_database_record
skills_enabled: []
primitives_required:
  - oauth_connection
auth_method: oauth2
required_scopes:
  - data.records:read
  - data.records:write
  - schema.bases:read
setup_steps_summary: Grant the Synthetos integration access to specific bases.
setup_doc_link: null
typical_use_cases:
  - Database-backed client intake forms
  - Report publishing to a shared base
broadly_useful_patterns:
  - Structured data automation
  - Form-driven task creation
known_gaps:
  - Attachment handling is limited
client_specific_patterns:
  - Base IDs and table schemas unique per team
implemented_since: "2026-04-05"
last_verified: "2026-04-17"
owner: platform-team
```

### Playwright (MCP)

```yaml integration
slug: playwright-mcp
name: Playwright MCP
provider_type: mcp
status: fully_supported
visibility: public
read_capabilities:
  - page_read
write_capabilities: []
skills_enabled: []
primitives_required:
  - mcp_server
auth_method: mcp_token
required_scopes: []
setup_steps_summary: Provision the Playwright MCP server endpoint and token.
setup_doc_link: null
typical_use_cases:
  - Scraping public pages for agent analysis
  - Screenshot capture for reporting
  - Automated browser-based verification
broadly_useful_patterns:
  - Web scraping
  - Automated browser verification
known_gaps:
  - Authenticated browsing flows require additional setup
client_specific_patterns:
  - Target URLs specific to one client's site
implemented_since: "2026-03-25"
last_verified: "2026-04-17"
owner: platform-team
```

### ClientPulse Configuration (pseudo-integration)

```yaml integration
slug: clientpulse-configuration
name: ClientPulse Configuration
provider_type: native
status: fully_supported
visibility: public
read_capabilities:
  - clientpulse.config.read
  - clientpulse.config.history
write_capabilities:
  - clientpulse.config.update
  - clientpulse.config.reset
skills_enabled:
  - config_update_hierarchy_template
primitives_required:
  - hierarchy_templates
  - config_history
auth_method: none
required_scopes: []
setup_steps_summary: No setup — available to every org out of the box once the GHL Agency Intelligence template is applied.
setup_doc_link: null
typical_use_cases:
  - Operator bumps health-score weights via the Configuration Assistant chat
  - Operator lowers an alert notification threshold after a noise complaint
  - Operator tightens intervention cooldown hours after an over-firing incident
broadly_useful_patterns:
  - Audited config-as-data changes with change_source provenance
  - Sensitive-path governance via review-queue gating (B5)
known_gaps:
  - V1 applies single-path patches per skill call; multi-path composed changes run as multiple calls
client_specific_patterns:
  - Per-org overrides live on hierarchy_templates.operational_config
implemented_since: "2026-04-19"
last_verified: "2026-04-19"
owner: platform-team
```
