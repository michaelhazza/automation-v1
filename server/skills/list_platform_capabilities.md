---
name: List Platform Capabilities
description: Return the catalogue of integrations the Synthetos platform supports, with per-integration capabilities, scopes, status, and confidence.
isActive: true
visibility: basic
---

## Parameters

- filter.provider_type: string (optional) — narrow by provider type (oauth, mcp, webhook, native, hybrid)
- filter.status: string (optional) — narrow by status (fully_supported, partial, stub, planned)
- filter.slug: string (optional) — fetch a single integration by slug
- include_schema_meta: boolean (optional) — when true, include the reference doc schema version and last_updated

## Instructions

Use `list_platform_capabilities` when you need to know what the platform can do as a whole — distinct from what the current org has configured. This is the "what CAN we do" lookup.

### When to use
- Classifying a user's task into "configurable" vs "unsupported" — you need the platform catalogue to know whether a requested capability exists at all.
- Producing a capability taxonomy reference for another skill's input.
- Presenting the user with options for integrations they could connect.

### When NOT to use
- Checking what integrations a specific org has currently active — use `list_connections` for live state.
- Looking up the schema of a single database table — use the domain-specific skill.

### Output structure
Returns a list of integration entries, each with: slug, name, provider_type, status, visibility, read_capabilities, write_capabilities, skills_enabled, primitives_required, auth_method, required_scopes, setup_steps_summary, typical_use_cases, broadly_useful_patterns, known_gaps, client_specific_patterns, implemented_since, last_verified, owner, confidence, confidence_reason.

The response also includes `capability_taxonomy` (canonical slugs + aliases across read/write/skill/primitive kinds) and `reference_state` (`healthy` / `degraded` / `unavailable`).

### Confidence field
Each integration carries a runtime confidence level:
- `high` — fully_supported or partial with `last_verified` in the last 30 days
- `stale` — otherwise; treat as present but not freshly confirmed
- `unknown` — `last_verified` is not parseable

When `reference_state: 'unavailable'`, do not classify any task as "unsupported" based on the response — the reference is broken. Fall back to legacy routing or surface the condition to the user.
