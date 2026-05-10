# Syntheos as a Personal Investment & Trading Assistant — Synthesis

> Inputs: `claude-response.md`, `gemini-response.md` (run 2026-05-10). ChatGPT deep research failed and was excluded.
> Audience: feasibility decision for Breakout Solutions. Non-technical reader.

---

## What this is — in one paragraph

A "personal AI trading team" — a small group of specialised agents (researcher, analyst, risk manager, trader, journal-keeper) that work for one investor, on that investor's own keys, on that investor's own schedule — is a real, shippable pattern in 2026. Several teams have built versions of it, the plumbing for digital assets is mature, and the legal posture for selling it to a paying community is workable so long as we don't custody member funds or charge performance fees. The honest catch: frontier LLMs have not proven they can generate alpha unsupervised; the value is in research, monitoring, journalling, and disciplined execution, not in autonomous money-printing. Build for human-in-the-loop and frame the product accordingly.

---

## Five things that came back clearly

1. **The reference architecture is converging.** Both research outputs point to the same shape: parallel analyst agents → a debate/critic step → a trader → a risk gate → a portfolio manager → execution. TauricResearch's *TradingAgents*, virattt's *ai-hedge-fund*, Lewis Jackson's *Paperclip*, and Almanak's commercial *AI Swarm* all instantiate variants. Confidence: **high**.

2. **The crypto plumbing is production-grade.** Coinbase AgentKit (with non-custodial agentic wallets), Hyperliquid MCP servers, CCXT-MCP for centralised exchanges, Jupiter for Solana DEX execution, GOAT SDK for cross-chain action coverage, Dune and Nansen MCPs for analytics. We can wire Syntheos to every layer without writing primitives. Confidence: **high**.

3. **A direct commercial competitor already exists in the digital-asset segment — Senpi.** Telegram-native personal trading agents on Hyperliquid, $4.5M seed (Coinbase Ventures, Lemniscap), >$100M volume processed since launch, ~40% win rate. Almanak is the closer architectural analogue but targets DeFi quants; Senpi is the closer go-to-market analogue. We are not first. Confidence: **high**.

4. **Frontier LLMs lose money trading unsupervised.** Nof1's Alpha Arena (Oct–Nov 2025) gave six top LLMs $10K each on Hyperliquid for 17 days. GPT-5 finished −62%, Gemini 2.5 Pro −56%, Grok 4 −45%, Claude Sonnet 4.5 −30%. Only Qwen3 Max (+22%) and DeepSeek V3.1 (+5%) finished green. This is the most important calibration finding in the brief. Confidence: **high** (verifiable; public Hyperliquid wallets).

5. **Regulation is workable but not casual.** US (SEC + FINRA), EU (MiCA + MiFID II), and AU (ASIC) all care about how this is marketed and packaged. The clean posture: sell it as software and education; member self-hosts; member uses their own keys and their own exchange accounts; we never custody funds; we never publish forward return claims; we never take a performance fee. Anything beyond that triggers registration. Confidence: **medium-high** — needs a 30-minute lawyer call before launch pricing, not before prototyping.

---

## What Syntheos could become — three honest pictures

### Option A — "Personal Research & Risk Desk" (low risk, fastest to ship)
Agents do everything *except* place real orders. Daily watchlist memo, on-chain whale tracking, narrative monitor, position health watcher, automated journal. Member trades manually with the team's research and supervision. Sells as productivity software. **No regulatory exposure beyond standard SaaS.** Closest reference: Lewis Jackson's Paperclip in its default paper-trading mode.

### Option B — "Personal Trading Team with Approval Gate" (medium risk, the sweet spot)
Adds execution, but every live trade requires a human flip. Agents propose, backtest, paper-trade for 30 days, then prompt the member to approve a strategy for live trading; once approved, agents execute within a hard-coded risk-thresholds file the agents cannot rewrite. Member uses their own exchange/wallet keys; Syntheos never holds funds. **Regulatory exposure low if marketed as infrastructure not advice.** Closest reference: Senpi (commercial), Paperclip + TradingView MCP (open-source).

### Option C — "Autonomous Personal Fund" (high risk, defer)
Full 24/7 autonomy within capital limits. The agent rebalances, hedges, harvests yields, defends positions during shocks — only escalates to the human on out-of-band events. Cobo Pact / Almanak / Generative Treasury territory. **Regulatory exposure is real:** in the US this looks like an unregistered adviser; in AU like operating an automated trading system without an AFSL. Defer until A/B are working and there's a credible legal path.

