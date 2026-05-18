# output_schema_valid

Validates that the agent's run output is valid JSON and conforms to a provided JSON Schema 2020-12 document.

## What it checks

- Run output parses as valid JSON.
- The parsed value validates against `parameters.schema` using AJV (JSON Schema 2020-12 dialect, `~8.17.1`).

## What it does not check

- Semantic correctness or meaning of field values.
- Presence of fields not declared in the schema.
- Character encoding or output size.

## Partial-match grading

This validator returns binary scoring (1.0 / 0.0). Partial-match grading is not implemented because a schema validation result is a pass/fail contract — partial conformance is not a useful signal. Operators who need graduated scoring should split the schema into separate checks.

## Known false positives

- A schema with `additionalProperties: false` will fail on outputs that include extra context fields the schema did not anticipate. Review schema coverage before marking a run as failing.

## Known false negatives

- Schema keyword coverage: AJV 2020-12 supports the full JSON Schema 2020-12 vocabulary. Custom keywords beyond the standard are not evaluated.

## Gaming attempts this validator defeats

- Deeply-nested JSON objects (200+ levels) are handled without crashing; AJV processes depth without stack overflow under the tested depth budget.
- An empty schema `{}` passes any JSON value — this is correct JSON Schema behaviour; operators should use a non-trivial schema.

## Scoring formula

Binary: 1.0 for pass (all schema keywords satisfied), 0.0 for fail. Evidence includes `schemaErrors[]` with instance path, keyword, and message.

## Evidence redaction policy

Evidence stores AJV error objects (instancePath, keyword, message). No tenant output text is stored in evidence — only the schema path and error keyword. Operators may review schema errors without risk of exposing the raw output.

If the output contains sensitive data, combine this validator as a precondition in a `hybrid` check so that a passing schema check does not expose output in the evidence trail for failing checks.
