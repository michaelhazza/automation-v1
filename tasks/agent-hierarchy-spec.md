# Agent Hierarchy & Organisation Templates — Specification

## Status: In Progress

## Background

The application has a three-tier architecture: System Agents → Org Agents → Subaccount Agents. Currently all agents at every level are flat — no orchestration model, no reusable team structures, no compatibility with Paperclip (MIT licensed, open-source agent organisation format).

## What We Are Building

A portable agent organisation system:

1. **Agent hierarchy** — parent/child relationship tree at each level (system, org, subaccount)
2. **Hierarchy templates** — reusable named blueprints stored at org level
3. **Template application** — apply templates to subaccounts with preview
4. **Paperclip import** — import Paperclip organisation files as org templates

Phase 1 hierarchy is **structural and visual only** — no effect on agent execution routing or delegation.

## Design Principles

- Additive, not breaking (all schema changes nullable)
- Three-tier hierarchy preserved
- Templates are org-scoped blueprints only
- Materialisation is one-time (no retroactive sync)
- Auto-inherit at provisioning time, not auto-sync
- Apply is idempotent
- Preview guaranteed identical to apply (same code path, rolled-back transaction)

## Data Model

### New Tables

**hierarchy_templates** — org-scoped template definitions
- id, organisationId, name, description, isDefaultForSubaccount, version, sourceType, paperclipManifest, timestamps, deletedAt

**hierarchy_template_slots** — slots within templates
- id, templateId, systemAgentId?, agentId?, blueprintSlug?, paperclipSlug?, blueprint fields (name, description, icon, role, title, capabilities, masterPrompt, modelProvider, modelId), parentSlotId?, sortOrder

### Additive Columns

- system_agents: parent_system_agent_id, agent_role, agent_title
- agents: parent_agent_id, agent_role, agent_title
- subaccount_agents: parent_subaccount_agent_id, agent_role, agent_title

### Integrity Constraints

- CHECK (parent != self) on all three tables
- Max depth 10 levels enforced at service layer
- Circular ancestry check on write
- Children ordered sortOrder ASC, fallback createdAt ASC

## Build Order

1. DB migration
2. System agent hierarchy API + UI
3. Org agent hierarchy API + UI
4. Org template CRUD API
5. Paperclip import → org template API
6. Org template UI
7. Apply template to subaccount API
8. Template application UI
9. Subaccount hierarchy tree view
10. Direct subaccount Paperclip import

See full specification in the original task description for complete API schemas, matching logic, permissions, and UI details.
