# Mockup log — auto-knowledge-retrieval

**Build slug:** auto-knowledge-retrieval
**Mockup directory:** `prototypes/auto-knowledge-retrieval/`
**Loop status:** **PRE-APPROVED — verification only.**

## Provenance

The 8 hi-fi prototypes were authored across multiple prior sessions by `mockup-designer` (and operator iteration) before this Phase 1 invocation. Five rounds of feedback are recorded in git:

- `9d7ae3c9` — mockup feedback round 1
- `f181d04c` — round 2 (menus, edit modal, bundles)
- `ef8733a6` — round 3 (size visual, scope-as-org-only, bundle edit)
- `f6747f9e` — simplification pass (reduce UI noise across all 7 mockups)
- `9f9c7937` — finalise (em-dashes, design principles, brief Rev 2)

Operator instructed `spec-coordinator` to treat the mockups as the approved Phase 1 mockup output and skip the iterative loop.

## Verified mockup surfaces

| Mockup | File | Brief reference |
|---|---|---|
| Index | `index.html` | n/a (navigation) |
| Knowledge: Files tab | `knowledge-files-tab.html` | §5 (sibling tab), §6 (Add to Knowledge action) |
| Add to Knowledge modal | `add-to-knowledge-modal.html` | §6 |
| Agent edit: Data Sources tab | `agent-data-sources.html` | §3 (modes), §4 (5-tier hierarchy), §16 (success criteria) |
| Knowledge: Documents tab | `knowledge-documents-tab.html` | §5 (tabs), §17 (recurring patterns) |
| Document Detail modal | `document-detail-modal.html` | §3 (modes), §10 (size widget), §17 (two-column) |
| Knowledge: Bundles sub-tab | `knowledge-bundles-tab.html` | §5 (bundles) |
| Bundle Edit modal | `bundle-edit-modal.html` | §5 (mode chips read-only) |

## Alignment pass result

Single read-only review against `docs/auto-knowledge-retrieval-dev-brief.md` (Rev 4):

- Tabs match brief §5 (Authored memory / Auto-memory / Documents / Files).
- Three modes (Auto / Always available / Reference only) per brief §3.
- Five tiers (org / sub-account / agent / recurring task / task instance) per brief §4.
- Three-dots menu pattern + Change-mode flyout per brief §17.
- Provenance badges only on non-default cases per brief §17.
- Token / cost / size: hidden by default, warning chip only, qualitative size widget in detail modal per brief §17.
- Stat tiles: 2 max per page per brief §17.
- Em-dashes: none in mockup data per brief §17.
- Recurring patterns already promoted into `docs/frontend-design-principles.md`.

**Verdict:** mockups pre-approved by operator across 5 prior rounds (see git log). Treat as Phase 1 design source of truth. No alignment gap requires re-authoring.

## Next step

Spec authoring (Step 6).
