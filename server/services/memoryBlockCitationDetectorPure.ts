// Phase 8 / W3c — Pure block-level citation scoring.
// Extends existing memoryCitationDetector (which handles workspace_memory_entries)
// to also score memory_blocks against agent outputs.
// Spec: docs/universal-brief-dev-spec.md §6.3.7

export interface BlockCitationInput {
  appliedBlockIds: string[];
  blocks: Array<{ id: string; text: string }>;
  runOutputText: string;
  config: { minCitationScore: number };
}

export interface BlockCitation {
  memoryBlockId: string;
  citedSnippet?: string;
  citationScore: number;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSnippet(blockText: string, outputText: string): string | undefined {
  const words = normalise(blockText).split(' ').filter((w) => w.length > 3);
  if (words.length === 0) return undefined;

  // Find longest phrase from the block that appears in the output
  for (let len = Math.min(6, words.length); len >= 3; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      if (normalise(outputText).includes(phrase)) {
        return phrase;
      }
    }
  }
  return undefined;
}

function computeCitationScore(block: { id: string; text: string }, outputText: string): number {
  const blockWords = normalise(block.text).split(' ').filter((w) => w.length > 3);
  if (blockWords.length === 0) return 0;

  const outputNorm = normalise(outputText);
  const matched = blockWords.filter((w) => outputNorm.includes(w)).length;
  return matched / blockWords.length;
}

/**
 * Scores applied memory blocks against the agent's run output text.
 * Returns citations for blocks that exceed minCitationScore.
 * Pure function — no I/O.
 */
export function detectBlockCitationsPure(input: BlockCitationInput): BlockCitation[] {
  const blockMap = new Map(input.blocks.map((b) => [b.id, b]));
  const citations: BlockCitation[] = [];

  for (const blockId of input.appliedBlockIds) {
    const block = blockMap.get(blockId);
    if (!block) continue;

    const citationScore = computeCitationScore(block, input.runOutputText);
    if (citationScore >= input.config.minCitationScore) {
      citations.push({
        memoryBlockId: blockId,
        citedSnippet: extractSnippet(block.text, input.runOutputText),
        citationScore,
      });
    }
  }

  return citations.sort((a, b) => b.citationScore - a.citationScore);
}
