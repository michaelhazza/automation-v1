import type { skillAnalyzerJobs, skillAnalyzerResults } from '../../db/schema/index.js';
import type { MergeWarningCode, WarningResolutionKind } from '../skillAnalyzerServicePure.js';

/** Shape of `matchedSkillContent` attached to result rows in the GET response.
 *  Computed live from systemSkillService.getSkill at request time. See spec §7.4. */
export interface MatchedSkillContent {
  id: string;
  slug: string;
  name: string;
  description: string;
  definition: object;
  instructions: string | null;
}

/** Shape of `availableSystemAgents` attached to the job in the GET response.
 *  Used by the Phase 4 "Add another system agent..." combobox. */
export interface AvailableSystemAgent {
  systemAgentId: string;
  slug: string;
  name: string;
}

/** Result row enriched with the live `matchedSkillContent` lookup. */
export type EnrichedResult = typeof skillAnalyzerResults.$inferSelect & {
  matchedSkillContent?: MatchedSkillContent;
  /** v2 §11.12.5: true when the mutation cleared existing warning_resolutions
   *  so the UI can surface a "Review decisions reset" toast. */
  resolutionsCleared?: boolean;
};

/** Job + enriched results + Phase 1 GET response extensions. */
export interface GetJobResponse {
  job: typeof skillAnalyzerJobs.$inferSelect;
  results: EnrichedResult[];
  /** Per spec §7.4: live snapshot of all system agents for the
   *  "Add another system agent..." combobox in Phase 4. */
  availableSystemAgents: AvailableSystemAgent[];
}

export interface ResolveWarningParams {
  resultId: string;
  jobId: string;
  organisationId: string;
  userId: string;
  /** Required header; missing → 400, mismatch → 409. See §11.11.5. */
  ifUnmodifiedSince: string;
  warningCode: MergeWarningCode;
  resolution: WarningResolutionKind;
  details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string };
}

/** Body for the PATCH /jobs/:jobId/results/:resultId/agents endpoint.
 *  Exactly one of `selected`, `remove`, or `addIfMissing` must be present.
 *  See spec §7.3 for the full contract. */
export interface UpdateAgentProposalParams {
  resultId: string;
  jobId: string;
  organisationId: string;
  systemAgentId: string;
  /** Toggle the selected flag on an existing proposal. */
  selected?: boolean;
  /** Drop the proposal from agentProposals entirely. */
  remove?: boolean;
  /** Manual-add: when the proposal is not in agentProposals, refresh the
   *  agent's embedding and append a fully-scored proposal with selected=true.
   *  When the proposal is already present, this is a no-op. */
  addIfMissing?: boolean;
}

/** Body for the PATCH /merge endpoint. Per spec §7.3 the four merge fields
 *  are individually patchable; any omitted field is left untouched.
 *  `instructions` may be explicitly null to clear the field.
 *  `ifUnmodifiedSince` is an optional ISO timestamp for optimistic concurrency:
 *  if the stored mergeUpdatedAt is newer than this value the endpoint returns 409. */
export interface PatchMergeFieldsParams {
  resultId: string;
  jobId: string;
  organisationId: string;
  ifUnmodifiedSince?: string;
  patch: {
    name?: string;
    description?: string;
    definition?: object;
    instructions?: string | null;
  };
}
