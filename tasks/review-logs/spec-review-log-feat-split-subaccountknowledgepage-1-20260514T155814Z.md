# Spec Review Iteration 1 Log — feat-split-subaccountknowledgepage

## Codex findings (16) — classification

- C1 mechanical — §3/§8.2 drawer integration not specified → applied (combined w/ R2: actually host-owned)
- C2 mechanical-REJECT — `atoms/` is precedent-consistent with batch-1 `usage/atoms/`; "no new primitives" refers to new shared codebase abstractions, not "no new files"
- C3 mechanical — component tree missing `key={blocksKey}` → applied
- C4 mechanical — refetch-vs-remount inconsistency → applied
- C5 mechanical — host owns blocksKey contradiction → applied
- C6 mechanical — §8.3 missing onPromoted trigger → applied
- C7 mechanical — callback timing → applied
- C8 mechanical — demote cross-tab refresh → applied
- C9 mechanical — tables internal vs exported verdict → applied
- C10 mechanical — chunk 1 imports timing → applied
- C11 mechanical — TabButton missing from acceptance → applied
- C12 mechanical — optional RenameReferenceModal name not pinned → applied
- C13 mechanical — referencePreview HTML-stripping coverage → applied
- C14 mechanical — truncation exact output → applied
- C15 mechanical-REJECT — `build:client` IS the real package.json script (verified at line 15)
- C16 mechanical — open questions: pin optional choices → applied

## Rubric findings — classification

- R1 mechanical — FACTUAL: `/knowledge/blocks` and `/knowledge/references` endpoints do not exist. Source uses one `/api/subaccounts/:id/knowledge` returning both → applied
- R2 mechanical — FACTUAL: EditArtefactDrawer is in baseline-artefacts header region, NOT in ReferencesTab → applied
- R3 mechanical — host `search` state + per-tab filtering not addressed → applied
- R4 mechanical — Reference Edit modal + Promote modal location → applied
- R5 mechanical — Block Edit modal location → applied
- R6 mechanical — "+ New X" header buttons location → applied
- R7 mechanical — Insights promote flips to References + reloads refs/blocks/insights → applied
- R8 mechanical — Refs promote flips tab to Blocks → applied
- R9 mechanical — Blocks demote flips tab to References → applied
- R11 mechanical — Missing N/A sentence for checklist sections 0/4/5/10 → applied

## Decisions applied

All mechanical findings folded into a single coherent spec rewrite that:
- States the real endpoint (`/api/subaccounts/:id/knowledge` returning both refs+blocks; `/knowledge/insights` separate)
- Pins ownership of every modal, header button, search box, filter, and post-mutation tab+refresh
- Locates the EditArtefactDrawer on the host (baseline-artefacts region) not on ReferencesTab
- Adds the checklist sections 0/4/5/10 N/A sentence per batch-1 precedent
- Pins the `key={blocksKey}` decision and removes "or context" alternative
- Pins the rename-modal split decision (named `RenameReferenceModal.tsx` if needed)
- Adds TabButton.tsx + __tests__/format.test.ts to acceptance inventory
- Specifies exact truncation outputs for the format tests

## Counts

- mechanical_accepted: 24 (14 Codex + 10 rubric)
- mechanical_rejected: 2 (C2 atoms/, C15 build:client)
- directional_or_ambiguous: 0
- reclassified: 0

## Iteration 1 Summary

- Mechanical findings accepted:  24
- Mechanical findings rejected:  2
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (pending commit)
