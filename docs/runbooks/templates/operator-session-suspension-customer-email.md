---
template: operator-session-suspension-customer-email
version: 1
audience: customer (external)
channel: email
use_when: >
  The customer's operator-session subscription was suspended or revoked by their provider
  and one or more tasks have been paused as a result.
---

# Customer Email Template: Operator Session Suspended

**Subject:** Action needed: your autonomous session has been paused

---

Hi [CUSTOMER_NAME],

We wanted to let you know that one of your autonomous tasks — "[TASK_DESCRIPTION]" — has been paused because your subscription session is currently unavailable.

This happens when the subscription you connected to Automation OS is suspended, rate-limited, or no longer active on your provider's side. Your task is safe: all progress so far has been saved and the session can be resumed once your subscription is back.

**What you can do right now:**

1. Check your AI subscription account with your provider and confirm the subscription is active.
2. If it is active, reconnect from Automation OS: go to Govern > Connections > AI Subscriptions and reconnect your session.
3. If you prefer to switch to direct API billing for this task, you can add an API key credential from the same page.

Your task will stay paused and will not charge you anything until you take action.

If you have questions about your session or the options available, reply to this email and we will help you through it. For your records, your consent reference is: [CONSENT_RECORD_ID].

[CS_AGENT_NAME]
Automation OS Support
