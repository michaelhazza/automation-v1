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

---

## Round 2 — 2026-05-12 01:00

**Operator feedback:** Re-home the ranker mode selector to per-subaccount (SubaccountKnowledgePage). Strip all three org-inheritance leaks from the prototype. Keep shadow comparison panel intact. No new components.

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- `akr-ranker-settings.html` Part A (mode selector): extends `client/src/pages/SubaccountKnowledgePage.tsx`. Added as a 4th tab "Retrieval" in the existing tab strip (`TabButton` pattern: `border-b-2 border-indigo-600 text-indigo-700` active state). The page's baseline artefacts card and page header layout are carried forward verbatim.

- `akr-ranker-settings.html` Part B (shadow comparison): anchored to `client/src/pages/AgentRunLivePage.tsx`. The run context topbar matches AgentRunLivePage's breadcrumb pattern (`Agents / [Agent name] / Run: [timestamp]`). `RunTracePage.tsx` does not exist; `AgentRunLivePage.tsx` is the actual per-run trace surface (it links to `/admin/runs/${runId}` for trace detail).

---

**Codebase grounding — round-wide:**

- All files read:
  - `client/src/pages/SubaccountKnowledgePage.tsx` (full)
  - `client/src/pages/AgentRunLivePage.tsx` (full — 284 lines)
  - `client/src/pages/AgentRunHistoryPage.tsx` (partial — breadcrumb and nav patterns)
  - `prototypes/memory-improvements/akr-ranker-settings.html` (prior round)

- Vocabulary and conventions inherited (quoted from codebase):
  - Tab strip: `px-4 py-2 text-[14px] font-medium border-b-2 transition-colors` with active `border-indigo-600 text-indigo-700`
  - Page header: `h1 text-[24px] font-bold text-slate-900` + sub `p text-[14px] text-slate-500`
  - Breadcrumb back link: `text-[14px] text-indigo-600 hover:text-indigo-700 no-underline`
  - Baseline artefacts card: `bg-white border border-slate-200 rounded-xl overflow-hidden` header `px-4 py-3 border-b border-slate-100 bg-slate-50` title `text-[13px] font-semibold text-slate-700`
  - Tab IDs in SubaccountKnowledgePage: `'references' | 'insights' | 'blocks'` — new tab `'retrieval'` added as 4th
  - AgentRunLivePage breadcrumb: `Agents / [Agent name] / Run history` pattern from `AgentRunHistoryPage`; live page uses `Link to="/agents/${agentId}"` and `Link to="/agents/${agentId}/runs"` patterns

- New dedicated pages proposed: none. Part A is a new tab on an existing page. Part B is a panel within the existing run page.

---

**Changes made:**

- Re-homed Part A mode selector from "Settings / Retrieval" sidebar location to `SubaccountKnowledgePage` as a 4th tab "Retrieval" in the existing tab strip.
- Updated sidebar: removed `Settings > Retrieval` as active item; set `Knowledge` as active under the subaccount workspace section.
- Updated breadcrumb: `Settings / Retrieval` changed to `Acme Corp / Knowledge / Retrieval`.
- Updated page header: no longer reads "Retrieval settings" with "Org admin only" badge. Now reads within the Knowledge page context with the Retrieval tab active.
- Removed all three explicit org-inheritance leaks:
    1. Sidebar: `Settings > Retrieval` active item gone; `Knowledge` is active.
    2. Breadcrumb: now `Acme Corp / Knowledge / Retrieval`, no "Settings" in path.
    3. Audit copy: changed from "recorded in the organisation action audit trail" to "recorded in the audit trail with the acting user and timestamp".
- Removed "Org admin only" field badge from settings card title and page header.
- Part B shadow comparison panel: updated run topbar breadcrumb to match `AgentRunLivePage` pattern (`Agents / Marketing Research Agent / Run: May 12, 9:14 am`). Shadow comparison content and recall-invariant bar are unchanged.
- Added interactive tab switching script so all four tabs are clickable in the prototype.
- Cleaned up mode-option "disabled" class (removed unused selector from CSS).

---

**Frontend-design-principles checks:**

- Start with primary task: yes. Subaccount admin's task is "set the ranker mode for my workspace." The tab surfaces this as a direct workspace setting, not a system-level configuration hidden in an org settings hierarchy.
- Default to hidden: yes. Sampled percentage slider hidden until Sampled is selected. Comparison panel collapsed by default. Raw cosine scores behind hover tooltip only.
- One primary action: yes. "Save" is the single primary action on the mode selector card.
- Inline state: yes. Current mode shown inline in the status strip. Save confirmation is an inline dismissing toast, not a redirect.
- Re-check passed: yes. A non-technical operator landing on the Retrieval tab sees their current mode clearly labeled, four options with plain-English descriptions, and one Save button. No inheritance language. No system identifiers.
- Extends existing surface: yes. SubaccountKnowledgePage tab strip extended with a 4th tab. AgentRunLivePage run meta context used for Part B.

**Rule violations flagged:** none.

**Org-inheritance language check (critical):**
- No "Inherited from organisation" badges: confirmed absent.
- No "set at org level" tooltips: confirmed absent.
- No "org-default value" labels: confirmed absent.
- No use of the word "organisation" in any user-visible string: confirmed. The only "org" reference in the file is in the HTML comment block, not in any rendered user-facing copy.

**New components introduced:** none. Reuses tab strip, settings card, mode selector, diff badge, recall bar, and compare panel patterns from Round 1.

**Files modified:**
- `prototypes/memory-improvements/akr-ranker-settings.html` (updated)
- `tasks/builds/memory-improvements/mockup-log.md` (updated)
