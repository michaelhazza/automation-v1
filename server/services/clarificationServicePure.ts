/**
 * clarificationServicePure — real-time clarification routing logic (pure)
 *
 * Deterministic recipient resolution and timeout classification. No I/O, no DB.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 */

export type ClarificationRecipientRole =
  | 'subaccount_manager'
  | 'agency_owner'
  | 'client_contact';

export type ClarificationUrgency = 'blocking' | 'non_blocking';

export interface ClarificationRoutingConfig {
  /** Preferred role for routing (default subaccount_manager). */
  defaultRecipientRole?: ClarificationRecipientRole;
  /** Role used when the default is offline and urgency=blocking. */
  blockingEscalationRole?: ClarificationRecipientRole;
  /**
   * Client-domain topic keywords (brand, product, audience). When the
   * question mentions any of these AND portal mode is collaborative, the
   * client contact is preferred over agency staff.
   */
  clientDomainTopics?: string[];
}

export type PortalMode = 'hidden' | 'transparency' | 'collaborative';

export interface ResolveRecipientInput {
  question: string;
  urgency: ClarificationUrgency;
  portalMode: PortalMode;
  routingConfig: ClarificationRoutingConfig | null;
  /** Presence state for each role (online = has an active WS session). */
  online: {
    subaccountManager: boolean;
    agencyOwner: boolean;
    clientContact: boolean;
  };
}

export interface ResolveRecipientResult {
  /**
   * The role resolved to receive the notification. Always returns a role —
   * the email-fallback path is the caller's responsibility when the resolved
   * role happens to be offline.
   */
  role: ClarificationRecipientRole;
  /**
   * Reason text for logging and audit trail. Not surfaced to the recipient.
   */
  reason: string;
  /**
   * True when the question was classified as client-domain (brand / product /
   * audience). Used by the caller to enrich the audit row.
   */
  isClientDomain: boolean;
}

/**
 * Default fallback chain per §5.4: subaccount_manager → agency_owner →
 * client_contact. Only used when `routingConfig` is null or missing fields.
 */
const DEFAULT_ROUTING: Required<ClarificationRoutingConfig> = {
  defaultRecipientRole: 'subaccount_manager',
  blockingEscalationRole: 'agency_owner',
  clientDomainTopics: ['brand', 'voice', 'product', 'audience', 'tone', 'messaging'],
};

/**
 * Normalise optional routing config to a fully-populated shape, filling
 * any missing field from the default fallback chain.
 */
export function normaliseRoutingConfig(
  config: ClarificationRoutingConfig | null,
): Required<ClarificationRoutingConfig> {
  if (!config) return { ...DEFAULT_ROUTING };
  return {
    defaultRecipientRole: config.defaultRecipientRole ?? DEFAULT_ROUTING.defaultRecipientRole,
    blockingEscalationRole:
      config.blockingEscalationRole ?? DEFAULT_ROUTING.blockingEscalationRole,
    clientDomainTopics:
      config.clientDomainTopics && config.clientDomainTopics.length > 0
        ? config.clientDomainTopics
        : DEFAULT_ROUTING.clientDomainTopics,
  };
}

/**
 * Heuristic: does the question text look like a client-domain concern?
 * Case-insensitive substring match against the topic keyword list.
 */
export function isClientDomainQuestion(question: string, topics: string[]): boolean {
  if (!question || topics.length === 0) return false;
  const q = question.toLowerCase();
  return topics.some((t) => q.includes(t.toLowerCase()));
}

/**
 * Resolve the recipient role per §5.4 rules:
 *
 * 1. If portalMode=collaborative AND the question is client-domain: route to
 *    client_contact.
 * 2. Else route to `defaultRecipientRole` (default subaccount_manager).
 * 3. If the default role is offline AND urgency=blocking, escalate to
 *    `blockingEscalationRole` (default agency_owner).
 *
 * Invariant: never routes to `client_contact` unless portalMode is
 * `collaborative`. Transparency or hidden portals must not leak client
 * questions to the client.
 */
export function resolveClarificationRecipient(
  input: ResolveRecipientInput,
): ResolveRecipientResult {
  const config = normaliseRoutingConfig(input.routingConfig);
  const isClientDomain = isClientDomainQuestion(input.question, config.clientDomainTopics);

  // Rule 1 — client-domain + collaborative portal → route to client contact
  if (input.portalMode === 'collaborative' && isClientDomain) {
    return {
      role: 'client_contact',
      reason: 'client_domain_question_collaborative_portal',
      isClientDomain: true,
    };
  }

  const onlineMap = {
    subaccount_manager: input.online.subaccountManager,
    agency_owner: input.online.agencyOwner,
    client_contact: input.online.clientContact,
  } as const;

  // Rule 2 — default role
  const defaultRole = config.defaultRecipientRole;
  const defaultOnline = onlineMap[defaultRole];

  // Rule 3 — blocking escalation when default is offline
  if (input.urgency === 'blocking' && !defaultOnline) {
    const escalationRole = config.blockingEscalationRole;
    // Guard against invariant: never escalate to client_contact outside collaborative
    if (escalationRole === 'client_contact' && input.portalMode !== 'collaborative') {
      return {
        role: defaultRole,
        reason: 'escalation_to_client_contact_blocked_by_portal_mode',
        isClientDomain,
      };
    }
    return {
      role: escalationRole,
      reason: `blocking_escalation_${defaultRole}_offline`,
      isClientDomain,
    };
  }

  return {
    role: defaultRole,
    reason: 'default_routing',
    isClientDomain,
  };
}

// ---------------------------------------------------------------------------
// Timeout classification
// ---------------------------------------------------------------------------

export interface TimeoutDecision {
  /** True when the clarification has timed out. */
  timedOut: boolean;
  /** Minutes since the clarification was issued (negative if `now < issuedAt`). */
  elapsedMinutes: number;
  /** Configured timeout ceiling in minutes for this urgency. */
  timeoutMinutes: number;
}

export function isClarificationTimedOut(params: {
  issuedAt: Date;
  urgency: ClarificationUrgency;
  now: Date;
  blockingTimeoutMinutes: number;
  nonBlockingTimeoutMinutes: number;
}): TimeoutDecision {
  const elapsedMs = params.now.getTime() - params.issuedAt.getTime();
  const elapsedMinutes = elapsedMs / 60_000;
  const timeoutMinutes =
    params.urgency === 'blocking'
      ? params.blockingTimeoutMinutes
      : params.nonBlockingTimeoutMinutes;
  return {
    timedOut: elapsedMinutes >= timeoutMinutes,
    elapsedMinutes,
    timeoutMinutes,
  };
}
