import { generateEmbeddings } from '../../lib/embeddings.js';
import { env } from '../../lib/env.js';
import { skillEmbeddingService } from '../../services/skillEmbeddingService.js';
import { skillParserServicePure } from '../../services/skillParserServicePure.js';
import type { ParsedSkill } from '../../services/skillParserServicePure.js';
import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import { BATCH_SIZE } from './helpers.js';
import { type JobContext } from './types.js';

type EmbedItem = {
  key: string; // content hash
  text: string; // normalized content
  sourceType: 'candidate' | 'system' | 'org';
  sourceIdentifier: string;
};

// -------------------------------------------------------------------------
// Stage 3: Embed (20% → 40%)
// -------------------------------------------------------------------------
export async function runStage3(ctx: JobContext, jobId: string): Promise<JobContext> {
  await updateJobProgress(jobId, {
    status: 'embedding',
    progressPct: 20,
    progressMessage: 'Generating embeddings...',
  });

  const { remainingCandidates, librarySkills } = ctx;

  // Gather all content needing embeddings (candidates + library skills)
  const toEmbed: EmbedItem[] = [];

  // Remaining candidates
  for (const { index, candidate, hash } of remainingCandidates) {
    toEmbed.push({
      key: hash,
      text: skillParserServicePure.normalizeForHash(candidate),
      sourceType: 'candidate',
      sourceIdentifier: `job:${jobId}:idx:${index}`,
    });
  }

  // Library skills (check cache first)
  const libEmbedItems: EmbedItem[] = librarySkills.map((lib) => {
    const libAsCandidate: ParsedSkill = {
      name: lib.name, slug: lib.slug, description: lib.description,
      definition: lib.definition, instructions: lib.instructions,
      rawSource: '',
    };
    const hash = skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(libAsCandidate));
    return {
      key: hash,
      text: skillParserServicePure.normalizeForHash(libAsCandidate),
      sourceType: lib.isSystem ? 'system' as const : 'org' as const,
      sourceIdentifier: lib.isSystem ? lib.slug : (lib.id ?? lib.slug),
    };
  });

  // Check cache for all items
  const allHashes = [...toEmbed, ...libEmbedItems].map((e) => e.key);
  const cachedEmbeddings = await skillEmbeddingService.getByContentHashes(allHashes);

  // Filter to uncached items only
  const uncachedItems = [...toEmbed, ...libEmbedItems].filter(
    (e) => !cachedEmbeddings.has(e.key)
  );

  // Deduplicate uncached items by key
  const uniqueUncached = Array.from(new Map(uncachedItems.map((e) => [e.key, e])).values());

  if (uniqueUncached.length > 0) {
    // Batch embed in groups of BATCH_SIZE
    const embeddingFallback = !env.OPENAI_API_KEY;

    if (!embeddingFallback) {
      for (let i = 0; i < uniqueUncached.length; i += BATCH_SIZE) {
        const batch = uniqueUncached.slice(i, i + BATCH_SIZE);
        const texts = batch.map((e) => e.text);

        const embeddings = await generateEmbeddings(texts);

        if (embeddings) {
          const storeBatch = embeddings.map((embedding, idx) => ({
            contentHash: batch[idx].key,
            sourceType: batch[idx].sourceType,
            sourceIdentifier: batch[idx].sourceIdentifier,
            embedding,
          }));
          await skillEmbeddingService.storeBatch(storeBatch);

          // Add to local cache map
          for (let j = 0; j < storeBatch.length; j++) {
            cachedEmbeddings.set(storeBatch[j].contentHash, embeddings[j]);
          }
        }

        const pct = 20 + Math.round((Math.min(i + BATCH_SIZE, uniqueUncached.length) / uniqueUncached.length) * 20);
        await updateJobProgress(jobId, {
          progressPct: pct,
          progressMessage: `Embedded ${Math.min(i + BATCH_SIZE, uniqueUncached.length)} / ${uniqueUncached.length} skills...`,
        });
      }
    } else {
      console.warn('[SkillAnalyzerJob] OPENAI_API_KEY not set - skipping embeddings, all pairs treated as ambiguous');
    }
  }

  return { ...ctx, embeddingByContent: cachedEmbeddings };
}