**Recommendation:** ship A first as a paid Breakout Solutions product (90 days), evolve to B for an upgraded tier (next 90 days), keep C in the R&D pipeline.

---

## Five workflows worth prototyping — ranked

| # | Workflow | Smallest viable build | Why first |
|---|---|---|---|
| 1 | **Daily Watchlist Memo** | One agent + Dune/Nansen/Kaito reads + Claude Sonnet 4.5 + email/Telegram delivery. ~1 week. | Highest perceived value per dollar of compute; lowest regulatory risk; demoes well to prospects. |
| 2 | **Position Health Watcher (24/7)** | Risk agent polling exchange APIs every 5 min; Telegram escalations; no autonomous closing. ~2 weeks. | Members already lose money to liquidations they didn't see coming. Saves real dollars on day one. |
| 3 | **Strategy Idea Miner from YouTube/X** | Agent takes a URL, extracts strategy rules to JSON, hands to backtester. ~2 weeks. | Self-evidently useful; aligns with how Breakout Solutions members already learn. Lewis Jackson has shown this works. |
| 4 | **Backtest-and-Promote Pipeline** | Strategy agent → Jesse or Freqtrade → Monte Carlo → 30-day paper on Hyperliquid testnet. ~3 weeks. | Bridge from "interesting research" to "approved live strategy" without us giving advice. |
| 5 | **Sentiment & Narrative Heatmap** | Kaito + Farcaster + X aggregation; daily digest tied to the member's watchlist. ~2 weeks. | Crypto-native moat. Differentiates us from equities-focused tools. |

Total to ship all five at MVP quality: **8–10 weeks** with one full-time engineer pulling on the existing Syntheos framework. Each one is independently sellable.

---

## What we should NOT do (yet)

- **Custody member funds.** Never. Members keep their own keys, their own exchange accounts. We are software.
- **Publish forward return claims.** Backward-looking journals only. No "expected APY", no "AI-driven 20% returns".
- **Charge performance fees or revenue share.** Triggers RIA / CTA / AFSL registration. Subscription only.
- **Latency-sensitive arbitrage or market-making.** LLMs are too slow. Wrong tool for the job.
- **Pure quant ML.** A trained gradient-boosted model on tabular features will beat any LLM on price-prediction. Use LLMs for narrative ingestion, orchestration, journalling — not nowcasting.
- **Try to outsource alpha to the agents.** Per Alpha Arena, they will lose money. The product is *discipline*, not edge.

---

## Open questions to resolve before pricing

1. **Australian regulatory posture.** 30-min lawyer call (Hall & Wilcox or Piper Alderman) before public launch pricing. Estimated cost: <$1k.
2. **Wallet/custody UX.** Coinbase AgentKit vs Privy vs Crossmint vs Safe + Zodiac. AgentKit is most mature but Coinbase-coupled. Decision affects the Operator tier roadmap.
3. **Cost economics at 24/7 scale.** A 6-agent firm running continuously on Claude Sonnet will not be "a few dollars a month" — needs a real cost model before any unmetered tier is offered.
4. **Whether to integrate or compete with Senpi/Kaito/AIXBT.** Probably integrate as upstream signal sources, but Kaito's API depends on X policy (revoked once already in Jan 2026). Build with provider-swap in mind.
5. **TradingView ToS risk.** The Chrome-DevTools-Protocol MCP servers used by Lewis Jackson are not a sanctioned TradingView API. For a paid product we should use Alpaca's official MCP for execution and treat TradingView as a Pine-Script-export-only research surface.

---

## Quality notes on the source research

- **Claude's response** is the stronger of the two. Specific named builders, working repos, the Alpha Arena dataset, sober tone on edge, useful pricing precedents, mostly-clean YouTube list.
- **Gemini's response** has genuinely useful architecture diagrams (the four ASCII diagrams in §2 are good) and a strong on-chain tooling table. But: several builds (AstraNova, Vibe Staking, Trader OS) are unverified and may be hallucinated; all YouTube URLs are malformed (missing `v=` parameter); publish dates self-flagged as "approximate" — treat as fabricated until checked.
- **ChatGPT** failed to return a deep-research response; not included.

---

## Suggested next step

A two-hour scoping session to:

1. Pick which of A / B / C we're building toward.
2. Lock the first two prototypes from the ranked list.
3. Decide on the first three integrations (recommend: Coinbase AgentKit + Dune MCP + a Hyperliquid MCP server).
4. Draft the Breakout Solutions positioning copy for member preview — software & education framing, no return claims.

After that session, the natural next artefact is a feature spec for prototype #1 (Daily Watchlist Memo) using the existing Syntheos build pipeline.
