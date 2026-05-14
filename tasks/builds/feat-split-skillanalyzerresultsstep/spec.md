**Status:** reviewing
**Spec date:** 2026-05-15
**Last updated:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-skillanalyzerresultsstep

# Split SkillAnalyzerResultsStep along classification-section seams

## 1. Goals

- Decompose `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` (1,102 LOC) into a thin orchestrator plus its 5 inline sub-components, each in a dedicated file under `client/src/components/skill-analyzer/`.
- Preserve every user-visible behaviour: section-by-classification grouping (Partial Overlaps / Replacements / New Skills / Duplicates), per-result warning resolutions, agent-chip auto-assignment, proposed-agent banner, restore-backup control, Continue button (always-enabled, with approved-count suffix).

## 2. Non-goals

- Visual change of any kind. Every Tailwind class and the SECTION_CONFIG colour map preserved verbatim.
- Server contract change — `evaluateApprovalState`, `mergeTypes`, the analysis-result and agent-proposal shapes all stay.
- New tests beyond targeted Vitest for `evaluateApprovalState` IF it ends up extracted; today it's already in `mergeTypes.ts` so no new tests needed.

## 3. Existing primitives reused

| Primitive | Why reuse |
|---|---|
| `client/src/components/skill-analyzer/` already exists as the feature folder | Sub-components stay here |
| `client/src/components/skill-analyzer/MergeReviewBlock.tsx` | Imported by ResultRow; not touched |
| `client/src/components/skill-analyzer/RestoreBackupControl.tsx` | Stays |
| `client/src/components/skill-analyzer/RestoreOutcomeBanner.tsx` | Stays |
| `client/src/components/skill-analyzer/types.ts` + `mergeTypes.ts` | Stay |
| `client/src/components/Modal.tsx` | Stays |

No new shared primitives invented. The new `resultsStep/` sub-folder and its `constants.ts` are colocation only — inline components and constants currently embedded in `SkillAnalyzerResultsStep.tsx` move into colocated files under `resultsStep/`. Nothing crosses the skill-analyzer feature boundary.

## 4. Current structure (today)

`SkillAnalyzerResultsStep.tsx`:

- Top-of-file `SECTION_CONFIG` (lines 30-75) — colour map per classification.
- `DiffView` (77-116) — small atom for "before/after" preview.
- `AgentChipBlock` (117-285, ~170 LOC) — agent assignment chip block (per-result).
- `ResultRow` (286-577, ~290 LOC) — single-result accordion row with warning resolutions + MergeReviewBlock.
- `ResultSection` (578-745, ~170 LOC) — section grouping with header band + accordion of ResultRows.
- Main export `SkillAnalyzerResultsStep` (746-957, ~212 LOC) — orchestrator: classification grouping, restore-backup banner, global expand/collapse signals, page header with approved-count summary, always-enabled Continue button.
- `ProposedAgentBanner` (958-1102, ~145 LOC) — banner shown when AI proposes a new agent template.

## 5. Target structure

Relevant files only — existing sibling files in `skill-analyzer/` (`SkillAnalyzerWizard.tsx`, `SkillAnalyzerImportStep.tsx`, `SkillAnalyzerProcessingStep.tsx`, `SkillAnalyzerExecuteStep.tsx`, `analyzerStatus.ts`) are unchanged and omitted from the tree for clarity.

```
client/src/components/skill-analyzer/
  ├─ SkillAnalyzerResultsStep.tsx            ← orchestrator only (~230 LOC target)
  ├─ resultsStep/                            ← new sub-folder; 6 new files (constants.ts + 5 component files)
  │   ├─ constants.ts                        ← SECTION_CONFIG colour map + Classification type
  │   ├─ DiffView.tsx
  │   ├─ AgentChipBlock.tsx                  ← also owns AGENT_SCORE_DISPLAY_THRESHOLD (file-local)
  │   ├─ ResultRow.tsx
  │   ├─ ResultSection.tsx
  │   └─ ProposedAgentBanner.tsx
  ├─ MergeReviewBlock.tsx                    ← unchanged
  ├─ RestoreBackupControl.tsx                ← unchanged
  ├─ RestoreOutcomeBanner.tsx                ← unchanged
  ├─ types.ts                                ← unchanged
  └─ mergeTypes.ts                           ← unchanged
```

Sub-folder chosen (vs. flat in skill-analyzer/) because the 5 extracted files are coherent and specific to ResultsStep — keeping them grouped prevents skill-analyzer/ from sprawling.

Host import path in the caller (`SkillAnalyzerWizard.tsx` — verified by grep as the sole importer in `client/src`) is unchanged.

## 6. Component tree (post-refactor)

```
SkillAnalyzerResultsStep (orchestrator)
│
├── <RestoreOutcomeBanner>            (unchanged)
├── <RestoreBackupControl>            (unchanged)
├── <ProposedAgentBanner> (conditional)
└── for each classification in [PARTIAL_OVERLAP, IMPROVEMENT, DISTINCT, DUPLICATE]:
       └── <ResultSection classification={c} results={grouped[c]} ...>
              └── for each result:
                     └── <ResultRow result={r} ...>
                            ├── <AgentChipBlock />      (DISTINCT rows only)
                            ├── <MergeReviewBlock />    (unchanged; called by ResultRow)
                            └── <DiffView />            (called by ResultRow as a peer of MergeReviewBlock, at the current call site)
```

## 7. Prop contracts

All contracts below are the exact signatures lifted from the current source file. Move verbatim — no shape change.

### 7.1 `<DiffView>`
```ts
{ result: AnalysisResult }
```

### 7.2 `<AgentChipBlock>`
```ts
{
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
}
```
Co-located file-local constant: `AGENT_SCORE_DISPLAY_THRESHOLD = 0.45`.

