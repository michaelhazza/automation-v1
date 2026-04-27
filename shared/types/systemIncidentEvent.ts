// Canonical registry of every SystemIncidentEventType literal.
// This file is the single source of truth — the verify-event-type-registry.sh
// gate reads it to confirm all eventType string literals used in system-monitor
// service files are registered here.
//
// To add a new event type:
//   1. Add it to this union.
//   2. Add it to the union in server/db/schema/systemIncidentEvents.ts (the
//      runtime type on the Drizzle column).
// The gate fails if a literal is used in the service layer but not registered here.

export type SystemIncidentEventType =
  | 'occurrence'                // the fingerprint fired again
  | 'status_change'             // lifecycle transition
  | 'ack'                       // human acknowledged
  | 'resolve'                   // human resolved
  | 'suppress'                  // human suppressed
  | 'unsuppress'                // suppression lifted (auto or manual)
  | 'escalation'                // manual escalate-to-agent, or Phase 2 auto-escalation
  | 'escalation_blocked'        // guardrail refused an escalation attempt
  | 'resolution_linked_to_task' // resolve happened on an escalated incident
  | 'notification_surfaced'     // Phase 0.5 in-app notification fired
  | 'remediation_attempt'       // Phase 3: something tried to fix
  | 'remediation_outcome'       // Phase 3: result of the attempt
  | 'diagnosis'                 // Phase 2: agent annotated diagnosis (generic)
  | 'note'                      // free-form human note
  // ── Phase 2 (System Monitor active layer) ────────────────────────────────
  | 'agent_diagnosis_added'     // agent wrote a diagnosis + investigate_prompt (spec §12.1)
  | 'agent_triage_skipped'      // triage was skipped — rate-limited, self-check, not eligible
  | 'agent_triage_failed'       // triage failed after exhausting retries (spec §9.8)
  | 'agent_auto_escalated'      // auto-escalation past rate limit (spec §9.9)
  | 'heuristic_fired'           // sweep heuristic fired for an entity
  | 'heuristic_suppressed'      // sweep heuristic fire was suppressed
  | 'sweep_completed'           // sweep tick completed (spec §9.3)
  | 'sweep_capped'              // sweep tick hit candidate or payload cap
  | 'prompt_generated'          // investigate_prompt generated (audit stamp)
  | 'investigate_prompt_outcome'// operator marked prompt useful/not (spec §11)
  | 'synthetic_check_fired'     // a synthetic check fired (spec §8)
  | 'baseline_refreshed'        // baseline window refreshed successfully
  | 'baseline_refresh_failed';  // baseline refresh job failed
