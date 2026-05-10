**Status:** Draft v3 (lock-ready pending operator sign-off)
**Date:** 2026-05-10
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** operator-session-identity
**Parent strategy brief:** `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Decision 3)
**Predecessor spec:** Spec A — `tasks/builds/execution-backend-adapter-contract/spec.md` (accepted, shipped PR #281)
**Sibling brief (concurrent):** `tasks/builds/sandbox-isolation/brief.md` (Spec B)
**Successor:** OpenClaw adapter scope — `tasks/builds/openclaw-adapter/scope.md`

# Spec C — Operator Session Identity — Build Brief

## 0a. Changelog

### v3 (2026-05-10) — second CEO-read pass

Five additional tightenings before lock. Schema and lifecycle gain explicit non-happy-path states.

- **Sanctioned-tier definitions per tier** — Pro/Team/Enterprise/Plus/unknown each get explicit posture (automation use, ownership model, rate-limit, business use, backend-agent eligibility); ambiguous tiers downgrade to "supported with disclosure".
- **Credential ownership & offboarding** — connecting user removed/deactivated → credential becomes `disabled`; authorised operator may transfer or re-auth; no orphaned personal subscriptions powering business automation.
- **Permission gates** — five explicit surfaces (connect, view metadata, revoke, re-auth, allow runtime use); raw token never user-visible at any level.
- **Plan-tier `unknown` + `plan_verification_status`** added to schema — unverified detection is a non-happy path, not a silent pass.
- **`usability_state` enum** added — `connected_usable | connected_needs_consent | connected_needs_reauth | connected_unverified | revoked | disabled`. Adapters may only receive `connected_usable`.

### v2 (2026-05-10) — first CEO-read pass

Tightened in response to CEO read. Core shape unchanged.

- Reframed "ChatGPT OAuth + plan introspection" as **architectural uncertainty** — spec MUST verify provider-supported mechanisms before locking implementation; if none exist, schema/consent/UX still ship and connection wiring is gated.
- Added **hard ban** on credential scraping, browser-cookie capture, headless-browser login automation, and any non-provider-sanctioned account extraction.
- Consent table is **append-only**; revocation/supersession modelled as a companion `operator_session_consent_events` event table; disclosure-version bumps force re-acceptance.
- **Authority boundary** named: default subaccount-scoped storage, user-attributed consent, broker-mediated backend-only use.
- **Retention under deletion** spelled out — 7-year evidence window survives identity removal, with PII minimisation and access restriction.
- **Token-lifecycle failure classification** added — six buckets, only auth/scope failures mark credential unusable.
- **Redaction surface** expanded — logs, audit, traces, prompts, tool inputs, UI, errors, telemetry, test snapshots.
- **No-consumer V1 acceptance criterion** added — mechanical check that no existing adapter consumes `operator_session`.
- Renamed "OAuth connection flow" → "Provider connection flow"; lifecycle event renamed to `operator_session.revoked`; schema field `oauth_provider` → `provider`, `oauth_token` → `auth_token`.

---

## 0. Purpose

Ship the Credential Broker primitive that lets customers connect a ChatGPT subscription as a model identity (instead of paying per-API-token). Spec A reserved the `'session_identity'` capability slot on the adapter contract; the Credential Broker is forward-compat for `auth_type: 'operator_session'` (PR #279). Spec C fills that slot end-to-end: schema, connection flow, plan-tier detection, disclosure UX, consent records, token lifecycle.

**Important framing — Spec C alone does NOT unlock cost savings.** It ships the credential *primitive*. None of the existing adapters (`api`, `headless`, `claude-code`, `iee_*`) is rewired to consume `operator_session` in V1. The first real consumer is the **OpenClaw adapter (Phase 3)**, which uses ChatGPT OAuth + the sandbox primitive to run long-form autonomous tasks at subscription cost.

Spec C ships infrastructure that goes unused-but-correct until OpenClaw lands. That's intentional — building it now means OpenClaw spec authors against a real schema, not a placeholder.

This is a **scoping brief**, not the spec. The output is locked scope; the full Spec C is authored next in this build slug.

---

## 1. What's locked from upstream

Decided in `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Decision 3 (Option E — Layered) and reserved in Spec A as the `'session_identity'` capability slot:

