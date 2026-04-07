# Setup — 42 Macro Reporting Agent (local dev)

End-to-end paywall → transcript → analysis → Slack workflow for the
**Breakout Solutions** organisation. Use this doc once the seed script has run
to finish wiring the parts that need real credentials.

> **Spec**: `docs/reporting-agent-paywall-workflow-spec.md`
> **Skills used**: `fetch_paywalled_content` → `transcribe_audio` →
> `analyse_42macro_transcript` → `send_to_slack`

---

## 1. Run the seed

```bash
npx tsx scripts/seed-42macro-reporting-agent.ts
```

This is idempotent. Re-run it whenever you wipe the local DB.

It creates:
- Organisation `breakout-solutions`
- Subaccount `42macro-tracking`
- Custom skill `analyse_42macro_transcript` (org-scoped, full 42 Macro A-Player Brain prompt embedded as `instructions`)
- Agent `42macro-reporting-agent` with the orchestration master prompt and `defaultSkillSlugs` covering all four steps
- `subaccount_agents` link for the Breakout Solutions / 42 Macro Tracking pair, with `maxCostPerRunCents=500` (T23 cost breaker ceiling)
- Two **placeholder** `integration_connections` rows with `connectionStatus='error'` — the worker will refuse to use these until you replace them with real credentials in step 3

---

## 2. Environment variables

Add these to your `.env` (or `.env.local`):

```bash
# Required by the worker for credential decryption (already set if you've
# done previous local dev — share the same key with the server process).
TOKEN_ENCRYPTION_KEY=base64:...

# Required by transcribe_audio skill — Whisper API.
OPENAI_API_KEY=sk-...

# Optional — override the cost-breaker default ($1.00) at the system level.
# The seed sets a per-subaccount-agent ceiling of $5.00 which already takes
# precedence, so you only need this if you're running other agents.
# IEE_DEFAULT_MAX_COST_CENTS=500
```

Restart the server + worker after changing these.

---

## 3. Provision the real integrations

The seed left two placeholder rows you must fill in.

### 3a. 42 Macro paywall login (`web_login` integration)

The seed inserted a row keyed by
`(organisationId, subaccountId, providerType='web_login', label='42 Macro paywall login')`.

Update it via the existing web-login connections API (auto-encrypts the
password via `connectionTokenService` → `TOKEN_ENCRYPTION_KEY`):

```bash
# Find the placeholder connection ID
psql $DATABASE_URL -c "SELECT id FROM integration_connections \
  WHERE label='42 Macro paywall login' AND provider_type='web_login';"

# Then PATCH it via the server API (auth as the org admin first)
curl -X PATCH http://localhost:3000/api/subaccounts/<SUBACCOUNT_ID>/connections/web-login/<CONNECTION_ID> \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "loginUrl": "https://42macro.com/login",
      "username": "your.real.email@breakoutsolutions.com"
    },
    "password": "your-real-password",
    "connectionStatus": "active"
  }'
```

The route encrypts `password` into `secrets_ref` server-side; plaintext never
hits the DB.

> **Selectors**: leave `usernameSelector` / `passwordSelector` / `submitSelector` / `successSelector` null on the first attempt. The defaults
> (`input[type=email]`, `input[type=password]`, `button[type=submit]`)
> match almost every modern login form. Only override them if step 4
> (smoke test) shows they don't match 42macro.com's specific markup.

### 3b. Slack bot token (`slack` integration)

1. Create a Slack app at https://api.slack.com/apps for the Breakout Solutions workspace
2. Add the **Bot Token Scopes**: `chat:write`, `chat:write.public`, `files:write`, `links:read`
3. Install to workspace, copy the **Bot User OAuth Token** (`xoxb-...`)
4. Invite the bot into `#42macro-reports` (or the channel you want)
5. Update the placeholder row:

```bash
# PATCH via the existing integration-connections route
curl -X PATCH http://localhost:3000/api/subaccounts/<SUBACCOUNT_ID>/connections/<CONNECTION_ID> \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "xoxb-your-real-bot-token",
    "connectionStatus": "active",
    "configJson": { "defaultChannel": "#42macro-reports" }
  }'
```

---

## 4. Smoke test the login (highest priority gate)

Per spec §11.8, run the manual Playwright smoke test against the real paywall
**before** running the agent end-to-end:

```bash
cd worker
SMOKE_LOGIN_URL=https://42macro.com/login \
SMOKE_USERNAME=your.real.email@breakoutsolutions.com \
SMOKE_PASSWORD='your-real-password' \
SMOKE_CONTENT_URL=https://42macro.com/members/videos \
tsx scripts/smoke-paywall.ts
```

Add `SMOKE_HEADLESS=0` to watch it in a real browser window.

