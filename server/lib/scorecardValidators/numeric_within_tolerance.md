# numeric_within_tolerance

Checks that a named numeric field in the agent's JSON output falls within a declared minimum and maximum range.

## What it checks

1. Run output parses as valid JSON.
2. The field named `parameters.fieldName` exists in the parsed object.
3. The field value is numeric (`Number(value)` is not NaN).
4. The value satisfies `value >= parameters.min && value <= parameters.max`.

## What it does not check

- Nested fields (only top-level field access).
- Array items or multiple fields in a single check (configure multiple checks for that).

## Known false positives

- A field that is a numeric string (e.g. `"3.5"`) is coerced to a number by `Number()`. This is intentional — both `3.5` and `"3.5"` are treated as the numeric value 3.5. If strict type checking is needed, use `output_schema_valid` with a schema that requires `type: 'number'`.

## Known false negatives

- Fields deeper than the top level are not accessible. Use `output_schema_valid` with an appropriate schema for nested numeric validation.

## Gaming attempts this validator defeats

- An agent that returns a numeric string rather than a number to try to avoid range validation: the `Number()` coercion catches it.

## Scoring formula

Binary: 1.0 for pass, 0.0 for fail. Evidence stores `field`, `expected` (the [min, max] range), and `actual` value.

## Evidence redaction policy

Evidence stores the field name, the configured bounds, and the actual numeric value. The actual value is a number, not a text excerpt from the output. Safe for all deployment contexts.