- **Layered posture:** default to OpenAI-sanctioned plans (Pro / Team / Enterprise); allow ChatGPT Plus only with explicit risk-acknowledgement opt-in.
- **No legal / product review blocking the spec** (per operator instruction 2026-05-10). Disclosure wording and SaaS contract clauses are placeholders; the architecture is the deliverable. Legal / product can review at any point and we update placeholders.
- **Quarterly review of OpenAI posture** is a calendared meeting, not a code feature.
- **Credential Broker is the seam.** ChatGPT OAuth is one `auth_type` among several; adapters consume credentials via the broker and never inspect `auth_type` themselves.

---

## 2. What Spec C must define

1. **`auth_type: 'operator_session'` schema** in the Credential Broker. Fields:
   - `provider` (`openai` initially, generic for future)
   - `auth_token`, `refresh_token`, `token_expires_at`
   - `plan_tier`: `'pro' | 'team' | 'enterprise' | 'plus' | 'unknown'`
   - `plan_verification_status`: `'verified' | 'self_declared' | 'unverified' | 'failed'`
   - `plan_verified_at` (nullable timestamp)
   - `consent_record_id` (FK to consent log if plan is `plus`, or if disclosure is otherwise required)
   - `usability_state`: `'connected_usable' | 'connected_needs_consent' | 'connected_needs_reauth' | 'connected_unverified' | 'revoked' | 'disabled'`

   Field names are provider-agnostic; OAuth is one possible mechanism, not assumed. **Adapters may only receive credentials in `connected_usable` state** — the broker refuses to hand out any other state, with the specific state surfaced to the connection UI for operator action.
2. **Provider connection flow.** The spec MUST first verify the currently supported OpenAI account/session identity mechanism against current OpenAI documentation. Do not assume OAuth callback semantics, plan-introspection APIs, or rate-limit-header tier inference exist until verified. If a sanctioned mechanism exists, define both paths:
   - **Default (sanctioned tiers):** provider-supported handshake, plan-tier detected, credential stored, ready to use.
   - **Plus tier (opt-in):** provider connection flow resolves `plan_tier = plus` → disclosure screen → user types "I accept the risk" → consent row written → credential stored.
   If no sanctioned mechanism exists, the spec MUST still define the broker schema, consent table, and disclosure UX, and mark the provider connection implementation as **blocked behind verified provider support** — the primitive ships, the connection wiring waits.
3. **Plan-tier detection mechanism.** Three options to evaluate in the spec, conditional on provider support verified in §2:
   - Provider plan-introspection API (preferred if exposed)
   - First-call probe (trivial call, inspect rate-limit headers / model availability) — only if provider documentation supports this as a stable signal
   - Customer self-declaration (fallback only — easily lied about; gates Plus disclosure regardless)
   - Spec recommends one with rationale, or marks detection blocked if none is verifiable.
   - **Unverified/failed detection is a non-happy path, not a silent pass.** A credential whose `plan_verification_status` resolves to `'unverified'` or `'failed'` MUST NOT proceed as if sanctioned. It is stored with `usability_state = 'connected_unverified'` and either blocks connection, requires explicit disclosure (treated as Plus-equivalent), or stays connected-but-not-usable until verified — spec picks one with rationale.
   - **Hard ban:** Spec C MUST NOT implement credential scraping, browser-cookie capture, password collection, session hijacking, headless-browser login automation, or any non-provider-sanctioned account extraction. Operator Session Identity may only use provider-supported authentication flows. This boundary protects future consumers (OpenClaw, others) from inheriting an unsafe primitive.