What to confirm:
- [ ] Login succeeds with the default selectors
- [ ] Note which detection tier wins (`selector` / `url_change` / `session_cookie`)
- [ ] No hidden redirects to disallowed domains
- [ ] The members video page renders server-side (downloads aren't hydrated by client JS that Playwright would miss)
- [ ] No 2FA / captcha prompts (out of scope for v1)
- [ ] Find the CSS selector for the **download button** on the video page —
      you'll need it for step 5

If the smoke test fails, fix the selectors (step 3a) before going further.

---

## 5. Trigger the agent

The agent uses standard execution mode (`api` or `headless`). The browser
work happens inside the `fetch_paywalled_content` skill, which enqueues an
IEE browser task and polls for completion.

### One-off run via the API

```bash
curl -X POST http://localhost:3000/api/subaccounts/<SUBACCOUNT_ID>/agents/<SUBACCOUNT_AGENT_ID>/run \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "trigger": "manual",
    "input": {
      "contentUrl": "https://42macro.com/members/videos/<latest-video-slug>",
      "downloadSelector": "button[data-test=download-video]",
      "videoTitle": "Macro Scouting Report"
    }
  }'
```

The agent's master prompt knows to call `fetch_paywalled_content` first; the
input fields above are passed straight through.

### Scheduled runs (heartbeat)

The seed leaves `heartbeatEnabled=false`. Once you've confirmed a manual run
works end-to-end, enable scheduling:

```sql
UPDATE subaccount_agents
   SET schedule_enabled = true,
       schedule_cron    = '0 7 * * MON,WED,FRI',
       schedule_timezone = 'America/New_York'
 WHERE id = '<SUBACCOUNT_AGENT_ID>';
```

That cron runs at 07:00 ET on Mon/Wed/Fri — adjust to match the 42 Macro
publishing cadence.

---

## 6. What to verify after the first end-to-end run

Query each layer to confirm the workflow ran exactly once and the dedup
fingerprint was persisted:

```sql
-- Most recent run
SELECT id, status, run_metadata->'reportingAgent' AS reporting_agent
  FROM agent_runs
 WHERE agent_id = (SELECT id FROM agents WHERE slug='42macro-reporting-agent')
 ORDER BY started_at DESC LIMIT 1;

-- The IEE browser task (download artifact + contentHash)
SELECT id, status, failure_reason, completed_at
  FROM iee_runs
 WHERE agent_id = (SELECT id FROM agents WHERE slug='42macro-reporting-agent')
 ORDER BY created_at DESC LIMIT 1;

-- The downloaded video artifact + contentHash
SELECT id, kind, mime_type, size_bytes, metadata->'contentHash' AS content_hash
  FROM iee_artifacts
 WHERE iee_run_id = '<from above>';

-- The fingerprint persisted by the end-of-run hook
SELECT last_processed_fingerprints_by_intent
  FROM subaccount_agents
 WHERE id = '<SUBACCOUNT_AGENT_ID>';

-- The Slack post coords (T11 dedup record)
SELECT run_metadata->'slackPosts'  AS slack_posts,
       run_metadata->'reportingAgent'->'slackPost' AS reporting_slack
  FROM agent_runs
 WHERE id = '<run id>';
```

The second run against the same video should short-circuit:
- `iee_runs.status = 'completed'` but no new artifact row
- `agent_runs.run_metadata.reportingAgent.terminationResult = 'no_new_content'`
- No Slack post
- The T25 invariant accepts the run because `fingerprintRead` is true and the
  termination result is `no_new_content`

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Worker logs `WebLoginConnectionNotFound` | `connectionStatus != 'active'` or wrong subaccount | Step 3a — flip status to `active` |
| `failure: auth_failure / login_failed:selector_not_found` | Default selectors don't match the form | Smoke test → set selector overrides on the connection |
| `failure: data_incomplete / mime_mismatch` | The "video" the worker downloaded was actually an HTML error page | Site changed; re-run the smoke test |
| `failure: internal_error / cost_limit_exceeded` | T23 ceiling tripped | Bump `subaccount_agents.max_cost_per_run_cents` or investigate the cost driver |
| `failure: internal_error / incomplete_run_state` | T25 invariant tripped — a step completed without writing its expected output | Check `agent_runs.run_metadata.reportingAgent` for which slot is missing |
| Whisper returns < 50 words | T27 sanity floor — Whisper silently failed | Re-run; if persistent, check `OPENAI_API_KEY` quota |

---

## 8. What's still manual / out of scope for v1

- **2FA / captcha** on the paywalled login — the spec defers to v2
- **Session-cookie auth mode** (avoiding stored passwords) — defers to v2
- **Tenant isolation tests** for the worker `getWebLoginConnectionForRun` path — vitest is not yet configured in the worker package
- **Client UI** for managing the `web_login` connection — the API and seed are end-to-end; the form component is a follow-up
