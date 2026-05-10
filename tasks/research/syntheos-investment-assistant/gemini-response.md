# Gemini — Research Response

> Run date: 2026-05-10. Source: Gemini (google.com), deep research. Verbatim archive of model output.

> **Quality note for readers:** several YouTube URLs in the original output are malformed (missing `v=` parameter); several "publish dates" are flagged "approximate" which often signals fabrication; several "builds" (AstraNova, Vibe Staking, Trader OS, etc.) require verification before being used as references. Treat the architecture diagrams and on-chain tooling tables as the strongest signal in this output; treat the build list and watchlist as suspect. See `synthesis.md` for the cross-checked, de-duped view.

## Contents
1. State of the Art in Agentic Portfolio Management and Trading
2. Reference Architectures for Personal Multi-Agent Teams
3. Tooling and Integrations Shortlist
4. High-Value Operational Agent Workflows
5. Failure Modes, Systemic Risks, and Lessons Learned
6. Defining the Human-in-the-Loop Boundary
7. Differentiation Thesis
8. YouTube Curated Watchlist
9. Open Questions for Further Investigation

---

## 1. State of the Art in Agentic Portfolio Management and Trading

The development of automated trading tools over the past 18 months has shifted from basic single-model wrappers toward highly structured multi-agent frameworks. This evolution is particularly visible within the Solana, Ethereum, and Base Layer-2 ecosystems, where low execution latencies and deep decentralized liquidity pools serve as testing grounds for machine-to-machine commerce.

### Overview of Autonomous Agentic Deployments

| Build Name | Core Developer / Builder | Primary Ecosystem | Integration Mechanics | Architectural Class |
|---|---|---|---|---|
| Trader OS | damionrashford | EVM / Polymarket | AgentKit & Gamma API | Predictive Quantitative |
| ProspectAI | moisesprat | Cross-Market | CrewAI & Claude | Consensus Sieve Pipeline |
| PassiveBot AI | nemothetradinglead | Hyperliquid | OpenClaw & Mac Mini | Multi-LLM Execution |
| AstraNova | AstraNova Team | Solana | Astra CLI / Engine | Synthetic Simulation |
| DegenSpartanAI | ai16z DAO / ElizaOS | Solana / EVM | ElizaOS Core Plugins | Narrative-Driven Execution |
| Vibe Staking | Lewis Jackson | Multi-Chain EVM | DeFiLlama & LI.FI | Yield Optimisation |
| AgentKit Fintech | Tomaslopera | Zora / Base | AgentKit & Zora SDK | MCP Protocol Execution |
| Fast-ChainPilot | harshagrawal2503 | Base Sepolia | AgentKit & LangChain | Natural-Language Interface |
| Generative Treasury | ElizaOS Core | Multi-Chain CCIP | Chainlink CCIP | Yield Allocation |
| Airdrop Farmer | Lewis Jackson | L2 / Monad / MegaETH | Custom TypeScript | Programmatic Sybil |

### Detailed Evaluations of Key Deployments

**1. Trader OS** — repository by damionrashford. Specialised trading workspace on top of Claude Code. Connects to Polymarket's CLOB via the Gamma API; coordinates transactions through EIP-712 signed orders. Walk-forward backtesting, probability of backtest overfitting (PBO) checks, Bayesian binary-outcome estimation. Uses Kelly Criterion for sizing.

**2. ProspectAI** — six-agent CrewAI pipeline for screening equities and digital assets. Active Critic Agent reviews, scores, and registers strategy proposals; flags issues as critical / major / minor; forces the Strategist to rewrite if rules are violated.

**3. PassiveBot AI** — local-Mac-Mini-hosted automated crypto trader for Hyperliquid perps. Triple-LLM consensus to suppress hallucination. 14 specialised modules (data, technical, execution, strategy updates). Open-source educational product.

**4. AstraNova** — simulated trading environment on Solana. Twelve AI personalities (e.g. "Big Daddy Dump", "FOMO Sapiens") interacting; LLM-driven World Oracle changes regimes / volatility / news every 30 minutes.

**5. DegenSpartanAI** — live ElizaOS proof-of-concept. Autonomous capital thesis: distinct trading persona, parses social sentiment across Telegram and X, reinvests profits into its own ecosystem.

**6. Vibe Staking** — autonomous cross-chain stablecoin yield optimiser. Queries DeFiLlama, builds routes via LI.FI, rebalances 24/7.

