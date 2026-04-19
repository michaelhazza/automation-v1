---
slug: config_update_hierarchy_template
title: Update hierarchy template operational_config
category: configuration
intent: |
  Apply a single dot-path / value patch to a hierarchy template's
  operational_config JSONB. Validates the proposed full config against the
  operational_config schema (including sum-constraints on healthScoreFactors
  weights). Writes to `config_history` with entity_type=
  'clientpulse_operational_config' and change_source='config_agent' (B3).

  Sensitive paths (per `SENSITIVE_CONFIG_PATHS`) route through the
  action→review queue instead of writing directly; the action handler
  commits the merge only after operator approval (B5).

inputs:
  templateId: hierarchy_templates.id — target template
  path: dot-path into operational_config (e.g. `alertLimits.notificationThreshold`)
  value: JSON-serialisable new value (leaf replaces; arrays replace wholesale)
  reason: operator-supplied rationale (logged on config_history.change_summary)
  sourceSession: optional session id (surfaces on config_history.session_id)

returns:
  committed: boolean
  classification: 'non_sensitive' | 'sensitive'
  configHistoryVersion: integer (when committed=true)
  actionId: uuid (when committed=false, sensitive path)
  requiresApproval: boolean

errors:
  - SCHEMA_INVALID
  - SUM_CONSTRAINT_VIOLATED
  - TEMPLATE_NOT_FOUND
  - AGENT_REQUIRED_FOR_SENSITIVE
  - DRIFT_DETECTED   (on approval-execute if the config changed since proposal)
---

# config_update_hierarchy_template

The Configuration Agent calls this skill to mutate a hierarchy template's
`operational_config` JSONB. One skill call = one dot-path patch — multi-path
changes are composed as multiple skill calls (the agent chains them).

## Flow

1. Load the current config for `(organisationId, templateId)`.
2. Deep-merge the patch. Arrays replace wholesale; nested keys preserve siblings.
3. Validate the proposed full config via `operationalConfigSchema`. Sum-constraint
   violations (e.g. healthScoreFactors weights not summing to 1.0) return
   `SUM_CONSTRAINT_VIOLATED`; other shape errors return `SCHEMA_INVALID`.
4. Classify `path`:
   - **Non-sensitive** → direct merge into `hierarchy_templates.operational_config`
     + `config_history` row in the same transaction. Returns
     `{ committed: true, configHistoryVersion }`.
   - **Sensitive** (matches `SENSITIVE_CONFIG_PATHS`) → insert `actions` row with
     `gateLevel='review'`, `status='proposed'`, `metadataJson.validationDigest`
     snapshot. Returns `{ committed: false, actionId, requiresApproval: true }`.
     The action handler `executeApprovedHierarchyTemplateConfigUpdate` runs on
     approval: re-validates, performs the merge + history write.

## Ship-gates

- **B3**: `config_history` row written with `entity_type=
  'clientpulse_operational_config'`, `change_source='config_agent'`.
- **B5**: Sensitive paths route through action→review→approve, not inline commit.

## Usage (agent-facing)

```
config_update_hierarchy_template({
  templateId: "<uuid>",
  path: "alertLimits.notificationThreshold",
  value: 5,
  reason: "Operator asked to lower the threshold via chat",
  sourceSession: "<session uuid>"
})
```
