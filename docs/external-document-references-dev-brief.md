# Live External Document References — Development Brief

## What are we building?

A capability that lets users attach files from connected external document stores (starting with Google Drive) to tasks, scheduled tasks, and agents. When the agent runs, it fetches the latest version of each attached document from the source — so scheduled tasks always work against the current state of the document, not a snapshot taken when the task was set up.

The same pattern is designed to extend later to other document stores (OneDrive, SharePoint / Teams, Dropbox), so the abstraction is built once and reused.

## Why are we building it?

Today, agents can be given context only via documents that have been uploaded directly into the platform. That works for one-shot context, but breaks down for the most valuable agent use case: scheduled, recurring tasks that need to act on the *current* version of a document that lives elsewhere.

A weekly report agent that summarises a planning document the team is actively editing should pick up Monday's edits, not the version that existed when the task was first configured three months ago. A client-facing agent that reads a "company context" document at the subaccount level should always be reading the latest version, automatically, with no human in the loop.

This unlocks:

- Scheduled tasks that act on living documents — briefs, plans, runbooks, meeting notes, customer files.
- Subaccount-level "company context" documents that every agent in that subaccount reads at runtime, always current.
- A natural workflow for non-technical operators — pick a file from your existing Drive, the agent reads it. No new system to learn, no separate uploads, no manual syncing.

It also closes a real reliability gap: today, attached context can drift silently from the source of truth. Live references make the platform's behaviour match what users intuitively expect.

## How is it going to work?

**Connecting Drive.** The user connects their Google Drive to a subaccount. This is a new integration, separate from the existing user Gmail integration and from the workspace identity system (which handles agent email/calendar). Adding Drive doesn't disturb either of those. By default, the connection is shared across the subaccount — so it survives when the connecting user goes on holiday or leaves the company.

**Attaching a document.** When configuring a task, scheduled task, or agent, the user opens the existing "add document" flow. They now see an additional option: pick a file from a connected Drive. They use a familiar file-picker, choose the file, and it's attached. The same flow they already know — just with a new source.

**At runtime.** When the task runs, the platform fetches the latest version of each attached document on the agent's behalf, using the connection that was used to attach it. The resolver normalises the content into plain text before passing it to the agent — so the agent receives consistent input regardless of file type or provider. Alongside the content, the agent always receives provenance metadata: source, document name, fetch time, and version identifier (where available).

**Caching.** A subaccount-level cache stores fetched content keyed by `(provider, fileId, connectionId)`. On the next run, the platform first performs a cheap change-detection check against the source — using the provider's native signal (Google Drive `revisionId`, or HTTP `ETag`) where available. If the document hasn't changed, the platform serves from cache. If it has, or if change detection is unavailable, it refetches and updates the cache. A fallback TTL applies when the provider offers no reliable change signal. To prevent cache stampedes when multiple agents reference the same document in the same window, a single-flight guard ensures only one fetch is in flight per document at a time. Cache writes are atomic per document — readers never observe partial writes, including when multiple agents within the same run reference the same document. Fetch and cache write operations are idempotent per `(referenceId, revisionId)`: retries do not produce duplicate cache entries, double-counted token totals, or conflicting `FetchEvent` records.

