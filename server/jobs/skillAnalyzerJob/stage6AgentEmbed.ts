import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import { type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 6: Agent-embed (75% → 80%) — Phase 2 of skill-analyzer-v2
// -------------------------------------------------------------------------
// Refresh embeddings for every active system agent. Lazy invalidation:
// anything whose stored content_hash matches the live hash is a cache hit
// and skipped. See spec §6 Pipeline + agentEmbeddingService.
export async function runStage6(ctx: JobContext, jobId: string): Promise<JobContext> {
  await updateJobProgress(jobId, {
    progressPct: 75,
    progressMessage: 'Refreshing system agent embeddings...',
  });

  const { agentEmbeddingService } = await import('../../services/agentEmbeddingService.js');

  await agentEmbeddingService.refreshSystemAgentEmbeddings();

  return ctx;
}
