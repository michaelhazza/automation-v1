**Status:** Draft v1
**Date:** 2026-05-10
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** operator-session-identity
**Parent strategy brief:** `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Decision 3)
**Predecessor spec:** Spec A — `tasks/builds/execution-backend-adapter-contract/spec.md` (accepted, shipped PR #281)
**Sibling brief (concurrent):** `tasks/builds/sandbox-isolation/brief.md` (Spec B)
**Successor:** OpenClaw adapter scope — `tasks/builds/openclaw-adapter/scope.md`

# Spec C — Operator Session Identity — Build Brief

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

1. **`auth_type: 'operator_session'` schema** in the Credential Broker. Fields: `oauth_provider` (`openai` initially, generic for future), `oauth_token`, `refresh_token`, `token_expires_at`, `plan_tier` (`pro` / `team` / `enterprise` / `plus`), `consent_record_id` (FK to consent log if plan is `plus`).
2. **OAuth connection flow.** Two paths:
   - **Default (sanctioned tiers):** standard OAuth callback, plan-tier detected, credential stored, ready to use.
   - **Plus tier (opt-in):** OAuth callback detects `plan = plus` → presents disclosure screen → user types "I accept the risk" → consent row written → credential stored.
3. **Plan-tier detection mechanism.** Three options to evaluate in the spec:
   - OpenAI's plan-introspection API (preferred if available)
   - First-call probe (issue a trivial API call, inspect rate-limit headers / model availability)
   - Customer self-declaration (fallback only — easily lied about)
   - Spec recommends one with rationale.
4. **Consent-record table.** New table `operator_session_consents`: `id`, `org_id`, `subaccount_id`, `user_id`, `plan_tier`, `disclosure_version`, `accepted_at`, `disclosure_text_snapshot`, `consent_text_snapshot`. RLS-protected. **7-year retention minimum** — disclosure-as-evidence requires durable records.
5. **Token-lifecycle service.** Background refresh ahead of TTL; re-auth UI when refresh fails. Adapter consumers don't see expired tokens.
6. **Provider-agnostic framing.** Even though V1 is ChatGPT-only, write the schema as "Operator Session Identity" with `oauth_provider` as a discriminator. When Anthropic Claude.ai / Google Gemini come, slot them in via the same `auth_type`. No ChatGPT-only column names.
7. **Connection-UI surface.** Connection list shows operator-session-typed connections distinctly from API-key connections; tier badge visible; "switch tier" placeholder CTA (Phase 3.5+).
8. **Audit / observability.** Every consent record action (granted, revoked, re-auth) writes to existing security audit stream. OpenAI session-revocation events fire a typed `operator-session-revoked` lifecycle event.
9. **Adapter consumption contract.** When an adapter requests a credential and gets an `operator_session` back, it receives a *redacted* envelope (auth token never logged, never serialised into prompt). Pin the redaction at the broker level.

---

## 3. Concurrent build note

Spec C runs in parallel with **Spec B — Sandbox Isolation** (`tasks/builds/sandbox-isolation/brief.md`). The two specs touch different code surfaces:

- C = `server/services/credentialBroker*`, OAuth callback handlers, new consent-log table, connection UI.
- B = `server/services/sandbox*`, `infra/sandbox-templates/`, cost ledger extension, `iee_dev` adapter rewiring.

**No code-area conflicts.** Both touch `architecture.md` (different sections) and `llm_requests` schema (different `source_type` values). Doc-sync sweep at finalisation reconciles. Either spec can land first; the second rebases.

Cross-coordination points (be aware, not blocking):

- **Cost ledger row types.** C adds `'subscription_mediated'`; B adds `'sandbox_compute'`. Coexist on a single agent run for OpenClaw later. Each spec defines its own row type independently.
- **Sub-account scoping.** Existing CredentialBroker behaviour (PR #279) covers C's case — credentials are already sub-account-scoped. No additional work in C.

---

## 4. Out of scope

- **Actual use of the credential by an adapter.** Spec C ships the *credential primitive*. Adapters (OpenClaw, future ones) consume it — that's their spec's scope. Today, no existing adapter is rewired to consume `operator_session`.
- **OAuth → API-key fallback path when session fails mid-run.** OpenClaw adapter's responsibility (it has the run context). Spec C exposes the broker mechanism (`getFallbackCredential(orgId, subaccountId)`); OpenClaw spec wires the call.
- **Customer billing dashboards showing subscription-mediated zero-cost runs** — Phase 3.5+.
- **Multi-OAuth-provider posture framework** beyond the schema-level forward compat. ChatGPT is the only provider in V1; the schema is the seam for others.
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
