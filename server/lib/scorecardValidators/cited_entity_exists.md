# cited_entity_exists

Checks that every entity ID cited in the agent's run output actually exists, by looking up each ID through a registered entity resolver.

## What it checks

For each entry in `parameters.entityTypes[]`:
1. All substrings in the run output matching `matchPattern` (a regex) are extracted.
2. Unique IDs are looked up via `ENTITY_RESOLVERS[lookupService]`.
3. Any ID that returns `false` is a citation error.

## Parameters

```json
{
  "entityTypes": [
    {
      "matchPattern": "ORD-\\d+",
      "lookupService": "orderService.existsById",
      "idArgName": "id"
    }
  ]
}
```

## What it does not check

- Whether the entity is relevant or appropriate for the context (only existence).
- Entities referenced by description rather than by ID.
- IDs in formats not matched by `matchPattern`.

## `deterministic_external` kind

This validator has `kind: 'deterministic_external'` because it calls external service resolvers. It is exempt from the isolation lint rule (which only targets `kind: 'deterministic'` validators). All tenant lookups flow through `ENTITY_RESOLVERS` — direct `db` or `pg` imports are not permitted.

## Batching behaviour

IDs are deduplicated per entity type before lookup. If the same ID appears 3 times in the output, the resolver is called once for that ID.

## Error handling

- Missing resolver (no entry in `ENTITY_RESOLVERS` for `lookupService`): returns `passed: false` with `unresolvedService` in evidence. Does NOT throw.
- Resolver throws: re-throws to let the dispatcher map to `inconclusive`. The distinction between "entity does not exist" and "resolver unavailable" is preserved.
- Invalid `matchPattern` regex: returns `passed: false` with the parse error.

## Known false positives

- A regex pattern that is too broad may match non-entity numeric sequences. Calibrate `matchPattern` to the specific ID format.

## Known false negatives

- IDs in the output that do not match `matchPattern` are not checked.

## Gaming attempts this validator defeats

- Citing an entity that existed at rubric-authoring time but was since deleted: the resolver checks existence at run time, not at rubric-save time.

## Scoring formula

Binary: 1.0 for pass (all cited IDs exist or no IDs found), 0.0 for fail. Evidence stores `missingIds[]` (capped at 50 entries; `_truncated: true` if more).

## Evidence redaction policy

Evidence stores only the missing IDs (the structured identifiers — not any surrounding output text). IDs are typically non-sensitive (e.g. `ORD-1234`). If IDs themselves are sensitive in a specific deployment, operators should not use this validator for those entity types.