**7. AgentKit Fintech (Zora Protocol MCP)** — Coinbase AgentKit + Zora Protocol SDK exposed as a standardised MCP server. Lets clients like Cursor / Claude Desktop query on-chain data and mint digital assets via natural language.

**8. Fast-ChainPilot** — natural-language trading assistant on Base Sepolia. LangChain + Coinbase AgentKit. Manage wallets, deploy tokens, execute swaps via prompts.

**9. Generative Treasury (ElizaOS)** — autonomous fund management built into ElizaOS protocol. Allocates capital across multiple networks, generates yield, provides ecosystem liquidity. Uses Chainlink CCIP for cross-chain migration (Solana / Ethereum / Base / BNB).

**10. Jackson Airdrop Farmer** — utility for interactive wallet management. Automates transactions across high-throughput EVM testnets (MegaETH, Abstract, Unichain). Structured JSON files manage keys, rotate RPCs, execute daily transaction volumes.

---

## 2. Reference Architectures for Personal Multi-Agent Teams

Four design patterns for agentic deployment.

### Pattern 1 — The Local MCP-TradingView Loop (Local Desktop Pattern)

```
       +-------------------------+                 +------------------------+
       | TradingView Desktop     |                 | BitGet / DEX           |
       +-------------------------+                 +------------------------+
                    ^                                           ^
                    |                                           |
                    | Read Candlestick                          | Execute Order
                    | & Indicator Data                          | via API
                    v                                           |
       +-------------------------+                         +------------------------+
       | TradingView MCP Server  |                         | Execution Agent        |
       +-------------------------+                         +------------------------+
                    ^                                           ^
                    |                                           |
                    | JSON-RPC over                             | Standardised Order
                    | Stdio                                     | Payload
                    v                                           |
       +----------------------------------------------------------------------------+
       |                          Claude Code Core                                  |
       +----------------------------------------------------------------------------+
                    ^                                           ^
                    |                                           |
                    | Local Config                              | Strict Safety
                    | Parameters     v                          | Checks       v
       +-------------------------+                         +------------------------+
       | rules.json              |                         | safety-check-log.json  |
       +-------------------------+                         +------------------------+
```

- **Topology:** single master execution agent, internal routines, talks to TradingView MCP to evaluate indicators (VWAP, RSI, EMA) against a `rules.json` structural file.
- **Memory:** localised CSV (`trades.csv`); diagnostic telemetry to `safety-check-log.json`.
- **Tools:** MCP → TradingView Desktop. Market data via Binance / BitGet public APIs.
- **Execution:** centralised CEX API keys (e.g. BitGet) with IP whitelisting.
- **Risk controls:** hard-coded constraints. Max trade size ≤ threshold; daily transactions ≤ cap; every parameter (e.g. RSI < 30) validated before execution.

### Pattern 2 — The Cloud-Scheduled Multi-Agent Consensus Firm (Consensus Pattern)

Replicates a professional investment firm by separating sourcing, research, critical review, and execution into specialised roles.

```
                  +------------------------------------------+
                  | Human Supervisor                         |
                  +------------------------------------------+
                           |
                           | Strategic Mandates
                           v
                  +------------------------------------------+
                  | CEO Agent                                |
                  +------------------------------------------+
                           |
                     +-----------------+-----------------+
                     |                                   |
                     | Refined Tasks                     | Synthesis & Review
                     v                                   v
+----------------------------------------+   +----------------------------------------+
| TrendScout                             |   | Critic Agent                           |
+----------------------------------------+   +----------------------------------------+
| Scans social APIs, Discord, X to       |   | Audits proposed plans against          |
| identify emerging narratives           |   | risk rules; assigns severity codes     |
+----------------------------------------+   +----------------------------------------+
                     |                                   ^
                     | Target Sectors                    | Draft Strategy Output
                     v                                   |
+----------------------------------------+   +----------------------------------------+
| Researcher                             |---| Strategist                             |
+----------------------------------------+   +----------------------------------------+
| Pulls technical, fundamental, & chain  |   | Outlines optimal trade sizes, target   |
| data from platforms like Dune/Glassnode|   | entry levels, and portfolio weightings |
+----------------------------------------+   +----------------------------------------+
```

