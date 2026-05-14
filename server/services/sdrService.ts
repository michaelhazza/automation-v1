/**
 * sdrService — System Agents v7.1 stub handlers for SDR skills.
 *
 * Handlers: discover_prospects, draft_outbound, score_lead, book_meeting
 *
 * discover_prospects: checks GOOGLE_PLACES_API_KEY; returns not_configured if absent.
 * draft_outbound: LLM synthesis stub.
 * score_lead: worker stub returning a score.
 * book_meeting: write stub; checks GOOGLE_CALENDAR_CLIENT_ID.
 */

import { searchPlaces } from './leadDiscovery/googlePlacesProvider.js';

// ---------------------------------------------------------------------------
// discover_prospects — read-class: geo-based lead discovery via Places API
// ---------------------------------------------------------------------------

export async function executeDiscoverProspects(
  input: Record<string, unknown>,
  _context: unknown,
): Promise<unknown> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    return {
      status: 'not_configured',
      warning: 'GOOGLE_PLACES_API_KEY not set',
      data: null,
    };
  }
  const location = String(input['location'] ?? '');
  if (!location) {
    return { success: false, error: 'location is required for discover_prospects' };
  }
  const result = await searchPlaces({
    query: String(input['query'] ?? ''),
    location,
    radius: typeof input['radius'] === 'number' ? input['radius'] : undefined,
    limit: typeof input['max_results'] === 'number' ? input['max_results'] : undefined,
  });
  return { success: true, result };
}

// ---------------------------------------------------------------------------
// draft_outbound — LLM-synthesis stub
// ---------------------------------------------------------------------------

export async function executeDraftOutbound(
  input: Record<string, unknown>,
  _context: unknown,
): Promise<unknown> {
  return {
    success: true,
    draft: `Outbound draft for ${input['prospect_name'] ?? 'prospect'} (stub — full LLM-synthesis deferred)`,
    prospect_name: input['prospect_name'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// score_lead — worker stub returning a computed score
// ---------------------------------------------------------------------------

export async function executeScoreLead(
  input: Record<string, unknown>,
  _context: unknown,
): Promise<unknown> {
  return {
    success: true,
    lead_id: String(input['lead_id'] ?? ''),
    score: 0.5,
    tier: 'medium',
    message: 'Lead score (stub — full scoring model deferred)',
  };
}

// ---------------------------------------------------------------------------
// book_meeting — write-class: checks calendar provider env var
// ---------------------------------------------------------------------------

export async function executeBookMeeting(
  input: Record<string, unknown>,
  _context: unknown,
): Promise<unknown> {
  const calendarClientId = process.env['GOOGLE_CALENDAR_CLIENT_ID'];
  if (!calendarClientId) {
    return {
      status: 'blocked',
      reason: 'provider_not_configured',
      provider: 'google_calendar',
      requires: ['GOOGLE_CALENDAR_CLIENT_ID'],
    };
  }
  return {
    success: true,
    prospect_id: String(input['prospect_id'] ?? ''),
    meeting_time: input['meeting_time'] ?? null,
    status: 'booked',
    message: 'Meeting booked (stub)',
  };
}
