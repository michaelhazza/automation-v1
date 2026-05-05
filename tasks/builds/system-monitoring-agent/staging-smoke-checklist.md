# System Monitor — Staging Smoke Checklist

Run in a staging environment with at least one connected agent and the system_monitor agent seeded.
Tick each step before opening the PR.

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | **Phase A smoke** — trigger a fast-retry loop (submit a deliberately failing request 5× to the same agent within 60s). Confirm: exactly 1 incident row created, throttle metric fires (check `system_monitor_baselines` or logs), no duplicate incidents. | [ ] PASS / [ ] FAIL | |
| 2 | **Synthetic queue stall** — pause pg-boss for ≥ 6 minutes (or set `SYSTEM_MONITOR_QUEUE_STALL_THRESHOLD_MINUTES=1` and wait). Confirm: `pg-boss-queue-stalled` synthetic check fires an incident within the next synthetic-checks tick (≤ 60s). | [ ] PASS / [ ] FAIL | |
| 3 | **Synthetic heartbeat** — restart the server process. Confirm: `no-recent-successful-runs-in-1h` synthetic check fires within the heartbeat window; recursion guard (`source=self`) prevents the incident from auto-triaging itself. | [ ] PASS / [ ] FAIL | |
| 4 | **Phase 2 incident-driven triage** — create a real incident (e.g. via test-trigger endpoint). Confirm: triage job enqueued, agent run visible in `agent_runs`, `agent_diagnosis` and `investigate_prompt` populated on the incident row, `agent_diagnosis_added` event written, diagnosis visible in the drawer within 60s. | [ ] PASS / [ ] FAIL | |
| 5 | **Phase 2 sweep-driven triage** — let the sweep tick run (wait ≤ 15min). Confirm: `system_monitor_heuristic_fires` rows written, at least one cluster produces an incident via `recordIncident`, triage auto-enqueued, diagnosis populated within 5 minutes. | [ ] PASS / [ ] FAIL | |
| 6 | **Prompt copy-paste (load-bearing manual test)** — copy 5 generated `investigate_prompt` values from the drawer to a local Claude Code instance. For each prompt confirm: (a) the prompt is complete and self-contained, (b) Claude Code can act on it without asking a follow-up clarification question, (c) the suggested steps are specific to the incident (not generic advice). | [ ] PASS / [ ] FAIL | Prompt quality is the primary deliverable of this feature. Do not skip. |
| 7 | **Feedback widget** — on a resolved agent-diagnosed incident: submit feedback (yes/no/partial) via the drawer widget. Confirm: `prompt_was_useful` updated on the incident row, `investigate_prompt_outcome` event written, widget collapses to "Thanks — feedback saved" on next drawer open. | [ ] PASS / [ ] FAIL | |
| 8 | **Rate-limit** — trigger triage for the same incident 3 times (e.g. re-open the incident between attempts or call the triage enqueue directly). Confirm: first two triage, third attempt writes `agent_triage_skipped` with `reason=rate_limited`, `triage_attempt_count` = 2. | [ ] PASS / [ ] FAIL | |
| 9 | **Kill switch** — set `SYSTEM_MONITOR_ENABLED=false`, trigger an incident. Confirm: no triage job enqueued, no `agent_diagnosis` written. Unset the env var, trigger another incident. Confirm: triage resumes and diagnosis is produced. | [ ] PASS / [ ] FAIL | |
| 10 | **Cold-start** — leave staging idle for 60 minutes. Confirm: zero false-positive incidents generated. Check: no heuristic fires on test-run agents, no synthetic checks misfired, no sweep incidents on agents with 0 completed runs in the window. | [ ] PASS / [ ] FAIL | |

## Pre-checklist

Before running the smoke steps:

- [ ] Latest branch deployed to staging (verify git SHA in server logs)
- [ ] `SYSTEM_MONITOR_ENABLED=true` (default)
- [ ] At least one `system_monitor` agent row seeded (`system_agents` + `agents`)
- [ ] `system-ops` org present (migration 0225 applied)
- [ ] pg-boss queues visible: `system-monitor-self-check`, `system-monitor-synthetic-checks`, `system-monitor-baseline-refresh`, `system-monitor-sweep`, `system-monitor-triage`

## Post-checklist actions

After all 10 steps tick green:

1. Record the commit SHA and staging environment name in the PR description.
2. Open the PR against `main`.
