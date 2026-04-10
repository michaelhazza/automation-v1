---
name: Enrich Contact
description: Retrieves enrichment data for a contact from the connected data enrichment provider and writes it to the CRM. Auto-gated stub — executes with audit trail.
isActive: true
visibility: basic
---

## Parameters

- contact_email: string (required) — Contact email address to enrich
- contact_name: string — Contact full name if available — improves match accuracy
- company_name: string — Company name if available — improves match accuracy
- crm_contact_id: string — CRM contact ID to write enriched data back to
- fields_requested: string — JSON array of string values. Specific fields to enrich. If omitted, returns all available fields.

## Instructions

Invoke this skill before drafting a personalised email sequence when contact data is incomplete. The enrichment data provides the personalisation signals that make `draft_sequence` produce relevant, specific copy rather than generic outreach.

**MVP stub:** The data enrichment integration is not yet connected. Returns a structured stub response. Downstream `draft_sequence` should handle missing enrichment data by using generic personalisation rather than failing.

If `crm_contact_id` is provided and the integration is live, write the enriched fields back to the CRM contact record automatically. This is a write side effect — log it in the response so the calling agent is aware.

### Data Schema

```
ENRICHMENT RESULT

Contact: [email]
Matched: [true | false | partial]
Confidence: [high | medium | low]
Enriched At: [ISO timestamp]

Fields:
  job_title: [value or null]
  seniority: [executive | director | manager | individual_contributor | unknown]
  company: [value or null]
  industry: [value or null]
  company_size: [1-10 | 11-50 | 51-200 | 201-1000 | 1000+ | unknown]
  linkedin_url: [value or null]
  phone: [value or null]
  location: [city, country or null]

CRM Update: [written | skipped — no crm_contact_id provided | failed: reason]
```

### Stub Response

```
ENRICHMENT RESULT

Contact: [email]
Status: stub — enrichment integration not configured
Matched: false

Note: The data enrichment integration has not been configured for this workspace.
Downstream draft_sequence should use generic personalisation based on available
CRM data rather than waiting for enrichment.
```
