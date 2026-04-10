---
name: Compute Health Score
description: Calculate a composite health score (0-100) for a subaccount based on normalised metrics
isActive: true
visibility: basic
---

## Parameters

- account_id: string (required) — The canonical account ID to score

## Instructions

This skill computes health scores using a configurable weight map. The weights determine how much each factor contributes to the final score. Default weights are: pipeline velocity (0.30), conversation engagement (0.25), contact growth (0.20), revenue trend (0.15), platform activity (0.10).

The score is written as a HealthSnapshot record for historical tracking and anomaly detection.
