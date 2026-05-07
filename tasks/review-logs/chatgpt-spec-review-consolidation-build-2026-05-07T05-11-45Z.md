# ChatGPT Spec Review Session — consolidation-build — 2026-05-07T05-11-45Z

## Session Info
- Spec: tasks/builds/consolidation-build/spec.md
- Branch: claude/learn-harbour-ui-B4k7a
- PR: #268 — https://github.com/michaelhazza/automation-v1/pull/268
- Mode: manual
- Started: 2026-05-07T05:11:45Z
- **Verdict:** APPROVED (2 rounds)

---

## Round 1 — 2026-05-07T05:11:45Z

### ChatGPT Feedback (raw)

Executive summary: Strong, well-scoped build spec. No blockers. 6 high-value refinements before plan/build phase.

Finding 1 — Agent edit API: ETag contract needs to be explicit and consistent. No definition of how ETag is generated, where it lives (header vs body), or whether tab-level PATCH shares the same ETag. Proposed: etag: string // sha256 of canonical JSON in GET /full response; ETag global per agent; all PATCH/PUT must require If-Match; server rejects mismatch → 409, returns new ETag after write.

Finding 2 — Skills & Data Sources: full replacement semantics need safeguards. PUT /skills and PUT /data-sources risk wiping all bindings on UI bug or partial payload. Proposed: full-replacement endpoints MUST reject payloads missing previously persisted items unless force=true is explicitly passed.

Finding 3 — Recurring tasks aggregator: define deterministic source precedence. "union over triggers, heartbeats, and manual runs" doesn't define overlap behaviour. Proposed precedence: agent_triggers > heartbeat-derived > manual (always independent). Tasks uniquely identified by (agentId + triggerId OR runId). No cross-source deduplication.

Finding 4 — Agent test endpoint: clarify execution model (sync vs async). AgentTestResponse includes durationMs, resultPreview, traceUrl (completion-only fields) but §6 says 202 + poll. Conflict. Proposed: strict async — POST → 202 { runId, status: "running" }; full result from GET /api/agent-runs/:runId.

Finding 5 — Agents list: metrics fields need source definition. runs30d and cost30d have no source service or consistency guarantee. Proposed: sourced from agent_runs aggregation, eventually consistent, may lag up to 60 seconds.

Finding 6 — Recurring task fireCondition: formalise formatting contract. No rules for determinism, timezone, or max length. Proposed rules: UTC, deterministic for identical trigger specs, no localisation (Phase 1), max 80 chars.

Minor A — Agent version chip fallback: if no revisions exist → display v1.
Minor B — Search behaviour: q is case-insensitive, partial match, no stemming.
Minor C — Confirmation dialogs: all destructive dialogs must be non-blocking async (no UI freeze during API call).

Overall verdict: APPROVED — READY FOR PLAN PHASE

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: ETag generation mechanism + placement + global-per-agent rule | technical | apply | auto (apply) | medium | Missing internal contract — implementers need to know sha256 method and that ETag is agent-global, not tab-scoped |
| F2: force=true safeguard on PUT /skills and PUT /data-sources | technical (escalated — high severity) | apply | apply (user: as recommended) | high | Changes API contract; escalated per high-severity rule |
| F3: Recurring tasks source precedence rule | technical | apply | auto (apply) | medium | Missing contract for the aggregator's deduplication/precedence logic |
| F4: Agent test endpoint — resolve sync/async contradiction | technical (escalated — high severity) | apply | apply (user: as recommended) | high | Internal contradiction between §4.3 and §6; escalated per high-severity rule |
| F5: runs30d / cost30d source + eventual-consistency note | technical | apply | auto (apply) | low | Prevents implementer confusion; internal consistency note |
| F6: fireCondition formatting contract (UTC, determinism, max 80 chars) | technical | apply | auto (apply) | low | Tightens the pure-function contract for formatFireCondition() |
| MinorA: Agent version chip fallback — v1 when no revisions | technical | apply | auto (apply) | low | Plugs an edge-case gap in §4.10 |
| MinorB: Search q semantics — case-insensitive, partial match, no stemming | technical | apply | auto (apply) | low | Prevents ambiguous implementation choices |
| MinorC: Confirmation dialogs must be non-blocking async | user-facing | apply | apply (user: as recommended) | medium | Describes visible UX behaviour — user approved |

### Applied (auto-applied technical)
- [auto] F1: Added etag field to AgentFull interface; clarified ETag is global per agent; added If-Match requirement to all PATCH/PUT endpoints; specified sha256 of canonical JSON generation
- [auto] F3: Added source precedence rule to §4.4 recurring tasks section
- [auto] F5: Added source + eventual-consistency note to §4.1 AgentListItem
- [auto] F6: Added formatting rules to §4.9 fireCondition
- [auto] MinorA: Added v1 fallback to §4.10
- [auto] MinorB: Added q semantics note to §4.8
- [user] F2: Added force=true safeguard to §4.2 full-replacement endpoints
- [user] F4: Split AgentTestResponse into AgentTestAccepted (202) and AgentTestResult (polled); strict async model
- [user] MinorC: Added non-blocking async requirement to §4.11 confirmation dialogs

