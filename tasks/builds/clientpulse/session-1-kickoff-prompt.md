# Session 1 Kickoff Prompt — paste this into a fresh Claude Code session

Copy the block below into a new session to start building Session 1. Everything the new session needs is linked — no context transfer from this thread required.

---

## START OF KICKOFF PROMPT

I'm starting ClientPulse Session 1 — platform foundation + settings UIs + operator onboarding wizard.

**Status: spec approved + locked. Start by invoking the architect to produce the implementation plan.** The external reviewer confirmed architect-ready after the precision-gap round:

> "Ready for architect pass. The only residual caution is implementation discipline: the architect plan should preserve the same contract language verbatim, not reinterpret it. The task breakdown should group work by invariant boundaries, not by UI screen. Tests should be mapped directly to contracts (m)–(v) and §1.6 invariants, otherwise some of this rigor will get diluted during build."

Those three guardrails bind the architect pass.

## Read these first (in order)

1. `tasks/builds/clientpulse/session-1-foundation-spec.md` — **the spec.** 1448 lines, fully locked. §1.3 contracts (a)–(v), §1.4 decision/execution layering, §1.5 InterventionEnvelope type, §1.6 lifecycle invariants. Every decision made, every open question resolved, every deferral logged. Do not re-open any resolved decision without explicit user authorisation.
2. `tasks/builds/clientpulse/session-2-brief.md` — brief for the next session (Phase 6 + 8). Do NOT build anything from this brief in Session 1; it exists to scope Session 1's deferrals and to seed the next session. Reference it only when a feature shows up in Session 1 code that actually belongs in Session 2.
3. `architecture.md` §"ClientPulse Intervention Pipeline (Phases 4 + 4.5)" — current state of the system Session 1 builds on.
4. `CLAUDE.md` — non-negotiable project rules.
5. `tasks/builds/clientpulse/progress.md` — history of what shipped through Phase 4/4.5.

## Review artifacts (for context, not instruction)

- Spec-reviewer loop artifacts: `tasks/spec-review-*session-1-foundation*.md` (5/5 lifetime cap reached; final checkpoint captures the 3 directional findings already applied).
- External review rounds: all closed, all findings applied, no residuals.

## Branch

Create a new branch off `main`: `claude/clientpulse-session-1-<suffix>`. Do NOT reuse the `claude/clientpulse-phase-4-docs-sync` branch — that's the spec + docs branch, now merged to main.

## Work sequence (per §8 of the spec — 8 chunks)

1. **Architect pass.** Invoke the `architect` agent with the spec as ground truth. Output: `tasks/builds/clientpulse/session-1-plan.md`.
2. A.1 — Data model + core renames (migrations + schema + pure tests)
3. A.2 — Config service refactor + sensitive-paths registry
4. A.3 — Generic route + UI renames
5. A.4 — Configuration Assistant popup (Option 2)
6. Phase 5 — ClientPulse Settings page + Subaccount Blueprint editor refactor
7. Phase 7 — Onboarding wizard + create-org modal
8. pr-reviewer + housekeeping

Each chunk = one commit. Sanity gates between chunks: typecheck (43-error baseline server / 10-error baseline client), pure tests, lint, `verify-integration-reference.mjs`.

## Architect-pass guardrails (non-negotiable)

From the external reviewer's final verdict:

1. **Preserve contract language verbatim.** Contracts (m) through (v) + the §1.6 invariants + the `InterventionEnvelope` type are the spec's binding surface. The architect plan references them literally — it does NOT re-word, re-number, or re-interpret. If the architect finds a contract needs revision, it surfaces that as an "open question" for the user, it does not silently rewrite.
2. **Group by invariant boundaries, not by UI screen.** The 8-chunk sequence in §8 is deliberate — each chunk maps to a coherent invariant surface (data model | slug rename | routes | popup | Settings UIs | onboarding). The architect plan's test layout reflects the same grouping. Do NOT reshape the chunks around "the Settings page" or "the onboarding wizard" — those are multi-invariant surfaces.
3. **Tests map directly to contracts + invariants.** Every new pure test file's header comment names which contract(s) + invariant(s) it exercises. Concretely:
   - `actionSlugAliasesPure.test.ts` — contract (l), contract (o)
   - `sensitiveConfigPathsRegistryPure.test.ts` — contract (n), locked registry pattern
   - `orgOperationalConfigMigrationPure.test.ts` — contract (h) [new in Session 1], data-model separation
   - `configUpdateOrganisationConfigPure.test.ts` (renamed from existing) — contracts (n), (s), (t), (u)
   - (etc. per architect plan)

## Ship gates to verify at PR-ready

From §1.2 of the spec: S1-A1 through S1-A5, S1-5.1, S1-5.2, S1-7.1, S1-7.2. Every gate has an explicit verification path (pure test / integration test / manual). All must pass before PR open.

## Reviews

- **After chunk 1 (architect pass):** optional `spec-reviewer` on `session-1-plan.md` — only if local Codex is available.
- **After chunk 4:** architect review-pass on Phase A alone (sanity check before moving to Phase 5/7).
- **After chunk 7 + before PR:** full `pr-reviewer` pass.
- **Before merge:** final `pr-reviewer` re-run if fix commits landed.
- `dual-reviewer` only if user explicitly requests + session is local.

## Out of scope for Session 1

See spec §10.7 — deferred items are documented with their eventual destination (mostly Session 2). If a deferred item shows up in the chunk work, flag it and surface — don't silently include.

## What NOT to do

- Don't re-open locked decisions in §10 (the decisions log). All open questions were resolved inline and consolidated.
- Don't re-run `spec-reviewer` on the spec file — 5/5 lifetime cap already reached. The loop will refuse.
- Don't skip the architect pass — it's load-bearing for the test-to-contract mapping.
- Don't bundle Session 2 work into Session 1 to "save a branch." The cleanup is the point.

## When you're done

The PR should include a summary that explicitly lists which of (m)–(v) + §1.6 invariants + `InterventionEnvelope` get their first implementation in Session 1. That summary becomes the auditable trail the next reviewer checks against.

## END OF KICKOFF PROMPT