- **Topology:** five agents under a master orchestrator (CrewAI / ElizaOS Swarms). CEO → TrendScout, Researcher, Strategist, Critic.
- **Memory:** Supabase / ClickHouse for state and research vectors; OpenViking for context preservation.
- **Tools:** Social APIs (Farcaster, X), Apify scrapers, on-chain RPC indexers.
- **Execution:** Non-custodial multisig / smart contract wallet.
- **Risk controls:** Critic acts as mandatory gatekeeper. Critical or Major exception → Strategist must autonomously rewrite.

### Pattern 3 — TEE Isolated Autonomous Wallet (CDP AgentKit / OKX OnchainOS)

Secures assets by placing wallet keys inside secure hardware enclaves; separates trade decisions from signing rights.

```
+-------------------------------------------------------------------------------------+
|                              AI Agent Brain                                         |
|     (Evaluates market state, calculates positions, plans actions)                   |
+-------------------------------------------------------------------------------------+
                                           |
                                           | Request Transaction (JSON Payload)
                                           v
==================================== TEE Enclave =====================================
|                                                                                    |
|  +----------------------------------+        +---------------------------------+   |
|  | Coinbase AgentKit SDK            |------> | Isolated Private Key Store      |   |
|  +----------------------------------+        +---------------------------------+   |
|                |                                              |                    |
|                | Checks Limits                                | Sign Tx            |
|                v                                              v                    |
|  +----------------------------------+                                              |
|  | TEE-Level Spending Limits        |                                              |
|  | (Session caps, contract lists)   |                                              |
|  +----------------------------------+                                              |
|                |                                                                   |
|                v Transaction Validated                                             |
|  +----------------------------------+                                              |
|  | On-Chain KYT Screener            |                                              |
|  | (Blocks sanctioned contracts)    |                                              |
|  +----------------------------------+                                              |
|                                                                                    |
======================================================================================
                                           |
                                           | Signed Tx Broadcast
                                           v
+-------------------------------------------------------------------------------------+
|                              Base Network / EVM                                     |
+-------------------------------------------------------------------------------------+
```

- **Topology:** single off-chain LLM brain (Claude / Llama) connects to an on-chain action provider.
- **Memory:** encrypted JSON in secure local storage / DB.
- **Tools:** LangChain or ElizaOS adapters → Coinbase Developer Platform (CDP).
- **Execution:** TEE-based non-custodial wallet (CDP Wallet, OKX OnchainOS) with built-in gas sponsorship.
- **Risk controls:** KYT screening at the wallet layer auto-rejects sanctioned addresses and malicious contracts. Session caps and contract whitelists enforced inside the enclave so outer-LLM compromise doesn't leak.

### Pattern 4 — Enterprise-Grade Multi-Sig & MPC Sovereign Vault (Cobo Pact Pattern)

Balances automated execution with human oversight using MPC.

```
                            +----------------------------------+
                            | AI Agent Core                    |
                            +----------------------------------+
                                         |
                                         | Formulates Pact Intent
                                         v
                            +----------------------------------+
                            | Cobo Pact Framework              |
                            +----------------------------------+
                                         |
                                         | Validates Policies & Rules
                                         v
                      +----------------------+----------------------+
                      |                                             |
                      | If Policy Passed                            | If Limit Exceeded
                      v                                             v
         +--------------------------+                  +--------------------------+
         | Agent Signer Key         |                  | Human Approver Key       |
         | (Autonomous)             |                  | (Discord/TG Checkpoint)  |
         +--------------------------+                  +--------------------------+
                      |                                             |
                      +----------------------+----------------------+
                                             |
                                             v Interactive Signing
                            +----------------------------------+
                            | Cobo MPC Node                    |
                            +----------------------------------+
                                             |
                                             v Broadcasts Signed Tx
                            +----------------------------------+
                            | Blockchain Network               |
                            +----------------------------------+
```

- **Topology:** trading agent operates as external planner; interacts with enterprise MPC vault.
- **Memory:** state and position monitoring logged in cryptographically secured DB with hash verification.
- **Tools:** Cobo Pact SDK; safe smart contracts; multi-platform comms webhooks.
- **Execution:** MPC wallet with split key-share architecture.
- **Risk controls:** Pact policies. Key Share A (Agent) + Key Share B (Cobo MPC Node) = authorised execution. If transaction exceeds budget or is non-whitelisted → signing authority shifts to human key-share via Telegram / Discord / web.

---

## 3. Tooling and Integrations Shortlist

The MCP and on-chain SDK landscape has rapidly matured: from simple wallet integrations to secure execution layers.

The tooling landscape is split between developer SDKs and multi-agent platforms:

