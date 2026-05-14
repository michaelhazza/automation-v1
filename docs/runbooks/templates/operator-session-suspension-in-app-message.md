---
template: operator-session-suspension-in-app-message
version: 1
audience: customer (admin, in-product)
channel: in-app notification
use_when: >
  The platform emits the cs.operator_session.suspended_detected notification.
  This template is the customer-facing copy for the admin in-app notification.
  The platform sends this automatically; CS may also send it manually if the
  automatic notification fails.
---

# In-App Message Template: Operator Session Suspended

**Notification title:** Your session has been paused

---

Your autonomous session is currently unavailable. One or more tasks have been paused and will not progress until your session is reconnected.

**What happened:** your subscription session was suspended or revoked by your provider. This is not a problem with Automation OS — it is a status change on your provider account.

**What to do:**

- Reconnect your session from **Connections > AI Subscriptions**.
- Or add an API key to switch to direct billing for affected tasks.

Your tasks and all progress so far are saved. Nothing has been lost.

If you need help, contact support and reference your session consent record: [CONSENT_RECORD_ID].