4. **Consent-record table.** New table `operator_session_consents`: `id`, `org_id`, `subaccount_id`, `user_id`, `plan_tier`, `disclosure_version`, `accepted_at`, `disclosure_text_snapshot`, `consent_text_snapshot`. RLS-protected. **7-year retention minimum** — disclosure-as-evidence requires durable records.
   - **Append-only.** Consent rows are never updated or deleted. Revocation, supersession, and re-acceptance are modelled as new rows in a companion `operator_session_consent_events` event table (`event_type ∈ {granted, revoked, superseded}`, `consent_id`, `actor_user_id`, `at`, `superseded_by_consent_id` nullable). Revocation marks the linked credential unusable via the broker; the consent row itself stays immutable.
   - **Disclosure version bump = forced re-acceptance.** If `disclosure_version` increments, existing Plus-tier credentials are flagged unusable until the user re-accepts; the new acceptance writes a fresh consent row referencing the prior via `superseded_by_consent_id`.
   - **Authority boundary.** Spec MUST define whether operator-session credentials are user-bound, subaccount-bound, or org-bound at runtime. **Default posture:** subaccount-scoped storage, user-attributed consent, broker-mediated backend-only use. The connecting user owns the consent record; the credential is usable by authorised backend agents acting within the subaccount, never directly by other operators.
5. **Retention under deletion.** Spec MUST define consent-record behaviour under user deletion, subaccount deletion, and org deletion. Records are retained for the 7-year evidence window even when the originating identity is removed; retained rows MUST be minimised (PII-stripped where legally permissible), access-restricted (compliance-role only), and explicitly excluded from normal destructive cleanup paths. Coordinate with any active GDPR / account-deletion playbook.
6. **Token-lifecycle service.** Background refresh ahead of TTL; re-auth UI when refresh fails; adapter consumers never see expired tokens.
   - **Failure classification.** Refresh failures MUST be classified at minimum as: `expired_refresh_token`, `provider_revoked`, `insufficient_scope`, `provider_unavailable`, `rate_limited`, `unknown`. Only `expired_refresh_token`, `provider_revoked`, and `insufficient_scope` mark the credential unusable and surface re-auth UI; `provider_unavailable` and `rate_limited` retry with bounded exponential backoff and stay usable; `unknown` defaults to unusable + alerted.
7. **Provider-agnostic framing.** Even though V1 is ChatGPT-only, write the schema as "Operator Session Identity" with `provider` as a discriminator. When Anthropic Claude.ai / Google Gemini come, slot them in via the same `auth_type`. No ChatGPT-only column names; no OAuth-specific column names where the underlying mechanism may vary by provider.
8. **Connection-UI surface.** Connection list shows operator-session-typed connections distinctly from API-key connections; tier badge visible; "switch tier" placeholder CTA (Phase 3.5+).
9. **Audit / observability.** Every consent lifecycle event (granted, revoked, superseded) writes to the existing security audit stream. Provider/session revocation events fire a typed `operator_session.revoked` lifecycle event consumable by adapter run loops and connection UI.
10. **Adapter consumption contract.** When an adapter requests a credential and gets an `operator_session` back, it receives a *redacted envelope*; only the broker / token-lifecycle service may access raw token material.
    - **Redaction surface.** Redaction MUST apply to: logs, audit context, run traces, prompts, tool inputs, UI payloads, error objects, telemetry metadata, and test snapshots. Pin the redaction at the broker level — no consumer is trusted to redact correctly.
11. **No-consumer enforcement (V1 acceptance criterion).** Spec C ships the primitive without rewiring any existing adapter. Acceptance MUST include a mechanical check (grep / test) proving no existing adapter (`api`, `headless`, `claude-code`, `iee_*`) requests or consumes `operator_session` credentials, and that all existing adapters continue using their previous auth paths. This prevents accidental runtime behaviour change before OpenClaw lands.
12. **Sanctioned-tier definitions.** "Sanctioned" is per-tier, not blanket. Spec MUST define for each supported plan tier (Pro, Team, Enterprise, Plus, unknown):
    - permitted automation use under provider terms
    - account ownership model (individual vs. workspace vs. enterprise admin)
    - rate-limit posture
    - acceptable business use
    - whether the tier can be used by backend agents acting for a subaccount

    If provider terms are ambiguous for a tier, the spec MUST mark it **"supported with disclosure"** (treated as Plus-equivalent — opt-in + consent record) rather than assumed sanctioned. Pro / Team / Enterprise are sanctioned only after verification against current provider terms; default-sanctioned status is provisional.
