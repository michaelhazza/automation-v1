# Doc Sync Scope

Single source of truth for which reference docs must be verified and updated after any dev session, spec review, or feature pipeline.

Per-agent Final Summary contracts, verdict regex, and persistence rules live in [`tasks/review-logs/README.md`](../tasks/review-logs/README.md) — this file is the scope/trigger source of truth; that file is the per-agent persistence contract.

Enforced at finalisation by `chatgpt-pr-review` (step 6), `chatgpt-spec-review` (step 5), and `feature-coordinator` (D.5 Doc Sync gate). Agents reference this file rather than embedding their own copy of the list.

**Adding a new reference doc:** any PR that introduces a new top-level reference doc must add it to the table below in the same commit. A doc not in this table is never enforced.

---

## Reference docs and update triggers

| Doc | Update when… |
|-----|-------------|
| `architecture.md` | Service boundaries, route conventions, three-tier agent model, orchestrator routing, task system, RLS / schema invariants, run-continuity, agent fleet, key-files-per-domain, audit framework |
| `docs/capabilities.md` | **Capability Registration trigger** (spec-section references §6.2.1 / §7.4.1 / §7.4.4 resolve to `tasks/builds/development-lifecycle-governance-upgrade/spec.md`). Update when any merge creates, mutates, splits, or merges a capability surface — i.e. anything that would change an Asset Register row's spec §7.4.1 fields (Capability ID/slug, Name, Description, Owner, Cluster, Lifecycle state, Launch source, Risk surface, Last review date, Carry notes, Decommission notes, Related docs). **Editorial Rules apply** — see § *Editorial Rules* in that file. External-ready prose only; no engineer-facing primitives.<br><br>**Verdict format (§6.2.1 combined format):** exactly one of these eight strings — no other phrasing is valid:<br>- `yes: create new capability record`<br>- `yes: update existing capability record`<br>- `yes: split existing capability record`<br>- `yes: merge with existing capability record`<br>- `n/a: docs-only change`<br>- `n/a: test-only change`<br>- `n/a: internal refactor with no capability surface change`<br>- `n/a: build / tooling change only`<br><br>A `yes`-class verdict requires that the Asset Register row(s) follow spec §7.4.1 and that one of the §7.4.4 registration outcomes is named explicitly. A `n/a`-class verdict requires that one of the four reasons above is named explicitly. Any other phrasing is invalid and treated as a missing verdict — which blocks `MERGE_READY`. |
| `docs/integration-reference.md` | Any change to integration behaviour: new scope, new skill, changed status, new write capability, new OAuth provider, new MCP preset, new capability slug, new alias. Update `last_verified`. |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | Any change touching build discipline, conventions, agent fleet, review pipeline, locked rules (RLS, service-tier, gates, migrations, §8 development discipline). Also triggered by `[missing-doc] > 2`. |
| `CONTRIBUTING.md` | Any change to lint-suppression policy, `// reason:` comment format, acceptable / forbidden disable patterns, or addition of new contributor-facing conventions. |
| `docs/frontend-design-principles.md` | Any new UI pattern, hard rule, or worked example introduced this session. |
| `KNOWLEDGE.md` | Patterns and corrections — always check. **Note:** architectural decisions go to `docs/decisions/` (ADRs), not KNOWLEDGE.md. |
| `docs/spec-context.md` | **Spec-review sessions only.** Any framing-assumption change implied by the spec under review. Bump `last_reviewed_at` when you confirm framing is still current — the staleness gate in `spec-reviewer` blocks at 120 days. |
| `docs/decisions/` | When the session locks a durable architectural choice (chose X over Y, set a policy, locked a contract). Author a new ADR using `_template.md`; update `decisions/README.md` index. |
| `docs/context-packs/` | When a context pack's referenced section anchor changes in `architecture.md`, or when a new mode is needed. Re-run anchor regeneration if section names changed. |
| `references/test-gate-policy.md` | When the test-gate posture changes (a new umbrella command becomes forbidden, a new local check becomes allowed). |
| `references/spec-review-directional-signals.md` | When `spec-reviewer` surfaces the same scope/sequencing/posture call >2 times — add a signal so the classifier catches it. |
| `docs/incident-response.md` | When the SEV classification matrix, on-call rotation, timeline-log format, post-mortem template, or escalation paths change. |
| `docs/testing-transition-plan.md` | When migration triggers, test-inventory sequencing, per-area effort estimates, or phasing decisions change. |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | Every framework-level change ships with a version bump and changelog entry. Repo-specific changes (your own architecture.md edits, your own agent additions) DO NOT bump the framework version — that tracks the agent-fleet/conventions layer only. |

---

## Event registry conventions

