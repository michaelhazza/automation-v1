// Agent-run visibility resolver — single source of truth for both the
// HTTP route guard AND the WebSocket `join:agent-run` handler.
// Spec: tasks/live-agent-execution-log-spec.md §7.1.
//
// The resolver takes (a) the run's tier (subaccount / org / system) and
// (b) the caller's current permission snapshot, and returns:
//   - canView:          can the caller see events / snapshot endpoints
//   - canViewPayload:   stricter — can the caller see raw LLM payloads
//                       (AGENTS_EDIT at the appropriate tier) — §7.3
//
// Two callers: the HTTP route wraps this in `requireAgentRunViewPermission`
// (middleware); the socket room handler calls it directly before allowing
// the socket to join the room.

export interface AgentRunVisibilityRun {
  organisationId: string;
  subaccountId: string | null;
  /**
   * Execution scope — subaccount-tier runs route through the subaccount
   * permission path; org-tier runs use org-level permissions; system-tier
   * runs require system_admin.
   */
  executionScope: 'subaccount' | 'org';
  /** True when the run.agent is a system-managed agent. */
  isSystemRun?: boolean;
}

export interface AgentRunVisibilityUser {
  id: string;
  role: 'system_admin' | 'org_admin' | 'user' | string;
  organisationId: string;
  orgPermissions: ReadonlySet<string>;
  subaccountPermissionsFor: (subaccountId: string) => ReadonlySet<string>;
}

export interface AgentRunVisibility {
  canView: boolean;
  canViewPayload: boolean;
}

// Per the current codebase, agent view/edit permissions exist only at the
// org tier (see server/lib/permissions.ts — ORG_PERMISSIONS has AGENTS_VIEW
// + AGENTS_EDIT; SUBACCOUNT_PERMISSIONS does not). The three-tier rule in
// spec §7.1 is implemented via: (1) org permission + (2) subaccount
// membership for subaccount-tier runs. Membership is enforced by the
// existing `resolveSubaccount(subaccountId, organisationId)` call in the
// HTTP route chain — this resolver assumes the caller has already passed
// that gate when run.subaccountId is set.
const ORG_AGENTS_VIEW = 'org.agents.view';
const ORG_AGENTS_EDIT = 'org.agents.edit';

/**
 * Pure resolver. Mirrors the three-tier rule from spec §7.1 + §7.3.
 * Caller provides a materialised user snapshot — no DB access.
 *
 * `canView` is the gate for the events + prompts endpoints and the
 * `join:agent-run` socket room. `canViewPayload` is the stricter
 * AGENTS_EDIT-scoped gate for the raw LLM payload endpoint (§7.3).
 */
export function resolveAgentRunVisibility(
  run: AgentRunVisibilityRun,
  user: AgentRunVisibilityUser,
): AgentRunVisibility {
  // ── System admin — always sees everything ──────────────────────────────
  if (user.role === 'system_admin') {
    return { canView: true, canViewPayload: true };
  }

  // ── Cross-org reads are forbidden for non-admins ───────────────────────
  if (run.organisationId !== user.organisationId) {
    return { canView: false, canViewPayload: false };
  }

  // ── System-tier run (system-managed agent) — only system_admin.
  if (run.isSystemRun) {
    return { canView: false, canViewPayload: false };
  }

  // ── org_admin bypass — parity with existing middleware ─────────────────
  if (user.role === 'org_admin') {
    return { canView: true, canViewPayload: true };
  }

  // ── Regular users — check the org-level permission set.
  //    Subaccount membership is enforced upstream via resolveSubaccount
  //    in the HTTP route and via the run-row org check in the socket
  //    room handler.
  const canView = user.orgPermissions.has(ORG_AGENTS_VIEW);
  const canViewPayload = user.orgPermissions.has(ORG_AGENTS_EDIT);
  return { canView, canViewPayload };
}
