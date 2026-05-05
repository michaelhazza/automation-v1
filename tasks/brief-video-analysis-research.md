# Research Brief — Video Analysis Feature for Synthetos

**Author:** Synthetos team
**Date:** 2026-05-05
**Researcher:** Claude (claude.ai with web search enabled)
**Time budget:** 60–120 minutes
**Status:** Pre-spec research spike

---

## Table of contents

1. Why this brief exists
2. Hard constraints
3. The five questions
   - Q1. Algrow: real, what, MCP-compatible?
   - Q2. Alternative video-fetching providers
   - Q3. Gemini native video vs. Claude vision + frames
   - Q4. TikTok / Instagram fetch reliability today
   - Q5. ToS and legal posture for commercial use
4. Output format
5. Anti-goals
6. Source quality warnings
7. How to start

---

## 1. Why this brief exists

We are scoping a feature for Synthetos (an AI automation platform) that lets a user paste a YouTube, TikTok, or Instagram link and receive a structured breakdown: hook analysis, content structure, key timestamps, intent of the creator, and "why it went viral." The user wants to skip the watching step entirely.

We have two paths:

- **(A) Integrate** an existing third-party fetcher (Algrow is one candidate the team has heard of; we believe it is an MCP server but have not verified). Our platform supports MCP servers natively.
- **(B) Build native** — `yt-dlp` for YouTube, custom scrapers for TikTok/Instagram, frame extraction via `ffmpeg`, transcription via Whisper, vision analysis via Claude or Gemini.

Before committing to either, we need ground-truth answers to the questions below. We do **not** want a "build vs. buy" essay. We want concrete data we can put into a decision matrix.

---

## 2. Hard constraints to anchor your research

- We are a multi-tenant SaaS, **commercial use**. Free / personal-use-only tools are interesting only as a comparison baseline.
- We need to handle **YouTube, TikTok, and Instagram Reels** at minimum. YouTube alone is not enough.
- We expect **moderate volume**: thousands of analyses per month per workspace, not millions. Cost per analysis matters; raw throughput does not.
- Latency target: **under 5 minutes end-to-end** for a 10-minute video. We can run async / background, so seconds-level latency is not required.
- We already have: Whisper transcription (via OpenAI), pg-boss job queue, MCP host pattern, Anthropic + OpenAI + Gemini + OpenRouter routed through a unified LLM router. We do **not** have: object storage, vision-capable provider blocks, video frame extraction.
- We are based outside the US (assume EU / UK ToS posture matters).

---

## 3. The five questions

Answer each independently. For each question, prefer **named sources with dates** (vendor docs, GitHub READMEs, pricing pages, recent blog posts, Reddit threads with dates) over generic claims. If you cannot find a confident answer, say so explicitly. Partial answers with gaps named are far more useful than confident hand-waving.

### Q1. Is "Algrow" real, what is it, and is it MCP-compatible?

**Specifically find:**
- Is there a product / tool / MCP server called Algrow (or Algrowww, Algro, etc., try variants) that fetches social video content for Claude or other LLMs?
- If yes: who builds it, what is the website, what does it cost, what platforms does it cover (YouTube / TikTok / Instagram / others), is it MCP-compatible, is there a public API, what is the rate limit / fair-use policy?
- If no: what is the LinkedIn / Twitter post (search the exact phrase "Algrow" + "Claude" + "video") most likely referring to? Sometimes these viral posts cite tools that don't exist or are private beta.

**Acceptance:** Either a one-paragraph product card with link + pricing + capability matrix, OR an explicit "could not find, here is what I tried and what I found instead."

### Q2. What are the 3–5 best alternative video-fetching providers?

Independent of Algrow. Look at: **Apify** (search for "TikTok scraper", "Instagram Reel scraper", "YouTube scraper" actors), **ScrapeCreators**, **Supadata**, **RapidAPI** marketplace (top-rated TikTok / IG scrapers), **Bright Data**, **ScrapingBee**, **Tactiq**, **Clipping AI**, **ScrapFly**, any MCP-server-native option in the **MCP server registry / awesome-mcp lists**.

