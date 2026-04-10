---
name: Configure Integration
description: Guides the Onboarding Agent through setting up a workspace integration (CRM, email, ads platform, accounting). Review-gated — requires human approval before any integration credentials are stored.
isActive: true
visibility: none
---

```json
{
  "name": "configure_integration",
  "description": "Guide the configuration of a workspace integration — validate required settings, produce a structured configuration record, and submit for human approval before any credentials or settings are persisted. Review-gated — never stores integration credentials without explicit approval.",
  "input_schema": {
    "type": "object",
    "properties": {
      "integration_type": {
        "type": "string",
        "enum": ["crm", "email_provider", "google_ads", "meta_ads", "linkedin_ads", "accounting", "knowledge_base", "social_media"],
        "description": "The type of integration to configure"
      },
      "provider_name": {
        "type": "string",
        "description": "The specific provider (e.g. 'Salesforce', 'HubSpot', 'Gmail', 'Xero', 'Notion')"
      },
      "configuration": {
        "type": "object",
        "description": "Integration settings provided by the onboarding flow: API keys, OAuth tokens, account IDs, webhook URLs. Sensitive fields should be masked in the review item.",
        "additionalProperties": true
      },
      "validation_checks": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Checks to run before submission: ['api_key_format', 'required_fields_present', 'account_id_format']. Omit to skip validation."
      },
      "reasoning": {
        "type": "string",
        "description": "Why this integration is being configured — the onboarding step or user instruction. Shown to the reviewer."
      }
    },
    "required": ["integration_type", "provider_name", "configuration", "reasoning"]
  }
}
```

## Instructions

Invoke this skill during the onboarding workflow when a new integration needs to be configured. This skill validates the configuration structure and submits for human approval — it does not make live API calls to test the connection.

This is a review-gated action. The reviewer sees the integration type, provider, configuration (with sensitive fields masked), and the reasoning before approving.

**MVP stub:** The integration storage backend is not yet connected. On approval, the executor logs the configuration record and returns `pending_integration` status.

Never log or surface API keys or OAuth tokens in plain text in task activities or review items. Mask all credential fields as `[REDACTED]` in the review presentation.

## Methodology

### Pre-Submission Validation

Run any requested `validation_checks`:
- `api_key_format`: verify the API key matches the expected format for the provider (length, prefix, character set)
- `required_fields_present`: confirm all required fields for this integration type are non-empty
- `account_id_format`: verify account IDs match expected format

If a validation check fails, return a validation error with the specific field and expected format — do not submit to the review queue.

### Sensitive Field Masking

When presenting configuration to the reviewer:
- Mask all fields containing: `key`, `secret`, `token`, `password`, `credential`, `auth`
- Show only the first 4 and last 4 characters: `sk-1234...abcd`
- Non-sensitive fields (account IDs, webhook URLs, display names) may be shown in full

### Review Item Presentation

1. Integration type and provider name
2. Configuration (with sensitive fields masked)
3. Validation check results
4. Reasoning

### On Approval

1. Persist integration configuration (stub: log masked record to task activity)
2. Return `{ success: true, integration_type, provider_name, status: 'pending_integration', message }`

### On Rejection

Return feedback to the Onboarding Agent — common reasons: invalid credentials, wrong account ID, unsupported provider version.