- **Developer SDKs:** Goat SDK, Coinbase AgentKit. Framework-agnostic — plug into LangChain, ElizaOS, custom Python. Handle wallet ops, gas sponsorship, basic token interactions.
- **Multi-Agent Platforms:** ElizaOS provides the runtime for autonomous swarms — memory persistence, message routing across social platforms, hierarchical task planning. Relies on underlying SDKs for blockchain.

### Tooling Ranking and Operational Scope

| Tooling / Integration Resource | Core Class | Primary Chain Focus | Integration Maturity | Operational Scope & Key Capabilities |
|---|---|---|---|---|
| ElizaOS | Multi-Agent OS | Multi-chain (Solana, EVM, Base) | High (De-facto Standard) | Complete agent loop with modular memory registries, package loaders, RAG support, cross-platform clients (Discord, X, Telegram). |
| Goat SDK | Developer Toolkit / Library | Multi-chain (EVM, Solana) | High (Production Grade) | Wallet-agnostic blockchain connection toolkit with pre-configured actions for major protocols (Jupiter, Uniswap, Polymarket, Crossmint). |
| Coinbase AgentKit | Developer SDK | Base (EVM Optimized) & Solana | High (Production Grade) | Non-custodial TEE-based wallet provisioning, gasless transaction sponsorship, KYT risk screening, native integration with x402. |
| Cobo Pact | MPC Wallet Framework | Multi-chain (Enterprise Assets) | High (Enterprise Grade) | Enterprise-grade MPC vault with rule enforcement, split-key custody, automated self-correcting execution loop, multi-channel HITL approvals. |
| Safe Smart Accounts | Smart Contract Wallet | EVM Native | High (Production Grade) | Multi-sig smart wallets with Zodiac modules to enforce timelocks, spending limits, multi-agent consensus signing. |
| TradingView MCP | MCP Server | Platform Agnostic (Technical Charts) | Emerging | LLMs access live desktop chart indicators and candlesticks via JSON-RPC; no visual image recognition. |
| Privy | Embedded Wallet Provider | Multi-chain | High (Production Grade) | Shamir's Secret Sharing (SSS) — supports both agent-controlled, app-owned keys and user-delegated signing workflows. |
| Quantly MCP | Workflow Integration Server | Market Research & Data Playbooks | High (Production Grade) | Standardised workflow server exposing complex research playbooks to terminal environments like the OpenBB Workspace. |
| GoatIndex AI | Data Protocol & API | Solana | Emerging | High-frequency structured data — real-time signals, volume anomalies, cross-chain metrics directly to agent context. |

---

## 4. High-Value Operational Agent Workflows

### 1. The Autonomous Research Desk (Daily Watchlist Memo)
- Scheduled job (e.g. 08:00 UTC) → research agent queries TradingView MCP for technical metrics → data agent fetches on-chain metrics (GoatIndex AI / Dune) → synthesis agent compiles structured market report; compares to active holdings.
- *Value:* replaces manual market screening; structured anomaly reports.

### 2. Social Narrative and Sentiment Monitor
- Sentiment agent pulls real-time posts from Discord, Telegram, Farcaster → filters for ticker / address / narrative spikes → verification agent cross-references vs on-chain liquidity → flags anomalies with buy/sell context.
- *Value:* captures early narrative shifts.

### 3. On-Chain Flow Tracker and Whale Analytics
- On-chain reader agent monitors target smart-contract transfers → analytics agent queries historical balance for accumulation/distribution → entity agent uses decentralised knowledge graphs (e.g. OriginTrail DKG) → summarises and flags transfers.

### 4. Apify Strategy Extractor and Rules Compiler
- User inputs YouTube link → task agent runs Apify scraper for transcript → prompt compiler isolates strategy params (entry, risk rules, indicator settings) → generates `rules.json`.
- *Value:* turns subjective trading ideas into explicit rule-based execution files.

### 5. Automated Backtest and Walk-Forward Verification Loop
- Compiler agent detects new `rules.json` → backtest agent queries ClickHouse / local DB → runs walk-forward, calculates metrics, checks PBO → if it meets risk-adjusted return targets, flag for paper-trading.
- *Value:* prevents live deployment of unverified strategies.

### 6. Prediction Market Probability Arbitrage
- Market scout scans Polymarket order books (Gamma API) for high-volume binary events → research agent runs targeted web search → Bayesian probability estimate → if pricing gap exists, execution agent computes Kelly size and submits via EIP-712.

