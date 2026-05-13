# Operator Session — Account Suspension Runbook

**Audience:** CS team + on-call engineer.
**Trigger:** A customer reports that their autonomous task stopped progressing, OR the system emits a `cs.operator_session.suspended_detected` CS notification to the inbox.

---

## 1. What "operator-session suspended" means

An operator-session subscription connects a customer's third-party AI subscription to Automation OS so the platform can drive long-form autonomous tasks on their behalf. When the provider suspends or revokes that subscription, the session becomes unavailable mid-task. The platform detects this automatically, pauses the affected tasks, and raises a CS notification so the team can follow up with the customer.

This is not a platform failure. The platform is working correctly: it detected an external credential problem, paused work safely, and surfaced it for human resolution. The customer's provider account requires their direct action before tasks can resume.

---

## 2. How the system detects suspension

The platform classifies an operator session as unavailable when any of the following signals appear:

- HTTP `401` or `403` from the session provider with a body indicating revocation, suspension, or stripped scope.
- HTTP `429` with a `Retry-After` of 60 seconds or more, or a provider-specific "session suspended" response body.
- Credential broker refresh failure: `expired_refresh_token`, `provider_revoked`, or `insufficient_scope` classification.
- Connection-level errors after more than three consecutive retries against the operator runtime.

These signal classes are enumerated in `server/services/operatorRuntimeErrors.ts` (canonical closed set). When any of these fires, the platform:

1. Classifies the failure as `session_unavailable`.
2. Attempts the API-key fallback path if the customer has configured one (see § 6 for customer options).
3. If fallback is unavailable or also fails: pauses the active task with status `paused_chain_failure`.
4. Emits a `cs.operator_session.suspended_detected` CS notification to the CS inbox and admin notifications.
5. Records an `operator.chain_link_start_failed` incident via the system incident pipeline.

---

## 3. The automatic notification chain

When suspension is detected, the following happens automatically without CS intervention:

1. **Incident record** — A `system_incidents` row is created with fingerprint `operator_session:suspended:{connection_id}`. Severity starts at `warning`; re-occurrence escalates severity.
2. **CS inbox notification** — A `cs.operator_session.suspended_detected` notification lands in the CS inbox with the customer's organisation, subaccount, affected task(s), and the connection ID.
3. **Admin in-app notification** — The subaccount admin(s) receive an in-app notification that their operator session is unavailable and tasks have been paused.
4. **Task paused state** — The task is visible in the task board with an amber paused state. No further chain links dispatch until the credential is resolved or the customer cancels the task.

CS does not need to detect this manually. The notification chain fires before CS reads the inbox.

---

## 4. How to retrieve the disclosure record by consent record ID

When the customer connects an operator-session subscription, they consent to an opt-in disclosure. That consent is stored as a `consent_record_id` on the connection. Retrieve it as follows:

```sql
-- Find the connection and consent record for an affected customer
SELECT
  oc.id AS connection_id,
  oc.subaccount_id,
  oc.usability_state,
  oc.plan_tier,
  osc.consent_record_id,
  osc.created_at AS consented_at,
  osc.disclosure_version
FROM operator_session_connections oc
JOIN operator_session_consents osc
  ON osc.connection_id = oc.id
WHERE oc.subaccount_id = '<subaccount_id>'
  AND oc.status = 'active'
ORDER BY osc.created_at DESC
LIMIT 1;
```

The `consent_record_id` uniquely identifies the disclosure the customer agreed to. Include it in the customer communication as a reference — do not quote legal text verbatim in the email; the link to the record is sufficient.

To retrieve the full disclosure text for a given version:

```sql
SELECT disclosure_version, copy_text, updated_at
FROM operator_session_disclosure_versions
WHERE disclosure_version = '<disclosure_version>';
```

---

## 5. Comms templates

Two templates are provided:

- **Customer email:** `docs/runbooks/templates/operator-session-suspension-customer-email.md`
- **In-app message:** `docs/runbooks/templates/operator-session-suspension-in-app-message.md`

Before sending, fill in:
- `[CUSTOMER_NAME]` — customer's name or org name.
- `[TASK_DESCRIPTION]` — brief description of the paused task (visible in the inbox notification).
- `[CONSENT_RECORD_ID]` — from the query in § 4.
- `[CS_AGENT_NAME]` — your name.

The templates are written in plain English. Do not add legal language or blame the customer. The tone is: "here is what happened, here is what you can do next."

---

## 6. Customer's options

Present these to the customer in order of preference:

1. **Reconnect the operator session** — The customer logs in to their AI subscription provider, confirms the subscription is active, and reconnects from the Connections page (Govern > Connections > AI Subscriptions). Once reconnected and the usability state returns to `connected_usable`, paused tasks can be retried.

2. **Add a fallback API key** — The customer adds an API key credential for the same provider from the same Connections page. If a fallback is configured, the platform automatically switches to per-token billing for the remainder of the affected task and any new tasks — no manual intervention needed for future sessions.

3. **Cancel ongoing tasks** — If the customer does not want to reconnect or add a fallback, they can cancel the paused task from the task board. Completed chain links are preserved in the run trace. In-progress cost rows up to the suspension point are recorded in the usage explorer.

4. **Do nothing (task stays paused)** — The task remains in `paused_chain_failure` state. It does not consume resources in this state. The customer can return to it later and retry once their subscription is active again.

---

## 7. Escalation tree

| Situation | Action |
|-----------|--------|
| Customer cannot reconnect — provider account page shows no issue | Escalate to engineering. The provider may have changed their API surface; check `server/services/operatorRuntimeErrors.ts` for the closed signal set. |
| Multiple customers affected at the same time | Escalate to engineering immediately. This indicates a provider-side outage, not a per-customer issue. Check `system_incidents` for clustering by `connection_id` pattern. |
| Customer claims they never consented to operator-session use | Retrieve the `consent_record_id` and `consented_at` from § 4. Share with the customer. Escalate to legal if the customer disputes the consent record. |
| Fallback API key is configured but tasks are still paused | Engineering escalation. The fallback path may have hit a separate error. Pull the incident `failure_class` from `system_incidents` for the `connection_id`. |
| Customer asks for a refund for the suspended period | Route to billing. The cost ledger for the task is available in the usage explorer; the `subscription_mediated` source-type rows show the subscription cost attribution. Chain links after the fallback switch to `api_key` will show per-token costs. |
| CS notification not received but customer reports suspension | Check the `system_incidents` table for `operator_session:suspended:{connection_id}`. If the incident exists but no inbox notification was created, escalate to engineering — the `operatorSessionSuspensionNotifier` may have failed. |
