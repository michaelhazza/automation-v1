**Status:** draft
**Spec date:** 2026-05-15
**Last updated:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-mergereviewblock

# Split MergeReviewBlock along field-row / warning / atom seams

## 1. Goals

- Decompose `client/src/components/skill-analyzer/MergeReviewBlock.tsx` (992 LOC) into a thin orchestrator plus its inline sub-pieces, colocated under `client/src/components/skill-analyzer/mergeReview/`.
- Preserve every user-visible behaviour: the three-column merge layout (current / incoming / recommended), inline diff, field-by-field recommendations, warning resolutions (with name-mismatch detail), critical-phrase input flow.

## 2. Non-goals

- Visual change. Every Tailwind class and inline-diff token highlight preserved verbatim.
- Server-contract change — `evaluateApprovalState`, the warning shapes, and `onResultUpdated` all stay.
- New tests beyond targeted Vitest for the 3 pure helpers (`definitionToString`, `tryParseJson`, `parseNameMismatchDetail`).

## 3. Existing primitives reused

| Primitive | Why reuse |
|---|---|
| `client/src/components/skill-analyzer/` feature folder | Sub-pieces live in a new sibling sub-folder |
| `client/src/components/skill-analyzer/mergeTypes.ts` (incl. `evaluateApprovalState`) | Stays |
| `client/src/components/skill-analyzer/types.ts` | Stays |
| `client/src/components/Modal.tsx` | Stays |

No new shared primitives invented.

## 4. Current structure

`MergeReviewBlock.tsx` (992 LOC):
- 3 pure helpers: `definitionToString` (57-65), `tryParseJson` (66-81), `parseNameMismatchDetail` (543-551).
- Inline atoms: `InlineDiff` (82-136), `FieldRow` (146-259), `WarningItem` (718-950), `CriticalPhraseInput` (951-992).
- Sub-component: `WarningResolutionBlock` (552-717, ~165 LOC).
- Main export `MergeReviewBlock` (260-542, ~280 LOC).

## 5. Target structure

```
client/src/components/skill-analyzer/
  ├─ MergeReviewBlock.tsx                  ← orchestrator only (~280 LOC target)
  ├─ mergeReview/
  │   ├─ format.ts                         ← definitionToString, tryParseJson, parseNameMismatchDetail
  │   ├─ __tests__/format.test.ts          ← Vitest for the 3 pure helpers
  │   ├─ InlineDiff.tsx                    ← atom
  │   ├─ FieldRow.tsx                      ← atom (three-column row)
  │   ├─ WarningResolutionBlock.tsx        ← orchestrating sub
  │   ├─ WarningItem.tsx                   ← per-warning row
  │   └─ CriticalPhraseInput.tsx           ← atom
  └─ … (other existing siblings unchanged)
```

Caller import (probably from `resultsStep/ResultRow.tsx`) is unchanged — MergeReviewBlock stays at its current path.

## 6. Component tree (post-refactor)

```
MergeReviewBlock (orchestrator, ~280 LOC)
│
├── for each field: <FieldRow current incoming recommended onRecommendedChange definitionError />
│   └── <InlineDiff baseline value />
└── <WarningResolutionBlock warnings resolutions onResolve />
       └── for each warning: <WarningItem warning resolution onResolve>
              └── (conditional) <CriticalPhraseInput .../>
```

## 7. Prop contracts

Move each sub-component's signature verbatim — these are lifted from the current inline declarations. No shape changes. Pin them in `mergeReview/{InlineDiff,FieldRow,WarningResolutionBlock,WarningItem,CriticalPhraseInput}.tsx` exactly as today.

`MergeReviewBlock`'s outer props `{ result, candidate, jobId, onResultUpdated }` are unchanged.

## 8. Pure-helper extraction

Three helpers → `mergeReview/format.ts`. Vitest test file covers:
- `definitionToString`: null/undefined → `''`; object → JSON pretty-print.
- `tryParseJson`: empty string → ok=true value={}; valid JSON object → ok=true value; malformed JSON → ok=false with error; non-object JSON → ok=false.
- `parseNameMismatchDetail`: undefined → null sentinel; malformed → null; valid `"current=X|incoming=Y"` form → parsed.

## 9. Migration plan

### Chunk 1 — `format.ts` + tests + atoms
- Create `format.ts` with the 3 helpers.
- Create `__tests__/format.test.ts`.
- Move `InlineDiff`, `FieldRow`, `WarningItem`, `CriticalPhraseInput` to dedicated files under `mergeReview/`.

### Chunk 2 — `WarningResolutionBlock`
- Move into `mergeReview/WarningResolutionBlock.tsx`.

### Chunk 3 — Verify + cleanup
- Run lint, typecheck, build:client, vitest format.test.ts.
- Confirm orchestrator file ≤ 300 LOC.
- Sweep unused imports.

## 10. Deferred Items

- **Promote InlineDiff to a shared UI atom.** Only used here today; defer.
- **Combine `definitionToString` + `tryParseJson` into a single `parseDefinition` utility.** Current two-step is clearer; defer.

## 11. Self-consistency

- Three-column merge layout, inline-diff token rendering, warning-resolution flow, critical-phrase input behaviour — preserved.
- `onResultUpdated` callback fires after every mutation — preserved.

## 12. Acceptance criteria

- Orchestrator ≤ 300 LOC.
- 6 new files under `mergeReview/`.
- All G1 gates green; format vitest passes.

## 13. Open questions

- None. Pattern established by batches 1 + 2.
