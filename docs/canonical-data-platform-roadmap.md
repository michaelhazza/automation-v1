# Canonical Data Platform — Roadmap Spec

Program-level spec that sequences six phases of work extending the canonical data layer from its current CRM-centric state (GoHighLevel, HubSpot, Slack, Stripe, Teamwork) to a fuller cross-source query surface that includes Gmail and Google Calendar, with the tenancy, principal, and query-safety primitives required to expose any of it to agents.

**This is a program spec, not an implementation spec.** It defines the end-state architecture, the phase sequencing, the cross-cutting decisions, and the contracts every phase must honour. Each phase gets its own implementation spec, written when that phase begins, which inherits the decisions documented here.

**Source of the program:** the existing canonical layer (`server/db/schema/canonical*.ts`, `server/services/canonicalDataService.ts`, `server/services/connectorPollingService.ts`) is 60% of the way to a useful cross-source query surface. The missing 40% is ingestion automation, read-path consolidation, coverage of email + calendar, a principal model capable of carrying per-user integrations safely, and a safe query surface. This spec names those gaps and orders them so each phase de-risks the next.

**Deployment context (matches `docs/spec-context.md` at time of writing):** Pre-production. No live users. Rapid evolution. Testing posture: static gates primary + pure-function unit tests. Rollout model: commit-and-revert, no feature flags. Breaking changes expected. This spec ships migrations without feature flags, writes pure helpers + `*Pure.ts` tests where logic warrants it, and adds new static gates where they catch drift in canonical or principal-context handling. None of the items below change the platform's posture.

---

## Implementation philosophy

Six rules that shape how the program is sequenced.

1. **Reuse existing primitives first.** `connectorPollingService`, `canonicalDataService`, `integrationConnections`, `config_history`, `tool_call_security_events`, `createWorker`, `withBackoff`, `TripWire`, `runCostBreaker`, `assertScope`, `policyEngineService`, `actionService.proposeAction` — all already exist and are the hook points for this program. No new parallel mechanisms where an existing one fits.

2. **Pure helpers for decision logic.** Principal-context resolution, scope-visibility predicates, ingestion filter application, dictionary rendering, and query-plan safety checks are pure functions with fixture-driven unit tests in `*Pure.ts`. Impure wrappers own the Drizzle reads/writes and external API calls.

3. **No schema changes without indices.** Every new column on a canonical table that will be queried ships with an index in the same migration. Principal-context columns (`ownerUserId`, `visibilityScope`, `sourceConnectionId`) must be indexed because every read will filter on them.

4. **Thin canonical for email, full canonical for calendar.** Email bodies and attachments are never persisted. Email canonical rows store metadata + entity links + cheap AI classifications only. Calendar events are stored in full (title, description, attendees, location, status). Rationale in D7.

5. **Privacy-by-default, principal-scoped by default, per-principal partitioned where indexed.** Every new connection defaults to private ownership. Every canonical read resolves against a principal context. Any vector index over user data is physically partitioned per principal. Rationale in D2, D3, D6.

6. **Phase N does not start until Phase N-1 has landed its static gates and documented its contracts.** In a pre-production, commit-and-revert project, "soak time" is not a gate. Gates are: code merged, static gates + pure tests green, `pr-reviewer` + `dual-reviewer` passed, docs updated in the same commit, cross-cutting contracts documented in this spec's appendix.

---

## Execution model

This spec inherits the at-least-once / idempotent-handlers contract from `docs/improvements-roadmap-spec.md` and `docs/run-continuity-and-workspace-health-spec.md`. It also inherits the **three-layer fail-closed isolation** model already shipped under improvements-roadmap §P1.1: Layer A = ALS-driven `withOrgTx` / `getOrgScopedDb` request scoping (`server/middleware/orgScoping.ts`, `server/instrumentation.ts`); Layer B = Postgres RLS default-deny via `app.organisation_id` session variable (manifest in `server/config/rlsProtectedTables.ts`, gates `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh`); Layer C = explicit `withAdminConnection` bypass via `admin_role`. P3 extends this model with principal-scoped predicates rather than introducing it from scratch. No new rules at the program level. Phase-specific async work (scheduled polling registration, backfill jobs, ingestion filter application) is defined in each phase's section and must be idempotent by design.

New async work introduced by this program:

- **P1**: scheduled connector polling via `pg-boss` cron jobs. Handler is idempotent — `connectorPollingService.syncConnector` already upserts by `externalId`.
- **P4**: Gmail ingestion worker (metadata + classification). Handler idempotent via `(sourceConnectionId, providerMessageId)` unique constraint.
- **P5**: Calendar ingestion worker. Same idempotency key pattern.
- **P6**: NL→SQL query planner is synchronous per agent call; no new background workers.

---

## Verdict legend

Each phase carries exactly one verdict from the following set.

| Verdict | Meaning |
|---------|---------|
| **BUILD** | Ship in this program. Not gated on any other phase. |
| **BUILD AFTER P<N>** | Ship in this program but only after the named phase has landed. Dependency is named explicitly. |
| **DEFER** | Named and described, but not in scope for this program. Rationale required. |

No phase is gated on external approval, feature flags, or staged rollout. The project is pre-production.

---

## Table of contents

