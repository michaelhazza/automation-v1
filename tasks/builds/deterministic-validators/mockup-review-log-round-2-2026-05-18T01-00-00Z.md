# Mockup Review Log — Round 2 — deterministic-validators — 2026-05-18

**Verdict:** CLEAN
**Blocking:** 0 | **Should-fix:** 0 | **Consider:** 2

## Round 1 regression check — all resolved

- B1 (title "Inbox"): line 954 — exact match to ReviewQueuePage.tsx:627
- B2 (Inbox + Needs Review + expansion in queue card): lines 967-1247 — queue-card extension pattern correctly applied
- B3 (no "Resolved" tab): lines 968-973 — tabs "Briefs" and "Needs Review" only
- S1 (human-readable names + muted slug): lines 694-705, 791-825
- S2 (one check expanded by default): lines 663-740 expanded, 746-750 + 877-881 collapsed
- S3 (label "Check kind"): lines 679, 768, 899
- S4 (instruction text in banner above page shell): lines 615-618, 939-942
- S5 (subtitle inherited): line 956 — exact text match to ReviewQueuePage.tsx:628

## Grounding check — all pass

- Screen 1 extension: ScorecardCreatePage.tsx shape fully inherited (PageShell, h1, form, Quality checks section, "+ Add check", pass mark, enabled toggle, footer)
- Screen 2 extension: ReviewQueuePage.tsx shape fully inherited (back-link, h1, subtitle, tab-pill Briefs/Needs Review, badge classes, queue-card structure)
- No phantom nav items
- No phantom routes
- Vocabulary: all labels inherited verbatim from source files

## Consider findings (non-blocking)

C1 — qc-card title "Skill Improvement: CRM Agent" inside Needs Review tab mixes verdict-review with action-approval verb domain. Round 1 reviewer explicitly directed this collapsing into Inbox. Spec phase should decide whether verdict review lives as a new lane inside Needs Review, a new tab, or the closed-loop brief's improvements-section pattern. Surface at spec authoring time.

C2 — Raw score values "1.00" / "0.00" / "-" on verdict sub-row summary duplicate the Pass/Fail/Inconclusive badge. Consider pushing scores inside the drill-in panel only. Not blocking — ScorecardCreatePage already exposes percentage pass-mark so operator has prior exposure to the numeric scale.
