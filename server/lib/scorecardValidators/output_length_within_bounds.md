# output_length_within_bounds

Checks that the agent's run output length falls within a declared minimum and maximum bound.

## What it checks

- Character count (default, `unit: 'chars'`): `output.length >= min && output.length <= max`.
- Token count (`unit: 'tokens'`): `ceil(output.length / 4) >= min && ceil(output.length / 4) <= max`.

## Tokeniser version

Token counting uses the 4-chars-per-token approximation (approximation-v1). This approximation is appropriate for GPT-3.5/4 tokenisation of English prose and is stable across model generations for the purpose of length bounding. It is not byte-pair encoding. If precise token counts are required, use `unit: 'chars'` and calibrate your bounds with a 4:1 conversion factor.

## What it does not check

- Content quality or semantic relevance.
- Encoding-specific character widths (multi-byte Unicode characters count as one character per code point in JavaScript's `String.prototype.length`).

## Known false positives

- Outputs composed mostly of emoji or CJK characters will have a higher byte count than character count; the token approximation may undercount for those scripts. Use `unit: 'chars'` with adjusted bounds for multi-byte-heavy outputs.

## Known false negatives

None for char-count mode. Token-count mode is an approximation; outputs near the boundary may be slightly over/under the true token count.

## Gaming attempts this validator defeats

- An agent that pads output with whitespace to meet a minimum will pass: whitespace characters count toward the length. If operators want to exclude whitespace padding, combine with `output_non_empty` as a precondition.

## Scoring formula

Binary: 1.0 for pass, 0.0 for fail. Evidence stores the measured count, the unit, and the expected range.

## Evidence redaction policy

Evidence stores the measured numeric count and the configured bounds. No output text is stored. Safe for all deployment contexts.
