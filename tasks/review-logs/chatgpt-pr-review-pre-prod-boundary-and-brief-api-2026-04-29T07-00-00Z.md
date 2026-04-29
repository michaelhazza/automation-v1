# ChatGPT PR Review Session — pre-prod-boundary-and-brief-api — 2026-04-29T07-00-00Z

## Session Info
- Branch: pre-prod-boundary-and-brief-api
- PR: #234 — https://github.com/michaelhazza/automation-v1/pull/234
- Mode: manual
- Started: 2026-04-29T07:00:00Z

---

## Round 1 — 2026-04-29T07:30:00Z

### ChatGPT Feedback (raw)
🔴 Blockers: (1) Duplicate brief_created response shapes; (2) Rate limiter uses Date.now() for Retry-After — violates DB-canonical clock invariant; (3) Login rate limit runs before validateBody; (4) File upload: file.buffer + createReadStream both set. 🟠 High-risk: (5) Rate limit buckets PK missing windowSec; (6) Rate limiter increments on deny — must document. 🟡 Medium: (7) Cleanup job silent backlog risk; (8) Middleware cleanup timing race; (9) Rate limit logic duplicated across routes; (10) Missing rate limit on some routes; (11) Logging asymmetry. Verdict: CHANGES_REQUESTED.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: Duplicate brief_created response shapes | technical | reject | auto (reject) | high | False positive — SessionMessageResponse already uses single `{ type: 'brief_created' } & BriefCreationEnvelope` arm; ChatGPT read a transitional diff state |
| F2: Date.now() for Retry-After vs DB now_epoch | technical | implement | user (implement) | high | Contradicts spec §6.2.3 "DB is canonical clock" invariant; fix: add nowEpochMs to RateLimitCheckResult and thread through all callers — escalated (high severity) |
| F3: Login rate limit before validateBody | technical | reject | auto (reject) | high | False positive — validateBody(loginBody) is Express middleware in the route chain, runs before asyncHandler; email is validated before String(email) reaches rate limit key |
| F4: file.buffer + createReadStream coexist | technical | reject | auto (reject) | medium | False positive — file.buffer already removed in this PR; fileService.ts line 38 has only createReadStream; ChatGPT saw the `-` (deleted) line in the diff |
| F5: Rate limit bucket PK missing windowSec | technical | defer | user (defer) | high | Already tracked in tasks/todo.md from spec-review; architectural decision (key encoding vs PK change) — escalated (architectural + defer) |
| F6: Rate limiter increments on deny — undocumented | technical | defer | user (defer) | medium | Design is intentional; add jsdoc note to check(); escalated (defer) |
| F7: Cleanup job silent backlog | technical | defer | user (defer) | medium | log event exists; alerting is an ops concern for a follow-up; escalated (defer) |
| F8: Middleware cleanup timing race | technical | defer | user (defer) | low | Very low probability; defer to follow-up; escalated (defer) |
| F9: Rate limit check duplicated across routes | technical | defer | user (defer) | medium | Valid refactor but out of scope; escalated (defer) |
| F10: Missing rate limit on some routes | technical | defer | user (defer) | low | Consistency gap, not this PR's scope; escalated (defer) |
| F11: Logging asymmetry | technical | defer | user (defer) | low | Acknowledged future consideration; escalated (defer) |

### Implemented
- [user] Added `nowEpochMs: number` to `RateLimitCheckResult`; updated `getRetryAfterSeconds` and `setRateLimitDeniedHeaders` to accept DB-canonical `nowMs` arg; updated all 9 call sites across 7 route files to pass `limitResult.nowEpochMs`

---
