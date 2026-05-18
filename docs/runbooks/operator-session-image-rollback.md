# OpenClaw / Operator Session — Template Image Rollback Runbook

**Audience:** Operator running production deploys; on-call engineer.
**Trigger:** A newly-published `operator-session` template version is causing session failures, performance regressions, or unexpected costs, AND new sessions need to roll back to a previously-known-good version.

---

## 1. What this runbook covers

Operator sessions (the `operator_managed` execution backend, used for OpenClaw / autonomous-coding workloads) run inside e2b sandboxes built from the `operator-session` template image. Each session pins its image tag at start (`operator_runs.image_tag`), so in-flight sessions are unaffected by template changes. NEW sessions, however, use whatever image tag the main server's `OPERATOR_SESSION_IMAGE_TAG` env var points at.

This runbook covers the "switch new sessions to a previously published image tag" scenario. It does NOT cover:
- **In-flight session recovery.** Sessions already running on the broken image cannot be migrated. They will complete or fail on their own; treat failures as one-off losses.
- **Customer data recovery.** Work-in-progress inside a broken session is gone. Apologise and reset.
- **Code-level rollback** (a bad commit on `main`). Standard `git revert` plus redeploy applies.
- **Iee-browser template rollback.** Same architectural pattern but separate env var; document separately when iee-browser image versioning is formalised.

---

## 2. Prerequisites (must be true before this runbook works)

These should be set up once, before any production traffic. Verify on every new deploy.

### 2.1 Env var must be pinned to a specific version

In the production environment variables (whichever host you deploy to):

```
OPERATOR_SESSION_IMAGE_TAG = operator-session:v2.4.1
```

(Use the actual current tag, not the example.)

After the `iee-worker-retirement` spec lands (Chunk 5 — pre-freeze hardening), the runtime **refuses to boot** in production if this env var is unset. The previous unsafe `'latest'` default is removed; boot fails fast with a typed error pointing at this runbook. This eliminates the silent-fallback risk entirely.

In non-production (`NODE_ENV !== 'production'`), a dev-only fallback string is used so local development still boots without ceremony.

### 2.2 The previous version must still exist in e2b

e2b retains published template versions indefinitely unless explicitly deleted. Do not delete old versions from e2b until at least 30 days after a newer version is fully bedded in. Storage cost is negligible; the option to roll back is invaluable.

### 2.3 You must know the last-known-good version tag

Keep a one-line note in the team channel or shared doc: "Production OpenClaw template is currently `v2.4.1`. Previous known-good: `v2.4.0`." Update this every time you publish a new version.

---

## 3. Quick rollback (incident response, ~2 minutes)

1. **Open Render dashboard** → production web service → Environment tab.
2. **Find the `OPERATOR_SESSION_IMAGE_TAG` variable.**
3. **Change its value to the previous known-good tag** (e.g. `operator-session:v2.4.0`).
4. **Click Save Changes.** Render automatically restarts the service. Restart typically takes 60-120 seconds.
5. **Verify rollback.** Start a new OpenClaw session and confirm `operator_runs.image_tag` for the new row matches the rolled-back tag.

Expected outcome:
- New sessions immediately use the rolled-back image.
- In-flight sessions on the broken image continue to completion or failure on their own; they cannot be migrated.
- Customer-visible impact is bounded to the broken image's window of exposure.

If the service does NOT auto-restart within 2 minutes, manually trigger a deploy from the Render dashboard.

---

## 4. Standard upgrade flow (the safe path)

Use this flow when introducing a new template version into production.

1. **Build and publish the new image to e2b with an explicit version tag.**
   - Update `infra/sandbox-templates/operator-session/CURRENT_VERSION` to the new version (e.g. `v3.0.0`).
   - Update the `Dockerfile` with the new OpenClaw / Codex CLI / dependency versions.
   - CI builds and publishes to e2b as `operator-session:v3.0.0`.
   - Update `PUBLISHED_VERSION` to record what is now live in e2b.
   - **Do NOT touch the `latest` tag.** It introduces ambiguity.