**Permissions.** Permission to read the document is decided at the moment of attachment — the human who attaches it has, by definition, the access they need. Agents inherit that access through the task. The platform doesn't try to re-verify access via the agent's own identity, because that would create confusing failure modes (agent can't read a doc the human just attached) and would require giving every agent its own paid Google Workspace seat.

**Attachment lifecycle.** Each external document reference has an explicit state:

- `active` — connection is live, document is reachable, cache is current.
- `degraded` — fetch failed on the last run; agent received stale cached content. "Degraded" is intentionally synonymous with "using stale cache" — this is expected behaviour during transient provider outages, not a permanent failure. The task surfaces a warning.
- `broken` — document reference can no longer be served even from cache (connection revoked, file deleted, cache expired). Task will not run until the reference is rebound or removed.

This state is surfaced in the UI wherever the attachment appears.

## Data Model (v1)

Core entities and what they own:

| Entity | Key fields | Responsibility |
|---|---|---|
| `ExternalDocumentReference` | `fileId`, `provider`, `connectionId`, `attachedByUserId`, `attachedAt`, `pinnedVersionId` (nullable), `state`, `importance` (`required \| optional`, default `required`), `attachmentOrder` (int) | Identifies which file is attached and how to fetch it; `attachmentOrder` is a stable explicit index — not inferred from timestamps — ensuring deterministic processing and context assembly order across DB migrations and environments |
| `DocumentCache` | `provider + fileId + connectionId` (composite key), `content`, `revisionId / etag`, `fetchedAt`, `contentSizeTokens`, `resolverVersion` | Stores normalised content, the change-detection token, and the resolver version used — required for lazy invalidation comparison on next access |
| `AttachmentState` | enum: `active \| degraded \| broken` | Tracks whether the reference is healthy, degraded (stale cache in use), or needs intervention |
| `FetchEvent` | `referenceId`, `runId`, `fetchedAt`, `cacheHit`, `provider`, `docName`, `revisionId`, `tokensUsed`, `resolverVersion`, `failureReason` (nullable enum: `auth_revoked \| file_deleted \| rate_limited \| network_error \| quota_exceeded \| budget_exceeded`) | Audit log of every content access; `resolverVersion` enables reproducibility; `failureReason` drives UI clarity, debugging, and future automated recovery |

Cache is per reference — v1 has only one output format (plain text), so there is no key dimension to separate per transformation.

**Cache key evolution note.** Keying on `(provider, fileId, connectionId)` is an intentional v1 simplification. The same file accessed via different connections creates separate cache entries, limiting hit efficiency within a subaccount. v2 may evolve to a primary key of `(provider, fileId)` with access control validated per connection at fetch time. This is a known limitation, not a permanent design.

## Current design decisions

- **Subaccount-scoped, not organisation-scoped.** Cache, connection, and document references all live at the subaccount level — matching how the rest of the platform isolates tenants. No cross-tenant surface to defend.

- **Owner's connection drives access, not the agent's email.** We considered a model where Drive folders are shared to the agent's email address and the agent reads them via its own Google OAuth token. Rejected: brittle, confusing failure modes, and doesn't match how users think about permission ("I'm adding this file, so the agent should see it"). Note: agents now have workspace email identities (synthetos_native or google_workspace backend), but those identities are provisioned through shared connector configs scoped to email and calendar — they carry no Google Drive OAuth scopes. Sharing a Drive file with an agent's workspace address would not work through that system; it would require a separate per-agent OAuth grant with Drive scopes, which is the model we're explicitly not building.

- **Lives in the existing reference-document system.** External docs are a new source type alongside uploaded documents — same attach flow, same bundle system, same agent context loader. Not a parallel feature.

- **Always-fetch-latest by default; optional pin to a specific version.** The default matches the core use case. Pinning is available for compliance-sensitive workflows where the approved version must be the version the agent reads forever.

- **Pinned version failure is always strict.** If a pinned version becomes inaccessible (deleted, permission revoked), the reference fails and the task does not run — regardless of the task's failure policy. There is no fallback to latest. This preserves the guarantee that makes pinning useful: the agent reads exactly what was approved, or it does not run.

- **One resolver interface for all providers.** OneDrive, Teams, and Dropbox plug in later without rebuilding the core. v1 ships Google Drive only, but the abstraction is in place from day one.

- **Resolver returns normalised plain text.** The resolver is responsible for extracting clean text from the source format. Agents always receive consistent, provider-agnostic content. v1 normalises Google Docs (prose) and Google Sheets (tabular → CSV or Markdown table). Structured extraction for other formats is deferred.

- **Resolver is versioned.** Each resolver implementation carries a version identifier stored in `FetchEvent.resolverVersion`. When the resolver is updated (improved parsing, changed formatting), the version increments. This enables reproducibility — a run's output can always be traced to the exact normalisation logic used — and supports targeted cache invalidation when a resolver upgrade would change existing cached content.

- **Resolver cache invalidation is lazy.** When the resolver version increments, existing cache entries are not eagerly invalidated on deploy. Invalidation occurs on the next access: the cached entry's `resolverVersion` is compared to the current version, and a refetch is triggered if they differ. No background reprocessing. This prevents agents within the same run from seeing inconsistent formats during a deployment window.

- **Degraded has a maximum staleness boundary.** Stale cached content is acceptable up to a threshold tied to the subaccount's cache TTL configuration. Beyond that threshold the reference transitions from `degraded` to `broken`. This prevents silent long-term drift where an agent runs for months on content that was never successfully refreshed.

- **Context is assembled in attachment order.** External documents are injected into the agent context in `attachmentOrder` sequence, each block preceded by its provenance metadata (source, document name, fetch time, version identifier). Order is explicit and deterministic — LLMs are position-sensitive, so undefined ordering produces inconsistent behaviour across runs.

- **Task-level failure policy, not per-attachment.** Tasks declare one of three policies that applies to all their external document references:
  - `strict` — any fetch failure hard-fails the task. Use for critical workflows where acting on stale data is worse than not running.
  - `tolerant` — on fetch failure, use the last-good cached content and surface a warning in the run log. **Default.**
  - `best-effort` — on fetch failure, skip the document and continue. Use for informational context that is nice-to-have but not required.

  Defaulting to `tolerant` matches real-world workflows better than `strict`: most users would rather get a run with a day-old document than a silent failure at 7am.

- **Audit metadata is mandatory, not optional.** Every agent context bundle that includes an external document also includes provenance: source provider, document name, fetch time, and revision identifier (where available). This is part of the content contract — not a debug-only feature. It helps the model reason about recency, supports debugging when an agent says something surprising, and satisfies compliance traceability requirements.

- **Quotas are tiered and token-denominated.** Raw byte limits are too coarse — a rendered Google Sheet can easily exceed 100KB in meaningful content. v1 quotas:
  - Per-subaccount: 100 external document references.
  - Per-task: 20 external document references.
  - Per-document: soft warn at 50K tokens of extracted content; hard block at 100K tokens. Documents exceeding the hard limit are truncated using a head + tail strategy — preserving the opening and closing content, with an explicit `[TRUNCATED: X tokens removed]` marker at the cut point. Token counts before and after truncation are recorded in the `FetchEvent`. This is a model-behaviour safeguard: silently dropping the tail risks destroying semantic meaning (totals at the end of a sheet, conclusions in a legal document).
  - Per-run: document token usage counts toward the task's existing token budget.
  - Numbers are monitored post-launch and adjusted based on real usage — they exist to prevent runaway cost, not to reflect anticipated P99 usage.

## Execution cost model

Fetching and processing external documents has direct cost impact. This must be modelled explicitly rather than left implicit.

- **Token contribution.** Extracted document content counts toward the agent's token usage for that run, the same as any other context. Tracked at the `FetchEvent` level (`tokensUsed`) and rolled up into the run's total cost.
- **Cache economics.** A cache hit still contributes the stored content tokens to the run cost, but incurs no provider API call. A cache miss incurs both the provider fetch and the token cost. At scale, widely-shared documents (e.g. a subaccount-level "company context" file referenced by dozens of agents) accumulate repeated token costs on every run even on a cache hit — the content is included in context regardless. This is the likely dominant cost driver at volume. Not addressed in v1, but worth tracking: future optimisations include in-run reference deduplication (inject once, reference by pointer across agents) or summarised cache layers.
- **Budget enforcement.** If a task has a token budget cap, external document content counts against it. Attachments are processed in ascending `attachmentOrder` sequence. Once cumulative document token usage would exceed the budget, the remaining attachments are skipped — the task's failure policy then determines the run outcome (`strict` fails; `tolerant` proceeds with a warning; `best-effort` proceeds silently). Processing in attach order makes runs deterministic: the same documents are always included or excluded regardless of scheduling non-determinism.
- **Billing surface.** Document fetch cost is visible in the run detail view alongside other token usage. It is not billed separately — it is part of the run's consumption.

## Open questions for feedback

1. **Which file types matter most in v1?** Decision: Google Docs (prose text), Google Sheets (tabular → normalised), and PDFs (basic text extraction only — no layout, table, or structure guarantees; OCR is out of scope, so scanned/image-only PDFs are not supported in v1). PDFs are too common in real workflows to exclude. Definitely out: Slides, Office binaries (.docx, .xlsx). Confirm this is the right cut, or flag if any excluded type maps to an existing customer commitment.

2. **Failure policy default.** Recommended default is `tolerant` (use cache, surface warning). `strict` is available per task. Does this feel right, or is there a workflow class where `strict` should be the default?

3. **Folder attachments.** Out of scope for v1 — folder contents are dynamic and scope can balloon. Confirm that's acceptable, or flag if there is a customer commitment depending on it.

4. **Connection re-binding when an attaching user leaves.** If the connection used to attach the doc is revoked, the reference transitions to `broken`. v1 plan: surface clearly in the UI with a re-attach prompt; allow any subaccount admin to rebind using another live connection that has access to the file. Auto-fallback across connections is not v1 — too much silent magic. Confirm this priority is acceptable.

5. **Per-document token hard limit.** 100K tokens is the proposed hard block. Is there a known document class (large Sheets, long reports) where this is too restrictive for v1 workflows?

## Explicitly not in v1

These are deferred — flagged so they don't sneak into scope.

- Other providers (OneDrive, SharePoint / Teams, Dropbox).
- Folder-level attachments.
- Real-time webhook invalidation (v1 polls on read; webhooks come in v2).
- Image and Office binary parsing (.docx, .xlsx, Slides).
- Service-account or domain-wide delegation models.
- Per-attachment failure policy override (replaced by task-level policy).
- Structured chunking for long documents (v1 truncates at the hard token limit).
- Pre-run attachment health checks (background validation surfacing "last fetched successfully X mins ago" or "connection issue detected" before runtime).

## What we need from this round of feedback

- Confirmation (or push-back) on the five open questions above.
- A gut check on whether the `tolerant` failure default feels right across the expected workflow mix.
- Confirmation that the task-level failure policy (strict / tolerant / best-effort) covers the cases teams are aware of.
- Any use cases or customer commitments that would change the v1 file-type cut.

Once those are settled, this brief becomes the framing for the architectural plan.
