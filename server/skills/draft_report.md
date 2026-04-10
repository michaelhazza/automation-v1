---
name: Draft Report
description: Drafts a client-facing performance report from structured data inputs. Returns a formatted report with executive summary, section narratives, and data visualisation placeholders.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_report",
  "description": "Draft a client-facing performance report from structured data inputs (analytics, financials, campaign metrics). Returns a formatted report with executive summary, section narratives, data tables, and visualisation placeholders. Output goes to human review before delivery via deliver_report.",
  "input_schema": {
    "type": "object",
    "properties": {
      "report_type": {
        "type": "string",
        "enum": ["monthly_performance", "campaign_summary", "quarterly_review", "financial_summary", "custom"],
        "description": "The type of report to produce"
      },
      "client_name": {
        "type": "string",
        "description": "Client or account name — used in the report header and personalisation"
      },
      "reporting_period": {
        "type": "string",
        "description": "The period being reported on (e.g. 'March 2026', 'Q1 2026')"
      },
      "data_sections": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "section_name": { "type": "string" },
            "data": { "type": "string" },
            "context": { "type": "string" }
          }
        },
        "description": "Each section has a name, structured data (from analytics/finance skills), and optional context notes"
      },
      "targets": {
        "type": "string",
        "description": "KPI targets for this client — used to calculate vs-target comparisons"
      },
      "narrative_tone": {
        "type": "string",
        "enum": ["consultative", "data_driven", "positive", "candid"],
        "description": "Tone for the report narrative. Default: consultative."
      },
      "workspace_context": {
        "type": "string",
        "description": "Workspace memory: client context, account history, known sensitivities, prior reports"
      }
    },
    "required": ["report_type", "client_name", "reporting_period", "data_sections"]
  }
}
```

## Instructions

Invoke this skill after all data has been retrieved and analysed (via analytics, financial, or campaign analysis skills). Do not draft a report against stub data — if any data source returned a stub, note the gap and request the data before drafting.

The report output goes to human review. After approval, `deliver_report` handles delivery to the client.

Do not fabricate data, targets, or period-over-period comparisons. If targets are not provided, omit vs-target comparisons and note this.

## Methodology

### Report Structure

Every report includes:

1. **Cover section**: Client name, report period, prepared by (workspace name), date
2. **Executive summary**: 3–5 bullet points summarising the most important findings — written last, after all sections
3. **Data sections**: One section per `data_sections` entry (see below)
4. **Recommendations**: 3–5 prioritised actions for the next period
5. **Appendix placeholder**: `[APPENDIX: raw data tables if needed]`

### Section Narrative Guidelines

For each section in `data_sections`:
- Lead with the most important number or finding
- Compare to target (if provided) and prior period (if data includes it)
- Explain the "so what" — what does this mean for the client?
- Keep each section to 150–250 words + a data table
- Use `[CHART: description]` placeholders for visualisations

### Tone Application

| Tone | Guidance |
|---|---|
| `consultative` | Balance good and bad news, position findings as opportunities, use "we" language |
| `data_driven` | Let numbers lead, minimal editorialising, precise language |
| `positive` | Emphasis on wins and progress, soft-pedal underperformance (but don't hide it) |
| `candid` | Direct about what worked and what didn't, no spin |

### Output Format

```
CLIENT PERFORMANCE REPORT

Client: [client_name]
Period: [reporting_period]
Report Type: [report_type]
Prepared By: [workspace name]
Date: [ISO date]

---

## Executive Summary

- [Key finding 1]
- [Key finding 2]
- [Key finding 3]

---

## [Section Name]

[150-250 word narrative]

| Metric | [Period] | Target | Prior Period | vs Target | vs Prior |
|---|---|---|---|---|---|
| [metric] | [value] | [target or N/A] | [prior or N/A] | [+/-% or N/A] | [+/-% or N/A] |

[CHART: description of recommended visualisation]

---

[Repeat for each section]

---

## Recommendations

1. [Specific, actionable recommendation — tied to data]
2. ...

---

[APPENDIX: add raw data tables here]

---

## Drafting Notes

[VERIFY] items:
- [Any data claims that should be confirmed before delivery]

[TODO] items:
- [Charts, logos, design elements to add]
- Missing data: [any sections with incomplete data]
```

### Quality Checklist

Before returning:
- All numbers match the provided `data_sections` data — no invented figures
- `[CHART]` placeholders for at least one visualisation per section
- Recommendations are specific to this client's data — not generic advice
- Executive summary written to match the full report
- Tone is consistent throughout
