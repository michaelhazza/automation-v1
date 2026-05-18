# output_non_empty

Checks that the agent's run output is not the empty string after trimming all leading and trailing whitespace.

## What it checks

- `runOutput.trim().length > 0`

## What it does not check

- Content quality, relevance, or helpfulness.
- Minimum length (see `output_length_within_bounds` for that).
- Encoding or character set validity.

## Known false positives

None. A non-empty whitespace-only string is correctly identified as failing. A non-empty string with only punctuation or numbers passes correctly — this validator does not evaluate semantic content.

## Known false negatives

An output of `" "` (a single space) fails correctly. An output of `"N/A"` passes — this validator does not evaluate whether the output is meaningful.

## Gaming attempts this validator defeats

- Injecting a single space character to avoid an empty-string check: fails correctly after trim.

## Scoring formula

Binary: 1.0 for pass, 0.0 for fail.

## Evidence redaction policy

Evidence stores only the raw `runOutput` value when failing. The raw output may contain tenant data. However, because this validator produces no evidence on pass and is only invoked for a failing verdict, the evidence is limited to the actual output string. Operators should consider whether the failing output needs additional redaction for their deployment context.

For PII-sensitive rubrics, combine `output_non_empty` as a precondition for `hybrid` checks rather than using it as a standalone deterministic check on outputs that may contain sensitive data.
