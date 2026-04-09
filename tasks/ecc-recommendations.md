# ECC Repo Recommendations — For/Against Assessment

Source: `affaan-m/everything-claude-code` (MIT licensed)
Assessed against: current codebase state as of 2026-04-09 (post sprint 3-5 merge)

## Current Setup

- **6 agents**: architect, dual-reviewer, feature-coordinator, pr-reviewer, spec-reviewer, triage-agent
- **2 hooks**: arch-guard.sh (architecture verification on server file edits), long-doc-guard.js (blocks large doc writes)
- **1 settings hook**: PR quality gate (runs lint/typecheck/tests on `gh pr create`)
- **32 verify scripts** + `run-all-gates.sh` (static gate infrastructure)
- **20 test files** (~4200 lines) following pure helper convention
- **No skills directory** in `.claude/` (server/skills/ exists for agent runtime skills)

---

## Recommendation 1: `agents/silent-failure-hunter.md`

**What it is:** Single-file agent (~70 lines) that hunts empty catch blocks, `.catch(() => [])`, swallowed promises, log-and-forget patterns, lost stack traces. Model-agnostic, zero dependencies.

**Case FOR implementing now:**
- This is the one bug class none of your 32 verify scripts, 20 test files, or 6 agents currently detect. Empty catches and swallowed promises cause the exact production bugs that are hardest to diagnose — "the dashboard is empty for one customer but the logs show no errors."
- Your codebase has 117 service files now. With the middleware pipeline expansion (critiqueGate, reflectionLoop, confidenceEscape, etc.), there's more async surface area than ever for silent failures to hide.
- Single file drop-in. 15 minutes to copy and adapt. Zero maintenance burden.
- Pairs naturally with your existing pr-reviewer chain — invoke as a second pass on Significant tasks.

**Case AGAINST implementing now:**
- You could achieve 80% of this with a targeted ESLint rule (`no-empty` + `@typescript-eslint/no-floating-promises`) added to your lint config. Cheaper, automated, catches issues at write-time rather than review-time.
- Adding a 7th agent increases cognitive load on the task classification decision ("do I also run silent-failure-hunter on this?").
- The codebase posture is "static-gates-over-runtime-tests" — a verify script that greps for empty catches/swallowed promises would be more consistent with the existing quality model than another agent.

**Verdict:** Implement as a **verify script** instead of an agent. Write `verify-no-silent-failures.sh` that greps for `catch {}`, `catch (_)`, `.catch(() =>`, and `console.error` without rethrow. Add it to `run-all-gates.sh`. This gets 90% of the value with zero new agents and full consistency with your existing quality infrastructure.

---

## Recommendation 2: `agents/database-reviewer.md`

**What it is:** Single-file agent. Postgres/Drizzle focused — reviews for missing FK indexes, N+1 queries, connection pool issues, transaction boundary problems, RLS gaps, index strategy.

**Case FOR implementing now:**
- Your DB surface area has exploded: 97 schema files, 92 migrations, RLS on 10 tables, org-scoped DB, scope assertions, memory blocks, regression cases, security events. This is the most complex part of the system and also the part where production bugs are most expensive.
- Your existing verify scripts catch RLS policy gaps and contract compliance, but nothing catches: missing indexes on FK columns (query performance), N+1 query patterns in service files, missing transaction boundaries for multi-table writes, connection pool exhaustion risks from long-running transactions.
- The `architect` agent covers schema *design* and `pr-reviewer` covers general correctness, but neither has Postgres-specific depth. This fills a genuine gap.
- Single file, zero dependencies. Pair with `architect` for schema change reviews.

**Case AGAINST implementing now:**
- Your `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` already cover the highest-severity DB concern (tenant isolation). The remaining gaps (missing indexes, N+1) are performance issues that won't cause data corruption or security incidents.
- N+1 and missing-index problems are better caught by production monitoring (slow query logs, pg_stat_statements) than by static review. An agent can't predict query volume or data distribution.
- You're pre-production with low data volumes. Index optimization before you have real traffic patterns is speculative.
- Adding another reviewer agent to the chain (architect → pr-reviewer → dual-reviewer → database-reviewer?) lengthens the review cycle.

