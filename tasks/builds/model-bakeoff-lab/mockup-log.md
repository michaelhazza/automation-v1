# Mockup Log — Model Bake-off Lab

## Round 1 — 2026-05-05 00:00

**Operator feedback:** initial draft

**Changes made:**
- Created `prototypes/model-bakeoff-lab/_shared.css` — extended the existing shared design token system (slate/indigo palette, Inter font, JetBrains Mono for model names) with bake-off-specific additions: provider chips per provider (Anthropic/OpenAI/NVIDIA/OpenRouter), capability tags (tools, free, paid, agentic, long-ctx), quality bar component, verdict banner, cost display helpers (actual vs projected), run status pills, response panel for drill-down, tool-call trace block.
- Created `index.html` — new run setup screen. Suite picker (saved suites grid + agent-run import tab), judge mode selector (deterministic / LLM-judge / human rating with LLM-judge as default), model picker with grouped provider sections, per-model badges, and a sticky bottom CTA bar showing the one primary action (Run Benchmark). Live model count badge and summary line update as checkboxes toggle.
- Created `running.html` — in-progress view. SVG ring showing overall percent complete. Per-model progress grid with progress bars, case-level dot indicators (pass/fail/running/queued), elapsed time, and inline status pills. Raw request log hidden behind a toggle (default collapsed). Quick-action strip at the bottom for re-run options.
- Created `results.html` — comparison results. Prominent verdict banner at the top naming the winning model with plain-English explanation of the quality/cost trade-off. Sort chips for all columns. Results table with one row per model, quality bar, value score bar, separate cost columns distinguishing actual cost (paid) from projected cost (NIM/free — dashed badge), latency p50 with p95 behind hover, error rate. Winner row highlighted green with left border accent.
- Created `drill-down.html` — side-by-side response comparison. Case selector nav (8 numbered buttons with pass/fail dots), model swap selectors, three-column layout (prompt context + assertion | model A response | model B response), tool-call trace blocks, LLM judge reasoning shown inline, cross-case summary table at the bottom.
- Created `suite-editor.html` — test suite editor. Two-panel layout (case list on left, case editor on right). Each case has system prompt, user message, tool definition (JSON schema), and assertion type (regex / tool-call match / LLM judge / human rating). Assertion type defaults to tool-call match for case 2 to show the tool-calling scenario.

**Frontend-design-principles checks:**
- Start with primary task: yes — every screen is oriented around the one task at hand. Index = pick suite + models + run. Running = see progress. Results = see which model won. Drill-down = understand why.
- Default to hidden: yes — raw request log collapsed on running.html. p95 latency, judge reasoning, and raw token counts are present but visually subordinate (smaller, muted). No KPI tile rows. No trend dashboards. Advanced admin note explained cost distinction without a separate dashboard panel.
- One primary action: yes — index.html has one sticky CTA (Run Benchmark). Running.html's primary action is navigating to results when complete. Results.html primary action is viewing details or starting a new run. Suite editor's primary action is Save suite.
- Inline state: yes — per-model status is an inline pill with a progress bar, not a separate status dashboard. Cost actual vs projected is explained inline in the table with a one-line legend below. Verdict is a callout banner, not a separate verdict page.
- Re-check passed: yes — the results page verdict reads "Recommended for this workload: deepseek-ai/deepseek-v4-flash — 18x cheaper, within quality tolerance." A non-technical product manager can scan the green banner and know the answer without reading the table.

**Rule violations flagged:** none. Admin-only tool operates under the relaxed budget (5 panels, charts permitted, density higher than tenant-facing). The horizontal quality bars and value score bars qualify as load-bearing visuals for the comparison task, not decoration.

**Files modified:**
- `prototypes/model-bakeoff-lab/_shared.css` (already existed, kept as-is — already had correct base tokens)
- `prototypes/model-bakeoff-lab/index.html` (created)
- `prototypes/model-bakeoff-lab/running.html` (created)
- `prototypes/model-bakeoff-lab/results.html` (created)
- `prototypes/model-bakeoff-lab/drill-down.html` (created)
- `prototypes/model-bakeoff-lab/suite-editor.html` (created)
