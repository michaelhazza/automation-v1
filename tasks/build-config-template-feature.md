# Build: Config Template Management Page

## Summary

Create a full management page for Configuration Templates accessible from the Platform > Config Templates section. The template name in the list should be clickable, linking to a dedicated "Manage Config Template" page where system admins can view and edit all configurable elements of a configuration template.

## Current State

- Config Templates are stored in `system_hierarchy_templates` table
- One template exists: "GHL Agency Intelligence" (seeded via migration 0068)
- The list page exists at `/system/config-templates` (`SystemCompanyTemplatesPage`)
- The list shows name, agent count, published status, version, and actions (Preview, Unpublish, Delete)
- There is no detail/edit page — the name is not clickable
- Template data includes: operational defaults (JSONB), memory seeds (JSONB), required operator inputs (JSONB), agent slots, connector requirements
- API endpoints exist: `GET/PATCH/DELETE /api/system/company-templates/:id`
- The `loadToOrg()` service method provisions agents + configs + memory into an organisation when a template is applied

## What Needs to Be Built

### 1. Manage Config Template Page (`/system/config-templates/:id`)

A tabbed or sectioned page for viewing and editing a configuration template. All sections should be editable with save functionality.

#### Section: Overview / Metadata
- Name (editable)
- Description (editable, textarea)
- Required connector type (dropdown: none, ghl, etc.)
- Published status (toggle)
- Version (read-only, auto-incremented on save)
- Created / updated timestamps (read-only)

#### Section: Agent Slots
- List of system agents included in this template
- Each slot shows: agent name, role, title, execution scope (org/subaccount), parent slot
- "Add Agent" button — opens a picker showing all published system agents not yet in the template
- "Remove" button per slot
- Drag-to-reorder or sort order controls
- Hierarchy visualisation (which agents report to which)
- Per-slot skill enablement map (which skills are turned on for this agent in this template context)

#### Section: Operational Defaults
This is the core configuration — the JSONB blob that drives all intelligence behaviour. Needs a structured editor, not raw JSON.

Sub-sections:
- **Health Score Factors** — table of metrics with: metric slug, weight (0-1, must sum to 1), label, period type, normalisation config (type, min, max)
- **Anomaly Detection** — default threshold (sigma), window days, seasonality, minimum data points, dedup window minutes
- **Churn Risk Signals** — table of signals with: slug, weight, type (metric_trend/metric_threshold/health_score_level), linked metric, condition, threshold, periods
- **Intervention Types** — table with: slug, label, gate level (auto/review), action type, connector action (if applicable), cooldown hours, cooldown scope
- **Alert Limits** — max alerts per run, max per account per day, batch low priority toggle
- **Cold Start Config** — minimum data points, allow heuristic scoring toggle
- **Execution Parameters** — scan frequency hours, report schedule (day of week, hour), max accounts per run, max concurrent evaluations, max run duration ms, account priority mode, max skip cycles, metric availability mode
- **Data Retention** — metric history days, health snapshot days, anomaly event days, org memory days, sync audit log days, canonical entity days

Each sub-section should validate inputs (e.g. weights sum to 1, positive numbers, valid cron-like values).

#### Section: Memory Seeds
- List of pre-populated org memory entries that get injected when the template is loaded
- Each entry: content (text), entry type (preference, observation, decision, etc.)
- Add/remove/edit entries

#### Section: Required Operator Inputs
- List of inputs the operator must provide when activating the template (e.g. OAuth credentials, alert email)
- Each input: key, label, type (oauth, email, url, text), required (boolean)
- Add/remove/edit inputs

### 2. Navigation Changes

- Make the template name in the list page a clickable link to `/system/config-templates/:id`
- Add breadcrumb: Config Templates > [Template Name]
- Add route in App.tsx under SystemAdminGuard

### 3. API Changes

The `PATCH /api/system/company-templates/:id` endpoint already exists and accepts partial updates. May need to be extended to handle:
- Slot management (add/remove/reorder slots) — may need dedicated endpoints
- Deep operational defaults merging
- Memory seeds array replacement
- Operator inputs array replacement

Potential new endpoints:
- `POST /api/system/company-templates/:id/slots` — add a slot
- `DELETE /api/system/company-templates/:id/slots/:slotId` — remove a slot
- `PATCH /api/system/company-templates/:id/slots/:slotId` — update slot (skill enablement, sort order)

## Key Files

| File | Purpose |
|------|---------|
| `client/src/pages/SystemCompanyTemplatesPage.tsx` | Existing list page — add clickable name link |
| `client/src/App.tsx` | Add route for detail page |
| `server/routes/systemTemplates.ts` | API routes — may need slot management endpoints |
| `server/services/systemTemplateService.ts` | Service layer — template CRUD + slot management |
| `server/db/schema/systemHierarchyTemplates.ts` | Template table schema |
| `server/db/schema/systemHierarchyTemplateSlots.ts` | Slot table schema |

## DB Schema Reference

### system_hierarchy_templates
- `id`, `name`, `description`, `source_type`
- `required_connector_type` (text, nullable)
- `operational_defaults` (JSONB — the big config blob)
- `memory_seeds_json` (JSONB array)
- `required_operator_inputs` (JSONB array)
- `agent_count`, `is_published`, `version`
- `manifest_hash`, `parser_version` (for Paperclip imports)
- `status` (draft/published)
- `created_at`, `updated_at`, `deleted_at`

### system_hierarchy_template_slots
- `id`, `template_id` (FK)
- `system_agent_id` (FK, nullable — set when matched to a system agent)
- `blueprint_slug`, `blueprint_name`, `blueprint_description`, `blueprint_icon`
- `blueprint_role`, `blueprint_title`, `blueprint_capabilities`
- `blueprint_master_prompt`, `blueprint_model_provider`, `blueprint_model_id`
- `parent_slot_id` (self-referencing for hierarchy)
- `skill_enablement_map` (JSONB)
- `execution_scope` (subaccount/org)
- `sort_order`

## Design Considerations

- The operational defaults editor is the most complex part. Consider building reusable table-editor components for the repeated pattern of "list of items with typed fields".
- Weights that must sum to 1.0 need real-time validation feedback.
- The agent slot picker should show which agents are already included to prevent duplicates.
- Version should auto-increment when any substantive change is saved (not on every keystroke).
- Consider a "Preview JSON" toggle for power users who want to see/edit the raw JSONB.
- The page should work for both imported Paperclip templates and manually created ones.

## Out of Scope (for this task)

- Template activation wizard (the flow an org admin goes through when applying a template)
- Connector configuration UI (OAuth flows, credential management)
- Template versioning/history (viewing previous versions)
- Template cloning/duplication
- Template export to Paperclip format