### `operator-session.*` lifecycle event namespace (operator-backend, 2026-05)

Hyphenated lifecycle events (`operator-session.*`) are distinct from dotted incident/audit events (`operator.*`, `task.operator.*`, `subaccount.operator_settings.*`). The separation is enforced by a CI gate.

**Single source of truth:** `shared/types/operatorBackendEvents.ts` — the discriminated union for all `operator-session.*` event-name literals. Any file that needs to reference an event name literal MUST import from this file; it MUST NOT declare a string literal inline (even if the string is identical).

**CI gate:** `scripts/gates/verify-operator-event-registry.sh` — greps the repo for naked `operator-session.*` string literals outside the registry file and the explicitly allow-listed paths (the registry file itself, test fixtures, this spec, plan, and brief). Non-empty output from the gate = CI failure.

**Why this matters:** before this gate, event-name strings drifted across handlers and services, making it impossible to enumerate all producers or consumers of an event without a full-text search. The single-source-of-truth pattern prevents silent drift. Future event families that span multiple producers and consumers should adopt the same pattern: one `shared/types/<domain>Events.ts` file + one CI gate in `scripts/gates/verify-<domain>-event-registry.sh`.

---

## Investigation procedure

Every doc-sync sweep MUST execute this procedure per registered doc. Verdicts cannot be assigned without it. The procedure is the gate; the verdict is the receipt.

1. **Read the doc.** Open the file. Do not rely on prior summaries, prior reviews, or memory.
2. **Derive a candidate-stale-reference set from the branch diff.** Build a deterministic list of grep terms drawn from this session's changes:
   - File paths the diff renames, deletes, or moves
   - Symbols renamed, removed, or added: agent names, service names, primitive names, function names, table names, config keys, route paths, env vars, capability slugs, skill names
   - Behaviour, invariants, or rules introduced, changed, or removed
   - Any new name introduced in the branch that the doc may need to mention going forward
3. **Grep the doc for each candidate.** Every hit becomes a stale-reference candidate.
4. **For each hit, verify and fix in this same finalisation pass:**
   - Stale → update the doc now. Do not defer. Do not log a TODO. Do not assume someone else will see it.
   - Still correct (mention is intentional and accurate) → leave alone.
5. **Record the verdict** per Verdict rule below — only after steps 1–4 ran.

A "no" verdict cited from memory or skim is a missing verdict. The grep terms in step 2 are the audit trail; the verdict cites them.

---

## Verdict rule

For each doc, record one of:

- `yes (sections X, Y)` — doc was updated as part of step 4; cite headings actually edited (e.g. `yes (Agent Workplace Identity, Playbook Engine)`), not vague descriptors like `yes (misc updates)`.
- `no — <rationale>` — investigation procedure ran clean. The rationale MUST include either:
  - The grep terms checked against this doc and found absent (e.g. `no — checked feature-coordinator, builder, finalisation-coordinator, dual-reviewer; zero stale references`), OR
  - The specific reason this doc's update trigger from the table above did not actually apply to the change-set (e.g. `no — no skill / capability / integration add/remove/rename in this PR`).
  Without one of those, the verdict is treated as missing.
- `n/a` — step 2 produced zero candidates relevant to this doc's update trigger; the doc's scope per the table above was not touched.

**A missing or unsubstantiated verdict blocks finalisation.** Stale docs are a blocking issue per `CLAUDE.md § 11`.

---

## Final Summary fields

Every finalised `chatgpt-pr-review` and `chatgpt-spec-review` log must include these fields in its `## Final Summary` block:

```
- KNOWLEDGE.md updated: yes (N entries) | no — <rationale>
- architecture.md updated: yes (sections X, Y) | no — <rationale> | n/a
- capabilities.md updated: yes: &lt;registration-outcome&gt; | n/a: &lt;reason&gt;  (§6.2.1 format — eight valid strings listed in the Capability Registration section above; any other phrasing is invalid and treated as a missing verdict)
- integration-reference.md updated: yes (slug X) | no — <rationale> | n/a
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes | no — <rationale> | n/a
- spec-context.md updated: yes | no — <rationale> | n/a   # spec-review sessions only
- frontend-design-principles.md updated: yes | no — <rationale> | n/a
```

`spec-context.md` applies to spec-review sessions only — omitted from PR review and feature-pipeline summaries.

---

## Where this is enforced

- **`chatgpt-pr-review`** — Finalization step 6 (Doc sync sweep)
- **`chatgpt-spec-review`** — Finalization step 5 (Doc sync sweep)
- **`feature-coordinator`** — D.5 (Doc Sync gate), applied across full feature change-set
- **`tasks/review-logs/README.md`** — Final Summary fields table
