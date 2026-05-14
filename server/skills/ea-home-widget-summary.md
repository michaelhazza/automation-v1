---
slug: ea.home_widget.summary
name: EA Home Widget Summary
description: Provides summary card data for the Personal Assistant home widget. Returns pending draft count and latest briefing timestamp. No LLM call — pure data read.
actionType: ea.home_widget.summary
riskTier: 2
defaultGate: auto
requiredIntegration: null
topics:
  - workspace
---

## Purpose

Returns a `summary_card` widget for the Personal Assistant's home zone card. Data sources:
- Pending approval count from `actions WHERE status = 'pending_approval' AND kind = 'ea_draft'`
- Latest daily briefing run from `agent_runs WHERE trigger_context->>'eventType' = 'daily_briefing'`

## Output

Returns a `WidgetData` object of type `summary_card`:
- `primaryLine`: agent display name
- `secondaryLines`: pending count + last briefing info
- `openLink`: deep link to the Personal Assistant page