---

## Round 2 — 2026-05-07T05:35:00Z

### ChatGPT Feedback (raw)

Executive summary: Clean, production-ready spec. Round 1 fixes landed well. No blockers. 4 final micro-tightenings.

Finding 1 — ETag canonicalisation: "canonical JSON (stable key order)" still ambiguous. Rules needed: keys sorted lexicographically at every level, undefined omitted, arrays preserved in order, numbers normalised, booleans/null preserved, UTF-8 before hashing.

Finding 2 — Full-replacement safeguard identity keys: comparison criteria not defined. Identity keys: skill.id, dataSource.id, trigger.id. Deletion = set difference (existing IDs − incoming IDs).

Finding 3 — Recurring tasks cursor pagination stability: no ordering guarantee. Default sort (nextFireAt DESC, id DESC); cursor encodes both; all queries must include id as tiebreaker.

Finding 4 — Agent test idempotency key scope: no scope definition. Scope: (agentId, workspaceContextId); reuse within 24h returns same run; after expiry = new request. Server MAY enforce TTL eviction.

Minor A — Agents list parentAgentName null handling: fallback "Unknown agent" if parentAgentId != null and name unavailable.
Minor B — nextFireAt null semantics: null for event-driven triggers and manual-only tasks.
Minor C — Project PATCH partial null handling: explicit null clears field; omitted = no change.
Minor D — Test runner UX: disable Run test button while request in-flight for same idempotencyKey.

Overall verdict: DONE — LOCK SPEC

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: ETag canonicalisation rules (key sort, undefined omit, array order, number normalisation, UTF-8) | technical | apply | auto (apply) | medium | Prevents ghost 409s from inconsistent serialisation across environments |
| F2: Identity keys for full-replacement deletion detection (skill.id, dataSource.id, trigger.id) | technical | apply | auto (apply) | medium | Prevents ambiguity when configJson changes but ID unchanged; avoids accidental rejection |
| F3: Recurring tasks pagination stability (default sort, id tiebreaker, cursor encodes both) | technical | apply | auto (apply) | medium | Prevents duplicate/missing rows across pages |
| F4: Idempotency key scope (agentId+workspaceContextId, 24h TTL, expiry = new request) | technical | apply | auto (apply) | medium | Prevents cross-context reuse; defines lifecycle for ops |
| MinorA: parentAgentName null fallback "Unknown agent" | technical | apply | auto (apply) | low | Plugs edge case in AgentListItem |
| MinorB: nextFireAt null semantics (event-driven and manual tasks) | technical | apply | auto (apply) | low | Prevents implementer confusion on null meaning |
| MinorC: Project PATCH null = clear, omit = no-op | technical | apply | auto (apply) | low | Standard PATCH semantics; prevents ambiguity |
| MinorD: Disable Run test button while in-flight | user-facing | apply | apply (user: as recommended) | low | Visible UX behaviour; prevents duplicate submissions before TTL kicks in |

### Applied (auto-applied technical + user-approved user-facing)
- [auto] F1: ETag canonicalisation rules added to §4.2
- [auto] F2: Identity keys (skill.id, dataSource.id, trigger.id) added to full-replacement safeguard in §4.2; configJson-only updates clarified as non-deletions
- [auto] F3: Pagination stability invariant (default sort + id tiebreaker + cursor encoding) added to §4.4
- [auto] F4: Idempotency key scope + 24h TTL + expiry semantics added to §4.3
- [auto] MinorA: parentAgentName null fallback comment added to AgentListItem §4.1
- [auto] MinorB: nextFireAt null semantics comment added to RecurringTask §4.4
- [auto] MinorC: PATCH null/omit semantics added to §4.5
- [user] MinorD: In-flight button guard added to §4.7
- [integrity] Fixed Round 1 formatting artifact — budget PATCH list item restored to correct position in §4.2

Top themes: contract precision (ETag, pagination, idempotency), edge-case coverage (null semantics, fallbacks), UX correctness (in-flight guard).

---

## Final Summary
- **Verdict:** APPROVED (2 rounds)
- Rounds: 2
- Auto-accepted (technical): 13 applied | 0 rejected | 0 deferred
- User-decided: 4 applied | 0 rejected | 0 deferred
- Index write failures: 0
- Deferred to tasks/todo.md § Spec Review deferred items / consolidation-build: none
- KNOWLEDGE.md updated: no (no novel reusable patterns surfaced beyond existing ETag/idempotency conventions)
- architecture.md updated: n/a (no cross-spec contract changes)
- capabilities.md updated: n/a
- integration-reference.md updated: n/a
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a
- spec-context.md updated: n/a
- frontend-design-principles.md updated: n/a
- PR: #268 — https://github.com/michaelhazza/automation-v1/pull/268
