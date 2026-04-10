---
name: Detect Anomaly
description: Compare current metrics against historical baseline and flag significant deviations
isActive: true
visibility: basic
---

## Parameters

- account_id: string (required) — The canonical account ID to check
- metric_name: string (required) — The metric to check (e.g. 'health_score', 'contact_growth', 'pipeline_value')
- current_value: number (required) — The current value of the metric

## Instructions

Compares the current value against a rolling baseline from historical snapshots. Baselines are per-account — each account is compared to its own history, not to portfolio averages. The sensitivity threshold is configurable per organisation.
