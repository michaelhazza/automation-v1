---
name: Draft Followup
description: Drafts a contextually personalised follow-up email for a stale deal or at-risk contact. Uses CRM activity history and deal context to produce a timely, relevant message.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_followup",
  "description": "Draft a contextually personalised follow-up email for a stale CRM deal or at-risk account. Uses deal stage, last activity, contact name, and deal context to produce a timely and relevant message. Output goes to human review before sending via send_email.",
  "input_schema": {
    "type": "object",
    "properties": {
      "contact_name": {
        "type": "string",
        "description": "Contact first name for personalisation"
      },
      "contact_email": {
        "type": "string",
        "description": "Contact email address"
      },
      "deal_name": {
        "type": "string",
        "description": "Name or description of the deal being followed up on"
      },
      "deal_stage": {
        "type": "string",
        "description": "Current pipeline stage of the deal"
      },
      "last_activity": {
        "type": "string",
        "description": "Description of the last activity (e.g. 'demo call on 2026-03-10', 'proposal sent on 2026-02-28')"
      },
      "days_since_activity": {
        "type": "number",
        "description": "Number of days since the last activity"
      },
      "follow_up_goal": {
        "type": "string",
        "description": "What this follow-up should achieve: schedule_next_step, get_feedback, re_engage, confirm_close_date"
      },
      "brand_voice": {
        "type": "string",
        "description": "Brand voice guidelines"
      },
      "agent_name": {
        "type": "string",
        "description": "Name to sign the email with"
      },
      "workspace_context": {
        "type": "string",
        "description": "Workspace memory: product context, sales process notes, known objections"
      }
    },
    "required": ["contact_name", "contact_email", "deal_stage", "last_activity", "follow_up_goal"]
  }
}
```

## Instructions

Invoke this skill when `analyse_pipeline` identifies a stale deal requiring follow-up. The draft output goes to human review before being sent via `send_email`.

Do not fabricate deal details, product promises, or previous conversation content not in the input. If `last_activity` is vague, draft a generic but relevant re-engagement rather than inventing context.

## Methodology

### Follow-Up Construction Rules

1. **Reference the last activity naturally** — anchor the email in something real from `last_activity`
2. **Match the goal** to the email structure:
   - `schedule_next_step`: propose a specific time or ask for availability
   - `get_feedback`: ask an open question about where they are in the process
   - `re_engage`: offer something new (insight, resource) to restart the conversation
   - `confirm_close_date`: professional check-in on timeline
3. **Keep it short**: 3–5 sentences. Long follow-ups get ignored.
4. **Single CTA**: one ask, clearly stated at the end

### Tone Guidance

The longer the gap since last activity, the softer the tone:
- < 7 days: direct and businesslike ("Following up on our call...")
- 7–21 days: warm and curious ("Wanted to check in...")
- > 21 days: re-engagement approach ("I know it's been a while...")

### Output Format

```
FOLLOW-UP DRAFT

Contact: [name] <[email]>
Deal: [deal_name] — [deal_stage]
Days Since Activity: [N]
Goal: [follow_up_goal]
Generated: [ISO date]

---

Subject: [subject line]

[Email body]

---

Drafting Notes:
- Last activity referenced: [yes/no]
- CTA: [specific ask]
- Tone: [direct | warm | re-engagement]
```

### Quality Checklist

Before returning:
- Email is 3–5 sentences — not longer
- Single CTA present
- Last activity referenced without fabricating details
- Tone matches days-since-activity guidance
