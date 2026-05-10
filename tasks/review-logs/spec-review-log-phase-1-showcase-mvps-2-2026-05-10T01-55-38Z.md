# Iteration 2 — phase-1-showcase-mvps

- Spec commit at start: `7a29378fc8985648d18ee65b780293946f7290cb`
- Codex output: `tasks/review-logs/_codex_phase-1-showcase-mvps_iter2_2026-05-10T01-55-38Z.txt`

## Findings index

- iter2-1 §3.3 INV-10 vs §5.3.2/§5.6.2/§8.3 — default-inbox-mode contradiction — mechanical, accept
- iter2-2 §5.3.3 — collision check ordering — mechanical, accept
- iter2-3 §5.3.4 vs §5.6.3 — terminal-verdict events missing for non-draft branches — mechanical, accept
- iter2-4 §3.5/§5.6.3/§9.2 — support event count inconsistency — mechanical, accept
- iter2-5 §5.5.4/§7.3 — eval static gate underspecified — mechanical, accept
- iter2-6 §3.5/§6.1 — file_delivery payload contracts missing — mechanical, accept
- iter2-7 §5.4.3/§5.6.4 — file inventory drift (agentSkills.ts, routes/operate/) — mechanical, accept

## Counts

- Mechanical accepted: 7
- Mechanical rejected: 0
- Directional / ambiguous (auto-decided reject, routed to todo.md): 0
- Reclassified → directional: 0

## Applied changes (summary)

- §3.3 INV-10 (iter2-1): default mode by lifecycle pinned — brand-new rows default to `disabled`, bumped to `assisted` on agent enablement; operator may flip to `autonomous` from §5.6.2.
- §5.3.3 (iter2-2): human-activity collision check moved to immediately after claim acquisition, before thread-read / classification. Classification is agent work and must not run while a human is active.
- §5.3.4 + §5.6.3 + §9.2 + §5.6.4 (iter2-3, iter2-4): added `phase1.support.ticket_terminal` event; explicit per-branch terminal-event mapping for the six per-ticket terminal verdicts; INV-16 list extended; §9.2 acceptance criterion updated to "6 Run Trace event types"; clarified that `phase1.support.eval_drift_detected` is admin-alert only, not Run Trace-rendered. Renderer count in §5.6.4 corrected to 6.
- §5.5.4 + §7.3 (iter2-5): eval gate fully specified — minimal `support_eval_runs` row shape (organisation_id, run_at, classification_accuracy_per_intent JSONB, draft_judge_score_avg, snapshotted thresholds); two-consecutive-run logic via ORDER BY run_at DESC LIMIT 2; fail-open when fewer than two rows exist (with logged note) so fresh-CI does not block all merges.
- §6.1.5b (iter2-6): NEW subsection — payload contracts for the four `phase1.file_delivery.*` events; emit points clarified (uploaded after row insert; signed_url_issued at signing; downloaded via app proxy giving accurate per-download attribution; expired emitted by daily sweeper job).
- §5.4.3 (iter2-7): `agentSkills.ts` → `server/db/schema/systemSkills.ts`.
- §5.6.4 (iter2-7): `server/routes/operate/supportAgentRoutes.ts` → `server/routes/support/supportAgentRoutes.ts` (placed under existing route group).
