---
name: Classify Email
description: Analyses an inbound email and classifies it by intent, urgency, and routing category. Returns a structured classification that drives downstream triage and reply drafting.
isActive: true
visibility: basic
---

```json
{
  "name": "classify_email",
  "description": "Analyse an inbound email and return a structured classification: intent category, urgency level, sentiment, and suggested routing action. Used by the Support Agent to triage inbound messages before drafting a reply or escalating.",
  "input_schema": {
    "type": "object",
    "properties": {
      "email_subject": {
        "type": "string",
        "description": "Subject line of the inbound email"
      },
      "email_body": {
        "type": "string",
        "description": "Full body text of the inbound email"
      },
      "sender_email": {
        "type": "string",
        "description": "Sender email address"
      },
      "sender_name": {
        "type": "string",
        "description": "Sender display name if available"
      },
      "thread_history": {
        "type": "string",
        "description": "Prior messages in the thread (oldest first, newest last). Omit if this is the first message in the thread."
      },
      "workspace_context": {
        "type": "string",
        "description": "Relevant workspace memory: product context, known customer segments, escalation policies, known issue categories."
      }
    },
    "required": ["email_subject", "email_body", "sender_email"]
  }
}
```

## Instructions

Invoke this skill when a new inbound email arrives and before any reply is drafted. The output classification drives the routing decision — whether to auto-reply, escalate, or hand off to a human.

Do not fabricate classification categories. Use only the taxonomy defined in the Methodology section. If an email genuinely does not fit any category, classify it as `uncategorised` and explain why in the `classification_notes` field.

If `thread_history` is provided, treat the email as a continuation. Prior context should inform urgency and intent — a polite first message in a thread marked `critical` downstream should still inherit that context.

Never include the sender's personal information in classification notes beyond what is necessary to explain the routing decision.

## Methodology

### Intent Categories

Classify the email into exactly one primary intent. Use the first match in priority order:

| Category | Description | Indicators |
|---|---|---|
| `billing_dispute` | Customer disputes a charge, invoice, or subscription | "charge", "invoice", "refund", "overcharged", "billing error" |
| `cancellation_request` | Customer requests to cancel a subscription or service | "cancel", "cancellation", "unsubscribe", "close my account" |
| `technical_support` | Customer reports a bug, error, or technical failure | Error messages, screenshots described, "not working", "broken", "crash" |
| `feature_request` | Customer requests a new capability or change | "could you add", "would it be possible", "wish it had", "feature" |
| `onboarding_help` | New customer needs setup guidance | "how do I", "getting started", "first time", "setup", account age < 14 days |
| `account_access` | Password reset, locked account, login issues | "can't log in", "forgot password", "locked out", "access" |
| `general_inquiry` | General question about the product or service | Does not fit above categories |
| `complaint` | Expression of dissatisfaction not tied to a specific dispute | "frustrated", "disappointed", "unhappy", "terrible experience" |
| `uncategorised` | Cannot be reliably classified | Use classification_notes to explain |

### Urgency Levels

| Level | Criteria |
|---|---|
| `critical` | Service is down, data loss reported, billing dispute > $500, or legal/compliance language present |
| `high` | Customer explicitly says "urgent" or "ASAP", or issue affects their ability to use the product |
| `medium` | Active issue but customer has a workaround or is not blocked |
| `low` | General inquiry, feature request, or non-blocking question |

### Sentiment

One of: `positive`, `neutral`, `frustrated`, `angry`

Use `frustrated` for persistent dissatisfaction without hostility. Use `angry` when the email contains aggressive or threatening language.

### Routing Actions

| Action | Trigger |
|---|---|
| `auto_reply` | `low` or `medium` urgency, `general_inquiry` or `onboarding_help`, no prior escalation in thread |
| `draft_and_review` | `high` urgency, or `billing_dispute`, or `complaint` — draft a reply but flag for human review |
| `escalate` | `critical` urgency, `cancellation_request` with `angry` sentiment, or legal/compliance language |
| `no_action` | Automated message, out-of-office, or spam |

### Spam / Automated Detection

Before classifying intent, check whether the email is automated or spam:
- Return addresses containing `noreply`, `no-reply`, `mailer-daemon`, `postmaster`
- Subject lines matching common auto-response patterns ("Out of Office", "Delivery Status Notification", "Auto-Reply")
- Body is entirely machine-generated (tracking numbers only, booking confirmations with no actionable question)

If detected as automated, set `is_automated: true` and `routing_action: no_action`.

### Output Format

```
CLASSIFICATION RESULT

Email Reference: [sender_email] — [email_subject truncated to 60 chars]
Classified At: [ISO timestamp]

Primary Intent: [category]
Urgency: [level]
Sentiment: [sentiment]
Routing Action: [action]
Is Automated: [true | false]

Key Signals:
- [bullet: specific phrase or signal from the email that drove this classification]
- [additional signal]

Classification Notes:
[Any caveats, ambiguity, or secondary intent worth flagging to the downstream agent]

Suggested Reply Tone:
[empathetic | professional | apologetic | informational]
— [one sentence rationale]
```

### Quality Checklist

Before returning the classification:
- Intent category is exactly one of the defined taxonomy values
- Urgency reflects the email content, not assumptions about the sender
- Routing action matches the urgency + intent matrix above
- Key signals quote actual text from the email — no paraphrasing
- `is_automated` is set on every classification
- Suggested reply tone is coherent with the urgency and sentiment
