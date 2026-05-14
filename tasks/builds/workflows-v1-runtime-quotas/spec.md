# Stub: Workflows V1 runtime quotas

**Trigger to activate:** When the next Workflows V1 architect-time decomposition needs concrete quota values OR when the first production run hits an unset implicit limit.

**Scope (one paragraph).** Ten architect-time runtime quotas that share one decision-making spec, all from `docs/workflows-dev-spec.md`: M1 (max approver pool size), M2 (max Ask fields per step), M3 (max files per task before grouping), M4 (`/run/resume` race-window timeout), F21 (max step count per run quota), F23 (fan-in result ordering by `task_sequence`), F24 (permission drift policy — snapshot for gates, live for controls), F38 (max concurrent steps per run / per org), F40 (hard upper bounds on tasks per run + steps per task + runtime duration), F42 (visibility timeout / stuck execution recovery). The spec sets concrete numerical values + a brief rationale per item.

**Origin:** Workflows V1 runtime quotas in legacy `tasks/todo.md`.
