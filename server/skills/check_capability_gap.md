---
name: Check Capability Gap
description: Classify a required-capability list into configured, configurable, or unsupported. Core skill for Orchestrator routing path selection.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- orgId: string (required) — must match caller's organisation
- subaccountId: string (optional) — inferred from context if not provided
- required_capabilities: array (required) — list of `{kind, slug}` objects. `kind` is one of `integration`, `read_capability`, `write_capability`, `skill`, `primitive`. `slug` may be canonical or an alias.

## Instructions

Use `check_capability_gap` when the Orchestrator has decomposed a user task into a required-capability list and needs to decide which of the four routing paths (A configured, B configurable narrow, C configurable broad, D unsupported) to take.

### Decision rule
This skill returns `verdict` as one of `configured`, `configurable`, `unsupported`, `unknown`.

- `configured` — a single candidate agent covers every capability AND every integration has an active connection AND every required scope is granted. All three conditions must hold atomically per candidate agent.
- `configurable` — reference declares the capabilities but no single agent has them all with matching connections/scopes. Route to Path B (or Path C if broadly useful).
- `unsupported` — reference is `healthy` and does not declare at least one capability on any integration. Route to Path D.
- `unknown` — reference is `degraded` or `unavailable`, or a slug did not resolve to a canonical form. Do not classify as unsupported.

### Output details
- `per_capability` — per-capability availability with `confidence` from the Integration Reference
- `candidate_agents` — every linked agent considered, with `matched[]`, `missing[]`, `coverage`, and `combined_coverage_possible` (true when two+ agents would together cover the required set)
- `missing_for_configurable` — capability keys the user would need to set up for Path B/C
- `missing_for_unsupported` — capability keys the platform does not support at all (feed these into `request_feature` for Path D)
- `reference_state` — `healthy` / `degraded` / `unavailable`, surfaced for callers to decide whether to trust the verdict

### Normalisation
Slug normalisation is applied automatically: aliases from the capability taxonomy (e.g. `read_inbox` → `inbox_read`) are resolved before matching. If a slug does not resolve, the per-capability entry is marked `availability: unknown` rather than silently dropped.
