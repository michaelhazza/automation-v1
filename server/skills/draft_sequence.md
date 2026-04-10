---
name: Draft Sequence
description: Drafts a multi-step email outreach sequence for a contact or contact segment. Uses enrichment data and workspace context to produce personalised, on-brand emails for each step in the sequence.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_sequence",
  "description": "Draft a multi-step email outreach sequence for a contact or contact segment. Uses enrichment data, ICP (ideal customer profile), and workspace context to produce personalised subject lines and email bodies for each step. Returns the full sequence ready for human review before sending.",
  "input_schema": {
    "type": "object",
    "properties": {
      "contact_email": {
        "type": "string",
        "description": "Primary contact email address"
      },
      "contact_name": {
        "type": "string",
        "description": "Contact first name for personalisation"
      },
      "enrichment_data": {
        "type": "string",
        "description": "Output from enrich_contact — job title, seniority, company, industry, etc."
      },
      "sequence_goal": {
        "type": "string",
        "description": "The objective of the sequence: book a demo, schedule a call, download a resource, etc."
      },
      "steps": {
        "type": "number",
        "description": "Number of emails in the sequence (default 3, max 6)"
      },
      "step_delays": {
        "type": "array",
        "items": { "type": "number" },
        "description": "Days between steps (e.g. [0, 3, 7] means: day 0, day 3, day 7). Must have length = steps - 1."
      },
      "value_proposition": {
        "type": "string",
        "description": "The core value proposition to communicate across the sequence"
      },
      "brand_voice": {
        "type": "string",
        "description": "Brand voice guidelines: tone, vocabulary preferences, phrases to avoid"
      },
      "workspace_context": {
        "type": "string",
        "description": "Workspace memory: product context, ICP, known pain points, case studies, social proof"
      },
      "personalisation_level": {
        "type": "string",
        "enum": ["high", "medium", "generic"],
        "description": "How personalised to make the copy. High = uses enrichment data heavily. Generic = no personalisation tokens."
      }
    },
    "required": ["contact_email", "sequence_goal", "value_proposition"]
  }
}
```

## Instructions

Invoke this skill after `enrich_contact` (or with available CRM data if enrichment is not configured). The sequence is for human review — it is not sent directly. After approval, each step is sent via `send_email` at the appropriate delay.

Do not fabricate case studies, statistics, or social proof. Use only data from `workspace_context` or `value_proposition`. Insert `[VERIFY]` for any claim that needs confirmation.

If `enrichment_data` is a stub response (integration not configured), default to `personalisation_level: generic` regardless of the requested level. Note this in the drafting notes.

## Methodology

### Sequence Structure

Each step has a distinct purpose. Default 3-step sequence:

| Step | Purpose | Tone | Length |
|---|---|---|---|
| 1 | Cold outreach — introduce problem/opportunity | Curiosity, direct | 80–120 words |
| 2 | Follow-up — add value, provide proof | Helpful, evidence-based | 100–150 words |
| 3 | Soft close — low-friction CTA | Direct, no pressure | 60–90 words |

For 4-6 step sequences, add:
- Step 4: Case study or social proof
- Step 5: Different value angle
- Step 6: Final break-up email

### Personalisation Tokens

When `personalisation_level` is `high` or `medium`, use these tokens from enrichment data:
- `{{first_name}}` — contact first name
- `{{company}}` — company name
- `{{job_title}}` — job title
- `{{industry}}` — industry
- `{{pain_point}}` — derived from industry + seniority context

Mark unresolved tokens `[UNRESOLVED: token_name]` so the sending system can flag them before delivery.

### Subject Line Strategy

- Step 1: Pattern interrupt or specific curiosity hook ("Question about [company]'s [topic]")
- Step 2: Reference to step 1 or add new hook ("Re: [step 1 subject]" or fresh hook)
- Step 3: Ultra-short ("Still relevant?" / "Should I close your file?")

### Output Format

```
SEQUENCE DRAFT

Contact: [email]
Goal: [sequence_goal]
Steps: [count]
Personalisation: [level]
Generated: [ISO date]

---

## Step 1 — Day 0

Subject: [subject line]

[Email body]

---

## Step 2 — Day [delay]

Subject: [subject line]

[Email body]

---

[Additional steps...]

---

## Drafting Notes

- Personalisation tokens used: [list]
- Unresolved tokens: [list or "none"]
- [VERIFY] items: [list or "none"]
- Enrichment data: [used | stub — generic copy applied]
```

### Quality Checklist

Before returning:
- Every step has a distinct purpose — no repetition of the same ask
- No fabricated statistics or social proof without `[VERIFY]`
- Unresolved personalisation tokens are flagged
- Subject lines vary across steps — no duplicates
- Each email is within the target word count