**Verdict:** Useful but not urgent pre-production. The highest-severity DB concerns (RLS) are already covered by verify scripts. Consider adding this **after launch** when you have actual slow-query data to inform index decisions. If you do add it now, invoke it only on migration/schema PRs — not on every task.

---

## Recommendation 3: Config protection hook

**What it is:** A `PreToolUse` hook (Node script) that blocks the agent from editing eslint config, tsconfig, biome config, or similar tooling configuration files. Prevents the agent from "fixing" a failing check by weakening the check itself.

**Case FOR implementing now:**
- Directly enforces your existing CLAUDE.md rule: "Never skip a failing check. Never suppress warnings to make a check pass." Rules are only as good as their enforcement mechanism.
- Your 32 verify scripts are your production safety net. If Claude loosens a tsconfig `strict` flag to make typecheck pass, you might not notice for weeks — the verify scripts don't check *config drift*, only *current compliance*.
- You already have the hook infrastructure (`long-doc-guard.js` as a working `PreToolUse` example). Adding another is trivial — same pattern.
- ECC's `config-protection.js` is small and standalone once you strip the `run-with-flags` wrapper. ~30 min to port.

**Case AGAINST implementing now:**
- Your PR quality gate hook already runs lint/typecheck/tests on PR creation. If Claude weakened a config, the gate would still catch *regressions* introduced by the PR (existing violations would now pass, but new violations in the changed code would still be caught).
- You review all diffs before committing (per CLAUDE.md: "No auto-commits or auto-pushes"). Config file changes would be visible in the diff.
- The risk of Claude deliberately weakening tooling is low in practice — CLAUDE.md instructions are strong, and you're an attentive operator. This is insurance against a rare failure mode.
- Every hook adds latency to every tool call. The `PreToolUse` chain is now 2 hooks deep; a third adds ~50ms per Write/Edit call.

**Verdict:** Good insurance, low effort. Worth doing but not a blocker for production stability. Implement when you have a natural break in sprint work — half-hour task.

---

## Recommendation 4: `agents/security-reviewer.md`

**What it is:** OWASP Top 10 focused agent. Reviews for injection, auth bypass, secrets, XSS, CSRF, insecure deserialization. Runs `npm audit` + `eslint-plugin-security`. Report-only.

**Case FOR implementing now:**
- Your codebase has significant security surface: RLS (3-layer isolation), tool call security events, policy engine, webhook HMAC verification, OAuth flows, admin role bypass for maintenance jobs. A security-focused reviewer would catch gaps that general-purpose pr-reviewer misses.
- You handle untrusted input from multiple sources: GitHub webhooks (HMAC-verified), Slack webhooks, agent-generated tool calls, user form submissions, LLM outputs (parsed via Zod). Each is an injection vector.
- The `proposeActionMiddleware` + `tool_call_security_events` infrastructure shows security is already a priority. A security reviewer agent would be the human-readable complement to the automated pipeline.
- Multi-tenant SaaS with RLS — a single tenant isolation bug is an existential risk. More eyes on security paths is always better.

**Case AGAINST implementing now:**
- Your three-layer RLS contract + 2 RLS verify scripts + scope assertions already cover the highest-severity security concern (data isolation). These are automated and run on every CI pass — more reliable than a review-time agent.
- `npm audit` and `eslint-plugin-security` can be added to your existing `npm run lint` pipeline directly — no agent needed.
- The `pr-reviewer` already reviews for security issues as part of general code review. A dedicated security agent is incremental, not transformational.
- Security review agents tend to produce a lot of false positives ("this could theoretically be an injection if...") which slow down the review cycle without improving real security.
- Pre-production with no live users means the attack surface is currently zero. Production security hardening can happen closer to launch.

