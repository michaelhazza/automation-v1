# Claw Code Investigation Report

**Date:** 2026-04-02
**Repo:** [instructkr/claw-code](https://github.com/instructkr/claw-code)

---

## 1. What Is Claw Code?

Claw Code is a **clean-room reimplementation** of the Claude Code agent harness system. It was created after Anthropic accidentally shipped a source map file (59.8 MB) with `@anthropic-ai/claude-code@2.1.88` on March 31, 2026, exposing the full TypeScript source of Claude Code's CLI agent.

Sigrid Jin ([@sigridjineth](https://github.com/sigridjineth)) reverse-engineered the architectural patterns and rebuilt the agent harness from scratch — first in Python, then ported to Rust. It became **the fastest-growing GitHub repo in history**, crossing 127K stars in roughly 2 hours.

**Key distinction:** This is NOT a copy of Anthropic's code. It's a clean-room rewrite that reimplements the architectural patterns without copying proprietary source.

---

## 2. Tech Stack & Architecture

| Layer | Technology |
|-------|-----------|
| Primary language | Rust (92.9%) |
| Secondary | Python (7.1%) |
| HTTP/SSE | Axum |
| Protocol | MCP (Model Context Protocol) |
| LLM Support | Provider-agnostic (Claude, OpenAI, local models) |

### Rust Workspace (`rust/crates/`)
- `api-client` — API abstractions with OAuth and streaming
- `runtime` — Session management, MCP orchestration
- `tools` — Tool specifications and execution (19 built-in tools)
- `commands` — Slash command framework
- `plugins` — Plugin system with hooks
- `claw-cli` — Interactive REPL with markdown support
- `server` — HTTP/SSE via Axum
- `lsp` — Language server integration

### Python Workspace (`src/`)
- Original port layer — models, commands, tools, query engine, CLI entry point

---

## 3. Current Maturity (from PARITY.md)

### What Works
- Anthropic API/OAuth basics
- Local conversation/session state management
- Basic agentic loop with tool calling
- MCP stdio/bootstrap support
- MVP tool registry (shell, file, search, web, todo, skill operations)
- Core CLI commands (help, status, compact, model, permissions, clear, cost, resume, config, memory, init, diff, version, export, session mgmt)

### Critical Gaps
- **No plugin system** — No loader, marketplace, or extension mechanism
- **No hooks pipeline** — Config parsed but PreToolUse/PostToolUse don't execute
- **Missing commands** — `/agents`, `/mcp`, `/skills`, `/plan`, `/review`, `/tasks`
- **Missing services** — Analytics, settings sync, policy limits, team memory
- **Limited tool surface** — No AskUserQuestion, LSP, MCP resource tools, scheduling, workflow tools
- **No structured/remote transport layers**

**Assessment:** Solid foundation, but substantially incomplete. It's a working local CLI, not a production-ready platform.

---

## 4. Legal Considerations

| Risk | Detail |
|------|--------|
| Clean-room claim | Authors claim independent reimplementation, not a copy |
| Anthropic's stance | Anthropic has targeted repos hosting the original leaked TypeScript via DMCA |
| Claw Code status | Has NOT been taken down (clean-room defense) |
| Unresolved | Whether clean-room status holds up legally is still an open question |
| License | Not explicitly stated; caution warranted |

**Risk level: MODERATE.** Using patterns/ideas from claw-code is lower risk than using the leaked source directly, but there's reputational and legal ambiguity. We should treat it as **reference material for learning**, not as code to fork or depend on.

---

## 5. Relevance to Automation OS

### What We Already Have (that overlaps)
Our platform already has mature equivalents for most of what claw-code provides:

| Capability | Automation OS | Claw Code |
|-----------|--------------|-----------|
| Multi-provider LLM routing | ✅ Full (Claude, OpenAI, Gemini + cost tracking) | ✅ Provider-agnostic client |
| MCP integration | ✅ Full (action registry exposed as MCP tools) | ✅ MCP stdio/bootstrap |
| Tool/skill system | ✅ Full (skill executor, HITL gates, audit) | ⚠️ MVP only |
| Agent orchestration | ✅ Full (system agents, subaccount agents, workflows) | ⚠️ Basic agentic loop |
| Plugin/hook system | ✅ N/A (we use action registry) | ❌ Not implemented |
| Cost tracking & budgets | ✅ Full (LLM router, budget service) | ⚠️ Basic cost command |
| Session management | ✅ Full | ✅ Basic |
| CLI interface | ❌ We're a web platform | ✅ Core strength |

### Where Claw Code Could Add Value

#### A. Architectural Patterns Worth Studying
1. **Slash command framework** — Their command system (`/compact`, `/model`, `/diff`, `/export`) is a clean pattern. Could inform how we build operator-facing CLI tooling or chat-based command interfaces within our platform.

2. **REPL-style agent interaction** — The interactive loop pattern (user prompt → tool calls → streaming response) is well-structured. Could inform how we build real-time agent chat UIs.

3. **Session resume/export** — Their session management with resume and export capabilities is a pattern we could adapt for our workflow execution history.

#### B. Potential Integration Ideas

1. **CLI for Automation OS (Low Priority)**
   - Build a CLI that talks to our API, inspired by claw-code's REPL architecture
   - Would let power users interact with their agents/workflows from terminal
   - **Verdict:** Nice-to-have, not a priority. Our web UI is the primary interface.

2. **Local Development Agent (Medium Interest)**
   - A local coding agent that uses our MCP server as its tool backend
   - Developers could use a claw-code-like CLI that routes tool calls through Automation OS
   - **Verdict:** Interesting but complex. Better to wait for official Claude Code MCP improvements.

3. **Reference for MCP Tool Design (High Value)**
   - Their 19 built-in tool specs are well-documented
   - Could inform how we design and document our own MCP tool surface
   - **Verdict:** Worth reviewing their tool specs for design patterns.

4. **Rust Performance Layer (Low Priority)**
   - If we ever need high-performance agent runtime components, their Rust crate structure is a good reference
   - **Verdict:** Not relevant now. Our Node.js stack handles our scale fine.

---

## 6. Recommendations

### ✅ DO
1. **Study the architectural patterns** — Review their slash command framework, tool registry design, and session management as reference material for improving our own systems
2. **Review their MCP tool specs** — Their 19 built-in tool definitions could inform better tool design in our action registry
3. **Monitor the project** — It's moving fast (127K stars, active development). If it matures and gets clear licensing, it could become a useful ecosystem component
4. **Learn from their REPL UX** — If we ever build a chat-based command interface, their interaction patterns are solid reference

### ❌ DON'T
1. **Don't fork or depend on it** — Legal status is unresolved, and it's substantially incomplete
2. **Don't replace our existing systems** — Our LLM routing, MCP integration, agent orchestration, and cost tracking are more mature than what claw-code offers
3. **Don't prioritize CLI tooling** — Our platform value is in the web-based multi-tenant automation, not terminal interfaces
4. **Don't copy code directly** — Even though it claims clean-room status, lifting code carries reputational risk given the controversy

### 🔍 WATCH
1. **Licensing clarity** — If they adopt a permissive license (MIT/Apache), some components could be safely referenced
2. **Plugin system maturity** — If their plugin/hook system matures, it could inform our own extensibility story
3. **Community ecosystem** — 127K stars means a large community. Tooling and plugins built on top could be valuable

---

## 7. Bottom Line

**Claw Code is interesting as a reference architecture but provides minimal direct value to Automation OS today.**

Our platform already has more mature versions of everything claw-code implements. The main value is as a **learning resource** — studying how they've structured the agent harness, tool registry, and command framework. The legal ambiguity and incomplete state make it unsuitable as a dependency or fork target.

**Recommended action:** Bookmark it, review their tool specs and command patterns for design inspiration, and revisit in 3-6 months when maturity and legal status are clearer.
