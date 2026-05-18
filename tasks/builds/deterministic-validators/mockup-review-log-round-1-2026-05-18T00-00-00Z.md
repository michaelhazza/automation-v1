# Mockup Review Log — Round 1 — deterministic-validators — 2026-05-18

**Verdict:** NEEDS_REWORK
**Blocking:** 3 | **Should-fix:** 5 | **Consider:** 2

## Blocking findings

### B1 — Screen 2: invented "Morning review" page title
Line 807. Should be "Inbox" (ReviewQueuePage.tsx:627). The brief's Surface 2 is an expansion-panel component inside the existing Inbox, not a new page.

### B2 — Screen 2: full-page verdict list instead of drill-in panel
Lines 807-815. Surface 2 is a reusable React component expanding inside a verdict row in the Inbox. Not a standalone page-level list with its own tabs.

### B3 — Screen 2: invented "Resolved" tab
Line 813. Phantom nav — Inbox tabs are "Briefs" / "Needs Review". No justification for adding a third tab.

## Should-fix findings

### S1 — Validator slugs as sole label in picker (Screen 1)
Lines 573-584. Pair each slug with a human-readable name as primary label; slug as secondary muted text.

### S2 — Three check cards open simultaneously (Screen 1)
Lines 546-783. Default state should be collapsed/empty with one example expanded per frontend-design-principles Modal advanced expanders.

### S3 — "Evaluation method" label collides with spec's evaluation_method enum
Line 561. Use "Check kind" or "Kind" for the authoring field to avoid confusion with the verdict provenance enum (different concept).

### S4 — Proto-note rendered inside app surface (Screen 2)
Line 809. Move prototype notes outside the page shell.

### S5 — Subtitle drift on Screen 2
Lines 807-808. Do not invent competing page-level subtitle copy.

## Consider findings

### C1 — Validator slug link to catalogue browser (Screen 2)
Deferred Surface 3 future: make slug a link once catalogue browser ships. Not blocking.

### C2 — Latency in evidence table
latency_ms belongs in validator_invocations admin audit, not user-facing verdict drill-in.