**For each candidate, return:**
- Name + URL
- Platforms supported (YT / TikTok / IG / others)
- Pricing model (per-call, subscription, credits) and rough cost per video
- Returns: metadata only? transcript? video file URL? frames? structured analysis?
- Reliability signal: when was it last updated, GitHub stars / issues, recent reviews
- Commercial-use posture (their ToS, not the platform's)
- MCP server available, or REST / SDK only?

**Acceptance:** A comparison table with at least 3 named, currently-operating providers with all columns filled or marked "unknown, searched X, found nothing."

### Q3. Gemini native video input vs. Claude vision + frame sampling, what's the cost and capability delta?

We are choosing between:
- **Path G:** Send the full video file to Gemini 1.5 / 2.0 / 2.5 (whichever is current and cheapest with video support) and get analysis directly.
- **Path C:** Extract N keyframes via `ffmpeg`, send frames + transcript to Claude Sonnet / Opus with vision.

**For each path, return:**
- Cost for a 60-second video and a 10-minute video, with current API pricing (cite the pricing page + access date).
- Quality posture: does Gemini *actually* understand video temporally, or is it sampling frames internally? Any independent benchmarks comparing Gemini video vs. Claude vision-on-frames for content analysis?
- Latency expectation.
- Rate limits / max video length / file size limits.
- Anything the team should know about reliability or output quality from recent (last 90 days) third-party reports.

**Acceptance:** Side-by-side cost calculation for a 10-minute video on each path, plus 1–2 sentences on which is better for our use case (content analysis, not transcription).

### Q4. How reliable is TikTok / Instagram public-content fetching today (last 60 days)?

Not "is scraping technically possible" — we know it is. We need to know **how stable it is in May 2026**. Specifically:

- What is TikTok's current anti-bot posture? Are public scrapers breaking weekly, monthly, or holding steady? Search Reddit (`r/webscraping`, `r/TikTok`), GitHub issues on `TikTokApi` and similar libraries, recent dev blog posts.
- Same question for Instagram (`instaloader`, `instagrapi`, public Reels endpoints).
- Is there an **official commercial API** path for either platform that's not the gated research API? E.g., TikTok Display API, Instagram Graph API for non-owned content?
- Are paid providers (Apify actors, ScrapeCreators, etc.) **also** breaking, or do they have stable enough infra that customers don't notice?

**Acceptance:** A "reliability snapshot" paragraph per platform (TikTok, Instagram) plus a clear answer to: "If we paid a provider, would we get >95% success rate on public videos today, or is this still a coin flip?"

### Q5. ToS and legal posture for commercial use

For a commercial multi-tenant SaaS based in the EU / UK that ingests public TikTok / Instagram / YouTube videos on behalf of users:

- What does each platform's ToS actually say about automated access and downstream commercial use? (Not the marketing summary, the actual clause references with section numbers.)
- Is there meaningful precedent for platforms enforcing against tools that do this? (HiQ v. LinkedIn, Meta v. Bright Data, etc., anything from the last 24 months specifically around video.)
- Do any of the paid providers in Q2 explicitly indemnify their customers or assert "we have rights to redistribute"?
- GDPR posture, are creator handles / faces in frames "personal data" we'd be processing? Any practical guidance from EU data protection authorities on this in the last 12 months?

**Acceptance:** A short "what we'd be exposed to" paragraph plus a list of providers (from Q2) that offer the strongest commercial-use posture.

---

## 4. Output format

Return your findings as a **single Markdown document** with this exact structure:

```markdown
# Video Analysis Research, Findings

## TL;DR
(3–5 bullets: the answer the team should walk away with.)

## Recommendation
(One paragraph: which path, A integrate / B build / hybrid, based on what you found, and why.)

## Q1. Algrow
...

## Q2. Alternative providers
| Provider | Platforms | Pricing | Returns | Reliability | Commercial OK | MCP? |
|---|---|---|---|---|---|---|
...

## Q3. Gemini vs Claude+frames
...

## Q4. Reliability snapshot
### TikTok
...
### Instagram
...

## Q5. ToS / legal
...

## Sources
(Numbered list of every URL cited above, with access date.)

## Gaps and uncertainty
(What you could NOT find out, and what the team would need to do to close the gap, talk to a vendor, run a pilot, etc.)
```

---

## 5. Anti-goals, do NOT spend time on

- Generic "what is video AI" overviews. Skip.
- The analysis prompting layer ("how do you write a prompt that explains why a video went viral"). The team will handle this.
- General "AI tools for creators" lists from content-marketing blogs. Low signal.
- Any tool that is YouTube-only, it doesn't solve our problem.
- Speculation about future Claude / Gemini capabilities. Use only what is shipping today.
- "Build vs. buy" framework essays. We have a framework. We need data.

---

## 6. Bias / source quality warnings

- **Vendor marketing pages overstate reliability.** Cross-check pricing pages with recent customer reviews (G2, Reddit, GitHub issues).
- **GitHub stars are vanity.** Open issues and last-commit date matter more.
- **LinkedIn posts are often promotional.** Treat any "this tool is amazing" post as a starting point, not evidence.
- **Reddit threads >18 months old are stale** for scraping reliability, the anti-bot landscape moves fast. Filter for recent posts.
- **Apify actor reviews are gameable**, look for actors with >100 paying users and recent (current-year) updates.

---

## 7. How to start

1. Web-search `"Algrow" Claude MCP video` and variants. If nothing, search for the LinkedIn / Twitter post text directly to identify the original author and what they were actually demoing.
2. Browse the **MCP server registry** (modelcontextprotocol.io or awesome-mcp-servers on GitHub) for any video-fetching servers.
3. Hit **Apify**, **ScrapeCreators**, **Supadata**, **RapidAPI** for current TikTok / IG / YT scraper offerings. Pull pricing pages.
4. Open **Anthropic** and **Google AI Studio** pricing pages for current Claude vision and Gemini video pricing. Check model versions.
5. Check **GitHub issues** for `yt-dlp`, `TikTokApi`, `instaloader` for the last 60 days, are they working?
6. Skim **Reddit r/webscraping** for the last 30 days for "TikTok" and "Instagram" threads.

When done, paste the Markdown findings back to the dev session. We will use it to either spec Phase 1 (integrate) or escalate to a deeper build investigation.
