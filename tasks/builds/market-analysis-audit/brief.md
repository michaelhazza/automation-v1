# Market Analysis Audit — Internal Brief

**Status:** Draft, ready to dispatch
**Owner:** michaelhazza
**Created:** 2026-05-15
**Purpose:** Surface gaps between Synthetos (Automation OS) and the broader market BEFORE the v1 development freeze and full QA / production-deployment round, so any obvious must-have features can be rolled into the freeze rather than retrofitted later.

---

## Why this exists

We are about to enter a development freeze and a full QA + deployment cycle. Before we lock the surface, we want an external read on whether the product has any glaring capability gaps a buyer would notice on a first comparison call.

The output of this exercise should answer one question:

> **"Is there anything obvious we should build into v1 because shipping without it would be a credibility hit on day one?"**

We are NOT trying to:
- Reach feature parity with every competitor (we explicitly reject feature-parity-as-strategy — see `docs/capabilities.md § Non-goals`)
- Pivot positioning (the operations-layer-for-agencies frame is locked)
- Over-engineer the v1 surface (the brief asks each model to flag over-engineering risk explicitly)

## How this is run

Three independent research passes — one each on Claude, Gemini (Deep Research), and ChatGPT (Deep Research). Each model gets the **same** research prompt (`research-prompt.md`) so we can triangulate findings.

**Pass 1 — competitor identification.** Each model returns a list of competitors clustered by competitive shape (direct, adjacent, partial, infrastructure). No comparison work yet.

**Pass 2 — comparison + gap analysis + recommendations.** Same conversation, same prompt continues. Each model produces:
1. Side-by-side capability matrix (us vs each direct + adjacent competitor)
2. Gap list, classified as: parity gap (table-stakes feature missing), differentiation gap (competitor has something we don't and it's a wedge), or non-issue (gap exists but is a deliberate non-goal).
3. Pre-freeze recommendation: ranked list of features to consider building into v1, each tagged Must / Should / Defer with a one-line rationale and an over-engineering risk note.
4. Final read: would a buyer choose us over the strongest 2–3 competitors today? If not, what's the single biggest reason?

Both passes happen in **one conversation per model** — the research-prompt.md instructs each model to do Pass 1, present results, then continue into Pass 2.

## Triangulation

After all three platforms return, we synthesise:
- Recommendations that appear in **all three** outputs → strong signal, candidates for v1 inclusion
- Recommendations that appear in **two of three** → discuss
- Recommendations that appear in **one** → log to `tasks/todo.md`, do not action pre-freeze unless the rationale is unusually strong

Synthesis lives in `tasks/builds/market-analysis-audit/synthesis.md` (created after Pass 2 returns).

## Files

- `brief.md` — this file (internal context, not for external use)
- `research-prompt.md` — the self-contained prompt to paste into Claude / Gemini / ChatGPT
- `responses/claude-pass1.md`, `responses/claude-pass2.md` — paste Claude's responses here
- `responses/gemini-pass1.md`, `responses/gemini-pass2.md` — paste Gemini's responses here
- `responses/chatgpt-pass1.md`, `responses/chatgpt-pass2.md` — paste ChatGPT's responses here
- `synthesis.md` — final cross-model synthesis (Pass 3, done by us)

## Operator workflow

1. Open Claude (web or app), Gemini Deep Research, and ChatGPT Deep Research in separate tabs.
2. Paste the entirety of `research-prompt.md` into each.
3. When each model completes Pass 1, save its response to `responses/{model}-pass1.md`.
4. Reply with the literal text **"Proceed to Pass 2"** in each conversation. The prompt instructs the model to continue.
5. When each model completes Pass 2, save its response to `responses/{model}-pass2.md`.
6. Run synthesis. Surface the must-have shortlist for triage before the freeze.

## Guardrails

- Do not let any model rewrite our positioning. The prompt is explicit that the operations-layer frame is non-negotiable.
- Treat the "Defer" column as the most important output — easy wins for the freeze are rare; "obvious things we'd regret not building" is the rarer signal.
- If a model proposes a feature that conflicts with our stated non-goals, the synthesis should note it but not action it.
