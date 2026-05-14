/**
 * briefVisibility — re-exports from briefVisibilityService.
 *
 * DB-touching code moved to server/services/briefVisibilityService.ts to
 * comply with the RLS architecture contract (no db imports in server/lib/).
 * Existing callers that import from this file continue to work unchanged.
 */

export {
  type BriefPrincipal,
  type BriefVisibility,
  resolveBriefVisibility,
  resolveConversationVisibility,
} from '../services/briefVisibilityService.js';
