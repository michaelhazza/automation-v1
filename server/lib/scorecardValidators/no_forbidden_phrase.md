# no_forbidden_phrase

Checks that none of the declared forbidden phrases or regex patterns appear in the agent's run output. Returns a graded score based on how many phrases are absent.

## What it checks

- Each entry in `parameters.phrases[]` is tested against the full run output.
- String entries are matched case-insensitively as literal substrings.
- Object entries with `{ regex, flags }` are matched as regular expressions.

## What it does not check

- Semantic intent — an output that implies a forbidden concept without using the literal phrase will pass.
- Obfuscated or encoded forms of the phrase (e.g. l33tspeak, whitespace insertion).

## Partial-match grading

Score = `phrasesClean / phrasesTotal`. Example: 3 phrases configured, 1 violated → score 0.667. Evidence stores the `violatingPatterns` list (pattern category, not matched text).

## Known false positives

- A phrase that is a common English word may match in unexpected contexts. Use regex entries with word-boundary anchors (`\b`) to reduce false positives.

## Known false negatives

- Obfuscated phrases (l33tspeak, spaces between characters) bypass the literal match. This is a documented limitation; use regex patterns for common obfuscation variants.
- Encoding variations (HTML entities, Unicode look-alikes) are not normalised before matching.

## Gaming attempts this validator defeats

- Case variation (e.g. `BADWORD`, `BaDwOrD`): defeated by case-insensitive matching on string entries.
- Regex flags on object entries allow per-phrase tuning.

## Scoring formula

Graded: `phrasesClean / phrasesTotal`. Evidence stores: `{ phrasesClean, phrasesTotal, violatingPatterns: string[] }`.

## Evidence redaction policy

Evidence stores only the pattern label (the string or regex source), never the matched substring or any excerpt of the run output. The `matchedSubstring` field is intentionally absent from evidence. Safe for all deployment contexts.