2. **Do NOT change `OPERATOR_SESSION_IMAGE_TAG` in production yet.** Production keeps running on `v2.4.1`.

3. **Smoke-test in staging.**
   - In the Render staging environment, set `OPERATOR_SESSION_IMAGE_TAG = operator-session:v3.0.0`.
   - Render auto-restarts staging.
   - Run 3-5 end-to-end OpenClaw sessions through staging. Verify session completion, cost rollup, mid-run credential fallback, and at least one cancel-during-session test.
   - Check `operator_runs` rows have `image_tag = 'operator-session:v3.0.0'`, status `completed`, and reasonable cost rows.

4. **Cut over production.**
   - Change production `OPERATOR_SESSION_IMAGE_TAG = operator-session:v3.0.0`.
   - Render auto-restarts. Restart ~60-120 seconds.
   - Update the team note: "Production OpenClaw template is now `v3.0.0`. Previous known-good: `v2.4.1`."

5. **Monitor for 30-60 minutes** after cutover.
   - Watch session failure rate (compare to baseline).
   - Watch session cost (compare to baseline).
   - Watch heartbeat-stale events (`maintenance:backend-reconciliation` cron output).
   - Customer-reported issues channel.

6. **Decide.** If the new version is stable, leave it in place and remember the previous tag for the NEXT upgrade's rollback target. If anything looks wrong, execute Section 3 immediately.

---

## 5. Verification drill (one-time, before first paying customer)

Do this drill once, in staging, to prove rollback actually works. Schedule a 30-minute window.

1. Confirm staging `OPERATOR_SESSION_IMAGE_TAG` is pinned to a specific version (e.g. `v2.4.1`).
2. Publish a deliberately broken template to e2b as `operator-session:v-broken-test`. "Broken" can mean: returns exit code 1 immediately, or doesn't include the harness entry script.
3. Switch staging env var to `v-broken-test`. Confirm Render restarts.
4. Start a new OpenClaw session. Confirm it fails.
5. Switch staging env var back to `v2.4.1`. Confirm Render restarts within 2 minutes.
6. Start a new OpenClaw session. Confirm it succeeds.
7. Record the wall-clock time from "decision to roll back" to "first successful new session." Should be under 3 minutes. If longer, investigate what slowed you down.
8. Delete the `v-broken-test` tag from e2b.

Repeat this drill any time the deployment topology changes (provider switch, Render plan change, anything that touches the env-var-update flow).

---

## 6. What this runbook does NOT solve

- **A bug that affects the publishing pipeline itself** (CI broken, e2b unavailable). Rollback assumes a previous tag exists in e2b; if e2b is down, rollback can't help because the substrate is down. Wait for e2b recovery; tasks queue in pg-boss and resume.
- **A bug in the orchestration code** (the main server's `operatorManagedBackend.ts` itself). That's a code rollback: `git revert` plus Render redeploy.
- **A bug in shared infrastructure** (Credential Broker, Run Trace, Postgres). Different runbooks apply.
- **Data corruption inside the sandbox runtime** (corrupt browser profile, corrupt workspace volume). Sandbox-level fix; not template-level.

---

## 7. Cross-references

- `server/services/executionBackends/operatorManagedBackend.ts:106` — `OPERATOR_SESSION_IMAGE_TAG` env var and `'latest'` fallback.
- `infra/sandbox-templates/operator-session/` — Template Dockerfile, `CURRENT_VERSION`, `PUBLISHED_VERSION`.
- `docs/superpowers/specs/2026-05-12-operator-backend-spec.md § 3.15` — Image versioning, per-session pinning.
- `docs/runbooks/operator-session-account-suspension.md` — Related operator-session incident runbook (different failure mode).
- `tasks/builds/hosting-provider-evaluation/brief.md § 13` — Hosting decision context, including risk register.

---

## End

This runbook is the source of truth for OpenClaw / operator-session template rollback. If the rollback mechanism changes (e.g., env var renamed, multi-tag dispatch added, automated canary rollout), update this file in the same commit.