### 7.3 `<ResultRow>`
```ts
{
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  candidate: ParsedCandidate | undefined;
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
  onResultPatched: (next: AnalysisResult) => void;
  expandVersion: number;
  collapseVersion: number;
}
```

### 7.4 `<ResultSection>`
```ts
{
  classification: Classification;
  results: AnalysisResult[];
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  parsedCandidates: ParsedCandidate[];
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onBulkAction: (classification: Classification, action: 'approved' | 'rejected' | 'skipped') => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
  onResultPatched: (next: AnalysisResult) => void;
  onResultsReplaced: (results: AnalysisResult[]) => void;
  expandSectionVersion: number;
  collapseSectionVersion: number;
}
```

### 7.5 `<ProposedAgentBanner>`
```ts
{
  jobId: string;
  job: AnalysisJob;
  onJobRefetched: (results: AnalysisResult[]) => void;
}
```

### 7.6 Orchestrator (`SkillAnalyzerResultsStep`)
Existing props unchanged: `{ job, results, onResultsUpdated, onContinue, backup, onRestoreOutcome, restoreOutcome, onDismissRestoreOutcome }`. Internally now composes the extracted children.

## 8. Pure-helper / constant extraction

- `SECTION_CONFIG` (lines 30-75) → `resultsStep/constants.ts`. Imported by `ResultSection.tsx` and the orchestrator (the latter uses `SECTION_CONFIG[c].badgeBg / badgeText / dot / label` for the top-of-page count pills at lines 855-864).
- `Classification` type alias (line 28) — moves to `resultsStep/constants.ts` next to `SECTION_CONFIG` (it's the key type).
- `AGENT_SCORE_DISPLAY_THRESHOLD` (line 110, value `0.45`) — file-local to `resultsStep/AgentChipBlock.tsx`. Not promoted to constants.ts because nothing else reads it.
- `evaluateApprovalState` already lives in `mergeTypes.ts` — stays.

No new pure functions introduced. No new tests required.

## 9. Migration plan

### Chunk 1 — Extract `constants.ts` + `DiffView` + `AgentChipBlock`
- Create `resultsStep/constants.ts` with `Classification` type and `SECTION_CONFIG`.
- Create `DiffView.tsx` and `AgentChipBlock.tsx` (move verbatim).
- Interim import owners: until Chunk 2 carves out `ResultRow`, the orchestrator file (which still contains the inline `ResultRow` definition) imports `DiffView` and `AgentChipBlock`. `ResultSection` (still inline at this point) imports `SECTION_CONFIG` from `constants.ts`.

### Chunk 2 — Extract `ResultRow` + `ResultSection`
- Create `ResultRow.tsx` and `ResultSection.tsx`.
- Final import owners: `ResultRow.tsx` imports `DiffView`, `AgentChipBlock`, and `MergeReviewBlock`; `ResultSection.tsx` imports `SECTION_CONFIG` from `constants.ts` and renders `ResultRow`; the orchestrator imports only `ResultSection` (plus `SECTION_CONFIG` for its own page-header pills).

### Chunk 3 — Extract `ProposedAgentBanner`
- Move into `resultsStep/ProposedAgentBanner.tsx`.

### Chunk 4 — Verify + cleanup
- Run `npm run lint`, `npm run typecheck`, and `npm run build:client` locally.
- Confirm orchestrator file ≤ 250 LOC.
- Sweep unused imports.
- Full CI test gates run on the PR; no local gate run required per `references/test-gate-policy.md`.

## 10. Deferred Items

- **DiffView extraction into MergeReviewBlock or shared diff atom.** Today DiffView is a small file-local atom. If a sibling component wants the same diff visualisation later, promote it then. Out of scope here.
- **SECTION_CONFIG promotion to a constants module shared with backend.** No backend code reads this; client-only. Stays in resultsStep/constants.ts.

## 11. Self-consistency

- 4 classification sections render in their existing order with the existing colour bands — preserved.
- Section defaultOpen flags per current `SECTION_CONFIG`: PARTIAL_OVERLAP / IMPROVEMENT / DISTINCT default open; DUPLICATE default closed — preserved.
- Continue button behaviour: always enabled, no disabling. The button label suffix shows the approved count (`Continue to Execute → (n)` when `n > 0`) but the click handler is unconditional — preserved verbatim in the orchestrator.
- `onResultsUpdated` callback fires after every mutation — preserved.

## 12. Acceptance criteria

- Orchestrator file ≤ 250 LOC.
- 6 new files exist under `client/src/components/skill-analyzer/resultsStep/` (`constants.ts` + 5 component files: `DiffView.tsx`, `AgentChipBlock.tsx`, `ResultRow.tsx`, `ResultSection.tsx`, `ProposedAgentBanner.tsx`).
- `npm run lint`, `npm run typecheck`, and `npm run build:client` all pass locally. Full CI test gates (`test:gates`, `test:qa`, `test:unit`) run on the PR — not locally.
- Manual smoke: each classification section renders with the correct colour band, section accordion open/close works, row expand/collapse works (including section-level Expand all / Collapse all and global Expand all / Collapse all from the page header), warning resolutions update result state, MergeReviewBlock still renders within ResultRow, RestoreBackupControl still works, Continue button stays always-enabled with the `→ (n)` suffix appearing when at least one result is approved, ProposedAgentBanner fires when expected.
- Callback parity: every mutation path that previously called `onResultsUpdated` (approve / reject / skip per row, bulk action per classification, warning-resolution patch, retry-classification refetch, bulk-retry refetch, proposed-agent confirm/reject refetch) still fires `onResultsUpdated` with the replaced `AnalysisResult[]` array.

## 13. Open questions

- None.