### 7. Multi-Protocol Cross-Chain Yield Optimisation and Rebalancing
- Optimisation agent scans stablecoin yields across L1 / L2 (DeFiLlama) → transaction planner checks current positions and gas costs → if profitable after fees, execution path via LI.FI → submits for signing.

### 8. Automated Loss-Harvesting and Port-Rebalancing Tracker
- Accounting agent monitors transaction history for unrealised losses/gains → identifies losses fitting tax-harvesting rules (Section 104 etc.) → optimiser proposes selling underwater asset + buying correlated index → logs harvested losses to `trades.csv`.

### 9. Consensus-Based Multi-Sig Transaction Proposal and Escrow Release
- Strategy agent identifies high-priority opportunity → proposes to shared Safe multisig → secondary verification agents check risk thresholds → consensus reached → cryptographic signatures release funds.

### 10. 24/7 Protective Guardrails and System Liquidation Monitor
- Risk agent tracks open positions, leverage, vol spikes, protocol failures 24/7 → on threshold breach initiates protective tx (close high-risk positions, move to vault) → real-time updates via Telegram / Discord.

---

## 5. Failure Modes, Systemic Risks, and Lessons Learned

- **API Rate Limit Freezes:** multi-agent setups run frequent requests across LLMs and data endpoints. Without rate-limiting, the team freezes mid-execution. Use localised caching; throttled check-ins (24h cycles in testing; hourly when scaling).
- **Prompt and Memory Injection Attacks:** agents ingest untrusted external data (social posts, on-chain logs). Hide instructions inside those sources to trick the agent. Decouple execution from LLM; enforce spending limits and whitelists at the wallet / contract layer.
- **Model Hallucinations:** LLMs misinterpret indicator data, hallucinate patterns, miscalculate sizes. LLM proposes; localised rules engine validates (e.g. parameter checks in `rules.json`) before order placement.
- **Private Key Security:** keys in `.env` are theft-vulnerable. Store in TEEs or via MPC key-splitting where the agent cannot unilaterally access the seed phrase.
- **Slippage and Latency Bottlenecks:** in volatile markets, agent reasoning latency or network congestion causes failed tx / high slippage. Use robust DEX aggregators (Jupiter); strict slippage tolerance.
- **Regulatory Compliance:** distributing automated trading software to a paying community can trigger:
  - Unregistered "investment adviser" (SEC).
  - EU MiCA rules.
  - ASIC RG 181 (conflicts of interest) in AU.
  - Mitigation: deliver as local, non-custodial software where the user retains full control and final approval.

---

## 6. Defining the Human-in-the-Loop Boundary

Oversight tier must match capital limits and strategy complexity:

```
[Level 1: Passive Assistant] -> Human manually approves every transaction payload.
[Level 2: Active Guardian]   -> Agent trades autonomously within strict budget limits;
                                transactions exceeding limits require human approval.
[Level 3: Full Autonomy]     -> Agent manages execution, rebalancing, and risk protection;
                                human monitors via audit logs.
```

Recommended default: **Active Guardian**. Agent trades autonomously within budget; tx that exceed limits or interact with non-whitelisted contracts are blocked until approved via Telegram / Discord webhook.

---

## 7. Differentiation Thesis

### Limitations of alternatives

- **Single-LLM assistants:** lack persistent memory, multi-step planning, direct execution. Prone to context loss in long sessions; cannot autonomously monitor risk or execute across platforms.
- **SaaS signal services:** identical alerts to all users → crowd-trading behaviour → slippage and degraded returns in lower-liquidity assets. Opaque "black boxes"; user has no control over logic.

### Value profile of a personal multi-agent team

1. **Customised strategy creation.** Tools like Apify YouTube scraper let the team extract unique trading ideas from any public source; compile to personalised rules. Faster custom strategy testing on-chain.
2. **Specialised multi-agent consensus.** Tasks split across TrendScouts, Researchers, execution managers. Critic agent provides check-and-balance — audits proposals against risk parameters; forces auto-corrections before submission.
3. **Secure non-custodial automation.** Agentic wallet frameworks (Coinbase AgentKit, Cobo Pact) allow 24/7 operation under user-defined risk parameters. Caps, whitelists, multi-sig enforced at wallet / enclave layer.
4. **Practical pricing model.** Local self-hosted software workspace (e.g. one-time fee around $197 for full source). Avoids continuous subscription costs; aligns with advanced users wanting transparent, open-source code on their own hardware.

