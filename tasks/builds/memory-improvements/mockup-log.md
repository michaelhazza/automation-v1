# Memory Improvements — Mockup Log

## Round 1 — 2026-05-12 00:00

**Operator feedback:** initial draft

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- `memory-block-detail.html` (Surface 1): extends `client/src/pages/MemoryBlockDetailPage.tsx`. Also references `prototypes/trust-verification-layer/run-trace.html` for Source pill styling, and `prototypes/trust-verification-layer/knowledge.html` for `chip-src-*` badge patterns. The new "Sources" tab slots into the existing tab strip (Version History / Diff vs Canonical).

- `citation-utility-dashboard.html` (Surface 2): extends `client/src/pages/UsagePage.tsx`. New "Memory Utility" tab added to the existing UsagePage tab strip (Runs / Routing / Spend). Chart and table patterns taken from `prototypes/auto-knowledge-retrieval/agent-data-sources.html` and `prototypes/consolidation-2026-05-06/_shared.css` data-table conventions.

- `akr-ranker-settings.html` (Surface 3, Part A): extends `client/src/pages/AdminSettingsPage.tsx` pattern (Settings page with tabs: Board Config / Categories / Engines; new "Retrieval" tab peer). Part B embeds a demo of the run trace panel extending `prototypes/trust-verification-layer/run-trace.html` event detail drawer conventions.

---

**Codebase grounding — round-wide:**

- All files read:
  - `client/src/pages/MemoryBlockDetailPage.tsx`
  - `client/src/pages/UsagePage.tsx` (partial — first ~180 lines)
  - `client/src/pages/AdminSettingsPage.tsx`
  - `client/src/pages/AgentRunLivePage.tsx` (partial)
  - `client/src/pages/AgentRunHistoryPage.tsx` (partial)
  - `client/src/pages/SubaccountKnowledgePage.tsx` (partial)
  - `client/src/pages/govern/KnowledgePage.tsx`
  - `prototypes/consolidation-2026-05-06/_shared.css`
  - `prototypes/auto-knowledge-retrieval/index.html`
  - `prototypes/auto-knowledge-retrieval/agent-data-sources.html` (partial)
  - `prototypes/auto-knowledge-retrieval/knowledge-documents-tab.html` (partial)
  - `prototypes/trust-verification-layer/run-trace.html`
  - `prototypes/trust-verification-layer/knowledge.html` (partial)

- Vocabulary and conventions inherited (quoted from codebase):
  - Tab active state: `border-b-2 border-indigo-600 text-indigo-700` (MemoryBlockDetailPage) / `border-bottom-color: var(--indigo-600)` (_shared.css `.tab-btn.active`)
  - Tab count pill: `background: var(--indigo-100); color: var(--indigo-700)` when active
  - Status badges: `.badge-green`, `.badge-amber`, `.badge-red`, `.badge-indigo`, `.badge-slate` from _shared.css
  - Source chips (TVL knowledge.html): `.chip-src-runs`, `.chip-src-corrections`, `.chip-src-manual`
  - Data table: `.data-table`, `thead` with `var(--slate-50)` background, `th` in uppercase 10.5px 600 weight
  - Card header: `background: var(--slate-50)`, border-bottom on `var(--border)`
  - Buttons: `.btn`, `.btn-primary` (`background: var(--indigo-600)`), `.btn-secondary`, `.btn-sm`
  - Modal overlay: `.modal-overlay`, `.modal-card` from _shared.css
  - Event row dot colours: `dot-llm` indigo, `dot-tool` sky, `dot-result` emerald, `dot-error` red
  - Verify badge pattern (TVL): `.verify-pass`, `.verify-fail`, `.verify-pending` with `::after` tooltip
  - Admin-only: fields absent (not disabled) for non-admins; org-admin pill on field label in admin view
  - Tab strip (KnowledgePage): tabs `'authored-memory' | 'auto-memory' | 'documents' | 'files' | 'bundles'`
  - UsagePage tabs (inferred from type conventions): Runs, Routing, Spend
  - Source pill (SourcePillKnowledge component): `capturedVia` values include `'auto_synthesised'`, `'operator_correction'`, `'manual_edit'`

