# Post-Merge Smoke Test Runbook — PR #196 (audit-remediation)

Source: chatgpt-pr-review Round 1 post-merge checklist. Linked from spec §G2.

Run this runbook against the environment where PR #196 has been deployed. Record outcomes in
the `## First-run output` section at the bottom. If any step fails, open a `## Blockers` entry
in `tasks/todo.md` per spec §G2 acceptance criterion 3.

---

## Step 1 — Verify agent creation still works

1. Open the Automation OS UI and navigate to the Agents section.
2. Create a new agent (any name, minimal config).
3. Confirm the agent persists after save:
   - Agent ID is visible in the UI or URL.
   - No 500 errors appear in browser DevTools or server logs.
4. Delete the test agent.

Pass: agent created and visible. Fail: 500, missing ID, or DB insert error in logs.

---

## Step 2 — Verify automation creation and trigger

1. Create a new automation (minimal trigger + one action step).
2. Manually trigger the automation.
3. Watch the run status in the UI — confirm the transition sequence:
   `pending` → `running` → `completed`
4. Open server logs and confirm no ERROR lines tied to the run ID.

Pass: clean status transitions, no error log lines. Fail: stuck in `running`, status skipped, or errors logged.

---

## Step 3 — Verify GHL webhook receipt

1. Use either the GHL dev console test-fire or a direct curl:
   ```
   curl -X POST https://<host>/api/webhooks/ghl \
     -H "Content-Type: application/json" \
     -d '{"type":"test","locationId":"<ghl-location-id>"}'
   ```
2. In server logs, confirm:
   - Receipt line logged (incoming webhook accepted).
   - Processing completed without ERROR or unhandled-rejection lines.

Pass: receipt + process logged, no errors. Fail: 4xx/5xx response, or no receipt log line.

---

## Step 4 — Verify the four jobs run without errors

For each job below, manually enqueue or trigger per the method listed, then capture exit status
from server logs. All four must exit cleanly (no ERROR line, no unhandled exception, no
process crash).

| Job | Trigger method | Expected exit signal |
|---|---|---|
| `bundleUtilizationJob` | Admin UI job queue panel or `pg-boss` enqueue call | INFO log: job completed, no ERROR |
| `measureInterventionOutcomeJob` | Manually trigger or wait for next scheduled run | INFO log: outcomes measured or nothing to measure; no ERROR |
| `ruleAutoDeprecateJob` | Manually trigger | INFO log: deprecation scan complete; no ERROR |
| `connectorPollingSync` | Observe one natural polling cycle | `sync_lock_token` advances in DB; no ERROR; per-phase no-op logs if nothing to sync |

For `connectorPollingSync`: after one cycle, run
`SELECT sync_lock_token FROM connector_polling_state LIMIT 5;`
and confirm the token value changed from the pre-cycle snapshot.

Pass: all four jobs exit cleanly. Fail: any ERROR log, unhandled rejection, or job stuck.

---

## Step 5 — Tail server logs for 10 minutes

1. Open server log stream (e.g. `pm2 logs` / CloudWatch / your log aggregator).
2. Watch for 10 minutes of ambient traffic.
3. Record any WARN or ERROR lines that represent a new pattern not present before the merge.
4. Baseline comparison: compare against the log snapshot captured pre-merge (if available).

Pass: no new WARN/ERROR pattern above baseline. Flag: any new error pattern, even if low-volume.

---

## Step 6 — Check LLM router metrics for 10 minutes

During the same 10-minute window (or immediately after step 5):

1. Open your metrics dashboard or run a structured log query for:
   - `cost_per_request_cents` — flag if significantly higher than pre-merge average.
   - `retry_rate` — flag if above baseline.
   - Provider error rates (`llm_router.provider_error`) — flag any spike.
2. Note any delta from pre-merge baseline.

Pass: all three metrics within normal range. Flag: any metric outside pre-merge range.

---

## Step 7 — Final verdict

- If steps 1–6 all pass: mark G2 done. Update the §5 Tracking row in
  `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` from
  `⧖ runbook authored; live execution pending operator` to `✓ done` with commit/date.
- If any step fails: open an entry under `## Blockers` in `tasks/todo.md`:
  - Step that failed.
  - Exact error or anomaly observed.
  - Root-cause hypothesis.
  - Proposed next action.

Do NOT mark G2 done until all 7 steps are clean.

---

## First-run output (2026-04-26)

Operator: ___________________________
Environment: ___________________________
Deploy commit: ___________________________
Run date: ___________________________

| Step | Result (pass / fail / flag) | Notes |
|---|---|---|
| 1 — Agent creation | | |
| 2 — Automation trigger | | |
| 3 — GHL webhook | | |
| 4a — bundleUtilizationJob | | |
| 4b — measureInterventionOutcomeJob | | |
| 4c — ruleAutoDeprecateJob | | |
| 4d — connectorPollingSync | | |
| 5 — Log tail (10 min) | | |
| 6 — LLM router metrics | | |
| 7 — Final verdict | | |

Anomalies or blockers (if any):

```
(none)
```