**Verdict:** Defer until closer to production launch. The automated RLS infrastructure already covers your highest-risk concern. When you do add it, invoke only on routes/, middleware/, and auth-related service changes — not every PR.

---

## Recommendation 5: `agents/typescript-reviewer.md`

**What it is:** Single-file agent. TypeScript type-safety focused. Auto-detects PR base, runs project's `typecheck` + eslint, detects merge-readiness, reports without refactoring.

**Case FOR implementing now:**
- TypeScript strictness issues (unchecked `any`, unsafe casts, missing null checks) are a category of bug that typecheck passes but still causes runtime failures. Your 32 verify scripts don't catch type-quality issues beyond "does it compile?"
- With 117 service files and the complex middleware pipeline, type-level bugs (wrong generic parameter, unsafe assertion, missing discriminated union check) are increasingly likely.

**Case AGAINST implementing now:**
- Your PR quality gate hook already runs `npm run typecheck`. Your `npm run lint` config already catches many type issues. `pr-reviewer` + `dual-reviewer` already review code quality including types.
- This is the most marginal of the agent recommendations — it duplicates work your existing 3-agent review chain already does. The delta between "general code reviewer that checks types" and "typescript-specific reviewer" is small.
- Your CLAUDE.md verification table already mandates `npm run typecheck` on every TypeScript change with 3 auto-fix attempts. The enforcement is already there.

**Verdict:** Skip. Your existing infrastructure (typecheck in CI, PR quality gate, pr-reviewer, dual-reviewer) already covers this. Adding a TS-specific agent is redundant.

---

## Recommendation 6: AgentShield (ecc-agentshield)

**What it is:** Standalone npm CLI (`npx ecc-agentshield scan`) that lints `.claude/` configuration against 102 rules. Checks for: hardcoded secrets, overly permissive allowlists, prompt injection patterns in CLAUDE.md, risky MCP servers, command injection in hook definitions, unrestricted tool access in agent definitions. Has `--fix` mode and a GitHub Action.

**Case FOR implementing now:**
- Your `.claude/` directory is growing: 6 agents, 2 hooks, settings.json. Each new file is a configuration surface that could introduce security issues (e.g., a hook that runs arbitrary shell commands, an agent with overly broad tool access).
- Zero integration cost — just `npx ecc-agentshield scan`. Could be added to `run-all-gates.sh` in one line.
- The `--fix` mode auto-replaces hardcoded secrets with env var references and tightens wildcard permissions. Useful as a one-time audit even if you don't keep it permanently.

