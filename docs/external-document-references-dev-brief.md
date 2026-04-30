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

**Connecting Drive.** The user connects their Google Drive to a subaccount. This is a new integration, separate from the existing Gmail integration, so adding Drive doesn't disturb anyone's existing email setup. By default, the connection is shared across the subaccount — so it survives when the connecting user goes on holiday or leaves the company.

**Attaching a document.** When configuring a task, scheduled task, or agent, the user opens the existing "add document" flow. They now see an additional option: pick a file from a connected Drive. They use a familiar file-picker, choose the file, and it's attached. The same flow they already know — just with a new source.

**At runtime.** When the task runs, the platform fetches the latest version of each attached document on the agent's behalf, using the connection that was used to attach it. The agent receives the live content as part of its context, exactly the way uploaded documents work today.

**Caching.** A subaccount-level cache stores fetched content. On the next run, the platform first does a cheap check against the source: has the document changed? If not, it serves from cache. If yes, it refetches and updates the cache. This keeps tasks fast, stays well inside provider rate limits, and reduces cost when many agents reference the same document.

**Permissions.** Permission to read the document is decided at the moment of attachment — the human who attaches it has, by definition, the access they need. Agents inherit that access through the task. The platform doesn't try to re-verify access via the agent's own identity, because that would create confusing failure modes (agent can't read a doc the human just attached) and would require giving every agent its own paid Google Workspace seat.

## Current design decisions

- **Subaccount-scoped, not organisation-scoped.** Cache, connection, and document references all live at the subaccount level — matching how the rest of the platform isolates tenants. This keeps client data from one subaccount completely separated from another, even within the same organisation. No cross-tenant surface to defend.

- **Owner's connection drives access, not the agent's email.** We considered a model where each agent has its own email address and Drive folders are shared to that email. We've rejected it: it's brittle (it only works for paid Google seats), creates confusing failure modes when an agent doesn't have access to a doc the user just gave them, and doesn't match how users naturally think about permission ("I'm adding this file to this task, so the agent should see it").

- **Lives in the existing reference-document system.** External docs are a new source type alongside uploaded documents — same attach flow, same bundle system, same agent context loader. Not a parallel feature. Users learn one model, not two.

- **Always-fetch-latest by default; optional pin to a specific version.** The default behaviour matches the killer use case (scheduled tasks reading living documents). Pinning is available for compliance-sensitive workflows where the version that was "approved" must be the version the agent reads forever.

- **One resolver interface for all providers.** Built so OneDrive, Teams, and Dropbox plug in later without rebuilding the core flow. v1 ships Google Drive only, but the abstraction is in place from day one.

- **Hard quotas from day one.** Per-subaccount caps on number of external docs, total content size cached, and per-task limits. Easier to relax later than to introduce after the fact.

## Open questions for feedback

1. **Which file types matter most in v1?** Likely answer: Google Docs (text) and Google Sheets (tabular). Probably skip in v1: Slides, raw PDFs in Drive, and Office binaries (.docx, .xlsx) — they need parsers we don't have today. Is that the right cut, or are any of those critical to a use case we're already promising customers?

2. **Failure policy when fetch fails at runtime.** If the document can't be fetched when the task runs (token revoked, file deleted, quota exceeded, network blip), should the task hard-fail, continue with the last-good cached version, or continue without the document and warn? Each policy has a real workflow case. Recommended default: hard-fail, with the option to override per attachment. Open to push-back.

3. **Folder attachments.** Out of scope for v1 — folder contents are dynamic and the scope can balloon. Confirm that's acceptable, or flag if there's a customer commitment depending on it.

4. **Audit visibility in the agent's prompt.** Should the agent's prompt explicitly say "this content was fetched from Google Drive, document X, version Y, at time T"? It helps the model attribute facts and helps debugging when an agent says something surprising. Cheap to add now. Recommended yes.

5. **Connection re-binding when an attaching user leaves.** If the user who attached the doc disconnects their Drive, the doc reference goes stale. We can either fall back to another live connection in the subaccount that has access, or surface it as a "needs re-attaching" warning. Probably both, but worth confirming the priority for v1.

6. **Quota and size limits.** What numbers feel right? Strawman: 50 external docs per subaccount, 100KB per fetched doc, 10 docs attached per task. These prevent runaway cost but if set too low we'll be relaxing them constantly. Open to better-grounded numbers.

## Explicitly not in v1

These are deferred — flagged so they don't sneak into scope.

- Other providers (OneDrive, SharePoint / Teams, Dropbox).
- Folder-level attachments.
- Real-time webhook invalidation (v1 polls the source on read; webhooks come in v2).
- Image, PDF, and Office binary parsing.
- Service-account or domain-wide delegation models — for customers who want a single platform-managed integration rather than per-user connections.

## What we need from this round of feedback

- Confirmation (or push-back) on the six open questions above.
- A gut check on whether the "owner's connection, agent inherits" permission model feels right from a product and trust standpoint.
- Any use cases or customer commitments that would change the v1 cut.

Once those are settled, this brief becomes the framing for the architectural plan.
