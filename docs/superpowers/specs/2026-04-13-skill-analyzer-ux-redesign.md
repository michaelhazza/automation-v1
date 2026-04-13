# Skill Analyzer Results Page — UX Redesign

**Date:** 2026-04-13
**Status:** Approved — ready for implementation
**Scope:** `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` and `MergeReviewBlock.tsx`

---

## What We're Building

A full visual redesign of the skill analyzer review step. No data model or API changes — purely frontend layout, styling, and interaction changes.

---

## Layout: List with Expand-to-Review

Replace the current card-per-skill layout with a compact list. Each row shows just enough to identify the skill. Clicking a row expands it inline to reveal the full merge review panel. Only one or more rows can be expanded at a time (no restriction — user controls).

---

## Section Structure

Four collapsible sections, each with a distinct coloured header band. Order top-to-bottom:

1. **Partial Overlaps** — amber band (`#fffbeb` bg, `#fcd34d` bottom border)
2. **Replacements — incoming is strictly better** — blue band (`#eff6ff` bg, `#93c5fd` bottom border). Renamed from "Improvements". The `vs.` line on rows reads "replaces X" not "vs. X".
3. **New Skills** — green band (`#f0fdf4` bg, `#86efac` bottom border)
4. **Duplicates — already in library** — red band (`#fef2f2` bg, `#fca5a5` bottom border). Collapsed by default.

Each section header shows: title, count badge (colour-matched), "N approved" meta, bulk Approve/Reject buttons, collapse chevron.

The overall page background is `#f1f5f9` (light slate) so the white section bodies stand out.

---

## Collapsed Row

```
[Skill name]                          [conf%]  ›
[vs. Matched Skill · XX% similar]
```

- Name: 13px medium weight, `#1e293b`
- Sub-line: 11px, `#94a3b8`
- Confidence: 11px, `#cbd5e1` (subtle — not the focus)
- Chevron rotates 90° when expanded
- **Decided rows** (approved/rejected/skipped): dimmed to 40% opacity, name struck through, status badge shown (green/red pill), no chevron interaction needed

---

## Expanded Row Panel

Background `#f8fafc`, top border `1px solid #e2e8f0`, padding `20px 18px`.

### Reasoning block
Italic, 11px, `#64748b`, white background, left border accent `3px solid #e2e8f0`, rounded.

### Diff legend (merge rows only)
Small legend above the three columns:
- Green swatch = "Added from incoming"
- Red swatch = "Removed from current"
- Italic note: "Rewritten passages appear fully highlighted — review content carefully"

### Three-column merge view
`display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px`. Columns scroll independently (`max-height: 380px; overflow-y: auto`).

Each column:
- Labelled header strip (9px uppercase, coloured bg)
- Body: name, description, section labels (PARAMETERS, INSTRUCTIONS), pre-wrap text
- Recommended column: green border (`#86efac`), green header bg

Diff highlights: `diff-add` = `#dcfce7` bg, `#166534` text. `diff-remove` = `#fee2e2` bg, `#991b1b` text, strikethrough.

### Action bar (all rows)
```
[Approve]  [Reject]  [Skip]  [Reset to AI suggestion]     [View skill]
```
- Approve: dark `#0f172a` background, white text
- Reject: white, hover → red border + text
- Skip: white, muted border
- Reset: white, muted — only shown when user has edited the merge
- View skill: indigo text, indigo border, right-aligned via `margin-left: auto`

### Agent assignment block (New Skills only)
Below the action bar, separated by a top border. Label "Assign to agents" (9px uppercase).

Chips: pill shape.
- **Selected**: `bg-emerald-600` solid green, white text
- **Unselected**: `bg-slate-100`, grey text
- Each chip shows agent name + score% + × remove button
- "+ Add agent" dashed pill button opens existing dropdown

### Failed classification
Amber banner (`#fffbeb` bg, `#fde68a` border) with message and Retry button. Shown above the action bar when `classificationFailed: true`.

---

## Page Header

```
Review Skills                                    [Continue to Execute →]
37 candidates · approve, reject, or skip...
[● 27 new] [● 4 replacements] [● 10 partial overlaps] [● 3 duplicates]
```

Pills are colour-coded to match sections. Progress bar + "13 of 37 reviewed" below pills.

---

## Files to Change

| File | Change |
|------|--------|
| `SkillAnalyzerResultsStep.tsx` | Full layout rewrite — section headers, row structure, expand/collapse, page header, chip styling |
| `MergeReviewBlock.tsx` | Add diff legend; no structural change needed unless column scroll needs adjusting |

No backend changes. No new components. No new routes.

---

## Out of Scope

- Keyboard navigation / shortcuts
- Undo after approve/reject
- Export results
- Search/filter within sections
- Any changes to MergeReviewBlock edit/patch logic
