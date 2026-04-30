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
| `docs/capabilities.md` | Any add / remove / rename of a product capability, agency capability, skill, or integration. **Editorial Rules apply** — see § *Editorial Rules* in that file. External-ready prose only; no engineer-facing primitives. |
| `docs/integration-reference.md` | Any change to integration behaviour: new scope, new skill, changed status, new write capability, new OAuth provider, new MCP preset, new capability slug, new alias. Update `last_verified`. |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | Any change touching build discipline, conventions, agent fleet, review pipeline, locked rules (RLS, service-tier, gates, migrations, §8 development discipline). Also triggered by `[missing-doc] > 2`. |
| `docs/frontend-design-principles.md` | Any new UI pattern, hard rule, or worked example introduced this session. |
| `KNOWLEDGE.md` | Patterns and corrections — always check. |
| `docs/spec-context.md` | **Spec-review sessions only.** Any framing-assumption change implied by the spec under review. |

---

## Verdict rule

For each doc, record one of:

- `yes (sections X, Y)` — doc was updated; cite the section edited. Section references should match actual headings in the doc (e.g. `yes (Agent Workplace Identity, Playbook Engine)`), not vague descriptors like `yes (misc updates)`.
- `no — <one-line rationale>` — scope was touched but the doc is already accurate. Format: `no — <rationale>`. A bare `no` with no rationale is treated as a missing verdict. Examples: `no — capability already reflects added skill set` / `no — no changes to integration surface in this PR`.
- `n/a` — scope of this doc was not touched by this session

**A missing verdict blocks finalisation.** Stale docs are a blocking issue per `CLAUDE.md § 11`.

---

## Final Summary fields

Every finalised `chatgpt-pr-review` and `chatgpt-spec-review` log must include these fields in its `## Final Summary` block:

```
- KNOWLEDGE.md updated: yes (N entries) | no — <rationale>
- architecture.md updated: yes (sections X, Y) | no — <rationale> | n/a
- capabilities.md updated: yes (sections X) | no — <rationale> | n/a
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
