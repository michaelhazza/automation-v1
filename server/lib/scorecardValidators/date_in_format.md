# date_in_format

Checks that a named field in the agent's JSON output is a valid ISO 8601 date (RFC 3339 subset).

## What it checks

1. Run output parses as valid JSON.
2. The field named `parameters.fieldName` exists in the parsed object.
3. The field value, when converted to a string, matches the ISO 8601 regex:
   - Date-only: `YYYY-MM-DD`
   - Date-time with Z: `YYYY-MM-DDTHH:MM:SSZ`
   - Date-time with offset: `YYYY-MM-DDTHH:MM:SS+HH:MM` or `...-HH:MM`
   - Fractional seconds optional: `YYYY-MM-DDTHH:MM:SS.sssZ`

## What it does not check

- Semantic validity beyond the regex (e.g. Feb 30 will fail the regex month check but some calendar edge cases may pass).
- Timezone normalisation.
- Date-time without timezone offset (not RFC 3339 compliant — fails this validator).

## Known false positives

None significant. The regex enforces valid month (01–12) and day (01–31) ranges.

## Known false negatives

- Date-time values without timezone information (`2024-03-15T09:30:00` with no `Z` or offset) fail this validator. This is correct behaviour for RFC 3339 compliance. If the agent consistently produces timezone-naive datetimes, fix the agent prompt or accept the fail.
- Dates with day 29–31 in months that don't support them (e.g. Feb 30) are not calendar-validated by regex alone; use `output_schema_valid` with `format: 'date-time'` and AJV format validation for full calendar validation.

## Gaming attempts this validator defeats

- Month 13 (`2024-13-01`): rejected by the regex (month range 01–12).
- Invalid date structure passed as a long numeric string: rejected by the regex format requirement.

## Scoring formula

Binary: 1.0 for pass, 0.0 for fail. Evidence stores `field`, `expected` format description, and `actual` value.

## Evidence redaction policy

Evidence stores the field name and the actual field value (the date string). Date strings are generally non-sensitive. If dates in the output are themselves sensitive (e.g. date of birth), operators should consider whether this validator's evidence trail is appropriate for their deployment context.