1. [Context and end-state vision](#context-and-end-state-vision)
2. [Architectural decisions (D1–D10)](#architectural-decisions-d1d10)
3. [Principal model](#principal-model)
4. [Canonical data model conventions](#canonical-data-model-conventions)
5. [P1 — Scheduled polling + stale-connector health detector](#p1--scheduled-polling--stale-connector-health-detector)
6. [P2 — Canonical consolidation + data dictionary](#p2--canonical-consolidation--data-dictionary)
7. [P3 — Principal model and tenancy hardening](#p3--principal-model-and-tenancy-hardening)
8. [P4 — Gmail adapter (thin canonical)](#p4--gmail-adapter-thin-canonical)
9. [P5 — Google Calendar adapter (full canonical)](#p5--google-calendar-adapter-full-canonical)
10. [P6 — NL→SQL query surface](#p6--nlsql-query-surface)
11. [Cross-cutting contracts and invariants](#cross-cutting-contracts-and-invariants)
12. [Static gates added by this program](#static-gates-added-by-this-program)
13. [Deferred items with rationale](#deferred-items-with-rationale)
14. [Open questions not yet decided](#open-questions-not-yet-decided)
15. [Glossary](#glossary)
16. [Appendix: Phase entry/exit criteria](#appendix-phase-entryexit-criteria)

---

## Context and end-state vision

### What we have today

The canonical layer exists and is in productive use:

- **Canonical entity tables**: `canonical_accounts`, `canonical_contacts`, `canonical_opportunities`, `canonical_conversations`, `canonical_revenue`, `canonical_metrics`, `canonical_metric_history`, `health_snapshots`, `anomaly_events`. Each carries `organisationId` and optional `subaccountId`.
- **Five connector adapters**: GoHighLevel (OAuth2 + webhook), HubSpot (OAuth2), Slack (OAuth2), Stripe (API key), Teamwork (OAuth2 + webhook). All write through normalised adapter functions into the canonical tables.
- **Ingestion pattern**: webhooks (real-time, where provider supports), `connectorPollingService.syncConnector` for backfill/refresh, and ad-hoc skill-level reads that hit provider APIs directly.
- **Governance primitives**: encrypted credential storage (`connectionTokenService`, AES-256-GCM, claimed-at + expires-in rotation), per-org/subaccount scoping, immutable `config_history`, hashed-args audit log (`tool_call_security_events`), per-org retention windows for runs and security events.
- **Single read service**: `canonicalDataService` is the declared read interface for agents, but is not yet the only read path — several skills still hit provider APIs directly.

### What is missing

1. **Automated ingestion.** Polling is operator-triggered. A connector that is never manually synced goes stale silently. No health detector flags it.
2. **Read-path consistency.** `read_crm`, `read_inbox`, `read_campaigns` skills hit external APIs directly, bypassing the canonical layer. This means canonical history is incomplete, rate-limit pressure is higher, and there is no single audit surface.
3. **Coverage.** Email, calendar, meeting transcripts, and Monday-style task systems are not modelled canonically. The product's agency → client relationship intelligence loop is half-blind.
4. **Principal model.** Every existing integration is org-owned or subaccount-owned. There is no concept of a user-owned connection, no concept of a service principal distinct from a user, and no concept of a delegated principal. This works for CRM data (GHL is a shared agency asset) but breaks the moment we introduce per-user Gmail/Calendar.
5. **Tenancy enforcement.** Isolation is service-layer only. No Postgres RLS. A service-layer bug can cross-tenant-leak.
6. **Query surface for agents.** Agents can only invoke pre-built skills. Ad-hoc reasoning across canonical data ("which accounts have declining revenue and no email activity in the last 14 days?") requires a developer to build a new skill each time.

### End-state vision (what this program delivers)

When all six phases have landed:

- **Every connector polls on a schedule**, registered in `pg-boss` cron. Stale connectors surface as a workspace health finding. Operator intervention is the exception, not the default.
- **Every skill that reads third-party data reads through canonical.** Provider APIs are touched only by adapters (for ingestion) and by a narrow set of declared "live-fetch" skills (for content that is intentionally not persisted, such as email bodies).
- **A data-dictionary skill** exposes the canonical schema — tables, columns, relationships, semantic meaning, freshness — to agents as part of their system context. Agents know what they can query without a developer hand-authoring a skill for each question.
- **Every integration connection** carries explicit ownership scope (user/subaccount/org), visibility scope (private/shared-team/shared-subaccount/shared-org), and classification (personal/shared-mailbox/service-account).
- **Every agent run** carries a principal context. Every canonical read resolves against that context. A user principal sees their own private data plus shared data in their scope; a service principal never sees private user data; a delegated principal sees only what an explicit, time-bounded delegation grant allows.
- **Postgres RLS** enforces tenancy on canonical tables. Service-layer checks remain, but the database is the last line of defence, not the only one.
- **Gmail is ingested as thin canonical** — metadata, participants, thread IDs, labels, entity links, cheap classifications. Bodies are fetched on demand through a live-fetch skill that runs under the invoking principal's credentials, never persisted.
- **Google Calendar is ingested as full canonical** — events, attendees, times, locations, status. Calendar records are small, less sensitive, and high-signal for relationship cadence and availability.
- **An NL→SQL query-surface skill** lets agents ask questions against canonical in natural language, guarded by a principal-context-aware query planner, an allow-list of tables and columns, cost limits, and HITL approval gates for destructive or wide-scope queries.

### Anti-goals (what this program is NOT)

Named explicitly to keep scope tight.

- **Not an email archiver.** We do not store email bodies, attachments, inline images, or historical message corpora. If a customer needs compliance archiving, that is a separate product motion.
- **Not a full CRM replacement.** We canonicalise relationship and revenue data to drive agent reasoning. We do not replace GHL, HubSpot, or any other source-of-truth system.
- **Not a BI/analytics platform.** Pre-computed metrics and the NL→SQL surface serve agent reasoning. Self-serve dashboards, scheduled reports for humans, and data-warehouse-grade aggregations are separate concerns.
- **Not a domain-delegated platform.** Workspace-admin domain-wide delegation (e.g. Google Workspace admin installs on behalf of every user) is deferred past this program. See D5.
- **Not a vector-search product on day one.** Embeddings-based retrieval over canonical data is possible but not in scope for any phase in this program. See the deferred items section.
- **Not a rewrite of existing adapters.** GHL, HubSpot, Slack, Stripe, Teamwork adapters stay where they are. P2 consolidates how skills *read* canonical data, not how existing adapters *write* it.

---

## Architectural decisions (D1–D10)

Each decision below has the same shape: **Decision → Why → Implications → What this replaces or forecloses.** Every phase spec that follows inherits these as constraints. A phase spec may not contradict a decision here without first amending this document and re-running spec-review against it.

### D1 — Continue the middleware-database pattern, do not pivot to a data-lake or source-of-truth model

**Decision.** Canonical tables in Postgres remain the shape of the layer. Data flows one way: *external API → adapter (normalise) → canonical table → canonicalDataService (read interface) → agents/skills*. We do not introduce a separate data lake, warehouse, or document store for this program.

**Why.** The existing canonical layer already implements this pattern and works. The alternative — "dump raw payloads into one big bucket and let the LLM figure it out" — works for single-tenant insight products but fails the multi-tenant isolation, write-path, and action-execution requirements of an agency automation platform. We need normalised entities we can join, constrain, and mutate through, not a blob store.

**Implications.**
- Every new data source requires an adapter that normalises into canonical shape. No raw JSON tables.
- Canonical schema evolution is a first-class concern. Migrations ship with indexes in the same commit (see implementation rule 3).
- Bulk storage of high-volume unstructured content (email bodies, full Zoom transcripts, document corpora) is explicitly out of the canonical pattern. Where such content is needed, it is live-fetched through a declared skill path, not warehoused.

**What this forecloses.** We are not building a "connect everything and let Claude query the firehose" product in the style of the AI-for-Contractors video. That is a simpler single-tenant problem with different trade-offs. The program's shape is agency-client-relationship-intelligence-and-automation — a normalised, entity-joined, action-executing system, not a search-over-raw-corpus system.

### D2 — Privacy-by-default for user-owned connections

**Decision.** Any integration connection classified as `personal` (a specific user's Gmail, Google Calendar, or equivalent) defaults to `visibility: private`. Data ingested from such a connection is visible only to the owning user, to agents running under that user's principal, and to explicitly-granted delegates. Changing visibility requires an explicit UI action with a preview of who will gain access.

**Why.** Defaults determine most real-world outcomes because most users never change them. A personal mailbox contains conversations the owner has never consciously opted to share with their employer, let alone with agents serving the employer's clients. Defaulting such data to "shared with the agency" creates legal, ethical, and commercial exposure disproportionate to any convenience gained. Jurisdictions including the EU (GDPR), California (CCPA), and a growing list of others require informed, specific consent for personal-data processing.

**Implications.**
- The connection-creation UI must present ownership and visibility as explicit choices, not buried toggles. Copy must make clear what each scope means in practice.
- Revocation must be first-class: disconnecting a personal connection triggers deletion of rows where `ownerUserId = them AND sourceConnectionId = that connection` within a defined SLA (see cross-cutting contracts).
- Shared mailboxes (`sales@agency.com`, `support@agency.com`) are not subject to the private-by-default rule. They are classified as `shared-mailbox` at creation time and may default to `shared-subaccount` or `shared-org`. Classification is a first-class attribute on the connection row.
- Any agent that reads data from a personal connection does so under a principal context that proves it is allowed to. See D3 and P3.

**What this forecloses.** "Connect your team's Gmail in one click and we'll make everything visible to everyone" is not an acceptable onboarding path, even if sales asks for it. If agency operators want an easy "everyone-sees-everything" mode, they must use shared mailboxes, not aggregated personal inboxes.

### D3 — Three-principal model: user, service, delegated

**Decision.** Every agent execution carries a principal context with exactly one of three types: `user`, `service`, or `delegated`. The principal context is propagated through the agent run, the skill invocation, the canonical read, and (under D10) to the database session itself.

| Principal type | Example trigger | Data access |
|---|---|---|
| `user` | Human user manually runs an agent | That user's private data + shared-team data where the user is a member + shared-subaccount + shared-org |
| `service` | Scheduled job, webhook-triggered automation, system-maintenance run with no human actor | Shared-subaccount + shared-org only. **Never** private user data |
| `delegated` | Agent configured by user A to run on a schedule on A's behalf | A's private data, scoped to the grant; subject to expiry; every use audited |

**Why.** Without distinct principal types, every background job becomes either (a) a root/god principal that can see everything, or (b) forced to run interactively. Option (a) is a confused-deputy vulnerability that will leak private data the first time a reporting agent accidentally queries an inbox table. Option (b) makes scheduled workflows unusable. The delegated type exists because real agency workflows genuinely need "Alice set up a mailbox-triage agent that runs while she's asleep" — without a formal grant, this either requires impersonating Alice permanently (unsafe) or running only when Alice is online (unusable).

**Implications.**
- `agent_runs` grows a `principalType` column (enum: `user` | `service` | `delegated`) and a `principalId` reference. Both indexed. Delegated runs also carry `delegationGrantId`.
- A new `delegation_grants` table tracks: grantor user, grantee (service identity or user), scope summary, expiry (default 30 days, max 365), revocation timestamp, creation metadata. Every use of a grant is logged to `tool_call_security_events` with the grant ID.
- Service principals are named, not anonymous. Examples: `service:canonical-polling`, `service:health-detector`, `service:anomaly-scanner`. Each is a row in a `service_principals` table tied to a subaccount or organisation.
- Every canonical read entrypoint accepts a principal context argument. Reads without a principal context are rejected by a static gate (see P3 static gates).
- Pure helpers compute visibility predicates: given a principal context and a row's scoping fields, return boolean "visible or not." Unit-tested exhaustively via fixtures.

**What this forecloses.** Ambient god-mode principals ("system runs as nobody and sees everything"). Every execution context answers "who is this running as, and what is that principal allowed to see." The "no principal / admin override" escape hatch does not exist in the normal path; breakglass access is a separate, audited, operator-only procedure documented in the runbooks folder, not an architectural feature.

### D4 — Cross-subaccount scoping via a many-to-many linkage table, not arrays or duplicated rows

**Decision.** When a canonical row can legitimately belong to more than one subaccount (an email thread involving two clients, a calendar event with attendees from multiple agency clients, a shared document referenced in two project contexts), the row is stored once in its canonical content table and its subaccount scopes are recorded in a dedicated linkage table `canonical_row_subaccount_scopes` with the shape `(canonicalTable, canonicalRowId, subaccountId, attribution, createdAt)`.

Attribution values: `primary` (the subaccount this row predominantly relates to), `mentioned` (a subaccount referenced but not owning the interaction), `shared` (a row genuinely shared across subaccounts with no predominant owner).

**Why.** Three options were considered; the linkage table is the only option that survives all four of (a) efficient per-subaccount visibility queries, (b) atomic updates when scopes change, (c) atomic deletion when a subaccount is removed, (d) RLS policies that can inspect scope membership without array-contains gymnastics.

- **Array column on canonical row** (`subaccountIds: uuid[]`): concise on read but painful for RLS, mutation, and selective deletion. GIN indexes on `uuid[]` work but complicate migration paths and make visibility predicates harder to reason about.
- **Duplicated rows per subaccount**: simple queries but forces N copies of the same body/metadata, creates sync drift when any field is edited, and multiplies storage for the rare legitimate cross-scope case.
- **Linkage table** (chosen): one canonical content row, N scope rows. Joins are cheap, RLS attaches to the linkage table, revocation is a single delete, attribution is expressible without overloading the content row's columns.

**Implications.**
- Every canonical table that can be multi-subaccount-scoped gains a linkage entry in `canonical_row_subaccount_scopes`. Existing single-subaccount tables (`canonical_contacts`, `canonical_opportunities`, etc.) continue to use their direct `subaccountId` column for the common case. A canonical table uses the linkage table when and only when its source data supports multi-scope participation (email threads, calendar events, documents) — not for entities that are always 1:1 with a subaccount.
- Visibility predicates join through the linkage table when evaluating multi-scope canonical rows. Pure helpers handle this without exposing the join at the skill layer.
- The linkage table has a unique constraint on `(canonicalTable, canonicalRowId, subaccountId)` to prevent double-recording and to support upsert on reprocess.
- `attribution` is an enum, not free-text. Adding a new attribution value is a schema change requiring spec amendment.

**What this forecloses.** Arrays-of-IDs columns on canonical rows (the "JSON of tags" pattern) are not the way to express scope membership in this program. Skill authors should not reach for `tags jsonb` to solve "this email belongs to multiple clients" — the linkage table is the supported mechanism.

### D5 — Defer Google Workspace domain-wide delegation until after this program completes

**Decision.** Domain-wide delegation (the pattern where a Google Workspace admin grants a service account impersonation rights over every user in the domain, allowing one admin consent to cover N users) is named, scoped, and explicitly out of this program. The schema design will not preclude it, but no phase of this program delivers it.

**Why.** Domain delegation has significant compliance and operational overhead that is disproportionate to its payoff for the current target market:

- **Cloud App verification.** Google requires a formal security review before an application can request sensitive scopes at domain scale. The review cycle is measured in weeks to months, consumes real engineering and legal time, and must be repeated for material changes.
- **Consent model ambiguity.** "Admin consents on behalf of every user in the domain" is commercially common and legally contested. GDPR and CCPA case law continues to evolve; the safest posture is to require per-user informed consent via OAuth until we have legal review and a formal DPA template for enterprise customers.
- **Revocation complexity.** Per-user revocation and admin-level revocation interact in non-obvious ways. Designing this correctly requires the per-user path (which we are building) as a foundation, plus an additional layer on top — not as a substitute.
- **Commercial fit.** The current product target is SMB agencies (5–30 staff). Per-user OAuth scales cleanly at that size. Domain delegation becomes valuable at 100+ users — a segment the product is not yet serving.

**Implications.**
- Connection ownership scopes remain `user | subaccount | organisation`. A future domain-delegation feature would add a fourth scope (`domain`) with its own consent and revocation semantics; it does not map onto any of the three existing scopes.
- Service-principal classification (`personal | shared-mailbox | service-account`) includes `service-account` as a named classification even though we do not ship domain-level service accounts in this program. This lets shared-mailbox and service-account data paths coexist without naming collisions.
- Nothing in the schema assumes per-user OAuth is the only consent path. Future domain-delegation support would extend `integration_connections` with a `consentModel` column (values: `per_user` | `domain_admin`) rather than requiring a schema migration on every existing row.

**What this forecloses.** Building for enterprise-scale Google Workspace tenants as a first-class customer segment during this program. If an enterprise customer appears mid-program, they get per-user OAuth like everyone else or they wait. Domain delegation is its own program, with its own security review, and its own commercial motion.

### D6 — If/when vector indexes are introduced, they are physically partitioned per principal scope

**Decision.** Any vector index over canonical data that includes personal or shared-team content is physically partitioned by principal scope. Private-user data lives in per-user indexes. Shared-team data lives in per-team (or per-subaccount) indexes. Shared-org data lives in per-org indexes. There is no global cross-tenant or cross-principal vector index over personal data. Queries route to the appropriate partition(s) based on the principal context; they cannot semantically "reach into" a partition they are not routed to.

Vector indexes are **not** shipped as part of any phase in this program. This decision exists to constrain the design if and when such an index is added in a follow-on program, so the program is not architected in a way that precludes safe indexing later.

**Why.** The dominant failure mode of vector-search-with-access-control is the "retrieve-then-filter" pattern: top-K semantically relevant results are pulled from a shared index and then filtered against a principal's ACL. If the filter has a bug, is racing a revocation, or is using stale ACL state, the LLM has already been exposed to data it should not have seen — retrieving into context is not reversible, even if the final response strips it. Partitioning at the index level makes the failure mode "query the wrong index" (easier to detect, logged, and contained) rather than "leak through a filter" (silent, unobservable, and fatal).

**Implications.**
- Any future vector-search implementation specs must name which provider (Turbopuffer, Qdrant, pgvector partitioning, etc.) and how partitioning is enforced at the infrastructure level, not just at the query-helper level.
- Cross-principal semantic search over private data is not a feature we will offer. "Find all emails semantically similar to this one, across every user in the agency" is not a safe query; the principal-scoped version ("across every user who has granted me visibility") is the only form supported.
- Cost modelling for vector indexes must account for the N-partition overhead. Shared indexes are cheaper at scale, but cheaper is not the operative criterion.

**What this forecloses.** Shipping a single cross-tenant embedding store "because it is cheaper and the post-filter is fine in practice." It is not fine in practice, and the first incident closes the company. This decision is recorded up-front so nobody has to re-argue it when the cost discussion comes up during a follow-on program.

### D7 — Thin canonical for email, full canonical for calendar

**Decision.** Email is canonicalised as metadata and entity links only. Bodies, attachment bytes, and inline images are never persisted to canonical tables. Body content is fetched on-demand, per query, through a declared live-fetch skill that runs under the invoking principal's credentials, returns content into the agent's working context, and does not write to the database. Calendar events are canonicalised fully: title, description, attendees, start/end, location, status, recurrence.

**Why.** Email and calendar have fundamentally different content-to-metadata ratios and fundamentally different sensitivity profiles.

- **Email bodies are high-volume and high-sensitivity.** A mid-size agency with 15 staff generates on the order of 2M messages across two years. Storing bodies means tens of GB per org, linear growth, and a legally meaningful personal-communications corpus under our custody. Breach, employee-with-DB-access, backup-tape, and subpoena surfaces all become significantly larger problems.
- **Email metadata is low-volume and lower-sensitivity.** Sender, recipients, subjects, timestamps, and thread IDs answer the majority of the product's real questions: cadence, response time, thread navigation, entity linkage, simple cross-source joins. The product does not need bodies in canonical to answer "when did we last email this contact" or "how many unanswered threads does this account have."
- **Where bodies are needed, they are needed rarely and briefly.** Summarisation, draft-generation, and intent-classification queries that require body content are rare, expensive (LLM calls), and acceptable to fetch on demand. On-demand fetch preserves freshness (Gmail's state is always truth) and keeps us out of the archiver business.
- **Calendar content is low-volume and lower-sensitivity.** Events are short by nature. Attendee lists and meeting titles are valuable signal. Full storage is cheap and the privacy gradient is meaningfully lower than email bodies. Trying to split calendar into thin/full variants would gain nothing and lose the simplicity of "calendar is canonical, query freely."

**Implications.**
- `canonical_emails` schema includes: provider, provider message ID, thread ID, in-reply-to, subject (capped length), sent-at, received-at, sender/recipient/cc/bcc participant JSON with canonical contact links where resolvable, labels, folder, read state, attachment metadata (names, MIME, sizes — no bytes), AI classifications (sentiment, urgency, category) computed once at ingest. Explicitly **not** included: body text, body HTML, attachment bytes, inline images.
- A live-fetch skill — provisional name `fetch_email_body` — is built alongside the Gmail adapter in P4. It takes a canonical email row ID, resolves the `sourceConnectionId`, uses the credential of that connection, fetches the body from Gmail API, returns it to the agent. It never writes to canonical. It emits a `tool_call_security_events` row on every invocation.
- `canonical_calendar_events` schema includes: provider, provider event ID, series ID (for recurring), title, description, location, start, end, timezone, status, organiser, attendees JSON with canonical contact links, visibility, recurrence-rule.
- Any product question that cannot be answered from email metadata + entity links + on-demand body fetch is either rare enough to accept the latency cost, or is a signal that the metadata layer needs an additional AI classification computed at ingest (e.g. topic, action-required-flag, client-sentiment-shift) — not that we need to start storing bodies.

**What this forecloses.** Bulk analytics over historical email content. Trend analysis on complaint language across a 12-month corpus. Embedding historical inbox content into a searchable index. All three are potentially valuable but are not primary product loops for AutomationOS and are not justified at the cost of becoming a custodian of personal email corpora. If the product roadmap later justifies any of them, the decision is re-opened with explicit customer commitments and legal review, not by quietly widening `canonical_emails` to include a `bodyText` column in a patch commit.

### D8 — Bundled-tier pricing for integration connections; engineering must keep per-connection costs observable

**Decision.** Integration connections are priced to customers as a bundled allowance per agency tier (base tier ~10 connections, mid-tier ~25, enterprise 100+), with optional add-on packs. Usage-based per-connection line items and unlimited-connection offers are out of scope. Engineering responsibility: make per-connection cost (API calls, ingestion compute, and row throughput) observable internally so tier economics can be tuned without customer-facing pricing changes.

This is primarily a commercial decision. The pricing and billing motion (meters, dashboards, tier-enforcement gates) is not a phase deliverable of this program. The engineering observability table (`integration_ingestion_stats`) that makes internal cost tuning possible is a P1 deliverable — it must exist before scheduled ingestion runs start producing data to record.

**Why.** Per-connection metering creates buying friction at every hire, is unpredictable for customer budgeting, and is the top SaaS churn driver in the category. Unlimited-connection pricing is operationally catastrophic at enterprise scale. Bundled tiers with soft caps match how agencies actually plan staffing, keep customer bills predictable, and let internal cost variance (Gmail cheap, Zoom expensive) be absorbed by tier margin rather than exposed line-by-line.

**Implications.**
- Every connection row records `createdAt`, `provider`, and (after P1) `lastSuccessfulSyncAt`. This is already true for existing connections.
- Every ingestion run records approximate API-call count, row-count ingested, and sync duration, written to an `integration_ingestion_stats` table (rolling window, not per-event history). Row throughput (`rows_ingested`) is the per-tier storage proxy — tier economics are evaluated from aggregate row counts across rolling windows, not from per-sync byte estimates. Sufficient for internal cost tuning; not exposed to customers.
- Every canonical-backed skill invocation is already logged to `tool_call_security_events`. Per-connection cost attribution can join through `sourceConnectionId` on canonical rows.
- Soft caps are enforced at the application layer: when an agency reaches its connection allowance, the UI prompts upsell rather than hard-blocking mid-workflow. Hard limits exist only at very high thresholds (e.g. 500 connections per org) to prevent abuse-scale ingestion.

**What this forecloses.** A usage-based pricing motion ("pay per email ingested") or an unlimited-connections motion ("connect everything, we'll figure it out"). Engineering is not asked to build billing infrastructure for per-connection metering during this program. If the commercial motion later shifts, the observability hooks above give us the data to build it; nothing about this program precludes that pivot.

### D9 — All canonical-backed skill reads go through canonical, not direct to provider APIs, with declared exceptions

**Decision.** Any skill whose purpose is to *read* data already represented in canonical (contacts, opportunities, conversations, revenue, emails, calendar events) reads from canonical via `canonicalDataService`, not from the provider's API. Direct provider-API reads are permitted only in two declared cases:

1. **Ingestion.** Adapters reading provider APIs and writing to canonical. This is the one-way direction of the middleware pattern.
2. **Live-fetch skills.** Skills that intentionally fetch content that is not persisted to canonical (e.g. `fetch_email_body` per D7) and return it to the agent context without writing to the database. These must be declared in `server/config/actionRegistry.ts` with a `liveFetch: true` flag (new) and are subject to additional audit logging.

Every other third-party read path is either converted to canonical-backed or deleted.

**Why.** Today's mix of "some skills read canonical, some skills read provider APIs directly" is an architectural smell with real consequences: canonical history is incomplete (live-fetch results are not reflected in historical analytics), rate-limit pressure is unnecessarily high (repeated identical queries hit the provider N times), audit surface is split across two different logging mechanisms, and reasoning about "where does an agent's answer actually come from" requires reading each skill's implementation. Consolidating read paths is table stakes for everything later in this program — the data-dictionary skill (P2), principal-context enforcement (P3), and the NL→SQL surface (P6) all assume canonical is the read interface.

**Implications.**
- P2 is the phase that carries out this consolidation. Every existing skill is audited: each read path is either (a) refactored to use `canonicalDataService`, (b) declared as a live-fetch skill with the `liveFetch: true` flag and explicit rationale, or (c) deleted if it turns out to be dead code.
- Declaring a skill as live-fetch is an explicit, reviewable action. A static gate (see P2 static gates) prevents any skill from calling provider APIs directly unless it is flagged live-fetch in the action registry.
- Live-fetch skills log to `tool_call_security_events` with `fetchMode: 'live'` so audit queries can distinguish canonical-backed reads from live-fetch reads.
- Adapters continue to hold the only credentialled write path to canonical. Skills never write to canonical directly.

**What this forecloses.** The "quick win" of bypassing canonical when a skill author doesn't want to wait for the next ingestion. If the canonical layer is not fresh enough for a query, the answer is to tune ingestion (P1 scheduling) or to classify the skill as live-fetch — not to reach past canonical and create a ghost read path nobody can audit.

### D10 — Tenancy is enforced by Postgres RLS keyed to the principal context, with service-layer checks retained as defence-in-depth

**Decision.** Every canonical table and every principal/connection table ships with Postgres Row-Level Security policies. **Org-level RLS already exists on this codebase** — Sprint 2 P1.1 (migrations 0079–0082, plus every tenant-table migration since) shipped Layer 1 RLS keyed on `current_setting('app.organisation_id', true)`, with the manifest in `server/config/rlsProtectedTables.ts` and the gates `scripts/gates/verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh`. P3 **extends** that infrastructure with principal-scoped predicates (owner / visibility / principal_type) and adds the `withPrincipalContext` wrapper on top of the existing `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` primitives. Service-layer scope checks (the existing pattern — services require `organisationId` arguments, filter in the query) are retained as defence-in-depth and as the primary error-surface for developers.

**Why.** Service-layer-only isolation survives the common case but loses to the uncommon case: a new query path that forgets the scope filter, a helper that fetches by primary key without re-checking tenancy, a one-off admin script that runs against production. RLS at the database makes the database itself the last line of defence: if a query slips past the service layer without a scope filter, Postgres returns zero rows rather than cross-tenant data. The service-layer check is kept because RLS errors are opaque (the query "succeeds" but returns fewer rows than expected) — developers need explicit "you forgot to pass `organisationId`" errors at the service layer to catch mistakes during development, before RLS saves them in production.

**Implications.**
- P3 is the phase that **extends** the existing org-level RLS to cover principal-scoped predicates. Every canonical table, every connection table, every principal table, and every table holding personal-principal data gains policies that key on principal type/ID and visibility scope, in addition to the org-level policies they already inherit from the existing manifest.
- RLS policies are defined in migration files alongside the schema, not in separate "apply policies" migrations. A table that gains RLS in one migration and policies in another is a failure mode that static gates must catch. New canonical tables MUST be added to `RLS_PROTECTED_TABLES` in the same migration that creates them — this is an existing gate, not a new one.
- Session-variable setup is layered on the existing `withOrgTx` / `getOrgScopedDb` plumbing: P3 introduces `withPrincipalContext` as a thin extension that sets `app.current_principal_type` / `app.current_principal_id` / `app.current_subaccount_id` alongside the already-shipped `app.organisation_id`. Direct database access that bypasses this helper is a static-gate violation.
- RLS is not applied to administrative tables where cross-tenant access is required for operation (e.g. system config, feature registry, platform-level tables). These are explicitly named in P3 and excluded — the existing `withAdminConnection` / `admin_role` bypass remains the only escape hatch.
- Tests for RLS are written at the pure-function level for the policy predicate logic (principal → row visibility) and at the integration level for a small, exhaustive fixture set, extending the existing `server/services/__tests__/rls.context-propagation.test.ts` harness. Runtime tests for every query path are explicitly out of scope — we rely on the static gate that enforces principal-context propagation.

**What this forecloses.** "We'll add principal-scoped RLS later when we need it." The org-level layer is already there; principal-scoped policies are the precondition for every phase that exposes canonical data to principal-scoped queries, including Gmail (P4), Calendar (P5), and the NL→SQL surface (P6). Deferring it makes every one of those phases harder to ship safely. The principal-scoped extension lands in P3 and is not deferred.

---

## Principal model

The principal model defined here is the concrete expression of D3. P3 is the phase that implements it. P4, P5, and P6 inherit it. This section is the single source of truth for the shape of a principal context — implementation specs for each phase reference back to it rather than restating it.

### Shape of a principal context

Every agent execution, every skill invocation, every canonical read, and every database session carries a principal context with this shape (TypeScript shown for clarity; equivalent SQL/session-variable form is defined in P3):

```typescript
// shared/principal/types.ts
export type PrincipalContext =
  | UserPrincipal
  | ServicePrincipal
  | DelegatedPrincipal;

interface PrincipalBase {
  organisationId: string;       // always required
  subaccountId: string | null;  // context of the current run; null for org-level runs
  requestId: string;            // trace id for auditing
}

interface UserPrincipal extends PrincipalBase {
  type: 'user';
  userId: string;
  teamIds: string[];            // resolved at context creation; used for shared-team visibility
}

interface ServicePrincipal extends PrincipalBase {
  type: 'service';
  serviceId: string;            // stable identifier: 'service:canonical-polling', 'service:health-detector', etc.
}

interface DelegatedPrincipal extends PrincipalBase {
  type: 'delegated';
  actingAsUserId: string;       // the user whose data the delegation covers
  delegationGrantId: string;    // FK to delegation_grants
  triggeredByUserId: string | null;  // user who initiated the current run, if any
}
```

Every field is required for its variant. There is no "partially-populated principal context" state. A context-less call is a programming error and is caught by the static gate defined in P3.

### Visibility rules (pure function)

A row's visibility to a principal is decided by a pure function `isVisibleTo(row, principal)` that returns `boolean`. The function considers four row fields — `organisationId`, `subaccountId` (or linkage-table entries for multi-scope rows), `ownerUserId`, `visibilityScope` — and resolves:

| Row state | Visible to `user` principal? | Visible to `service` principal? | Visible to `delegated` principal? |
|---|---|---|---|
| `visibilityScope = private`, `ownerUserId = P.userId` | Yes | No | Only if `ownerUserId = P.actingAsUserId` AND grant covers the canonical table |
| `visibilityScope = private`, `ownerUserId ≠ P.userId` | No | No | No |
| `visibilityScope = shared-team`, user in scope teams | Yes | No | No |
| `visibilityScope = shared-subaccount`, row in current subaccount scope | Yes | Yes | No¹ |
| `visibilityScope = shared-org` | Yes | Yes | No¹ |
| Row's `organisationId ≠ P.organisationId` | No (always) | No (always) | No (always) |

¹ Delegated principals access the grantor's private data only. Shared-subaccount and shared-org rows are accessible to service and user principals directly without a delegation grant — there is no need for delegation to reach them, and expanding delegated scope to shared rows would make grants over-powerful relative to their stated purpose.

The function is implemented in `server/services/principal/visibilityPredicatePure.ts` and tested exhaustively via fixtures. RLS policies in P3 express the same predicate in SQL; the pure helper and the RLS policy are kept in sync by a static gate that compares the fixture outputs against a SQL-replay harness.

### Principal context lifecycle

Principal contexts are created at exactly three entry points:

1. **Authenticated route handler.** Every route wraps its handler in a helper that resolves `{ userId, organisationId, subaccountId, teamIds }` from the session, builds a `UserPrincipal`, and attaches it to `req.principal`. Downstream service calls accept the context as an argument.
2. **Scheduled job handler.** Every `pg-boss` worker created via `createWorker()` (the existing primitive) is wrapped so the job's payload declares which service principal it runs under. The worker resolves a `ServicePrincipal` and passes it into the handler. Jobs triggered *on behalf of a user* (delegation) carry the delegation grant ID in the payload; the worker resolves it into a `DelegatedPrincipal`.
3. **Webhook handler.** Webhooks create a `ServicePrincipal` scoped to the webhook's named service identity (e.g. `service:ghl-webhook`). Webhook-originated work that must act on behalf of a specific user (rare) uses a delegation grant set up at connection time.

A principal context is never manufactured inside a service function. Services receive contexts; they do not create them.

### Delegation grants

A `delegation_grants` table makes grants a first-class entity:

```
delegation_grants
  id uuid primary key
  grantor_user_id uuid not null          -- the user delegating access
  grantee_kind enum('user','service')    -- delegated to another user or to a named service
  grantee_id text not null                -- user id or service id
  subaccount_id uuid                      -- scope of the grant (nullable = org-level)
  allowed_canonical_tables text[] not null  -- whitelist, e.g. ['canonical_emails','canonical_calendar_events']
  allowed_actions text[] not null           -- whitelist, e.g. ['read','fetch_body'] — no 'write' by default
  reason text                              -- free-text reason the grantor provided
  expires_at timestamptz not null          -- default now() + 30 days, max now() + 365 days
  revoked_at timestamptz
  created_at timestamptz not null default now()
```

Every use of a grant:

- Validates expiry and revocation at use time (not at cache time).
- Logs a row to `tool_call_security_events` with the grant ID, the principal acting, the canonical table accessed, and the number of rows returned.
- Refuses if the grant does not cover the action (`allowed_actions`) or the table (`allowed_canonical_tables`).

Users have a UI (not in program scope except as a named requirement for P3) listing their active grants, with one-click revocation and a log of every use.

### Observability

Every canonical read emits a structured log line including `principalType`, `principalId`, `organisationId`, `subaccountId`, canonical table(s) accessed, row count, and whether RLS or service-layer checks filtered any rows. This supports per-user audit ("who read my email, when, from where") and per-agency audit ("which agents are running and what data are they touching").

---

## Canonical data model conventions

Every new canonical table introduced by this program must honour the conventions below. Existing canonical tables gain the fields they are missing in P3 as part of the principal-model hardening migration.

### Required columns on every canonical table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | Generated client-side (via `randomUUID()`), not serial |
| `organisation_id` | uuid not null | Tenant scope; always filtered; RLS-bound |
| `subaccount_id` | uuid nullable | Direct subaccount scope for 1:1 canonical rows; null for multi-scope rows (use linkage table) |
| `source_connection_id` | uuid nullable | FK to `integration_connections` — identifies which connection produced this row; null for rows computed from other canonical sources (health snapshots, etc.) |
| `owner_user_id` | uuid nullable | Owning user for personal-scope rows (Gmail, Calendar under personal connections); null for shared/org/service rows |
| `visibility_scope` | enum not null | `private` \| `shared-team` \| `shared-subaccount` \| `shared-org` |
| `shared_team_ids` | uuid[] not null default '{}' | Teams that can see this row when `visibility_scope = shared-team`. Populated from the connection's team visibility at ingest time. Empty array = no team can see the row (even with `shared-team` scope). **Stale-data limitation:** if a connection's `shared_team_ids` is later changed via the admin UI, existing canonical rows retain stale values until reprocessed — team-visibility changes take effect for newly ingested rows only. The visibility-management UI task (deferred) must include a background job that propagates connection visibility changes to canonical rows; see Deferred items. |
| `external_id` (or provider-specific equivalent) | text nullable / not null | Provider's ID for this row, for idempotent upsert. Use `external_id` for generic adapters; use a provider-specific name where clearer (e.g. `provider_message_id` for email, `provider_event_id` for calendar). The uniqueness guarantee — `UNIQUE (source_connection_id, <id_column>)` — is required regardless of the column name. |
| `ingested_at` | timestamptz not null | When this row was written to canonical |
| `source_updated_at` | timestamptz nullable | When the provider last modified this row, if the provider exposes it |
| `deleted_at` | timestamptz nullable | Soft-delete pattern used elsewhere in the codebase |

### Required indexes

| Index | Rationale |
|---|---|
| `(organisation_id)` | Every read filters by org |
| `(organisation_id, subaccount_id)` | Subaccount-scoped queries |
| `(organisation_id, owner_user_id)` | User-scoped queries (private data) |
| `(shared_team_ids) using gin` | Fast array-overlap check in `shared-team` RLS policy |
| `UNIQUE (source_connection_id, <id_column>)` where `<id_column>` is `external_id` or the provider-specific equivalent | Idempotent upsert on reprocess |
| `(source_connection_id, ingested_at)` | Per-connection ingestion history and debugging |

Tables with entity links (e.g. `canonical_emails` linking to `canonical_contacts`) additionally index each FK column.

**Multi-subaccount-scoped tables skip the `(organisation_id, subaccount_id)` index.** For tables where `subaccount_id` is always null (emails, calendar events — see next section), this index is meaningless and must be omitted. Scope queries for those tables go through `canonical_row_subaccount_scopes`.

### Multi-subaccount-scoped tables (per D4)

Tables whose rows can legitimately belong to multiple subaccounts (emails, calendar events, documents) do **not** use the direct `subaccount_id` column. Instead:

- `subaccount_id` is nullable and always null on the canonical content row.
- Scope membership is recorded in `canonical_row_subaccount_scopes`.
- Visibility predicates and RLS policies on these tables join through the linkage table.

This distinction is named in the table's schema file with a comment and enforced by a static gate (P3) that checks linkage-table presence for tables tagged `multiScoped: true` in a registry.

### Forbidden patterns

The following patterns are forbidden in canonical tables. Spec reviewers reject any implementation spec that uses them without first amending this document.

- **`tags jsonb` used as a scope or visibility mechanism.** Tags are for user-facing labels only (e.g. `canonical_contacts.tags`). They must not carry visibility, principal, or subaccount scope information.
- **Nullable `organisation_id`.** Every canonical row belongs to exactly one organisation. Rows that "belong to the platform" (e.g. skill definitions, action registry entries) are not canonical tables and live in a separate namespace.
- **Free-text enum values.** Columns like `visibility_scope`, `attribution`, `principal_type` are Postgres enums, not text. Adding a value is a migration, not a data insert.
- **Raw provider payload columns.** No `raw_json jsonb` columns holding the unprocessed provider response. If a field is not worth modelling canonically, it is not stored. Live-fetch is the path for content that does not belong in canonical.
- **Embedded credential or secret material.** No API keys, tokens, or OAuth artefacts in canonical tables. Credentials live in `integration_connections` and are accessed only by adapters.

### Derived / computed canonical tables

Tables that hold computed aggregates (e.g. `health_snapshots`, `anomaly_events`, `canonical_metric_history`) follow the same conventions with two additions:

- A `computation_version` column (integer) so changes to the computation logic can be surfaced without deleting history.
- A `source_rows_fingerprint` column (text, nullable) where applicable — a stable hash of the input canonical rows used, so reprocessing can skip unchanged computations.

Principal/visibility fields on derived rows inherit from the most-restrictive source row that contributed to the computation. A health snapshot computed from a mix of shared-subaccount and private-user data inherits `private` — i.e., computed rows cannot widen visibility. This rule is enforced by the aggregation pipeline and verified by pure helper tests in P2.

---

## P1 — Scheduled polling + stale-connector health detector

**Verdict: BUILD.** Smallest, contained phase. De-risks everything downstream by ensuring canonical data is actually fresh before we start consolidating reads (P2) or exposing new query surfaces (P4–P6).

### Goal

Every connector polls on a schedule without operator intervention. Stale connectors surface as a workspace-health finding. The manual `POST /api/org/connectors/:id/sync` path continues to work, but is the exception, not the default.

### Current state

`connectorPollingService.syncConnector()` is idempotent and honours the backfill → transition → live phases. `integration_connections` already stores a `pollIntervalMinutes` value per connection (default 60). What is missing is:

- No `pg-boss` job registered for scheduled syncs. The sync is only triggered by route calls or manual operator action.
- No `lastSuccessfulSyncAt` or `lastSyncError` columns on `integration_connections`. Operators cannot tell at a glance which connections are behind.
- No workspace-health detector for stale connectors. `workspaceHealthService` has detectors for agent-run drift, skill-definition drift, etc., but nothing for ingestion freshness.

### Design

**Schema additions to `integration_connections`:**

```sql
ALTER TABLE integration_connections
  ADD COLUMN last_successful_sync_at timestamptz,
  ADD COLUMN last_sync_started_at timestamptz,
  ADD COLUMN last_sync_error text,
  ADD COLUMN last_sync_error_at timestamptz,
  ADD COLUMN sync_phase text NOT NULL DEFAULT 'backfill';  -- 'backfill' | 'transition' | 'live' | 'paused'

CREATE INDEX integration_connections_last_successful_sync_at_idx
  ON integration_connections (last_successful_sync_at)
  WHERE deleted_at IS NULL;

CREATE INDEX integration_connections_sync_phase_idx
  ON integration_connections (sync_phase)
  WHERE deleted_at IS NULL AND sync_phase IN ('backfill','transition','live');
```

The `sync_phase` column promotes the implicit phase transitions already encoded in `connectorPollingService` to first-class state. A connection marked `paused` is skipped by the scheduler until an operator un-pauses it.

**Scheduled polling job:**

A single `pg-boss` cron job `connector-polling-tick` runs every minute. Its handler:

1. Sets a `ServicePrincipal` context (`service:canonical-polling`) — even though P3 has not landed yet, the handler is structured to accept the context from day one; before P3, the context is a stub that carries `organisationId` per connection.
2. Selects connections due for sync: `sync_phase IN ('backfill','transition','live') AND deleted_at IS NULL AND (last_successful_sync_at IS NULL OR now() - last_successful_sync_at >= poll_interval_minutes * interval '1 minute')`.
3. For each, enqueues a per-connection job `connector-polling-sync` with the connection ID.
4. The per-connection worker calls `connectorPollingService.syncConnector(connectionId, servicePrincipal)`, wraps with `withBackoff` for transient errors, updates `last_sync_started_at` before and `last_successful_sync_at` / `last_sync_error` after.

Both jobs use `createWorker()` (the project's existing pg-boss wrapper primitive). Concurrency is bounded per connector to prevent one slow connection from starving others. Global concurrency is bounded to prevent API-rate-limit spikes across the fleet.

**Reuse existing scheduling primitives.** `server/services/scheduleCalendarServicePure.ts` (Feature 1, 2026-04) already owns cron-parser / rrule / heartbeat-offset projection math via the `SOURCE_PRIORITY` and `computeNextHeartbeatAt` helpers, and `server/services/scheduleCalendarService.ts` projects upcoming agent runs. The polling scheduler MUST reuse the same cron-parser library version and treat `scheduleCalendarService` as the read model for "what is due / upcoming"; do not invent a parallel projection. If the connector-polling cadence model legitimately differs from agent-run scheduling (e.g. needs per-connection per-tenant rate-limit windows), that divergence is documented in the P1 implementation spec with a justification.

**Stale-connector health detector:**

A new detector file at `server/services/workspaceHealth/detectors/staleConnectorDetector.ts` following the existing detector convention. Re-exported from `detectors/index.ts`. Returns findings with severity:

| Age beyond interval | Severity |
|---|---|
| < 2× interval | none (healthy) |
| 2×–5× interval | `warning` |
| > 5× interval, or `last_sync_error` within last 24h | `error` |
| Never synced AND `created_at` > 24h ago | `error` |

Findings carry a stable `resourceId = connectionId` so repeat runs do not create duplicates (convention already established in the health service).

### Contracts

- `connectorPollingService.syncConnector` accepts a `ServicePrincipal` argument. Signature change is coordinated with any existing callers (currently only the manual-sync route).
- Job handlers register with `createWorker()` and are idempotent — re-running the same sync for the same connection at the same moment is safe.
- The stale-connector detector is read-only; it does not mutate connection state.

### Pure helpers + tests

- `connectorPollingSchedulerPure.ts` — computes "which connections are due now" given the current time and a fixture list of connections. Fixture-driven tests cover the interval math, the phase filter, and the paused-skip behaviour.
- `staleConnectorDetectorPure.ts` — computes severity given a connection row and `now()`. Fixture-driven tests cover each severity band.

### Static gates

- `scripts/verify-connector-scheduler.sh` — greps for direct calls to `connectorPollingService.syncConnector` outside the manual-sync route and the scheduler handler; fails if found. Prevents ad-hoc callers bypassing the scheduler and its principal-context wrapper.

### Schema additions — `integration_ingestion_stats`

```sql
CREATE TABLE integration_ingestion_stats (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES integration_connections(id),
  sync_started_at timestamptz NOT NULL,
  api_calls_approx int NOT NULL DEFAULT 0,
  rows_ingested int NOT NULL DEFAULT 0,
  sync_duration_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_ingestion_stats_connection_idx
  ON integration_ingestion_stats (connection_id, sync_started_at DESC);
CREATE INDEX integration_ingestion_stats_created_at_idx
  ON integration_ingestion_stats (created_at);
```

Rolling retention: rows older than 90 days are deleted by the nightly `canonical-*-purge` family job (or a dedicated `ingestion-stats-purge` job — implementation spec decides).

### Out of scope for P1

- Per-connector rate-limit budgets (token buckets per provider). Noted as a P2 or later concern if a real rate-limit incident surfaces during P1.
- Webhook-receipt health (are we receiving webhooks we expect). Separate detector, future phase.
- Sync-phase transition logic changes. The existing transition logic stays; P1 only promotes the phase to a column.

### Entry criteria

- No prior phase dependencies.

### Exit criteria

- All P1 migrations landed with indexes (integration_connections additions + integration_ingestion_stats).
- Scheduled polling job running in dev/staging without manual intervention.
- `integration_ingestion_stats` rows being written by the per-connection sync worker.
- Stale-connector detector emitting findings for seeded stale fixtures.
- Static gate in `scripts/run-all-gates.sh`.
- `pr-reviewer` + `dual-reviewer` passed.
- `docs/architecture.md` updated with the scheduled-polling pattern if it is not already documented there.

---

## P2 — Canonical consolidation + data dictionary

**Verdict: BUILD AFTER P1.** P2 is split into two sub-phases (P2A read-through consolidation, P2B data-dictionary skill) because they have different shapes and different risk profiles. Both ship in this program, but P2A is the prerequisite.

### P2A — Read-through consolidation

#### Goal

Every skill that reads data already represented in canonical reads through `canonicalDataService`. Skills that intentionally fetch non-canonical content (e.g. full email bodies) are explicitly declared as live-fetch. No skill quietly bypasses canonical. This is the enforcement of D9.

#### Current state

Audit of `server/skills/` and `server/services/` (to be produced in full during P2A implementation) will identify three categories of skill:

1. **Already canonical-backed.** Reads through `canonicalDataService` today. No change.
2. **Canonicalisable.** Currently hits a provider API for data that is already in canonical (or should be). Refactored to read canonical.
3. **Genuinely live-fetch.** Reads content that is not persisted (and per D7 will never be, e.g. Gmail bodies). Reclassified as live-fetch with explicit flag and audit logging.

A fourth, unexpected category — dead skills — will be deleted.

#### Design

**Action registry flag.**

`server/config/actionRegistry.ts` grows a new field on the action definition:

```typescript
interface ActionDefinition {
  // ... existing fields ...
  readPath: 'canonical' | 'liveFetch' | 'none';  // 'none' for action-only skills (send, create, update)
  liveFetchRationale?: string;                   // required when readPath = 'liveFetch'
}
```

Every existing action is tagged during P2A. The tag is required — a static gate rejects actions that do not carry a `readPath`.

**Skill refactors.**

Each canonicalisable skill is refactored in a small, contained PR. The refactor:

- Replaces provider-API calls with `canonicalDataService` calls.
- Updates the action definition to `readPath: 'canonical'`.
- Updates the skill's system-prompt context to reflect that data comes from canonical (including freshness expectations, since canonical lags provider state by up to one poll interval).
- Adds or updates `*Pure.ts` tests for any helper logic.

Refactors are ordered so the highest-traffic read paths land first: `read_crm`, `read_campaigns`, `read_contacts`, then the long tail.

**Live-fetch declarations.**

Skills that are genuinely live-fetch (email body retrieval from P4, on-demand API writes from action skills like `send_email`, real-time availability checks) are tagged `readPath: 'liveFetch'` with a short `liveFetchRationale` explaining why canonical is not the right source. Rationale examples:

- `fetch_email_body`: "D7 — email bodies are not persisted to canonical by policy."
- `check_calendar_availability_realtime`: "Availability must reflect external-system state within seconds; canonical poll interval is not tight enough."

Live-fetch skills continue to log to `tool_call_security_events` but with an added structured field `fetchMode: 'live'` so audit queries can distinguish canonical-backed reads from live-fetch reads.

**Deleted skills.**

Dead skills identified during the audit are deleted outright. Deletion PRs are reviewed independently from refactor PRs so the audit trail is clean.

#### Contracts

- No skill may call a provider API directly unless its action is tagged `readPath: 'liveFetch'`. Static gate enforces this at PR time by greping for provider-client imports in skills that are not live-fetch.
- Every action definition carries `readPath`. Static gate enforces non-null.
- `canonicalDataService` gains any missing read methods needed by refactored skills. Methods accept a principal context argument (stub in P2A, enforced in P3).

#### Pure helpers + tests

- Any skill-level derivations that happen after the read (e.g. computing a rollup before returning to the agent) are lifted into `*Pure.ts` helpers. Existing `*Pure.ts` conventions apply.

#### Static gates

- `scripts/verify-skill-read-paths.sh` — checks every action in the registry carries `readPath`, checks that any skill importing a provider SDK has `readPath: 'liveFetch'`, checks that every `liveFetch` action has a `liveFetchRationale`. Fails on any violation.
- `scripts/verify-canonical-read-interface.sh` — checks that skills do not construct raw Drizzle queries against canonical tables; they must call `canonicalDataService` methods. Enforces the single read interface.

#### Out of scope for P2A

- Schema additions to canonical tables (covered by P3, P4, P5 as each phase introduces new tables or columns).
- Principal context enforcement on reads (covered by P3 — P2A accepts a stub context argument so the signature change is a single migration when P3 lands).
- Webhook handlers. They continue to write through adapters. The consolidation is about *read* paths, not write paths.

#### Entry criteria

- P1 landed — canonical freshness is managed, so skills reading from canonical have a defensible freshness story.

#### Exit criteria

- Every action in the registry tagged with a `readPath`.
- Every previously-direct-API-reading skill either refactored, reclassified as live-fetch with rationale, or deleted.
- Static gates in `scripts/run-all-gates.sh`.
- `pr-reviewer` + `dual-reviewer` passed.
- `docs/architecture.md` updated with the read-path contract if not already documented.

### P2B — Data dictionary skill

#### Goal

Agents have structured, up-to-date knowledge of the canonical schema — which tables exist, what each column means, how tables relate to each other, freshness expectations, and principal/visibility semantics — without a developer hand-writing that context into every agent's system prompt. The dictionary is the foundation on which the NL→SQL surface (P6) is built, but it is useful on day one for agents composing existing skills more intelligently.

#### Current state

Agents receive system-prompt context assembled from `agentConfigService`, workspace memory, skill descriptions, and handoff documents. None of this context describes the canonical schema itself. When an agent needs to reason about "which entities exist and how they relate," it must infer from skill descriptions or ask the user.

#### Design

**Dictionary source of truth.**

The dictionary is derived from the canonical schema at build time and loaded at runtime. Single source of truth:

- `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` — a TypeScript module that declares, for each canonical table: human-readable name, purpose, row-level principal/visibility semantics, column list with purpose and example values, foreign-key relationships, typical freshness expectation (e.g. "lags source by up to one poll interval, typically ≤ 60 minutes"), and skill references (which skills read this table).
- Columns in the registry must match the actual schema. A static gate (`verify-canonical-dictionary.sh`) diffs the registry against the Drizzle schema and fails the build on drift.

**Dictionary skill.**

A new skill `canonical_dictionary` is added to the registry with `readPath: 'canonical'` (reads metadata, not the rows themselves). The skill accepts optional filters (`table_name`, `topic`) and returns a structured summary suitable for injection into agent context.

**Prompt-context injection.**

Agents that need schema awareness (reporting agents, analytics agents, the NL→SQL surface) are configured to receive a dictionary summary as part of their system context. The summary is shaped so the cost of carrying it in-context is proportional to the agent's needs — the full dictionary is only injected for agents that opt in. Default agents do not carry it.

#### Contracts

- Every canonical table introduced by P3, P4, P5 adds a dictionary entry in the same commit. A static gate enforces this — a Drizzle schema file without a matching dictionary entry fails CI.
- Dictionary entries include a `since` field (e.g. "2026-Q3") so historical runs can reason about schema evolution. Not required for existing tables on day one; filled in as entries are added.
- The dictionary does not embed row counts, cost estimates, or other runtime state. It is static-from-schema, dynamic-from-metadata-only.

#### Pure helpers + tests

- `canonicalDictionaryRendererPure.ts` — given a registry and a filter, renders the structured summary. Fixture-driven tests cover table filtering, topic filtering, and the rendering format.
- `canonicalDictionaryValidatorPure.ts` — given a Drizzle schema AST and the registry, returns drift findings. Fixture-driven tests cover missing entries, stale column lists, and orphan registry rows.

#### Static gates

- `scripts/verify-canonical-dictionary.sh` — runs the validator against the real schema and registry. Fails on drift.

#### Out of scope for P2B

- NL→SQL query planning (P6).
- Dynamic cost estimation or query-plan hints in the dictionary. The dictionary is semantic; cost concerns belong to the query planner.
- Self-serve human-facing schema documentation (e.g. a web page listing all canonical tables). Useful but separate; the dictionary is for agent consumption.
- **Non-canonical RLS-protected tables.** The dictionary covers `canonical_*` tables only. The following existing RLS-protected tables are agent-state or app-surface, NOT canonical data, and are explicitly excluded: `agent_test_fixtures`, `agent_beliefs`, `agent_briefings`, `subaccount_state_summaries`, `memory_review_queue`, `trust_calibration_state`, `drop_zone_upload_audit`, `onboarding_bundle_configs`, `memory_blocks`, `regression_cases`, `tool_call_security_events`, `feature_requests`, `routing_outcomes`. They live in `RLS_PROTECTED_TABLES` for tenant isolation but are not exposed via `canonicalDataService` and have no `readPath` tag.

#### Entry criteria

- P2A landed — `readPath` tagging is in place, so skill references in the dictionary are meaningful.

#### Exit criteria

- Dictionary registry covers every existing canonical table with purpose, columns, relationships, and skill references.
- `canonical_dictionary` skill in the action registry with `readPath: 'canonical'`.
- Dictionary drift gate in `scripts/run-all-gates.sh`.
- At least one existing agent (likely the reporting agent) configured to receive dictionary context and verified against fixtures.
- `pr-reviewer` + `dual-reviewer` passed.

---

## P3 — Principal model and tenancy hardening

**Verdict: BUILD AFTER P2.** P3 is the largest and most architecturally invasive phase. It is split into two sub-phases (P3A schema + context propagation, P3B RLS + enforcement). P3 is the gate for every phase that follows — P4 (Gmail) and P5 (Calendar) cannot ship personal-user-owned data safely without P3. P6 (NL→SQL) cannot ship without P3's tenancy enforcement.

### P3A — Principal-model schema changes and context propagation

#### Goal

Every integration connection, every canonical row, every agent run, every skill invocation carries explicit ownership, visibility, and principal-context data. The shape defined in the [Principal model](#principal-model) section is realised in schema, types, and runtime plumbing — without yet enforcing it at the database level. P3A creates the scaffolding; P3B makes it binding.

Splitting the work this way lets the large schema migration land and be exercised by real code paths before RLS policies are added. RLS policies that fire against wrong-shaped data produce opaque failures; landing the shape first makes the subsequent policy migration a focused, testable change.

#### Current state

- `integration_connections` scopes to org or subaccount via nullable FKs. No ownership, no visibility, no classification.
- `agent_runs` carries `userId` (triggering user) but has no principal-type discriminator. Scheduled jobs set `userId` to a placeholder or null.
- Canonical rows have no `owner_user_id`, no `visibility_scope`, no `source_connection_id` in most tables.
- No `delegation_grants`, no `service_principals`, no `teams` table.
- No helper for manufacturing or propagating a `PrincipalContext`. Reads take `organisationId` as a naked argument.

#### Design

**New tables.**

```
service_principals
  id uuid pk
  organisation_id uuid not null
  subaccount_id uuid nullable
  service_id text not null                   -- stable identifier e.g. 'service:canonical-polling'
  display_name text not null
  created_at timestamptz not null default now()
  disabled_at timestamptz nullable
  unique (organisation_id, service_id)

teams
  id uuid pk
  organisation_id uuid not null
  subaccount_id uuid nullable                -- team may be org-scoped or subaccount-scoped
  name text not null
  created_at timestamptz not null default now()
  deleted_at timestamptz nullable

team_members
  team_id uuid fk
  user_id uuid fk
  added_at timestamptz not null default now()
  primary key (team_id, user_id)

delegation_grants
  -- shape defined in Principal model section
  -- unique constraint on active grants: (grantor_user_id, grantee_kind, grantee_id, subaccount_id)
  -- where revoked_at is null AND expires_at > now()

canonical_row_subaccount_scopes
  canonical_table text not null               -- e.g. 'canonical_emails'
  canonical_row_id uuid not null
  subaccount_id uuid not null fk
  attribution enum('primary','mentioned','shared') not null
  created_at timestamptz not null default now()
  primary key (canonical_table, canonical_row_id, subaccount_id)
  index (subaccount_id, canonical_table)
```

**Additive columns.**

On `integration_connections`:

```sql
ALTER TABLE integration_connections
  ADD COLUMN ownership_scope enum('user','subaccount','organisation') NOT NULL DEFAULT 'subaccount',
  ADD COLUMN owner_user_id uuid REFERENCES users(id),
  ADD COLUMN classification enum('personal','shared_mailbox','service_account') NOT NULL DEFAULT 'shared_mailbox',
  ADD COLUMN visibility_scope enum('private','shared_team','shared_subaccount','shared_org') NOT NULL DEFAULT 'shared_subaccount',
  ADD COLUMN shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT connection_owner_consistency CHECK (
    (ownership_scope = 'user' AND owner_user_id IS NOT NULL)
    OR (ownership_scope <> 'user' AND owner_user_id IS NULL)
  );

CREATE INDEX integration_connections_owner_user_id_idx ON integration_connections (owner_user_id) WHERE deleted_at IS NULL;
```

Existing connections are backfilled to `ownership_scope = 'subaccount' | 'organisation'` (matching their current FK), `classification = 'shared_mailbox'` (they are all shared today), and `visibility_scope = 'shared_subaccount' | 'shared_org'`.

On `agent_runs`:

```sql
ALTER TABLE agent_runs
  ADD COLUMN principal_type enum('user','service','delegated') NOT NULL DEFAULT 'user',
  ADD COLUMN principal_id text NOT NULL DEFAULT '',            -- userId or serviceId
  ADD COLUMN acting_as_user_id uuid REFERENCES users(id),      -- delegated only
  ADD COLUMN delegation_grant_id uuid REFERENCES delegation_grants(id);

CREATE INDEX agent_runs_principal_idx ON agent_runs (principal_type, principal_id);
```

Existing runs are backfilled: rows with `user_id` populated → `principal_type = 'user', principal_id = user_id::text`; rows triggered by scheduled jobs (identified by source) → `principal_type = 'service', principal_id = '<inferred service id>'`.

`agent_runs` already gained `is_test_run boolean` in migration 0153 (Feature 2 — inline Run Now test UX). **Principal type is orthogonal to test-run status**: a `user`-principal run can also be `is_test_run = true`, and a `service`-principal scheduled run cannot. P3A must not collapse the two — treat `is_test_run` as a runtime mode flag and `principal_type` as the identity of the actor. The `agent_test_fixtures` table (migration 0153) is app-surface user-authored data and is **not** a canonical_* table — it is already in `RLS_PROTECTED_TABLES` and out of scope for the canonical data dictionary.

On every canonical table, the columns defined in [Canonical data model conventions](#canonical-data-model-conventions) — `owner_user_id`, `visibility_scope`, `shared_team_ids`, `source_connection_id` — are added if not already present. Backfill rules per table are documented in the P3 implementation spec, not here.

**Principal context helper.**

A new module `server/services/principal/` owns principal-context construction and propagation:

```typescript
// server/services/principal/principalContext.ts
export async function buildUserPrincipal(userId: string, organisationId: string, subaccountId: string | null, requestId: string): Promise<UserPrincipal>;
export function buildServicePrincipal(serviceId: string, organisationId: string, subaccountId: string | null, requestId: string): ServicePrincipal;
export async function buildDelegatedPrincipal(grantId: string, triggeredByUserId: string | null, requestId: string): Promise<DelegatedPrincipal>;

// Attached to req.principal by auth middleware
// Attached to job context by the pg-boss worker wrapper
// Passed explicitly into every service call that reads canonical
```

Existing middleware (auth) and the `createWorker()` wrapper are updated to populate `req.principal` and the job context respectively. Route handlers and job handlers receive the principal implicitly; service-layer calls receive it explicitly as the first argument.

**Service-layer signature change.**

`canonicalDataService` methods change from accepting `(organisationId, ...)` to `(principal, ...)`. The service extracts `organisationId`, `subaccountId`, and scope predicates from the principal. Calls without a principal fail at compile time (TypeScript) and at runtime (service throws).

This is a mechanical but wide-reaching change. Every caller is updated in the same commit. Static gate `verify-principal-context-propagation.sh` greps for service calls that take a bare `organisationId` and fails the build.

#### Pure helpers + tests

- `visibilityPredicatePure.ts` — pure function decided on any (row, principal) pair. Exhaustive fixtures: 3 principal types × 4 visibility scopes × 2 owner relationships × 2 org-match states.
- `principalContextConstructorsPure.ts` — pure builders from fixture data. Fixture-driven tests verify each type's invariants (e.g. delegated principal has a grant id; service principal has no user id).
- `delegationGrantValidatorPure.ts` — given a grant and an intended action+table, decides permit/deny. Fixtures cover expired, revoked, out-of-scope table, out-of-scope action.

#### Static gates

- `scripts/verify-principal-context-propagation.sh` — service calls that accept `organisationId` as a bare argument fail CI.
- `scripts/verify-canonical-required-columns.sh` — canonical tables missing any of the required columns (per conventions section) fail CI.
- `scripts/verify-connection-shape.sh` — integration-connection rows without `ownership_scope`, `classification`, `visibility_scope` set fail CI.

#### Out of scope for P3A

- RLS policies (P3B).
- Client-facing UI for managing teams, delegation grants, or connection visibility (named requirements, built as part of P3B or in a follow-on UI task).
- Backfill of historical `tool_call_security_events` with principal-type fields — the audit log gains the fields forward-only.

#### Entry criteria

- P2A landed — canonical reads go through `canonicalDataService`, so the signature change is contained.
- P2B landed — the dictionary describes the current schema, so P3A schema additions can be added to the dictionary in the same commit.

#### Exit criteria

- All additive migrations landed with backfills and indexes.
- `canonicalDataService` methods take principal context as first argument. Every caller updated.
- Principal context populated at every execution entry point (route, job, webhook).
- Pure helpers and static gates in place.
- Dictionary entries updated for new columns and new tables.
- `pr-reviewer` + `dual-reviewer` passed.

### P3B — Postgres RLS + enforcement

#### Goal

Postgres Row-Level Security enforces tenancy and principal-scoped visibility on every canonical table, every connection table, and every principal table. Session variables carry the principal context; policies read those variables. Service-layer checks remain as defence-in-depth. The database is the last line of defence.

#### Current state after P3A

- All tables carry the required scoping columns.
- Principal context is constructed at entry points and passed through service calls.
- `canonicalDataService` enforces scope at the service layer.
- **Org-level RLS already exists** (Sprint 2 P1.1, migrations 0079–0082+) on 25+ tables — manifest in `server/config/rlsProtectedTables.ts`, keyed on `current_setting('app.organisation_id', true)`. P3B extends those existing policies with principal-scoped predicates; it does not introduce RLS from scratch.
- No principal-scoped RLS predicates exist on any table.
- No RLS policies exist on any canonical_* table (canonical tables themselves are introduced by P2 / P4 / P5 and inherit RLS as they ship).

#### Design

**Session-variable convention.**

`SET LOCAL` variables, set at the start of every logical database session:

| Variable | Type | Value | Status |
|---|---|---|---|
| `app.organisation_id` | uuid | Always required | **Already shipped** — used by existing org-RLS policies |
| `app.current_subaccount_id` | uuid | Null = org-level run | New in P3B |
| `app.current_principal_type` | text | `'user' \| 'service' \| 'delegated'` | New in P3B |
| `app.current_principal_id` | text | userId, serviceId, or acting-as-userId | New in P3B |
| `app.current_team_ids` | uuid[] | Team IDs the current user belongs to; derived from a join against `team_members` and set per-session. Empty array for service/delegated principals. | New in P3B |

**Naming-decision deferred to P3B implementation spec:** the shipped variable is `app.organisation_id` (no `current_` prefix). The new principal variables introduced here use the `app.current_*` family. Two options the implementation spec must pick between: (a) accept the asymmetry — keep `app.organisation_id` as-is and ship the three new variables under `app.current_*`; (b) rename `app.organisation_id` → `app.current_organisation_id` in a migration that also rewrites every existing policy and updates `server/middleware/orgScoping.ts`. Option (a) is the cheap default; option (b) is cosmetic-only and has wide blast radius. **Listed as an open question** below.

**Session lifecycle.**

Centralised in `server/db/withPrincipalContext.ts`, layered on top of the existing `withOrgTx` / `getOrgScopedDb` plumbing in `server/middleware/orgScoping.ts` + `server/instrumentation.ts`:

```typescript
export async function withPrincipalContext<T>(
  principal: PrincipalContext,
  work: (tx: DbHandle) => Promise<T>
): Promise<T>
```

Internally this calls into the existing `withOrgTx` helper (which already sets `app.organisation_id` and opens a transaction) and additionally issues `SET LOCAL` for the three new principal variables. Every route handler, job handler, and webhook handler that previously called `withOrgTx` directly is migrated to `withPrincipalContext`. Direct database access that does not go through `withPrincipalContext` is a static-gate violation — extending the existing `verify-rls-contract-compliance.sh` gate rather than duplicating it.

Connection pooling: pg-boss and the app share a pool configured to use transaction-mode pooling, which makes `SET LOCAL` variables session-safe. The helper begins a transaction, sets the variables, runs the work, commits. If a call does not need a transaction, the helper still opens one for the duration of the variable scope — this is the standard Postgres RLS pattern, and the overhead is negligible.

**Policy shape.**

Representative policy for a 1:1-scoped canonical table (`canonical_contacts`):

```sql
CREATE POLICY canonical_contacts_read ON canonical_contacts
  FOR SELECT
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      -- service principals: shared-scope only
      (current_setting('app.current_principal_type', true) = 'service' AND visibility_scope IN ('shared-subaccount','shared-org')
        AND (subaccount_id IS NULL OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))
      OR
      -- user principals
      (current_setting('app.current_principal_type', true) = 'user' AND (
        (visibility_scope = 'private' AND owner_user_id::text = current_setting('app.current_principal_id', true))
        OR (visibility_scope = 'shared-team' AND shared_team_ids && current_setting('app.current_team_ids', true)::uuid[])
        OR (visibility_scope = 'shared-subaccount' AND (subaccount_id IS NULL OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))
        OR visibility_scope = 'shared-org'
      ))
      OR
      -- delegated principals: narrow scope, validated further at service layer
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND visibility_scope = 'private'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );
```

Policies for multi-scoped tables (emails, calendar events) join through `canonical_row_subaccount_scopes`.

Write policies (INSERT, UPDATE, DELETE) are defined per-table:

- Most canonical tables allow writes only from adapters, which run as a dedicated service role (`canonical_writer`) bypassing RLS on writes.
- User-facing tables (e.g. `delegation_grants`, `teams`, `team_members`) have RLS write policies that ensure users only mutate rows they own.

**Tables excluded from RLS.**

Platform-level tables that legitimately need cross-tenant access (system config, skill definitions, action registry, platform-admin-only tables) are explicitly named in a registry at `server/db/rlsExclusions.ts` with rationale. A static gate verifies every other table has at least one SELECT policy.

**Service-layer check retention.**

`canonicalDataService` keeps explicit `organisationId` assertions and filter clauses. The reasoning: a query that returns "zero rows" because RLS filtered them out is indistinguishable at the result level from "this org has no contacts." Without the service-layer assertion, developers get silent empty results instead of loud "you forgot to pass the principal" errors. The service layer is the developer-facing error surface; RLS is the hardened safety net.

**Role separation.**

- `app_reader` — the role used by most application queries. RLS applies. (Most existing app traffic already runs under the default app role with RLS enforced; `app_reader` here is a clarifying name for that posture, not necessarily a new Postgres role.)
- `canonical_writer` — new in P3B. Used only by adapter write paths. Bypasses RLS on INSERT/UPDATE/DELETE (RLS on writes is enforced by the service layer that runs as this role, which only adapters can invoke). Narrower than the existing `admin_role` — it can write canonical_* tables but cannot bypass RLS for reads of app-surface tables.
- `migration_runner` — used only for schema migrations. Bypasses RLS entirely.
- `admin_role` — **already exists** (used by `withAdminConnection`, migrations 0079+, agent-run cleanup, memory-blocks maintenance). The full break-glass role. P3B does not replace or rename it; it remains the only escape hatch for cross-tenant operations and is not an application role for normal request paths.

#### Pure helpers + tests

- `rlsPredicateSqlBuilderPure.ts` — generates the policy SQL given a table's scoping shape. Fixture tests cover 1:1 scoped, multi-scoped, and personal-owned tables.
- `visibilityParityTestHarness.ts` — a test harness that runs the pure `visibilityPredicate` against a fixture and replays equivalent SQL against a throwaway Postgres instance seeded with the same fixtures. Verifies parity between the pure predicate and the SQL policy. Run in a dedicated static gate; not a runtime test.

#### Static gates

- `scripts/gates/verify-rls-coverage.sh` — **already exists** (Sprint 2 P1.1). P3B extends the underlying `RLS_PROTECTED_TABLES` manifest with every new canonical, connection, principal, and personal-data table; the gate continues to enforce that every manifest entry has a matching `CREATE POLICY` migration.
- `scripts/verify-visibility-parity.sh` — new in P3B. Runs the parity harness; fails if pure predicate and SQL policy diverge on any fixture.
- `scripts/gates/verify-rls-contract-compliance.sh` — **already exists**. P3B extends it (or adds a sibling `verify-with-principal-context.sh`) so direct database access outside `withPrincipalContext` is forbidden; grep-based enforcement on top of the existing `withOrgTx` enforcement.

#### Out of scope for P3B

- Per-row encryption. Separate concern; noted in deferred items.
- Admin UIs for teams, delegation grants, visibility changes on connections. Named requirement; built in a UI-focused follow-on, not blocking P3B exit. **Note:** this task is not UI-only — changing a connection's team visibility requires a background job to propagate the new `shared_team_ids` to all canonical rows ingested from that connection (see stale-data limitation in Required columns). The follow-on spec must include that backfill job.
- Auditing UI for "who has read my data." The audit log exists from P3A; a user-facing view of it is separate.

#### Entry criteria

- P3A landed — all tables carry required columns, all callers pass principal context.

#### Exit criteria

- RLS policies on every in-scope table.
- `withPrincipalContext` helper in place and used at every entry point.
- Parity harness passes.
- All three static gates in `scripts/run-all-gates.sh`.
- Exclusion registry documents every platform table that legitimately bypasses RLS.
- `pr-reviewer` + `dual-reviewer` passed.

---

## P4 — Gmail adapter (thin canonical)

**Verdict: BUILD AFTER P3.** Gmail is the first integration to introduce `personal`-classified, user-owned connections at scale. It is the load-bearing test of the principal model and RLS from P3. Per D7, canonical for Gmail is metadata-only; bodies are live-fetch.

### Goal

An agency user can connect their personal Gmail. Metadata flows to `canonical_emails` under their principal scope. Agents reason over cadence, thread navigation, and entity links without any body content persisted. When an agent genuinely needs a body, it calls `fetch_email_body` which hits Gmail API under the invoking principal's credentials, returns the body, and does not write. When an agent needs to organise emails (e.g. automated inbox labelling), it calls `modify_email_labels` which applies/removes labels via the Gmail API under the principal's credentials and syncs the canonical row.

### Current state

No Gmail adapter. No `canonical_emails` table. No OAuth flow for personal-scoped connections — all existing OAuth flows are agency/subaccount-owned.

### Design

**OAuth setup.**

Google Cloud project per environment (dev / staging / prod) with OAuth 2.0 credentials configured. Scopes requested:

- `https://www.googleapis.com/auth/gmail.readonly` — read-only access to messages, threads, labels.
- `https://www.googleapis.com/auth/gmail.metadata` — metadata-only access if the user wants to connect with tighter scope. Preferred scope when the product only needs metadata and the user does not anticipate invoking `fetch_email_body`.
- `openid email profile` — standard OIDC for identifying the user.

The connection-creation UI lets the user choose between `metadata-only` and `metadata + readable body on demand`. Choice is recorded on the connection row. Changing later requires re-consent.

An additional scope tier, `metadata + labels`, is available for users who want agents to manage their labels:

- `https://www.googleapis.com/auth/gmail.modify` — read and modify messages (labels, read/unread, archive). Required for the `modify_email_labels` skill. Not requested unless the user explicitly opts in to label management.

`gmail.send` is **not** requested by this program. A future "send email" skill gets a separate connection (or scope-upgrade flow) — design explicitly out of scope for P4.

**Connection-creation flow.**

1. User clicks "Connect Gmail" in the connection-management UI.
2. UI prompts: "Ownership: personal (recommended for your own inbox) or shared mailbox (for sales@, support@, etc.)?" Default: personal.
3. UI prompts for scope tier:
   - **Metadata only** — read-only, cheapest scope. Default.
   - **Metadata + read-on-demand body access** — agents can fetch email bodies live.
   - **Metadata + label management** — agents can read metadata and apply/remove labels. Requires `gmail.modify`.
   - **Full access (body + labels)** — combines body reads and label management.
4. UI previews the effective visibility (for personal: "Private — only you and agents you authorise will see this data").
5. Google OAuth consent screen (scopes vary by tier selected in step 3).
6. Tokens encrypted and stored via `connectionTokenService`. Connection row written with `ownership_scope = 'user'`, `owner_user_id = connecting user`, `classification = 'personal'`, `visibility_scope = 'private'`. The selected scope tier is recorded in `ingestion_config_json` so skills can check at invocation time whether the connection authorises the requested operation.

For shared mailboxes, the flow branches: `ownership_scope = 'subaccount' | 'organisation'`, `classification = 'shared_mailbox'`, `visibility_scope = 'shared-subaccount' | 'shared-org'`.

**Ingestion strategy.**

Two parallel paths, matching the existing connector lifecycle phases:

| Phase | Method | Purpose |
|---|---|---|
| `backfill` | Paginated `gmail.users.messages.list` with historical query, N pages per tick, full history to depth limit | Initial load |
| `transition` | Backfill continuing + `users.watch` push notifications (via Cloud Pub/Sub) | Overlap window |
| `live` | `users.watch` push notifications only; periodic low-frequency reconciliation poll | Steady state |

Historical backfill depth defaults to 12 months. Configurable per connection via `ingestion_config_json`. Beyond the depth limit, mail is not ingested.

**Metadata extraction.**

For each message, the adapter fetches metadata format (`format=metadata`) which returns headers, labels, and size without body. The pure helper `gmailMessageToCanonicalPure.ts` transforms the Gmail API payload into a `canonical_emails` row:

- Subject, timestamps, thread ID, in-reply-to, references from headers.
- Participants (from/to/cc/bcc) parsed and resolved to canonical contacts where the email address matches a known canonical contact in the same org/subaccount scope. Unresolved participants are stored as bare `{ email, displayName }` JSON; resolution is retried at read time if the contact appears later.
- Labels copied verbatim. Gmail labels map cleanly onto the thin canonical model.
- Attachment headers (filename, MIME type, size) extracted to `attachment_metadata_json`. Bytes not fetched.

**AI classifications at ingest.**

A small, cheap classification pass runs at ingest time on metadata-plus-subject (not body):

- `category`: one of a provider-independent enum (`transactional` | `promotional` | `relationship` | `internal` | `other`).
- `urgency`: `low` | `medium` | `high` based on subject-line heuristics + labels + sender domain.
- `topic_tags`: short list of topic tags derived from subject + contact links.

Classifications are stored on the row, enabling fast filtered queries without rerunning LLM calls on every query. Classifications are versioned (`classification_version`) so the set of classifications can evolve without invalidating all history.

For the `metadata + read-on-demand body` connections, additional classifications that require body access are possible but are explicitly deferred — running LLM classification on every ingested body during backfill is a cost profile that needs separate commercial sign-off, and the program's anti-goal is "not an email archiver."

**Ingestion filters.**

Per-connection filters, declared at connection time and editable:

- **Label exclusions** — messages with any listed label are skipped.
- **Sender exclusions** — messages from listed senders or domains are skipped.
- **Folder exclusions** — messages in listed folders (e.g. Trash, Spam) are skipped.
- **Date range** — older-than cutoff; newer-than for testing.

Filters applied in `gmailIngestionFilterPure.ts`. Fixture-driven tests exhaustive per filter type.

**Push-notification handling.**

`users.watch` creates a Pub/Sub subscription. The adapter's webhook endpoint receives push messages, fetches the delta via `history.list`, and upserts into canonical. Idempotent via `(source_connection_id, provider_message_id)` unique constraint.

Push subscriptions expire after 7 days per Google policy. A scheduled job re-registers watches for active connections every 3 days (`gmail-watch-refresh` job).

#### Contracts

- Adapter runs under a `ServicePrincipal` when invoked by the scheduler (`service:gmail-ingestion`).
- Every canonical row written carries the full principal/ownership/visibility fields derived from the connection.
- The linkage table `canonical_row_subaccount_scopes` is populated for every email, default attribution: `primary = owning user's current subaccount` if ownership is `user`; `mentioned = any subaccount the resolved contacts belong to that differs from primary`. Pure helper `emailScopeAttributionPure.ts` encodes the rule; fixture tests cover cross-subaccount cases.

#### Pure helpers + tests

- `gmailMessageToCanonicalPure.ts` — payload → canonical row.
- `gmailIngestionFilterPure.ts` — filter evaluation.
- `emailScopeAttributionPure.ts` — scope attribution from participants.
- `gmailClassificationPromptPure.ts` — prompt construction for the cheap classification pass (LLM invocation itself is impure; prompt construction is pure).

Each has fixture tests with representative Gmail API payloads (sanitised, anonymised).

- `gmailLabelResolverPure.ts` — label name → ID resolution logic, cache management (TTL + error-triggered invalidation), and label-creation decision. Fixture tests cover: existing label lookup, cache hit, cache miss, TTL expiry, 404-triggered refresh, label creation for unknown names, case-insensitive matching.
- `modifyEmailLabelsValidatorPure.ts` — validates scope tier permits modification, rate-limit check, batch-size check, delegation grant check, delta computation (desired-state vs current-state). Fixture tests cover each rejection path plus empty-delta skip.
- `modifyEmailLabelsBatchPure.ts` — batch result aggregation, partial-failure semantics, retry-subset computation. Fixture tests cover: all-succeed, all-fail, partial-fail, all-skipped (empty delta), retry-of-failed-subset idempotency.

#### Static gates

- `scripts/verify-email-thin-canonical.sh` — fails if any column in `canonical_emails` is named `body`, `body_text`, `body_html`, or matches attachment-bytes patterns. Enforces D7 at schema level.
- `scripts/verify-live-fetch-skill.sh` — ensures `fetch_email_body` and `modify_email_labels` are declared `readPath: 'liveFetch'` with documented rationale.
- `scripts/verify-modify-labels-scope-check.sh` — ensures the `modify_email_labels` skill checks `gmail.modify` scope before calling the Gmail API. Grep-based enforcement against the skill handler source.

### `canonical_emails` schema

```sql
CREATE TABLE canonical_emails (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid,                                 -- always null; use linkage table
  source_connection_id uuid NOT NULL REFERENCES integration_connections(id),
  owner_user_id uuid REFERENCES users(id),            -- set for personal-owned connections
  visibility_scope scope_enum NOT NULL,
  shared_team_ids uuid[] NOT NULL DEFAULT '{}',       -- teams with visibility (shared-team scope only; {} for private rows)
  provider text NOT NULL,                             -- 'gmail' (future: 'outlook')
  provider_message_id text NOT NULL,
  provider_thread_id text NOT NULL,
  in_reply_to text,
  message_references text[],
  subject text,                                       -- capped at 1024 chars; truncate with ellipsis
  sent_at timestamptz NOT NULL,
  received_at timestamptz,
  from_json jsonb NOT NULL,                           -- { email, displayName, canonicalContactId? }
  to_json jsonb NOT NULL,                             -- array of participants
  cc_json jsonb NOT NULL DEFAULT '[]',
  bcc_json jsonb NOT NULL DEFAULT '[]',
  labels text[] NOT NULL DEFAULT '{}',
  folder text,
  read boolean,
  attachment_metadata_json jsonb NOT NULL DEFAULT '[]', -- array of { filename, mimeType, sizeBytes }
  classification_version integer NOT NULL,
  category email_category_enum,
  urgency email_urgency_enum,
  topic_tags text[] NOT NULL DEFAULT '{}',
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz,
  deleted_at timestamptz,

  UNIQUE (source_connection_id, provider_message_id),
  CONSTRAINT no_body_column CHECK (true)              -- placeholder; static gate enforces the rule
);

CREATE INDEX canonical_emails_org_idx ON canonical_emails (organisation_id) WHERE deleted_at IS NULL;
CREATE INDEX canonical_emails_owner_idx ON canonical_emails (organisation_id, owner_user_id) WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL;
CREATE INDEX canonical_emails_thread_idx ON canonical_emails (organisation_id, provider_thread_id);
CREATE INDEX canonical_emails_sent_idx ON canonical_emails (organisation_id, sent_at DESC);
CREATE INDEX canonical_emails_labels_gin ON canonical_emails USING gin (labels);
CREATE INDEX canonical_emails_shared_team_gin ON canonical_emails USING gin (shared_team_ids);
CREATE INDEX canonical_emails_source_idx ON canonical_emails (source_connection_id, ingested_at DESC);
```

Explicitly absent: any column whose name or purpose implies body content.

Canonical scope attribution lives in `canonical_row_subaccount_scopes` (per D4).

### `fetch_email_body` live-fetch skill

```typescript
// server/skills/fetchEmailBody/fetchEmailBody.ts
export const fetchEmailBodyAction: ActionDefinition = {
  name: 'fetch_email_body',
  readPath: 'liveFetch',
  liveFetchRationale: 'D7 — email bodies are not persisted to canonical by policy. Body content is fetched on demand, under the invoking principal\'s credentials, and returned to the agent without persistence.',
  requiresApproval: 'per-run',          // HITL required for each run's first body fetch
  // ... other existing ActionDefinition fields ...
};
```

**Invocation flow:**

1. Agent requests `fetch_email_body` with a `canonical_email_id`.
2. The `actionService.proposeAction` path runs; `requiresApproval: 'per-run'` routes the first invocation to HITL review. Subsequent invocations within the same run inherit the approval for that run (per existing HITL patterns documented in `docs/agent-orchestration-hitl-reference.md`).
3. Skill loads the canonical email row under the current principal context. If the row is not visible to the principal (RLS filters it out), the skill returns "email not found" — it does not leak existence.
4. Skill resolves `source_connection_id`, loads the connection, decrypts the OAuth token via `connectionTokenService`, calls `gmail.users.messages.get(format='full')`.
5. Body is returned to the agent's working context. `tool_call_security_events` logs the fetch with `fetchMode: 'live'`, the principal, the canonical email ID, and the byte size returned.
6. Nothing is written to canonical.

**Guardrails:**

- Rate limit per principal: configurable per-principal cap on body fetches per run (default 20). Prevents runaway agents from exfiltrating an inbox.
- `runCostBreaker` (existing primitive) applies — body fetches count against the run's cost budget.
- Delegated principals: the grant must include `fetch_email_body` in `allowed_actions`. Otherwise refuse.

### `modify_email_labels` write-back skill

```typescript
// server/skills/modifyEmailLabels/modifyEmailLabels.ts
export const modifyEmailLabelsAction: ActionDefinition = {
  name: 'modify_email_labels',
  readPath: 'liveFetch',
  liveFetchRationale: 'Write-back skill — modifies labels on the provider (Gmail API) under the invoking principal\'s credentials. Updates the canonical row\'s labels array after successful modification to keep canonical in sync.',
  requiresApproval: 'per-run',
  // ... other existing ActionDefinition fields ...
};
```

**Idempotency contract:**

Label mutations are defined as a **desired-state operation**, not an imperative add/remove:

```
final_labels = (current_labels - removeLabels[]) ∪ addLabels[]
```

The skill reads the email's current label set from canonical before calling the Gmail API, computes the delta, and only applies the diff. If the delta is empty (labels already match desired state), the skill returns success without calling Gmail. This makes retries safe and deterministic — the same invocation always converges to the same final state regardless of how many times it runs. The idempotency key for deduplication is `(provider_message_id, sorted(addLabels), sorted(removeLabels))`.

**Invocation flow:**

1. Agent requests `modify_email_labels` with a `canonical_email_id`, `addLabels: string[]`, and `removeLabels: string[]`.
2. `actionService.proposeAction` runs; `requiresApproval: 'per-run'` routes the first invocation per run to HITL review. Subsequent label modifications within the same run inherit the approval.
3. Skill loads the canonical email row under the current principal context. If not visible (RLS), returns "email not found."
4. Skill checks the connection's scope tier (stored in `ingestion_config_json`). If the connection does not have `gmail.modify` scope, the skill returns a clear error: "This connection does not authorise label modifications. The user must upgrade their connection scope."
5. Skill computes the delta between the row's current `labels` array and the desired state. If the delta is empty, returns `{ status: 'no_change' }` without calling Gmail.
6. Skill resolves `source_connection_id`, loads the connection, decrypts the OAuth token, calls `gmail.users.messages.modify` with only the delta `{ addLabelIds, removeLabelIds }`.
7. On success, the canonical email row's `labels` array is updated in place to reflect the new label set. This is the one write-back path that touches canonical — it keeps the metadata in sync with the provider rather than waiting for the next ingestion poll.
8. `tool_call_security_events` logs the modification with `action: 'modify_labels'`, the principal, the canonical email ID, the labels added/removed, and `before_labels` / `after_labels` arrays for audit diffing.

**Label resolution:**

Gmail labels are identified by ID internally but named by the user. The skill accepts human-readable label names and resolves them to Gmail label IDs via `gmail.users.labels.list`. If a requested label does not exist, the skill creates it via `gmail.users.labels.create` (only if the connection has `gmail.modify` scope). Label ID ↔ name mappings are cached per connection with a **15-minute TTL** to balance API call reduction against staleness risk.

**Cache invalidation strategy:** Labels can be renamed, deleted, or created externally (by the user in Gmail, or by other clients). The cache handles this via two mechanisms:
- **TTL expiry** — the 15-minute TTL ensures the cache self-heals without operator intervention.
- **Error-triggered refresh** — if the Gmail API returns a `404` or `invalidLabel` error for a cached label ID, the cache is immediately invalidated for that connection and the label list is re-fetched before retrying the operation. This handles mid-TTL renames or deletions without waiting for expiry.

Label name matching is case-insensitive (Gmail labels are case-insensitive). The resolver normalises names before cache lookup.

**Guardrails:**

- Rate limit per principal: configurable cap on label modifications per run (default 50). Prevents mass-relabelling of an entire inbox in a single run.
- `runCostBreaker` applies — each modification counts against the run's cost budget (API call cost, not LLM cost).
- Delegated principals: the grant must include `modify_email_labels` in `allowed_actions`.
- Batch support: the skill accepts an array of `canonical_email_id`s for bulk labelling in a single invocation (up to the per-run cap). Each email is modified individually via the Gmail API (no batch endpoint for label modification). Partial failure semantics:
  - The batch does NOT abort on individual failures. Each email is attempted independently.
  - Result structure: `{ total: number, succeeded: number, failed: Array<{ canonicalEmailId, errorCode, errorMessage }>, skipped: number }`. `skipped` counts emails where the delta was empty (already in desired state).
  - Run status follows the existing `completed_with_errors` pattern if any emails fail.
  - On retry (pg-boss / manual), only the `failed` subset is retried — the idempotency contract ensures already-succeeded emails are no-ops on re-invocation.
  - Canonical rows are synced per-email immediately on success, not batched — a partial failure leaves successfully-modified rows in sync and failed rows unchanged.

### Connection-revocation deletion contract

When a personal Gmail connection is disconnected (by the user) or removed (by an org admin removing the user):

- `canonical_emails` rows where `source_connection_id = this connection` are soft-deleted (`deleted_at` set) within 60 seconds of disconnect.
- A scheduled job `canonical-email-purge` hard-deletes soft-deleted rows older than the per-org `dataDeletionGracePeriodDays` (default 30, configurable down to 0 for stricter orgs).
- The purge job is idempotent. Running it twice is a no-op.

### Out of scope for P4

- Send-email skill. Requires `gmail.send` scope, which this program does not request. Separate connection or scope-upgrade flow.
- Outlook adapter. The adapter abstraction is kept general enough to slot Outlook in later; this is an implementation-spec-level concern, not a program concern.
- Full-text search over email metadata at scale. Current index set is sufficient for expected query volumes.
- Vector embedding of email content. Per D6, deferred.
- Archive/delete/mark-as-read write-back skills. Only label modification is in scope for P4. Other write-back operations are straightforward extensions of the same pattern but require separate HITL and guardrail decisions.

### Entry criteria

- P3A and P3B landed — principal context + RLS exist. Personal-owned connections have somewhere safe to land.
- P2A and P2B landed — `canonicalDataService` is the read interface; dictionary entry will be added in the same commit as the schema.

### Exit criteria

- Gmail OAuth flow works for personal and shared-mailbox connections, with scope tiers (metadata-only / body / labels / full) correctly driving which scopes are requested.
- Ingestion pipeline running in dev/staging: backfill → transition → live with working push notifications.
- `canonical_emails` populated under correct principal/ownership/visibility fields; verified by an integration-level fixture test against a seeded org.
- `fetch_email_body` skill working, subject to HITL approval, correctly refusing to fetch across principal boundaries.
- `modify_email_labels` skill working, subject to HITL approval, correctly refusing when connection lacks `gmail.modify` scope. Label creation, resolution, and canonical sync verified by fixture tests.
- `canonical-email-purge` job running.
- Dictionary entry for `canonical_emails`.
- `pr-reviewer` + `dual-reviewer` passed.

---

## P5 — Google Calendar adapter (full canonical)

**Verdict: BUILD AFTER P4.** Calendar reuses the Gmail OAuth infrastructure, the personal-connection pattern, and the principal/RLS plumbing. Per D7, calendar is full canonical — events, descriptions, attendees, times, locations, status. Smaller scope than P4.

### Goal

An agency user can connect their personal Google Calendar. Events flow to `canonical_calendar_events` under their principal scope. Agents reason over meeting cadence, attendee relationships, upcoming availability, and meeting-density signals for health scoring. Calendar rows are full records (unlike emails); there is no live-fetch for calendar bodies because there is nothing excluded from canonical.

### Current state

No Calendar adapter. No `canonical_calendar_events` table.

### Design

**OAuth reuse.**

Uses the Google Cloud project and OAuth credentials from P4. Scopes added:

- `https://www.googleapis.com/auth/calendar.readonly` — read calendars and events.
- `https://www.googleapis.com/auth/calendar.events.readonly` — finer-grained alternative if the user wants to restrict to events (no calendar-list metadata).

Creating a calendar connection alongside an existing Gmail connection for the same user is a single consent flow — Google handles incremental scope grants. The UI presents this as "Connect calendar (adds to your existing Gmail connection)" rather than a new connection row. Behind the scenes, it remains one `integration_connections` row with an expanded scope set.

Send/write scopes are **not** requested. Event creation and modification are out of scope for this program.

**Ingestion strategy.**

Same three-phase lifecycle as Gmail:

| Phase | Method | Purpose |
|---|---|---|
| `backfill` | `events.list` per calendar, paginated, historical to depth limit | Initial load |
| `transition` | Backfill continuing + `events.watch` push notifications | Overlap window |
| `live` | Push notifications + low-frequency reconciliation poll | Steady state |

Historical backfill depth: 6 months past + 12 months future (default). Future depth matters — calendar analytics often want "what meetings are scheduled over the next quarter?"

Push subscriptions via `events.watch` have the same 7-day expiry as Gmail; the same `watch-refresh` pattern applies (`calendar-watch-refresh` job, re-registers every 3 days).

**Event extraction.**

Full event payload maps to `canonical_calendar_events`:

- Title, description (capped at 8 KB; truncate with marker if longer).
- Start, end, timezone, all-day flag.
- Location (string — we do not model structured location).
- Status (`confirmed` | `tentative` | `cancelled`).
- Visibility (the Google event visibility — `default` | `public` | `private` | `confidential`). **This is the Google-level event visibility, distinct from our `visibility_scope`.** Google-level `private` events default to canonical `visibility_scope = private` on personal connections (they were marked private on Google's side for a reason).
- Organiser (participant with canonical contact link if resolvable).
- Attendees (array of participants with canonical contact link where resolvable, plus response status).
- Recurrence rule (RRULE string) and series ID; individual occurrences are expanded or stored as series + exceptions per a rule in `calendarEventExpansionPure.ts`.
- Meeting URL (Zoom/Meet/etc. — extracted from conferencing data).

**AI classifications at ingest.**

Smaller than Gmail classifications, but useful:

- `meeting_type`: `internal` | `client` | `prospect` | `partner` | `personal` | `other`. Inferred from attendee domains relative to org + subaccount.
- `topic_tags`: short list from title + description.

Stored with `classification_version` for evolution.

**Ingestion filters.**

Per-connection filters:

- **Calendar exclusions** — exclude specific calendars (e.g. personal `birthdays@`, shared holiday calendars).
- **Event visibility exclusions** — default: exclude Google-level `private` events from ingestion entirely (not just from downstream visibility). Users can opt in to including private events under the canonical `private` visibility scope.
- **Title regex exclusions** — e.g. exclude events whose title matches a regex the user defines, for explicit privacy control.

### Contracts

- Same adapter-runs-under-service-principal pattern as Gmail.
- Multi-scope attribution handled via `canonical_row_subaccount_scopes`. Attribution rule: `primary = owning user's current subaccount`; `mentioned = any subaccount identified from attendee domains`. Pure helper `calendarEventScopeAttributionPure.ts`.
- Recurrence expansion is deterministic. The pure helper produces the same expansion given the same inputs, critical for idempotent upsert across reprocess.

### Schema

```sql
CREATE TABLE canonical_calendar_events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid,                                 -- null; use linkage table
  source_connection_id uuid NOT NULL REFERENCES integration_connections(id),
  owner_user_id uuid REFERENCES users(id),
  visibility_scope scope_enum NOT NULL,
  shared_team_ids uuid[] NOT NULL DEFAULT '{}',       -- teams with visibility (shared-team scope only; {} for personal rows)
  provider text NOT NULL,                             -- 'google_calendar'
  provider_event_id text NOT NULL,
  provider_series_id text,                            -- null for non-recurring
  calendar_id text NOT NULL,                          -- the source calendar within Google
  title text,
  description text,
  location text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  status event_status_enum NOT NULL,
  provider_visibility text,                           -- Google's event-visibility value
  organiser_json jsonb,
  attendees_json jsonb NOT NULL DEFAULT '[]',
  recurrence_rule text,                               -- RRULE
  recurrence_exception_date timestamptz,              -- if this row is an exception-to-series
  meeting_url text,
  classification_version integer NOT NULL,
  meeting_type event_type_enum,
  topic_tags text[] NOT NULL DEFAULT '{}',
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz,
  deleted_at timestamptz,

  UNIQUE (source_connection_id, provider_event_id)
);

CREATE INDEX canonical_calendar_events_org_idx ON canonical_calendar_events (organisation_id) WHERE deleted_at IS NULL;
CREATE INDEX canonical_calendar_events_owner_idx ON canonical_calendar_events (organisation_id, owner_user_id) WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL;
CREATE INDEX canonical_calendar_events_time_idx ON canonical_calendar_events (organisation_id, start_at);
CREATE INDEX canonical_calendar_events_series_idx ON canonical_calendar_events (provider_series_id) WHERE provider_series_id IS NOT NULL;
CREATE INDEX canonical_calendar_events_shared_team_gin ON canonical_calendar_events USING gin (shared_team_ids);
CREATE INDEX canonical_calendar_events_source_idx ON canonical_calendar_events (source_connection_id, ingested_at DESC);
```

### Pure helpers + tests

- `googleCalendarEventToCanonicalPure.ts` — payload → canonical row.
- `calendarEventExpansionPure.ts` — recurrence expansion, series + exception handling.
- `calendarEventScopeAttributionPure.ts` — scope attribution from attendees.
- `calendarEventClassificationPromptPure.ts` — classification prompt.

### Static gates

- `scripts/verify-calendar-classification-versions.sh` — every canonical event row has a non-null `classification_version`. Forward-compatible.

### Connection-revocation deletion contract

Same as Gmail: soft-delete within 60 seconds of disconnect, hard-delete after the per-org grace period via `canonical-calendar-event-purge` job.

### Out of scope for P5

- Outlook / other calendar adapters. Abstraction-friendly but not shipped here.
- Event creation / modification. Not in scope.
- Availability API ("when is this user free next week?"). Interesting follow-on but not part of this program — the canonical data supports it and a skill can be built against it in a separate implementation.

### Entry criteria

- P4 landed — Google OAuth infrastructure, personal-connection UX, ingestion lifecycle all exist.

### Exit criteria

- Calendar OAuth (scope add to existing Gmail connections, new calendar-only connections for users who want them).
- Ingestion running dev/staging across backfill, transition, live.
- `canonical_calendar_events` populated with correct principal/ownership/visibility.
- Event-visibility filter behaviour verified (Google-private events excluded by default).
- Dictionary entry.
- `pr-reviewer` + `dual-reviewer` passed.

---

## P6 — NL→SQL query surface

**Verdict: BUILD AFTER P3, P4, P5.** Final phase. Translates agent questions into safe SQL over canonical tables. Cannot ship without P3's RLS, P2B's dictionary, and P4/P5's coverage. Most likely to need iteration after landing; sized accordingly.

### Goal

Agents can ask questions against canonical in natural language and get answers without a developer authoring a new skill for each question. The query path is safe by construction: RLS enforces tenancy, an allow-list constrains tables and operations, a cost limit prevents runaway queries, and HITL gates catch wide-scope or unexpectedly-expensive queries before execution.

### Current state

Agents invoke pre-built skills. Ad-hoc questions — "which accounts have declining revenue and no email touchpoints in the last 14 days?" — require a developer to write a new skill or compose existing skills awkwardly.

### Design

**Planner.**

A new skill `query_canonical` with `readPath: 'canonical'`. It accepts a natural-language question and runs through a multi-stage planner:

1. **Intent extraction.** LLM call with the dictionary as context. Output: a structured query intent (target tables, filters, aggregations, time range, ordering, limit).
2. **Query construction.** A pure helper `queryPlanToSqlPure.ts` converts the intent into SQL. Pure because the conversion is deterministic given the intent. The SQL is parameterised — user-supplied values are never interpolated.
3. **Validation pass.** Another pure helper `querySqlValidatorPure.ts` parses the SQL and checks:
   - Every referenced table is in the allow-list.
   - No writes (INSERT, UPDATE, DELETE, DDL).
   - No references to platform/system tables.
   - No subqueries that reach outside the allow-list.
   - Aggregations are on allowed columns.
   - A `LIMIT` is present and at or below the per-principal cap.
   - Cost estimation (via Postgres `EXPLAIN`) is below the per-principal budget.
4. **HITL gate.** If the query returns more than N rows, or the cost estimate exceeds a threshold, or the question's intent is classified as "wide-scope" (cross-subaccount, cross-user, or aggregating over personal data), the planner pauses for HITL approval before executing. Uses existing HITL plumbing (`actionService.proposeAction` with `requiresApproval: 'on-threshold'`).
5. **Execution.** Query runs under `withPrincipalContext`. RLS applies. Results are returned to the agent.
6. **Explanation.** The planner optionally returns, alongside the results, a human-readable description of the SQL it ran — for audit and for the agent's own reasoning about what it got back.

**Allow-list.**

A registry at `server/services/canonicalQuerySurface/allowList.ts` declares, for each canonical table: allowed SELECT columns (may be subset of the full column list), allowed aggregations, allowed join partners, cost-class. Tables not in the allow-list are invisible to the NL→SQL surface even if they exist in the schema. Adding a table to the allow-list is a reviewed decision, not a drive-by change.

**Per-principal caps.**

- Row limit: user principals default 5,000 rows per query; service principals 20,000; delegated principals match their grantor user's cap.
- Cost estimate limit: a Postgres `EXPLAIN` cost ceiling per principal type.
- Concurrency: one in-flight NL→SQL query per principal. Second request queues.
- Daily quota: configurable per-org; soft-capped with HITL at approach, hard-capped at 2× soft cap.

`TripWire` (existing primitive) wraps the execution path to enforce these caps.

**HITL policy for wide-scope queries.**

Wide-scope queries trigger HITL even if under the row/cost limits, because the issue is not resource consumption but data exposure. The classifier:

- Any query that joins across more than two subaccounts → wide-scope.
- Any query aggregating over `canonical_emails` or `canonical_calendar_events` without a `owner_user_id = :current_user` filter (other than under an explicit delegation) → wide-scope.
- Any query with `visibility_scope` in the select or filter → wide-scope (the agent is attempting to reason about visibility metadata, which usually indicates something unexpected).

Wide-scope queries are not forbidden; they are paused for HITL approval with a clear description.

**Failure modes.**

- Query invalid → planner returns an error; does not retry automatically with a different query unless the agent explicitly re-invokes.
- Query exceeds cost estimate → HITL prompt with the estimate and the SQL.
- RLS returns fewer rows than expected → no special handling; the agent sees what it sees.
- LLM produces malformed intent → validator rejects; planner returns "could not plan this query."

### Contracts

- `query_canonical` skill calls through to `canonicalQuerySurfaceService`, which in turn calls `canonicalDataService.runAllowListedQuery(principal, sql, params)`.
- Every query logs to `tool_call_security_events` with the natural-language question, the SQL generated, the row count returned, the cost estimate, and whether HITL approval was required.
- Queries that fail validation log with the failure reason (using the `failure()` + `FailureReason` enum primitive from `shared/iee/failure.ts`).

### Pure helpers + tests

- `queryPlanToSqlPure.ts` — intent → SQL. Fixture-driven tests on representative intents.
- `querySqlValidatorPure.ts` — SQL validation. Fixture tests for each rejection case: disallowed table, disallowed column, write operation, missing LIMIT, excessive cost.
- `wideScopeClassifierPure.ts` — intent → wide-scope boolean. Fixture tests for each wide-scope rule.
- `queryResultSummariserPure.ts` — result set → human-readable description for audit.

### Static gates

- `scripts/verify-query-allowlist.sh` — every canonical table either has an allow-list entry or is explicitly marked `excluded: true` with a rationale. No silent exclusions.
- `scripts/verify-query-surface-write-refusal.sh` — the validator's test fixtures include every write operation (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE). All must be rejected. Gate fails if any fixture case is missing or any assertion passes.

### Out of scope for P6

- Natural-language writing to canonical ("create a contact with email X"). Writes remain action skills, not query-surface ones.
- Vector search. Per D6, deferred to a follow-on program.
- Query caching or memoisation. Phase-1 shape is fresh-per-invocation; caching is a later optimisation with its own cross-principal-leakage considerations.
- Self-serve "let a human write SQL in a text box" admin tool. Different threat model, different UX, out of scope.

### Entry criteria

- P3 landed — RLS is the substrate the query surface relies on.
- P2B landed — dictionary provides the planner's table/column context.
- P4 and P5 landed — the coverage that makes the surface worth building.

### Exit criteria

- `query_canonical` skill working end-to-end for a representative question set.
- HITL gates firing correctly for wide-scope and over-budget queries.
- Validator rejecting every write operation and every off-allow-list reference.
- Per-principal caps enforced.
- `pr-reviewer` + `dual-reviewer` passed.

---

## Cross-cutting contracts and invariants

These contracts apply across every phase. Each phase's implementation spec inherits them; they are documented here to avoid duplication and to serve as a checklist for PR review.

### Idempotency

Every ingestion handler (scheduler tick, per-connection sync worker, Gmail push webhook, Calendar push webhook) is idempotent. Re-running the same handler with the same inputs produces the same canonical state. Idempotency is enforced by unique constraints on `(source_connection_id, provider_<resource>_id)` plus upsert semantics in the adapter.

### At-least-once delivery

All async work is at-least-once. Handlers tolerate double-delivery. This inherits from `docs/improvements-roadmap-spec.md` and is restated here because P1, P4, P5 all introduce new async paths.

### Principal context is never optional

Every service call that touches canonical data takes a principal context argument. The argument is non-optional at the TypeScript level. Service implementations throw on a null/undefined principal. There is no "run without a principal" path in normal operation. Break-glass access (operator manually queries production via a dedicated tool) is a separate audited procedure, not an application code path.

### Adapter writes bypass RLS via role; skill reads do not

Adapters run as the `canonical_writer` role. `canonical_writer` has RLS bypass on INSERT, UPDATE, DELETE. Skill reads run as `app_reader`. `app_reader` has RLS enforcement. Migrations run as `migration_runner` which bypasses RLS entirely.

Role assignments are per-connection: the application pool uses `app_reader` by default, and adapter code that needs to write calls `withCanonicalWriterRole(work)` which opens a dedicated connection, sets the role, runs the work, closes. This keeps the high-privilege role narrowly scoped.

### Write-back skills are live-action, not adapter writes

Write-back skills (e.g. `modify_email_labels`) operate differently from adapter ingestion. They call the provider API directly under the invoking principal's credentials and then sync the canonical row to reflect the change. They do NOT use the `canonical_writer` role — canonical-row updates from write-back skills run through `app_reader` with normal RLS enforcement, which ensures the principal can only modify rows they can see. This pattern is the template for all future write-back skills across any integration (e.g. a future `modify_calendar_event` or `update_hubspot_contact`). The invariants: HITL-gated, principal-scoped, scope-tier-checked, rate-limited, audit-logged, canonical-synced.

### Audit log fields

Every entry in `tool_call_security_events` carries (from this program onwards):

- `principal_type`, `principal_id`, `organisation_id`, `subaccount_id`
- `canonical_tables_accessed` — array of table names touched
- `rows_returned` — integer; for reads only
- `fetch_mode` — `'canonical' | 'live'` for read operations
- `delegation_grant_id` — if acting under a grant
- `request_id` — trace id threading through related events

These fields are additive to the existing audit schema. Backfilling the fields for pre-program audit entries is out of scope.

### Deletion SLAs

| Event | SLA for soft-delete | SLA for hard-delete |
|---|---|---|
| Personal connection disconnected | 60 seconds | `dataDeletionGracePeriodDays` (default 30, min 0, max 90) |
| User removed from organisation | 60 seconds (connections and owned rows) | `dataDeletionGracePeriodDays` |
| Subaccount deleted | 60 seconds (all subaccount-scoped rows) | `dataDeletionGracePeriodDays` |
| Organisation deleted | 60 seconds | `dataDeletionGracePeriodDays` |
| Delegation grant revoked | Immediate (no new reads will be permitted) | n/a — no data is deleted on grant revocation |

Hard-delete jobs (`canonical-*-purge`) run nightly. They are idempotent. They log a per-run summary to `config_history`.

### Data minimisation rule

A canonical column is added only when it is directly used by a skill, a detector, or a product feature. Columns "for future use" are rejected in review. This rule is strict for sensitive-source tables (email, calendar). It is softer for computed canonical tables (health, anomalies, metrics) where adding columns for derived signals is expected.

### Schema migration rule

Every migration that adds a canonical column or table ships with: indexes (per conventions), dictionary entry (per P2B), RLS policy (per P3B once P3B has landed), and a backfill strategy if the column is not nullable. Migrations that add all but one of these are rejected in review.

### LLM cost attribution

Any ingestion-time LLM call (the cheap classification passes in P4 and P5) attributes cost to the org owning the connection. `llmRouter` already supports org attribution; the classification pipeline passes `organisationId` through.

**Test-run exclusion follows the existing pattern.** Per Feature 2 (`agent_runs.is_test_run`), `costAggregateService.upsertAggregates` skips org/subaccount P&L aggregate writes for test runs and writes only per-run dimensions. Any classification or live-fetch path that runs in a test-run context (e.g. test-running an agent that touches Gmail) MUST follow the same posture: per-run cost telemetry yes, P&L aggregates no. The classification job and the `fetch_email_body` skill respect `is_test_run` from the run context.

Classification failures do not block ingestion. If the classifier is unavailable or returns malformed output, the row is ingested without classifications; a scheduled job `canonical-reclassify-missing` retries classification for rows with null classification within the last N days.

### Observability invariants

- Every canonical read emits a structured log line with principal, tables, row count.
- Every canonical write (adapter) emits a structured log line with connection, rows upserted, rows deleted.
- Every HITL gate trigger emits a log line with the principal, the gated action, and the approval/rejection outcome.
- Job failures log with stack trace and are counted by `workspaceHealthService` as a health signal.

### Backwards-compatibility with existing skills

Skills that existed before this program and are not refactored in P2A continue to work. The program does not break existing behaviour; it constrains new behaviour. Dead skills deleted in P2A are the only behavioural regression, and those are verified dead before deletion.

---

## Static gates added by this program

Consolidated list. Each gate is introduced by the phase noted. All gates are added to `scripts/run-all-gates.sh` and run in CI.

| Gate | Phase | Purpose |
|---|---|---|
| `verify-connector-scheduler.sh` | P1 | Direct calls to `connectorPollingService.syncConnector` outside the scheduler and manual-sync route are forbidden |
| `verify-skill-read-paths.sh` | P2A | Every action carries a `readPath`; every `liveFetch` has a rationale |
| `verify-canonical-read-interface.sh` | P2A | Skills call `canonicalDataService`, not raw Drizzle against canonical tables |
| `verify-canonical-dictionary.sh` | P2B | Dictionary registry matches the Drizzle schema; no drift |
| `verify-principal-context-propagation.sh` | P3A | Service calls accepting bare `organisationId` arguments are forbidden |
| `verify-canonical-required-columns.sh` | P3A | Canonical tables missing required scoping columns fail CI |
| `verify-connection-shape.sh` | P3A | Connection rows without ownership/classification/visibility fail CI |
| `verify-rls-coverage.sh` | P3B | Every in-scope table has at least one SELECT policy |
| `verify-visibility-parity.sh` | P3B | Pure-predicate and SQL-policy parity on fixture set |
| `verify-with-principal-context.sh` | P3B | Direct DB access outside `withPrincipalContext` is forbidden |
| `verify-email-thin-canonical.sh` | P4 | `canonical_emails` has no body-content columns |
| `verify-live-fetch-skill.sh` | P4 | `fetch_email_body` and `modify_email_labels` declared `liveFetch` with rationale |
| `verify-modify-labels-scope-check.sh` | P4 | `modify_email_labels` checks `gmail.modify` scope before calling Gmail API |
| `verify-calendar-classification-versions.sh` | P5 | Canonical event rows carry `classification_version` |
| `verify-query-allowlist.sh` | P6 | Canonical tables have explicit allow-list entry or exclusion rationale |
| `verify-query-surface-write-refusal.sh` | P6 | Validator rejects every write operation; fixture coverage required |

Gates are introduced in the phase that owns them. A gate that requires infrastructure from a later phase (e.g. parity-harness uses the dictionary) is deferred to its dependent phase and named in that phase's entry criteria.

---

## Deferred items with rationale

Items that appear in adjacent discussions but are explicitly NOT in scope for this program. Listed so reviewers can cite this section when rejecting scope creep.

### Vector / embedding search over canonical data

**Deferred rationale.** Per D6, any vector index over personal data requires physical per-principal partitioning to contain the retrieve-then-filter failure mode. That is a meaningful infrastructure decision (provider choice, cost model, partitioning scheme) deserving its own program. None of the six phases in this program produce enough volume or demand to justify taking it on now. The decision record (D6) exists so a future program can pick up the constraint without re-litigating it.

### Google Workspace domain-wide delegation

**Deferred rationale.** Per D5. Per-user OAuth covers the current target market. Domain delegation is its own security-review and commercial motion.

### Outlook / Microsoft 365 adapter

**Deferred rationale.** Gmail and Google Calendar are the dominant providers in the target market. Outlook is a valuable second, but shipping two providers in parallel doubles P4 and P5 scope without doubling customer value. Outlook follows P5's pattern cleanly and can be added in a follow-on implementation spec when demand materialises.

### Zoom transcript ingestion

**Deferred rationale.** The original framing video highlighted Zoom transcripts as a key corpus. For AutomationOS's product loop (agency-client relationship intelligence), transcripts are high-volume, high-PII, and marginal-ROI until the surrounding signal layer (email, calendar, CRM) is in place. Revisit after P6 has soaked if a specific skill or detector would genuinely benefit from transcript access. If revisited, treat transcripts as live-fetch (per D7 reasoning), not canonical.

### Monday.com / project-management adapter

**Deferred rationale.** Teamwork adapter already exists. Adding Monday is a commercial decision driven by customer demand, not an architectural priority. Pattern for adding it is the existing adapter template; no program-level design needed.

### Self-serve admin UIs

**Deferred rationale.** P3 and P4 introduce concepts (teams, delegation grants, connection visibility, ingestion filters) that need admin and user UIs. These are named in each phase's exit criteria as required but are scoped as UI-focused follow-on work rather than blocking phase exit. Shipping the data model and the agent-consumable API is the program's priority; the UI is consumed by it.

### Break-glass operator access

**Deferred rationale.** Operator access to production data for incident investigation is a real requirement. Building it properly involves an audited session-based tool, time-limited approvals, and a separate UI. Out of scope for this program. Operator access via direct database is presumed to continue under existing operational controls; formalising it is its own project.

### Per-row field-level encryption

**Deferred rationale.** Personal data on canonical tables is encrypted at rest via the underlying database disk encryption. Per-row field-level encryption with per-tenant or per-user keys is a stronger posture for defence against DB-level compromise. Worthwhile long-term; out of scope for this program. The schema choices in P4 and P5 do not preclude adding field-level encryption later — sensitive columns are identifiable and can be rewrapped.

### Consent-and-preference management UX

**Deferred rationale.** GDPR-style "manage my consents" UX (view what data is ingested, download it, delete it, change visibility retroactively) is a named need. This program ships the deletion SLAs and the visibility controls. A polished consent-management UX is a separate project with its own design, copy, and legal review.

### Pricing / billing implementation

**Deferred rationale.** Per D8, pricing decisions are commercial. The program makes per-connection costs observable (cross-cutting contract) but does not build the billing meter, the dashboard, or the tier-enforcement path. Those are separate tracks.

---

## Open questions not yet decided

Questions that are intentionally unresolved at the program level and will be decided by the implementation spec of the phase that needs the answer. Resolved answers should be folded back into this document as decisions or contracts.

### Pending for P3 implementation

- **Shape of `shared_team_ids` on connections vs. a join through `team_members`.** The spec sketches an array column on connections for speed; an alternative is a dedicated `connection_team_visibilities` join table. Decide during P3A based on team-membership volatility.
- **Whether delegation grants should support per-canonical-row overrides** (e.g. "read my calendar but not events labelled private") vs. table-level-only. The current design is table + action only; row-level overrides add significant complexity. Open for P3A.
- **Session-variable transaction scope exact pattern.** The spec assumes `SET LOCAL` within a transaction; the transaction scope for routes that span multiple service calls is not fully specified. Resolve during P3B with an integration test.
- **Session-variable naming asymmetry vs. rename.** The shipped variable is `app.organisation_id`; the new principal variables are sketched as `app.current_subaccount_id` / `app.current_principal_type` / `app.current_principal_id`. Either accept the asymmetry (cheap; ship as-is) or rename `app.organisation_id` → `app.current_organisation_id` in a coordinated migration that also rewrites every existing RLS policy and updates `server/middleware/orgScoping.ts`. Blast radius of rename: every entry in `RLS_PROTECTED_TABLES` (~25 policies) plus the org-scoping middleware. Default recommendation is "accept asymmetry" unless a reviewer has a strong argument for the cosmetic win. Resolve before P3B's first migration lands.

### Pending for P4 implementation

- **Participant resolution order.** When a participant email matches multiple canonical contacts (same email across subaccounts), which resolves? Options: the subaccount matching the connection's scope; the most-recently-updated contact; none (leave as bare participant). Open for P4.
- **Classification model choice.** The cheap-classification pass wants a fast, cheap model. Which specific model; what prompt shape; what fallback when the model is unavailable. Implementation detail, not program-level.
- **Push-subscription topic routing.** Google Pub/Sub topics per org vs. per tenant vs. one-global-topic-with-routing. Cost and failure-isolation trade-offs. Decide during P4 with a small volume test.
- **How to handle Gmail label-rename events.** Labels are mutable in Gmail; a rename would silently break filters if we do not re-sync. Decide during P4 whether to poll label lists periodically or subscribe to label changes.

### Pending for P5 implementation

- **Recurring-event storage model.** Store series + exceptions, or expand to individual occurrences at ingest. Trade-off: storage and query simplicity vs. large backfills for dense recurring calendars. Decide during P5.
- **All-day vs timed events across timezones.** Canonical stores `start_at`/`end_at` as timestamptz. All-day events in Google have no zone. Normalisation rule needs to be documented in P5.

### Pending for P6 implementation

- **Cost-estimate thresholds.** What Postgres `EXPLAIN` cost ceiling triggers HITL vs. hard-fail. Needs calibration against representative queries.
- **Intent-to-SQL planner model choice and fallback.** Not program-level.
- **Whether to cache query plans or always re-plan.** Caching has cross-principal considerations; default is re-plan-per-invocation until P6 soak shows caching is safe.

### Pending for follow-on programs

- **Admin UI architecture** for teams, delegations, connection visibility, ingestion filters, deletion SLAs. Named as required; design belongs in a UI-focused follow-on spec.
- **Break-glass operator path** for production data access during incident investigation.
- **Per-row field-level encryption** design.
- **Vector-index program.** Explicitly deferred per D6; its own program when demand justifies.

---

## Glossary

| Term | Meaning in this document |
|---|---|
| **Canonical** | The normalised data model we store in Postgres, one row per logical entity, regardless of source system |
| **Middleware database** | The pattern of normalising data from multiple source systems into one local database that serves as the primary read interface |
| **Principal context** | The runtime object describing who is performing an action: type (user/service/delegated) + id + organisation + subaccount + other scope fields |
| **User principal** | Principal context for a human user actively driving an agent run |
| **Service principal** | Principal context for a named, non-user actor such as a scheduled job or webhook handler |
| **Delegated principal** | Principal context for an action performed on behalf of a specific user, authorised by a delegation grant |
| **Delegation grant** | A time-bounded, scoped authorisation by one user for another actor (user or service) to read their private data |
| **Visibility scope** | One of `private`, `shared-team`, `shared-subaccount`, `shared-org`, stored on every canonical row |
| **Ownership scope** | One of `user`, `subaccount`, `organisation`, stored on every integration connection |
| **Classification** | One of `personal`, `shared_mailbox`, `service_account`, stored on every integration connection |
| **Thin canonical** | Canonical storage of metadata + links only; bodies/content not persisted. See D7 |
| **Full canonical** | Canonical storage of the complete entity including content. See D7 |
| **Live-fetch skill** | A skill that fetches content directly from a provider API at invocation time, under the invoking principal's credentials, without persisting to canonical. See D9 |
| **Read-through canonical** | The rule that skill reads go through `canonicalDataService`, not directly to provider APIs. See D9 |
| **Linkage table** | `canonical_row_subaccount_scopes`, the many-to-many mapping for canonical rows that legitimately belong to multiple subaccounts. See D4 |
| **RLS** | Postgres Row-Level Security; the database-enforced visibility predicates applied per session |
| **Adapter** | A source-specific module that reads from a provider API and writes to canonical |
| **Dictionary** | The machine-readable description of the canonical schema used by agents and the NL→SQL surface |
| **Static gate** | A CI-time script under `scripts/verify-*.sh` that blocks merges on violation of a structural rule |
| **Principal scope partition (vector indexes)** | Physically separate vector indexes per user/team/subaccount/org. See D6 |

---

## Appendix: Phase entry/exit criteria

Consolidated table of gate criteria. Each row names the phase, its entry dependencies, and the concrete exit conditions. A phase's implementation spec must cite this table.

| Phase | Entry depends on | Exit conditions |
|---|---|---|
| P1 | (none) | Migrations landed with indexes (`integration_connections` additions + `integration_ingestion_stats`); scheduler running; `integration_ingestion_stats` rows being written per sync; stale-connector detector emitting findings; static gate in CI; pr-reviewer + dual-reviewer passed; architecture doc updated |
| P2A | P1 | Every action tagged `readPath`; every direct-API-reading skill refactored, reclassified, or deleted; `verify-skill-read-paths.sh` + `verify-canonical-read-interface.sh` in CI; reviewers passed |
| P2B | P2A | Dictionary covers every canonical table; `canonical_dictionary` skill available; `verify-canonical-dictionary.sh` in CI; at least one agent consuming dictionary context; reviewers passed |
| P3A | P2A, P2B | Additive migrations landed with indexes + backfill; `canonicalDataService` takes principal context; principal populated at all entry points; `verify-principal-context-propagation.sh` + `verify-canonical-required-columns.sh` + `verify-connection-shape.sh` in CI; dictionary updated; reviewers passed |
| P3B | P3A | RLS policies on every in-scope table; `withPrincipalContext` helper used everywhere; parity harness passes; `verify-rls-coverage.sh` + `verify-visibility-parity.sh` + `verify-with-principal-context.sh` in CI; exclusion registry documents platform tables; reviewers passed |
| P4 | P3A, P3B, P2A, P2B | Gmail OAuth (personal + shared-mailbox) with scope tiers; ingestion lifecycle (backfill → transition → live) running; `canonical_emails` populated with correct principal/ownership/visibility; `fetch_email_body` working with HITL; `modify_email_labels` working with HITL + scope-tier enforcement; `canonical-email-purge` job running; dictionary entry; `verify-email-thin-canonical.sh` + `verify-live-fetch-skill.sh` + `verify-modify-labels-scope-check.sh` in CI; reviewers passed |
| P5 | P4 | Calendar OAuth (scope-add to Gmail connections + standalone); ingestion lifecycle running; `canonical_calendar_events` populated with correct scoping; event-visibility filter working; dictionary entry; `verify-calendar-classification-versions.sh` in CI; reviewers passed |
| P6 | P3, P2B, P4, P5 | `query_canonical` skill end-to-end for representative question set; HITL gates firing for wide-scope and over-budget queries; validator rejects every write; per-principal caps enforced; `verify-query-allowlist.sh` + `verify-query-surface-write-refusal.sh` in CI; reviewers passed |

Every phase also carries the standing expectations: docs updated in the same commit, `tasks/todo.md` entry closed, `tasks/lessons.md` appended if anything unexpected surfaced.