**Case AGAINST implementing now:**
- Your `.claude/` is 8 files. Running a 102-rule scanner against 8 files is massive overkill. The rules were designed for repos with 50+ agents and complex hook chains.
- You manually review every file in `.claude/` — this is not a sprawling configuration that's easy to lose track of.
- Adds a dependency on an external npm package that may not be actively maintained (it's from a hackathon project). Your existing verify scripts are self-contained bash scripts with no external dependencies.
- The value proposition grows as your `.claude/` grows. At current size, reading the 8 files yourself takes 5 minutes.

**Verdict:** Skip for now. Revisit when `.claude/` exceeds ~20 files and you start losing track of what's in each one. Run it once manually as a sanity check if you're curious (`npx ecc-agentshield scan`), but don't add it to CI.

---

## Recommendation 7: TDD guide + TDD workflow skill

**What it is:** Agent (`tdd-guide.md`) that enforces Red-Green-Refactor with 80% coverage gate, plus a skill directory (`skills/tdd-workflow/`) with the workflow definition. Has `Bash` tool access so it runs tests itself.

**Case FOR implementing now:**
- Pure helper tests are a first-class pattern (`*Pure.ts` + `*.test.ts`). A TDD workflow could accelerate writing these.
- You have 20 test files now — establishing good testing discipline early sets the foundation.

**Case AGAINST implementing now:**
- **Your project explicitly rejects TDD as a posture.** The `spec-reviewer.md` baked-in framing says: "rapid evolution means light testing" and "static-gates-over-runtime-tests posture." Codex suggestions to add tests are classified as "almost always wrong for this stage."
- The testing approach is deliberate: pure-function unit tests for decision logic, static verify scripts for everything else, zero frontend/E2E. Introducing TDD contradicts a conscious architectural decision.
- TDD is a workflow change, not a tool install. Introducing a new methodology mid-sprint-to-launch adds cognitive overhead with no immediate payoff.
- The 80% coverage gate would fail immediately against your current codebase and become noise rather than signal.

**Verdict:** Do not implement. Actively contradicts your project's testing posture. If you revisit your testing strategy post-production, reconsider then.

---

## Recommendation 8: Accumulator + Stop pattern for arch-guard.sh

**What it is:** Instead of running verification after every Edit, accumulate touched files during the response and run all checks once at the `Stop` lifecycle event. ECC implements this as `post:edit:accumulator` + `stop:format-typecheck` — two hooks that work together.

**Case FOR implementing now:**
- `arch-guard.sh` currently runs 3-5 verify scripts on every server file edit. In a multi-file session touching 10+ files, that's 30-50 script invocations that each add ~1-3 seconds. Batching to a single run at Stop could save 30-90 seconds per session.
- The pattern is architecturally clean: record what changed (cheap), verify once (thorough).
- Your PR quality gate hook already demonstrates the "batch at a lifecycle event" pattern — this extends it to edit-time verification.

**Case AGAINST implementing now:**
- `arch-guard.sh` is scoped and fast — it only runs when route/service files are edited, and only the relevant subset of scripts. The actual latency impact is small for most sessions.
- The ECC implementation is coupled to `${CLAUDE_PLUGIN_ROOT}` and the `run-with-flags.js` wrapper. You'd need to rewrite it, not copy it.
- `Stop` hooks are less well-tested than `PreToolUse`/`PostToolUse` in Claude Code. Edge cases (session crash, manual abort) might skip the Stop phase, leaving verification unrun.
- Current arch-guard.sh gives immediate feedback — "this route file is missing asyncHandler" right after the edit. Batching to Stop delays that feedback, which could mean more wasted work before catching the issue.

**Verdict:** The immediate-feedback tradeoff makes this a wash. Your current approach is fine. If edit-time latency becomes noticeable in practice, revisit — but don't pre-optimise.

---

## Recommendation 9: Database migrations skill

**What it is:** ECC's `skills/database-migrations/SKILL.md` — a workflow definition covering Drizzle (plus Prisma/Kysely/Django/TypeORM) migration patterns: naming conventions, up/down scripts, testing strategy, rollback procedures.

**Case FOR implementing now:**
- You've shipped 15 migrations in the recent sprint (0078–0090). Migration velocity is high and likely to continue.
- Your custom migration runner (`scripts/migrate.ts`) has specific conventions (forward-only, down-migrations in `_down/`, no drizzle-kit). A skill capturing these conventions would prevent Claude from suggesting drizzle-kit patterns.
- Architecture.md documents migration conventions, but a skill is more targeted — it's surfaced exactly when Claude is about to create a migration.

**Case AGAINST implementing now:**
- Your migration conventions are already documented in `architecture.md` (Migrations section) and enforced by `verify-schema-compliance.sh`. Claude reads `architecture.md` before making backend changes per CLAUDE.md instruction.
- Adding a `.claude/skills/` directory is a structural change (see Recommendation 10). You'd be adopting a new organisational pattern for a single skill.
- The ECC skill covers 5 ORMs. You only use Drizzle. 80% of the content would be irrelevant noise.
- You haven't had migration quality issues that would justify adding another layer of instruction.

**Verdict:** Skip. Your architecture.md documentation + verify scripts already cover this. If you adopt `.claude/skills/` generally (Recommendation 10), then extracting migration conventions into a skill makes sense as part of that broader effort.

---

## Recommendation 10: Skills directory adoption (.claude/skills/)

**What it is:** Adopting the `.claude/skills/` directory structure as a general pattern for Claude Code workflow knowledge. Skills are invokable via `/skill-name` and provide contextual instructions (e.g., `/security-scan`, `/tdd`, `/api-design`).

**Case FOR implementing now:**
- Your CLAUDE.md already has a "Skills = System Layer" section (Section 7) describing skills as "modular systems the agent can explore and execute." The philosophy is documented but not implemented.
- Skills decouple workflow knowledge from the monolithic CLAUDE.md. As CLAUDE.md grows, finding the right instruction gets harder for Claude. Skills provide progressive disclosure — loaded only when relevant.
- ECC's best skills (security-scan, context-budget, api-design, architecture-decision-records) are genuinely useful workflow definitions that would reduce the "Claude reinvents the wheel" problem.
- The infrastructure already exists in Claude Code — `.claude/skills/` is a first-class directory. No custom tooling needed.

**Case AGAINST implementing now:**
- You don't have a skills problem yet. Your workflow knowledge lives in CLAUDE.md, architecture.md, and KNOWLEDGE.md — three files that Claude reads at session start. This works.
- Adopting skills is a structural change that needs ongoing maintenance. Every new skill needs to be kept in sync with code changes (per your rule #10: "Docs Stay In Sync With Code"). More files = more sync burden.
- Skills are most valuable for multi-person teams where different developers need different workflow contexts. As a solo developer, you already know which context to provide.
- The ECC skills are designed for their multi-tool harness (Claude Code + Cursor + Codex). Many include cross-tool compatibility shims that add noise.
- Premature structure is worse than no structure. Wait until you have 3+ workflow patterns that don't fit in CLAUDE.md before creating a skills directory.

**Verdict:** Defer until post-production. When your CLAUDE.md exceeds ~500 lines or you onboard additional developers, skills become valuable. For now, CLAUDE.md + architecture.md is the right level of structure.

---

## Summary Matrix

| # | Recommendation | Priority | Effort | Verdict |
|---|---------------|----------|--------|---------|
| 1 | Silent failure hunter | **High** | Low | Implement as a **verify script** (`verify-no-silent-failures.sh`) instead of an agent. Most consistent with existing quality model. |
| 2 | Database reviewer agent | Medium | Low | Defer until post-launch. RLS verify scripts cover highest-severity concern. Index/N+1 issues need real traffic data. |
| 3 | Config protection hook | Medium | Low | Worth doing at next natural break. Good insurance, 30-min task. Not blocking for production. |
| 4 | Security reviewer agent | Medium | Low | Defer until closer to production launch. RLS infra covers primary concern. |
| 5 | TypeScript reviewer agent | Low | Low | Skip. Redundant with existing review chain + typecheck CI. |
| 6 | AgentShield | Low | Trivial | Skip. Overkill for 8 config files. Run manually once if curious. |
| 7 | TDD guide + workflow | **Do Not** | Medium | Actively contradicts project's testing posture. Do not implement. |
| 8 | Accumulator + Stop pattern | Low | Medium | Current arch-guard.sh is fine. Immediate feedback > batched verification. |
| 9 | Database migrations skill | Low | Low | Skip. Already documented in architecture.md + enforced by verify scripts. |
| 10 | Skills directory | Low | Ongoing | Defer until post-production. Current CLAUDE.md structure is sufficient. |

### Bottom line

**One thing worth doing now:** Write `verify-no-silent-failures.sh` and add it to `run-all-gates.sh`. This is the only gap in your current quality infrastructure that the ECC repo revealed — and the right implementation is a verify script, not an agent.

**Everything else is either covered by your existing infrastructure, contradicts your project posture, or is a post-production concern.** Your current setup (6 agents, 32 verify scripts, 3-layer RLS, pure helper convention, PR quality gate) is more mature than most production codebases. Don't fix what isn't broken.