- New dedicated pages proposed: none. All three mockups are extensions of existing surfaces.

---

**Changes made:**

- Created `prototypes/memory-improvements/` directory (new)
- `memory-block-detail.html` — MemoryBlockDetailPage with Sources tab. Third tab added to existing (Version History / Diff vs Canonical). Tab hidden for non-auto-synthesised blocks. Source entries show: excerpt, run link, timestamp, quality score dot + numeric label. Bidirectional lineage per row as collapsed expander (one secondary affordance per brief). Version selector dropdown to switch between historical synthesis versions. Soft-deleted entries shown with strikethrough + opacity.
- `citation-utility-dashboard.html` — UsagePage with new Memory Utility tab. Two canvas-drawn line charts (entry utility and block utility, rolling 30d, three workspaces). Per-agent breakdown table with utility bar + percentage, suppressed agents note. Caveat banner with dismiss. Admin-only tab label.
- `akr-ranker-settings.html` — Two surfaces in one file. Part A: ranker mode selector card in Settings / Retrieval tab. Four rollout modes displayed as visual segmented-radio blocks (Off / Shadow / Sampled / On). Sampled shows a percentage slider when selected. Audit note inline. Save logs to action audit trail (confirmed via inline toast). Part B: embedded demo of shadow-mode comparison panel. Two-column side-by-side (Legacy payload vs Semantic ranker would load). Diff badges: Promoted / Dropped / Unchanged. Score available on hover tooltip only (no raw numbers in default view). Recall-invariant status bar (green/amber per category). Expand/collapse toggle.
- `index.html` — landing page linking all three mockups with brief descriptions.

---

**Frontend-design-principles checks:**

- Start with primary task: yes.
  - Surface 1: operator's task is "understand where this auto-synthesised block came from" — Sources tab is that exact answer.
  - Surface 2: operator's task is "see whether memory retrieval is working" — charts + table are that answer.
  - Surface 3: operator's task is (A) "change ranker mode safely" and (B) "inspect what the ranker would have changed on this run." Each part has one primary action.
- Default to hidden: yes. Quality scores behind hover on Surface 3. Bidirectional lineage behind expander on Surface 1. Caveat banner is dismissable. Sampled% slider only appears when Sampled mode is selected. Compare panel defaults collapsed on Surface 3.
- One primary action: yes. Surface 1: activate Sources tab (navigated to via pill). Surface 2: no destructive action (read-only dashboard). Surface 3A: "Save ranker mode." Surface 3B: "Show / hide retrieval diff."
- Inline state: yes. Quality scores shown inline as coloured dots with numeric labels on hover. Utility bars inline in table rows. Recall-invariant check inline in the comparison header. Mode change confirmation is an inline toast, not a redirect.
- Re-check passed: yes. A non-technical operator landing on Surface 1 sees clearly labelled sources with run links and timestamps. Surface 2 requires the operator to understand "utility %", which is explained in the caveat banner. Surface 3A has mode names and one-line descriptions per option; the default (Off) is clearly marked. Surface 3B shows Promoted / Dropped labels without requiring knowledge of cosine distance.
- Extends existing surface: yes. All three mock up surfaces inside existing pages (MemoryBlockDetailPage, UsagePage, AdminSettingsPage / run trace).

**Rule violations flagged:** none.

**Files modified:**
- `prototypes/memory-improvements/index.html` (new)
- `prototypes/memory-improvements/memory-block-detail.html` (new)
- `prototypes/memory-improvements/citation-utility-dashboard.html` (new)
- `prototypes/memory-improvements/akr-ranker-settings.html` (new)
- `tasks/builds/memory-improvements/mockup-log.md` (new)