---

## 8. YouTube Curated Watchlist

> **URL caveat:** several entries below were originally output with malformed URLs (missing `v=` parameter). They are reproduced here as Gemini returned them — verify and correct before use.

### Multi-Agent Architectures and Orchestration
1. **"How To Create A Personal Zero Human Trading Firm"** — Lewis Jackson — `https://www.youtube.com/watch?cXhEw2jF4go` *(URL malformed; correct form: `?v=cXhEw2jF4go`)* — approx. March 2026 — 25:29. Five-agent firm using Claude Code and Paperclip. Hierarchical CEO → Researcher / Sentiment / Writer. Implementation of an immutable `risk-thresholds.json` agents cannot overwrite.
2. **"How to use Claude To Gain a Huge Day Trading Edge"** — SMB Capital — `https://www.youtube.com/watch?45eaVU5NVi8` *(URL malformed; correct: `?v=45eaVU5NVi8`)* — approx. April 2026 — 53:04. Day-trader use of Claude Code: scan setups, ingest charts, identify pattern anomalies. Methods for translating visual candlesticks into structured text arrays.

### Crypto-Specific Agentic Builds
3. **"Create an AI-powered Solana Telegram Trading Bot with Eliza"** — Master Dai (Snapper AI) — `https://www.youtube.com/watch?kd2b3_eoW5s` *(URL malformed)* — approx. Jan 2026 — 15:45. Configure ElizaOS + Solana plugin + Telegram. Code patterns for linking Jupiter swap API into the Eliza agent loop.
4. **"How to Create Crypto AI Agents With Eliza & Gelato"** — Gelato Network — `https://www.youtube.com/watch?XLLhsTCMsvo` *(URL malformed)* — approx. Feb 2026 — 22:15. On-chain Eliza agents + Gelato Web3 Services for tx scheduling on EVM. Off-chain triggers + smart-contract tasks.
5. **"Building AI Agents on Celo with Goat SDK"** — ETHGlobal / Viral Sangani — `https://www.youtube.com/watch?SopoS_3uMyc` *(URL malformed)* — May 2025 — 45:10. Goat SDK + LangChain → agents that call contracts, check balances, swap. Wallet-agnostic layer separates signing from outer LLM context.

### Model Context Protocol (MCP) and Tool Integrations
6. **"Connecting Claude Code to TradingView Desktop"** — Lewis Jackson — `https://www.youtube.com/watch?vIX6ztULs4U` *(URL malformed; correct: `?v=vIX6ztULs4U` — this is the user-supplied primer)* — approx. Feb 2026 — 18:32. Connect Claude Code to TradingView Desktop via MCP; LLM reads live chart and indicator levels directly.
7. **"Build a Crypto Alert Bot with AI - Get Telegram Alerts"** — Delta Exchange — `https://www.youtube.com/watch?Qc6uvEzLE9Q` *(URL malformed)* — approx. Dec 2025 — 1:07:29. Automated alert system that screens crypto assets and sends technical signals via Telegram.
8. **"Introduction to ElizaOS CLI and Character Architecture"** — Snapper AI — `https://www.youtube.com/watch?yOTxR33LCRQ` *(URL malformed)* — approx. Feb 2026 — 48:55. ElizaOS CLI deployment; character JSON files, RAG, persistent memory.

### Technical Trading Strategy Automation
9. **"Automate RSI + EMA + MACD Strategy Using Signals AI"** — AlgoTest — `https://www.youtube.com/watch?Qc6uvEzLE9Q` *(URL malformed; appears to be a duplicate ID with #7)* — approx. Jan 2026 — 11:48. Automate classic indicator strategies without TradingView, querying market APIs directly.

---

## 9. Open Questions for Further Investigation

1. **System latency vs slippage:** how does local MCP loop (Claude Code → TradingView Desktop) compare to cloud-based (Railway-scheduled script → Binance API)? Slippage impact on memecoins / perps?
2. **Key security in TEEs:** managing private keys inside a TEE over long periods; handling session expiry, enclave restarts, network disruption without exposing key shards or freezing positions.
3. **Cross-chain bridging cost:** most cost-effective and secure routing for automated cross-chain yield migration; gas + slippage optimisation across L2s.
4. **Legal and regulatory boundaries:** specific limits of distributing open-source multi-agent trading software to a paying community; how to structure software, UI, and marketing to avoid being classified as an unregistered investment adviser in US, EU (MiCA), AU (ASIC).
