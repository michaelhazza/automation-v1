/**
 * Pure mappers for GHL webhook events → canonical_subaccount_mutations rows.
 * No DB access, no imports of drizzle. Tested in isolation from the webhook
 * router so the adapter contract from spec §2.0b is exercised without a
 * running Postgres.
 *
 * Spec: tasks/clientpulse-ghl-gap-analysis.md §2.0b (adapter contract, lines
 * 231–250). Phase 1 follow-up converts the 6 existing webhook handlers
 * (Contact*, Opportunity*, Conversation*) to ALSO emit mutation rows, and
 * adds 4 new handlers (INSTALL, UNINSTALL, LocationCreate, LocationUpdate).
 */

import type { ExternalUserKind } from '../db/schema/clientPulseCanonicalTables.js';

// ── Spec §2.0b mutation type catalogue ──────────────────────────────────
//
// The existing DEFAULT_STAFF_ACTIVITY config in orgConfigService.ts declares
// weights for these. Keep in lockstep; new additions flow through config.

export type GhlMutationType =
  | 'contact_created'
  | 'contact_updated'
  | 'opportunity_stage_changed'
  | 'opportunity_status_changed'
  | 'message_sent_outbound'
  | 'app_installed'
  | 'app_uninstalled'
  | 'location_created'
  | 'location_updated';

export type GhlMutationSourceEntity = 'contact' | 'opportunity' | 'conversation' | 'location';

export interface GhlEventEnvelope {
  /** GHL event type string, e.g. 'ContactCreate' */
  type?: string;
  /** GHL location id — every event carries this */
  locationId?: string;
  /** Event correlation id — unique per webhook delivery */
  traceId?: string;
  /** Timestamps */
  dateAdded?: string;
  dateUpdated?: string;
  /** Populated for contact/opportunity-centric events */
  id?: string;
  contactId?: string;
  /** Attribution fields (GHL populates these on staff-driven events) */
  createdBy?: string;
  updatedBy?: string;
  installedBy?: string;
  uninstalledBy?: string;
  /** Nested entities per GHL's shapes */
  contact?: Record<string, unknown>;
  opportunity?: Record<string, unknown>;
  message?: Record<string, unknown>;
  /** Conversation/message-level fields (may appear at top level too) */
  direction?: string;
  userId?: string;
  conversationProviderId?: string;
  [k: string]: unknown;
}

export interface NormalisedMutation {
  mutationType: GhlMutationType;
  sourceEntity: GhlMutationSourceEntity;
  externalUserId: string | null;
  externalId: string;
  occurredAt: Date;
  evidence: Record<string, unknown>;
}

// ── Mapping table (§2.0b lines 235–244) ──────────────────────────────────
//
// Returns null when the event shape doesn't merit a mutation row (e.g.
// ConversationCreated with direction='inbound' — that's a contact event,
// not a staff event — or with conversationProviderId set, meaning it came
// from a third-party integration not a human operator).

