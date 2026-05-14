# Research brief: staged rollout patterns for agent and skill changes

## Context

We are designing a four-ring rollout pipeline (Dev → Test → Canary → Prod) for promoting agent and skill updates safely. Two distinct use cases share the pipeline:

1. **Internal release** (live now). System-tier skill changes shipped by our staff. Initial rings populated by internal test subaccounts.
2. **Customer rollout** (post-launch). Same pipeline, customer cohorts populating later rings. Currently blocked by a policy flag (no staged rollouts pre-launch).

Cohort comparison metrics we have available:

- Scorecard verdicts (LLM-as-judge, sampled, immutable).
- Cache-hit-rate delta on identical prompts (prompt change invalidates prefix cache; delta reveals scope of behavioural change).
- Latency and cost per run.
- Operator correction frequency.
- Run-level LLM ledger (per-step costs, model, tokens, prefix hash) is live in production.

What the pipeline does **not** yet have, and what depends on this research:

- Specific cohort sizes per ring.
- Dwell times per ring.
- Auto-pause thresholds per metric.
- Cohort-selection strategy (random vs. stratified).
- Rollback semantics (hard rollback vs. shadow vs. pinning).

## What would change my mind?

1. **What ring shapes are emerging in production agentic systems?** Number of rings, cohort sizes, dwell times. Any published reference architectures from teams shipping prompt or skill updates at scale.

2. **Cohort selection for canary.** Random sampling, stratified by use case or customer size, behavioural cluster, opt-in volunteer cohort, paid-tier-first? What has proven less noisy and more representative?

3. **Auto-pause triggers.** Specific metrics and thresholds practitioners have settled on. Has cache-hit-rate delta proven a useful regression signal, or is it too noisy? What composite signals work best?

4. **Rollback semantics for prompt/skill changes specifically.** Code rollback semantics don't map cleanly because previously-completed runs that depended on the new prompt may still be in flight. Hard rollback, shadow execution, per-cohort pinning, replay? What works?

5. **Published incidents.** Any public post-mortems where a botched prompt or skill rollout caused customer-visible harm, and what the recovery pattern was. Especially valuable for designing the "stop the bleeding" path.

6. **Skeptic's case.** Strongest argument that staged rollout is overkill for prompt changes, and that fast revert with feature flags is sufficient. When does that argument actually hold?

## Output I want

A recommended ring configuration: number of rings, cohort sizes, dwell times, gate metrics, auto-pause thresholds, rollback semantics. Each choice anchored to a specific public source (production write-up, paper, incident report) from the last 18 months. Flag anything that's a defensible guess vs. evidence-backed recommendation.
