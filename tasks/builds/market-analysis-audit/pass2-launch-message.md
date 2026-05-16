# Pass 2 launch message — Brief 2 (multi-entity)

Paste this verbatim into **both** Claude and Gemini's existing Brief 2 conversation tabs. Single message, works for both.

**Rationale for the locks:** Pass 1 produced a strong convergent signal (Claude and Gemini independently picked Private Equity Portfolio Operations as the lead sub-segment). Each model picked a different 4–5 direct competitors, which would produce two non-comparable matrices. The locks below force both runs onto the same sub-segment and the same competitor column set so the operator can directly cross-reference Must-tier recommendations across the two outputs.

---

## Message text to paste

```
Proceed to Pass 2 with the following scope locks. These supersede the
model-chosen picks in §4(a) and §4(b) of Pass 1 — a parallel research
run on a different model independently selected the same sub-segment,
so we are locking the scope to ensure the two matrices are directly
comparable.

Lock 1 — Sub-segment. Scope all of Pass 2 (matrix, gap analysis,
recommendations, final read) to Private Equity Portfolio Operations
only. The buyer is the Operating Partner / Head of Portfolio Operations
at a PE firm running 10-100+ portfolio companies. Do not generalise
back to "multi-entity businesses" in the final read.

Lock 2 — Direct-competitor columns. The matrix columns are fixed at
exactly these eight:
  1. Synthetos
  2. Allvue Systems (incumbent fund admin, May 2026 RSM "Agentic AI
     Capital Operating Model" partnership)
  3. Blueflame AI (intelligent deal workspace for PE)
  4. V7 Go (knowledge-work automation with citation grounding)
  5. Brownloop Kairos (multi-agent PE knowledge-graph platform)
  6. Chronograph (incumbent portfolio monitoring + Chrono AI)
  7. Wayfound (independent agent supervision layer)
  8. In-house build on AWS Bedrock AgentCore (build-vs-buy counterfactual)

Do not add columns, substitute names, or drop entries. If you believe
a column is misclassified or unfair, flag it in the final read (§4)
rather than rewriting the matrix.

Lock 3 — Mandatory matrix rows. In addition to the B.A through B.G
capability groups from the original brief, add explicit rows for the
PE-specific table-stakes that Pass 1 surfaced as likely gaps. Both
research runs raised these independently — they must appear in the
matrix:
  - Citation-grounded outputs (visual grounding / source-linked
    answers per the Blueflame / V7 Go standard)
  - Native integration with PE data systems: DealCloud, eFront,
    FactSet, PitchBook
  - Capital-call workflow compression (Allvue / RSM benchmark —
    capital calls executed in days rather than weeks)
  - BYOK encryption at the entity (PortCo) level
  - Multi-level approval chains in supervised workflows (e.g.
    Associate drafts → Principal approves above a value threshold)
  - LP audit-readiness (immutable trail, fund-level evidence
    packs, continuous "exit-ready" documentation across the hold
    period)

All other constraints from the original Pass 2 instructions stand:
  - Must-tier recommendation list capped at 5 items
  - Each recommendation cites the specific gap from §2
  - Over-engineering risk explicitly flagged per item
  - Anything requiring a multi-month build is automatically Defer
  - Cite sources for every Yes / Partial claim about a competitor;
    flag inferred items as Unknown rather than Yes
  - The final read (§4) addresses both positioning defensibility for
    PE portfolio operations AND head-to-head competitiveness against
    the locked column set

Begin Pass 2 now.
```

---

## Operator workflow after pasting

1. Paste the block above (everything inside the triple backticks) into the Claude tab. Wait for Pass 2 to complete.
2. Save Claude's Pass 2 to `responses/claude-me-pass2.md`.
3. Paste the same block into the Gemini tab. Wait for Pass 2 to complete.
4. Save Gemini's Pass 2 to `responses/gemini-me-pass2.md`.
5. Synthesise into `synthesis-multi-entity.md`. Must-tier features appearing in **both** outputs are the v1 candidates. Single-output Musts go to `tasks/todo.md` for post-freeze triage unless the rationale is unusually strong.

## Notes

- ChatGPT is excluded from Brief 2 per operator instruction (subscription cap on deep-research tasks). Triangulation is 2-of-2 rather than 2-of-3.
- The locks are scoped to Pass 2 only. If either model wants to challenge the PE wedge itself, that critique should land in the final-read paragraph on positioning defensibility — it should not derail the matrix.