export function normaliseGhlMutation(event: GhlEventEnvelope): NormalisedMutation | null {
  const { type, traceId } = event;
  if (!type) return null;

  const occurredAt = pickDate(event);
  const externalId = traceId ?? `${type}:${event.id ?? event.locationId ?? ''}:${occurredAt.toISOString()}`;

  switch (type) {
    case 'ContactCreate': {
      const contact = asObj(event.contact);
      return {
        mutationType: 'contact_created',
        sourceEntity: 'contact',
        externalUserId: pickAttrUser(contact, 'createdBy') ?? pickAttrUser(event, 'createdBy'),
        externalId,
        occurredAt,
        evidence: { contactId: pickId(contact, event) },
      };
    }
    case 'ContactUpdate': {
      const contact = asObj(event.contact);
      return {
        mutationType: 'contact_updated',
        sourceEntity: 'contact',
        externalUserId: pickAttrUser(contact, 'updatedBy') ?? pickAttrUser(event, 'updatedBy'),
        externalId,
        occurredAt,
        evidence: { contactId: pickId(contact, event) },
      };
    }
    case 'OpportunityStageUpdate': {
      const opp = asObj(event.opportunity);
      return {
        mutationType: 'opportunity_stage_changed',
        sourceEntity: 'opportunity',
        externalUserId: pickAttrUser(opp, 'updatedBy') ?? pickAttrUser(event, 'updatedBy'),
        externalId,
        occurredAt,
        evidence: { opportunityId: pickId(opp, event) },
      };
    }
    case 'OpportunityStatusUpdate': {
      const opp = asObj(event.opportunity);
      return {
        mutationType: 'opportunity_status_changed',
        sourceEntity: 'opportunity',
        externalUserId: pickAttrUser(opp, 'updatedBy') ?? pickAttrUser(event, 'updatedBy'),
        externalId,
        occurredAt,
        evidence: { opportunityId: pickId(opp, event) },
      };
    }
    case 'ConversationCreated':
    case 'ConversationUpdated': {
      if (!isOutboundStaffMessage(event)) return null;
      const msg = asObj(event.message);
      return {
        mutationType: 'message_sent_outbound',
        sourceEntity: 'conversation',
        externalUserId: pickAttrUser(msg, 'userId') ?? pickAttrUser(event, 'userId'),
        externalId,
        occurredAt,
        evidence: { conversationId: event.id, messageId: pickId(msg, {}) },
      };
    }
    case 'INSTALL':
      return {
        mutationType: 'app_installed',
        sourceEntity: 'location',
        externalUserId: pickAttrUser(event, 'installedBy'),
        externalId,
        occurredAt,
        evidence: { locationId: event.locationId },
      };
    case 'UNINSTALL':
      return {
        mutationType: 'app_uninstalled',
        sourceEntity: 'location',
        externalUserId: pickAttrUser(event, 'uninstalledBy'),
        externalId,
        occurredAt,
        evidence: { locationId: event.locationId },
      };
    case 'LocationCreate':
      return {
        mutationType: 'location_created',
        sourceEntity: 'location',
        externalUserId: pickAttrUser(event, 'createdBy'),
        externalId,
        occurredAt,
        evidence: { locationId: event.locationId },
      };
    case 'LocationUpdate':
      return {
        mutationType: 'location_updated',
        sourceEntity: 'location',
        externalUserId: pickAttrUser(event, 'updatedBy'),
        externalId,
        occurredAt,
        evidence: { locationId: event.locationId },
      };
    default:
      return null;
  }
}

/**
 * Spec §2.0b line 241 guard — only count as a staff mutation when:
 *   direction='outbound' AND userId IS NOT NULL AND conversationProviderId IS NULL
 *
 * Non-outbound messages are inbound contact activity (not staff action).
 * A set conversationProviderId indicates a third-party integration (CloseBot,
 * Uphex, etc.) dispatched the message — also not a staff action, and worth
 * surfacing separately via the fingerprint scanner.
 */
export function isOutboundStaffMessage(event: GhlEventEnvelope): boolean {
  const msg = asObj(event.message);
  const direction = (msg.direction as string | undefined) ?? event.direction;
  const userId = (msg.userId as string | undefined) ?? event.userId;
  const providerId = (msg.conversationProviderId as string | undefined) ?? event.conversationProviderId;
  return direction === 'outbound' && !!userId && !providerId;
}

// ── Heuristic classifier (pure) ──────────────────────────────────────────
//
// Spec §2.0b / DEFAULT_STAFF_ACTIVITY.automationUserResolution:
//   strategy: 'outlier_by_volume'
//   threshold: 0.6 — a user whose share of total mutations exceeds this is
//                   almost certainly an automation, not a human.
//
// Caller supplies a pre-computed volume map (all mutation counts by user id
// within the lookback window) plus a totalCount. Pure function so it can be
// unit-tested without DB.

export interface VolumeClassifierInput {
  userId: string | null;
  userCounts: Map<string, number>;
  totalCount: number;
  threshold: number;
  /** Users the org has pre-classified (e.g. "this automation id = automation"). */
  namedAutomationIds?: ReadonlySet<string>;
}

export function classifyUserKindByVolume(input: VolumeClassifierInput): ExternalUserKind {
  const { userId, userCounts, totalCount, threshold, namedAutomationIds } = input;
  if (userId === null || userId === '') return 'unknown';
  if (namedAutomationIds?.has(userId)) return 'automation';
  if (totalCount === 0) return 'unknown';
  const count = userCounts.get(userId) ?? 0;
  if (count === 0) return 'unknown';
  const share = count / totalCount;
  return share > threshold ? 'automation' : 'staff';
}

// ── Helpers ──────────────────────────────────────────────────────────────

function asObj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function pickDate(event: GhlEventEnvelope): Date {
  const candidate = event.dateAdded ?? event.dateUpdated;
  if (typeof candidate === 'string') {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function pickAttrUser(obj: Record<string, unknown> | GhlEventEnvelope, field: string): string | null {
  const value = (obj as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickId(primary: Record<string, unknown>, fallback: Record<string, unknown>): string | undefined {
  const p = primary.id;
  if (typeof p === 'string') return p;
  const f = fallback.id;
  if (typeof f === 'string') return f;
  const fc = (fallback as GhlEventEnvelope).contactId;
  return typeof fc === 'string' ? fc : undefined;
}
