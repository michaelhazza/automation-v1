import type { Validator, ValidatorContext, ValidatorResult } from './types.js';
import { ENTITY_RESOLVERS } from './entityResolverRegistry.js';

// deterministic_external — exempt from isolation lint rule (which only targets kind: 'deterministic').

interface EntityTypeParam {
  matchPattern: string;
  lookupService: string;
  idArgName: string;
}

export const validator: Validator = {
  slug: 'cited_entity_exists',
  version: '1.0.0',
  kind: 'deterministic_external',
  parameterSchema: [
    {
      name: 'entityTypes',
      type: 'array',
      required: true,
      description:
        'Array of entity type definitions. Each item: { matchPattern: string (regex), lookupService: string, idArgName: string }.',
      uiHint: 'textarea',
    },
  ],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const entityTypes = ctx.parameters['entityTypes'];
    if (!Array.isArray(entityTypes) || entityTypes.length === 0) {
      return {
        passed: true,
        score: 1.0,
        reasoning: 'No entity types configured; check trivially passes.',
      };
    }

    const subaccountId = ctx.runMetadata.subaccountId;
    const missingIds: string[] = [];

    for (const et of entityTypes as EntityTypeParam[]) {
      const resolver = ENTITY_RESOLVERS[et.lookupService];
      if (!resolver) {
        return {
          passed: false,
          score: 0.0,
          reasoning: `No resolver registered for lookupService "${et.lookupService}".`,
          evidence: { missingIds: [], unresolvedService: et.lookupService },
        };
      }

      try {
        new RegExp(et.matchPattern, 'g');
      } catch (e) {
        return {
          passed: false,
          score: 0.0,
          reasoning: `Invalid matchPattern "${et.matchPattern}": ${String(e)}`,
          evidence: { missingIds: [] },
        };
      }

      // ReDoS guard: cap input length before applying user-supplied regex.
      const matched = ctx.runOutput.slice(0, 50_000).match(new RegExp(et.matchPattern, 'g')) ?? [];
      const uniqueIds = [...new Set(matched)];

      // Batched per entity type — check all IDs for this type before moving on.
      for (const id of uniqueIds) {
        // resolver throws → let it propagate to dispatcher (maps to inconclusive)
        const exists = await resolver(id, subaccountId);
        if (!exists) {
          missingIds.push(id);
        }
      }
    }

    if (missingIds.length === 0) {
      return {
        passed: true,
        score: 1.0,
        reasoning: 'All cited entity IDs exist.',
      };
    }

    const capped = missingIds.slice(0, 50);
    const truncated = missingIds.length > 50;
    const evidence: Record<string, unknown> = { missingIds: capped };
    if (truncated) evidence['_truncated'] = true;

    return {
      passed: false,
      score: 0.0,
      reasoning: `${missingIds.length} cited entity ID(s) do not exist.`,
      evidence: evidence as ValidatorResult['evidence'],
    };
  },
};
