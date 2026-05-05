# Pilot execution prompt — Video Analysis Feasibility Trial

> **How to use this file:** open a fresh Claude Code session in this repo (branch `claude/video-analysis-integration-8MAK6`), paste the entire block below the divider into the first message, and ensure the two API keys are present in `.env` before submitting. Stop after acceptance criteria are met; do not extend scope.

---

You are running a **throwaway pilot** to validate whether a video-analysis feature is worth building into Synthetos. This is a measurement exercise, not platform code. Your job is to write one standalone script, run it against 50 videos, and produce a results report that lets a human decide go/no-go.

## Background you need

- We considered three paths: integrate Algrow (turned out to be YouTube-only — disqualified), integrate a multi-platform fetcher, or build native scrapers.
- Recommendation we are now testing: **Supadata as the fetch+transcript layer + Gemini 2.5 Flash with native video input as the analysis brain.**
- Numbers we need to verify with real videos:
  - Fetch success rate per platform (independent benchmarks say ~91% on TikTok, ~99% on YouTube — we want first-party data).
  - Cost per video (modelled at ~$0.07–$0.13 all-in).
  - Subjective output quality on a "why did this video work" prompt.
- Full research findings are in `tasks/brief-video-analysis-research.md` (the brief). The corresponding findings live in the originating session's chat history — if you need verification of API specifics, fetch from vendor docs directly (links below).

## What you are building

**One standalone TypeScript script** at `scripts/pilots/video-analysis-pilot.ts`, runnable via `npx tsx scripts/pilots/video-analysis-pilot.ts`. It must NOT touch the existing Synthetos platform code. No changes to `ProviderContentBlock`, no new skill, no DB schema, no MCP wrapper, no LLM router extension. Direct `fetch()` calls to vendor APIs only.

### Inputs
- `tasks/pilots/video-analysis/inputs.json` — array of `{ url, platform, expected_to_perform_well, note? }` objects. Read it; do not generate URLs. If the file is missing, abort with a clear error message and instructions for the operator to create it.
- **Skip any entry whose `url` starts with `TODO_`** (case-sensitive prefix). These are unfilled placeholders. Log how many were skipped, grouped by platform, in the results report. Do not treat them as failures.
- `.env` — `SUPADATA_API_KEY` and `GEMINI_API_KEY`. If either is missing, abort with a clear error message.

### Per-video flow
1. **Fetch + transcript via Supadata.** Use their REST API (read https://supadata.ai/documentation for current endpoint shapes — likely `POST /v1/transcript` or equivalent). Capture: metadata, transcript, video URL, credit cost. Time the call.
2. **Analysis via Gemini 2.5 Flash.** Use the Gemini API File API or direct URL ingestion (read https://ai.google.dev/gemini-api/docs/video-understanding for current shape). Send the video + the structured prompt below. Use `media_resolution=low` to keep cost down on the pilot. Record input/output token counts and computed cost using current pricing ($0.30/M input, $2.50/M output for Gemini 2.5 Flash — verify on https://ai.google.dev/gemini-api/docs/pricing).
3. **Per-video record.** Write to `tasks/pilots/video-analysis/outputs/<safe-slug>.json` with the full input/output for human grading.
4. **Failure handling.** If any step fails, record the error and continue to the next video. Do not crash the run. The failures are the data.

### Structured prompt to Gemini

```
You are analyzing a short-form social video to explain why it performed well. Return strict JSON matching this schema:
{
  "topic": "1 sentence summary of what the video is about",
  "hook": { "first_seconds": "what happens in the first 3-5 seconds", "why_it_works": "1-2 sentences" },
  "structure": [{ "timestamp": "MM:SS", "beat": "what happens here, 1 sentence" }],
  "creator_intent": "1-2 sentences on what the creator was trying to do",
  "why_it_worked": "3-5 sentences on the actual mechanics: tension, payoff, audience signal, novelty, format choice"
}
Output JSON only. No prose outside the JSON.
```

### Output: results report

Write `tasks/pilots/video-analysis/results-<YYYY-MM-DD-HHMM>.md` with:

1. **Headline numbers**
   - Fetch success rate (overall + per platform)
   - Analysis success rate (overall + per platform)
   - p50 / p95 latency end-to-end
   - Total spend (Supadata credits used + Gemini USD)
   - Average cost per successful video
2. **Per-video table** — URL, platform, fetch ok?, analysis ok?, latency, cost, link to per-video output JSON
3. **Sample outputs** — paste the full JSON output for 5 videos (mix of platforms) inline so a human can grade quality without opening files
4. **Failure breakdown** — group errors by cause (Supadata 4xx, Supadata 5xx, Gemini quota, Gemini parse error, other)
5. **Recommendation** — your read on go/no-go, with the headline numbers as evidence

## Acceptance criteria

- Script runs end-to-end against the 50-video input file.
- Results report is generated with all five sections above filled in.
- No platform code is modified — `git diff origin/main..HEAD -- server/ client/ shared/` should return nothing.
- Total spend is under $15 (sanity check — if higher, stop and escalate).

## Hard "do not"

- Do not modify any file under `server/`, `client/`, `shared/`, `.claude/`, `docs/`, or `architecture.md`.
- Do not add new dependencies to the root `package.json`. Use Node built-ins + `dotenv` (already installed) + `fetch`. If a parser is genuinely required, use a minimal local install.
- Do not extend the existing LLM router or `ProviderContentBlock`. Direct API calls only.
- Do not commit `.env` or any file containing API keys.
- Do not run any platform tests, gates, or build scripts. This is a pilot, not a feature.
- Do not loop with retries on Gemini failures — the failure rate is data we want to measure.
- Do not invoke spec-coordinator, feature-coordinator, architect, or any review agent. This pilot is below their threshold.

## Stop conditions

- Acceptance criteria met → write a one-paragraph summary in chat with the headline numbers and stop.
- `inputs.json` missing → abort with instructions, do not improvise URLs.
- API keys missing → abort with instructions.
- Spend approaching $15 → stop the run, write a partial report, escalate.

## Commit / push

Once the report is generated, stage and commit `scripts/pilots/video-analysis-pilot.ts`, `tasks/pilots/video-analysis/inputs.json`, the per-video JSON outputs under `tasks/pilots/video-analysis/outputs/`, and the results report. Push to `claude/video-analysis-integration-8MAK6`. Standard commit message: `pilot(video-analysis): run 50-video feasibility trial`.