13. **Credential ownership & offboarding.** Spec MUST define what happens to an operator-session credential when the connecting user is removed from the org/subaccount, loses the relevant role permission, or is deactivated. Default posture: credential transitions to `usability_state = 'disabled'` and becomes unusable; an authorised operator (subaccount admin or above) may explicitly transfer ownership or trigger re-auth under their own identity, which writes a fresh consent row. **A personal subscription tied to a departed user never silently continues powering business automation.**
14. **Permission gates.** Spec MUST define explicit permission surfaces, separate from generic admin access:
    - `connect operator session`
    - `view connection metadata` (plan tier, usability state, last refresh — never the raw token)
    - `revoke connection`
    - `trigger re-auth`
    - `allow adapter/runtime use` (whether agents acting in this subaccount may consume this credential)

    Raw token material remains broker-internal and is never user-visible at any permission level. Gates map to the existing RBAC; the spec names the role bindings.

---

## 3. Concurrent build note

Spec C runs in parallel with **Spec B — Sandbox Isolation** (`tasks/builds/sandbox-isolation/brief.md`). The two specs touch different code surfaces:

- C = `server/services/credentialBroker*`, provider-handshake handlers (OAuth or whatever the verified mechanism turns out to be), new consent-log + consent-event tables, connection UI.
- B = `server/services/sandbox*`, `infra/sandbox-templates/`, cost ledger extension, `iee_dev` adapter rewiring.

**No code-area conflicts.** Both touch `architecture.md` (different sections) and `llm_requests` schema (different `source_type` values). Doc-sync sweep at finalisation reconciles. Either spec can land first; the second rebases.

Cross-coordination points (be aware, not blocking):

- **Cost ledger row types.** C adds `'subscription_mediated'`; B adds `'sandbox_compute'`. Coexist on a single agent run for OpenClaw later. Each spec defines its own row type independently.
- **Sub-account scoping.** Existing CredentialBroker behaviour (PR #279) covers C's case — credentials are already sub-account-scoped. No additional work in C.

---

## 4. Out of scope

- **Actual use of the credential by an adapter.** Spec C ships the *credential primitive*. Adapters (OpenClaw, future ones) consume it — that's their spec's scope. Today, no existing adapter is rewired to consume `operator_session`.
- **Operator-session → API-key fallback path when session fails mid-run.** OpenClaw adapter's responsibility (it has the run context). Spec C exposes the broker mechanism (`getFallbackCredential(orgId, subaccountId)`); OpenClaw spec wires the call.
- **Customer billing dashboards showing subscription-mediated zero-cost runs** — Phase 3.5+.
- **Multi-provider posture framework** beyond the schema-level forward compat. ChatGPT is the only provider in V1; the schema is the seam for others (Anthropic Claude.ai, Google Gemini, etc.) regardless of their underlying auth mechanism.
- **CS runbook for "OpenAI suspended my account."** Deferred to OpenClaw adapter scope (see `tasks/builds/openclaw-adapter/scope.md` § 3.5). Spec C surfaces the lifecycle event; the runbook is operational.
- **Customer-self-service tier switching UI** — Phase 3.5+.
- **Cost calculator / "should I be on Pro?" recommender** — Phase 3.5+.

---

## 5. What unblocks when Spec C ships

- **Customers can connect ChatGPT plans** — they appear in the connections list, plan tier detected, ready to be consumed.
- **No actual cost saving until OpenClaw adapter ships.** Spec C alone gives a stored, displayable, refreshable credential; it does not change any agent's runtime behaviour.
- **The credential broker forward-compat slot is filled** — OpenClaw adapter spec can author against a real schema, not a placeholder.

---

## 6. Next steps

1. **Operator reviews this brief, locks scope.**
2. **Spawn a new Claude Code session** for this build slug; the session adopts the `spec-coordinator` playbook (`.claude/agents/spec-coordinator.md`).
3. **Session runs:** brief intake (this doc) → spec authoring → `spec-reviewer` → `chatgpt-spec-review` → handoff for Phase 3 build.
4. **Phase 3 build session** kicks off after spec is `accepted`.
5. **Branch:** `claude/operator-session-identity-{nonce}` off post-A `main`.

---

## End of brief
