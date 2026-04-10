---
name: Draft Reply
description: Drafts a customer support reply to an inbound email, using the classification output from classify_email and any relevant knowledge base content. Returns a ready-to-review reply and a confidence score.
isActive: true
visibility: basic
---

## Parameters

- email_subject: string (required) — Subject line of the inbound email being replied to
- email_body: string (required) — Full body of the inbound email
- sender_name: string — Sender display name for personalised greeting
- classification: string (required) — JSON object with keys: "intent" (string), "urgency" (string), "sentiment" (string), "routing_action" (string), "suggested_reply_tone" (string). Output from classify_email: { intent, urgency, sentiment, routing_action, suggested_reply_tone }
- knowledge_base_context: string — Relevant knowledge base articles or FAQ content retrieved by search_knowledge_base. Include full article text where available.
- thread_history: string — Prior messages in the thread for context (oldest first). Omit if first message.
- agent_name: string — Name to sign the reply with (e.g. 'Support Team', 'Sarah from Support')
- workspace_context: string — Workspace memory: brand voice guidelines, escalation contacts, SLA commitments, product name.

## Instructions

Invoke this skill after `classify_email` has produced a classification. Always pass the classification output directly — do not re-classify inside this skill.

If `routing_action` is `escalate`, do not draft a reply. Return a structured response indicating escalation is required with the reason and suggested escalation path. The Support Agent should then invoke `request_approval` or route to a human queue.

If `routing_action` is `no_action` (automated or spam), return a no-draft response immediately. Do not waste tokens drafting for machine-generated emails.

If `knowledge_base_context` is not provided, note this in the `confidence_flags` field — the reply may need human review to verify accuracy.

Never invent product features, pricing, SLA terms, or policy details that are not present in the knowledge base context or workspace context. If unsure, add a placeholder like `[VERIFY: insert correct refund policy here]` and flag it in confidence_flags.

### Reply Construction Rules

1. **Greeting**: Address the sender by first name if `sender_name` is provided. Use "Hi [Name]," for informal/empathetic tone, "Dear [Name]," for formal/professional tone.

2. **Acknowledgement**: Always open with a one-sentence acknowledgement of the customer's issue before moving to resolution. Match the tone to `suggested_reply_tone`:
   - `empathetic`: "I completely understand how frustrating this must be..."
   - `apologetic`: "I'm sorry to hear you've experienced this..."
   - `professional`: "Thank you for reaching out about..."
   - `informational`: "Thanks for your question about..."

3. **Body**: Address the specific issue raised. Use knowledge base content where available. Do not pad the reply — be concise. If multiple issues are raised, use numbered steps or a short bullet list.

4. **Resolution or Next Step**: Every reply must end with one of:
   - A concrete resolution (problem solved, steps provided)
   - A clear next step (what the agent or customer will do next)
   - A timeline commitment (only if drawn from workspace_context SLA data — never fabricate)

5. **Closing**: Sign off with the `agent_name` if provided, otherwise "The Support Team".

### Intent-Specific Guidance

| Intent | Guidance |
|---|---|
| `billing_dispute` | Acknowledge the charge, explain what it is if known, state the refund/review process. Never promise a refund without confirmation. |
| `cancellation_request` | Acknowledge the request, confirm the cancellation process, offer a final resolution if retention is in scope. Do not be pushy. |
| `technical_support` | Provide troubleshooting steps from knowledge base. If unresolved, commit to escalation timeline. |
| `feature_request` | Acknowledge the idea, confirm it has been noted, set expectations on the feedback process. |
| `onboarding_help` | Be warm and practical. Provide step-by-step guidance. Offer a follow-up check-in. |
| `account_access` | Provide the account recovery path. Include direct link placeholders `[ACCOUNT_RECOVERY_URL]` if not in context. |
| `general_inquiry` | Answer directly. Do not over-explain. |
| `complaint` | Lead with empathy. Acknowledge before explaining. Focus on resolution, not justification. |

### Confidence Scoring

| Score | Meaning |
|---|---|
| `high` | Reply is grounded in knowledge base content and addresses the specific issue |
| `medium` | Reply addresses the issue but knowledge base context was absent or partial |
| `low` | Reply is generic or contains multiple `[VERIFY]` placeholders — human review required before sending |

### Output Format

```
DRAFT REPLY

To: [sender_email if available]
Subject: Re: [original subject]
Confidence: [high | medium | low]
Routing Action: [from classification — auto_reply | draft_and_review | escalate]

---

[Reply body]

---

Confidence Flags:
- [Any factual claims that should be verified before sending]
- [Any placeholders inserted]

Drafting Notes:
[Internal notes for the reviewing agent or human — not included in the sent email]
```

### Escalation Response (when routing_action = 'escalate')

```
ESCALATION REQUIRED

Intent: [intent]
Urgency: [urgency]
Reason: [why this must be escalated]
Suggested Path: [human queue | billing team | account manager | legal]
Draft: none — awaiting human handling
```

### Quality Checklist

Before returning the draft:
- Draft does not invent product facts, pricing, or policy
- All `[VERIFY]` placeholders are listed in confidence_flags
- Tone matches `suggested_reply_tone` from classification
- Reply is concise — no filler phrases, no padding
- Closing includes agent name or team name
- Confidence score reflects the actual grounding of the reply
- Escalation path returned (not a draft) when routing_action is `escalate`
