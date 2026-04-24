# Spec Review Iteration 2 — clientpulse-ui-simplification-spec

**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
**Iteration:** 2 of 5
**Started:** 2026-04-24T02:16:00Z
**Prior iteration commit:** c1f98a8fac5a7a9972ad962a3a5cde760c73e3df

---

## Codex findings (7 items) — all NET-NEW; no re-raises from round 1

Raw Codex output at `tasks/review-logs/_clientpulse-ui-iter2-codex-output.txt`.

### Codex-R2-1 — §0 still says "see §7" for deferred briefings; should point at §11
- Classification: mechanical (stale cross-reference introduced by round 1 adding §11)
- Disposition: accept — fix the cross-reference in the §0 "Out of scope" bullet.

### Codex-R2-2 — §3.5 and §6.3 contradict on the `/api/clientpulse/high-risk` contract
- Classification: mechanical (internal self-contradiction)
- Disposition: accept — consolidate the full endpoint contract in §3.5, have §6.3 reference it. Add `band`, `q`, `cursor`, `hasMore`, `nextCursor` to the §3.5 contract and note the "healthy opt-in" rule.

### Codex-R2-3 — §2.2 prose describes pulseService as returning review_item/inbox_item with real routes; actual shape is `review | task | failed_run | health_finding` with opaque tokens (`review:<id>`)
- Classification: mechanical (factual mismatch with actual code)
- Disposition: accept — rewrite §2.2 to (a) use the real kinds, (b) describe the client-side resolver that maps `review:<id>` → a real URL, (c) either leave pulseService unchanged (preferred — small client-side work) or call out any service change in §10. Going with (a)+(b) + client-side resolver in §2.2.1 as the mechanical minimum.

### Codex-R2-4 — §2.2.1 component contract is too simple for real approval flows (review rejection needs a comment; major approvals need acknowledgement modal)
- Classification: mechanical (load-bearing claim without mechanism — G13 can't verify as written)
- Disposition: accept — narrow v1 so pending-card buttons OPEN the existing context flow (where the comment modal / acknowledgement modal lives) rather than invoking approve/reject in-place. The card-inline Approve/Reject are kept ONLY for lanes where the existing primitive supports button-only approval. Specify this split in §2.2 + §2.2.1 contract.

### Codex-R2-5 — §2.3 says the ClientPulse card shows "$X MRR at risk"; `health-summary` doesn't return any revenue field
- Classification: mechanical (load-bearing claim without mechanism)
- Disposition: accept — drop the MRR line from the card prose. Keep the 4-band distribution + pill counts (which ARE returned). Route contract unchanged.

### Codex-R2-6 — Pulse retirement inventory misses Layout.tsx / BriefDetailPage.tsx back-links (verified: Layout has `/admin/pulse` nav link at lines 684, 691; BriefDetailPage at line 157)
- Classification: mechanical (file-inventory drift)
- Disposition: accept — add Layout.tsx and BriefDetailPage.tsx to §10 "To modify"; tighten G6 to include nav + back-link verification. ExecutionDetailPage had no match so don't add it.

### Codex-R2-7 — §11 doesn't list §6.8 onboarding audit-only carve-out OR §2.2's "lane without approve/reject primitive" case
- Classification: mechanical (Deferred-items completeness)
- Disposition: accept — add two §11 bullets: (a) onboarding audit-only (may graduate to file edits if the audit finds anything), (b) any pending-item lane whose underlying primitive doesn't support button-only approve/reject — those cards open context flow in v1.

---

## Rubric pass — nothing net-new

After reading through the revised spec I spotted no new contradictions, load-bearing unbacked claims, or file-inventory drift beyond what Codex caught this round. Rubric adds 0 findings.

---

## Classification summary

- Mechanical accepted: 7 (all Codex)
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

---

## Iteration 2 Summary

- Mechanical findings accepted:  7
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0

Spec commit after iteration: 21f20b6
