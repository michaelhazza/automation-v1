// documentChunkingServicePure.ts — Chunk 2D.
// Pure: no I/O. Splits text into semantically coherent chunks.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §4.5, §5.3, §18.1

import { estimateTokenCount } from './contextAssemblyEnginePure.js';

// Single source of truth for chunking config (spec §18, §1.5 #M1).
// Job handlers (documentChunkEmbedJob, documentReembedJob) capture these
// values at job-execution start and treat them as runtime-immutable per job.
export const DEFAULT_CHUNK_TARGET_TOKENS = 512;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 64;

export interface ChunkResult {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Split text by sentence boundaries (`. `, `! `, `? `). */
function splitBySentences(text: string): string[] {
  const sentences: string[] = [];
  let remaining = text;
  // Match sentence-ending punctuation followed by a space (not end-of-string).
  const boundary = /([.!?]) /;
  while (remaining.length > 0) {
    const match = boundary.exec(remaining);
    if (match === null) {
      sentences.push(remaining);
      break;
    }
    const cutAt = match.index + 2; // include the punctuation + space
    sentences.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  return sentences.filter((s) => s.length > 0);
}

/** Split a segment that is still too long by byte-window (last resort). */
function splitByByteWindow(text: string, targetTokens: number): string[] {
  const charLimit = targetTokens * 4; // inverse of estimateTokenCount heuristic
  const pieces: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    pieces.push(text.slice(offset, offset + charLimit));
    offset += charLimit;
  }
  return pieces;
}

/**
 * Decompose a single segment (paragraph or sentence) into pieces that each
 * fit within targetTokens. Returns the original segment if it already fits.
 * Priority: as-is → sentence-aligned → byte-windowed.
 */
function decomposeFitting(segment: string, targetTokens: number): string[] {
  if (estimateTokenCount(segment) <= targetTokens) {
    return [segment];
  }
  // Try sentence-level split.
  const sentences = splitBySentences(segment);
  if (sentences.length > 1) {
    const pieces: string[] = [];
    for (const sentence of sentences) {
      if (estimateTokenCount(sentence) <= targetTokens) {
        pieces.push(sentence);
      } else {
        // Sentence itself is too long — fall through to byte-window.
        pieces.push(...splitByByteWindow(sentence, targetTokens));
      }
    }
    return pieces;
  }
  // No sentence boundaries — byte-window fallback.
  return splitByByteWindow(segment, targetTokens);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Splits `content` into chunks targeting `targetTokens` tokens each, with
 * `overlapTokens` carry-over between consecutive chunks.
 *
 * Boundary detection priority (spec §4.5):
 *   paragraph-aligned > sentence-aligned > byte-windowed (last resort)
 */
export function chunkDocument(input: {
  content: string;
  targetTokens?: number;
  overlapTokens?: number;
}): ChunkResult[] {
  const { content } = input;
  const targetTokens = input.targetTokens ?? DEFAULT_CHUNK_TARGET_TOKENS;
  const rawOverlap = input.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;
  // Guard: cap overlap so it never consumes the entire chunk budget.
  const overlapTokens = rawOverlap >= targetTokens ? Math.floor(targetTokens / 2) : rawOverlap;

  if (content.length === 0) {
    return [];
  }

  // Short-circuit: content fits in a single chunk.
  if (estimateTokenCount(content) <= targetTokens) {
    return [{ chunkIndex: 0, content, tokenCount: estimateTokenCount(content) }];
  }

  // Step 1: split into paragraphs (double-newline), then decompose any
  // paragraph that exceeds targetTokens into sub-pieces.
  const rawParagraphs = content.split(/\n\n/);
  const fittingPieces: string[] = [];
  for (const para of rawParagraphs) {
    if (para.length === 0) continue;
    fittingPieces.push(...decomposeFitting(para, targetTokens));
  }

  // Step 2: accumulate pieces into chunks, respecting the token budget.
  const results: ChunkResult[] = [];
  let currentPieces: string[] = [];
  let currentTokens = 0;

  const flushChunk = () => {
    if (currentPieces.length === 0) return;
    const chunkContent = currentPieces.join('\n\n');
    results.push({
      chunkIndex: results.length,
      content: chunkContent,
      tokenCount: estimateTokenCount(chunkContent),
    });
  };

  // Build overlap text from the tail of the previous chunk's content.
  // We carry at most overlapTokens worth of text (in chars: overlapTokens * 4).
  const overlapCharLimit = overlapTokens * 4;

  for (const piece of fittingPieces) {
    const pieceTokens = estimateTokenCount(piece);

    if (currentTokens + pieceTokens > targetTokens && currentPieces.length > 0) {
      // Flush the current chunk.
      const chunkContent = currentPieces.join('\n\n');
      results.push({
        chunkIndex: results.length,
        content: chunkContent,
        tokenCount: estimateTokenCount(chunkContent),
      });

      // Build overlap: take the tail of the flushed chunk's text.
      // Guard: slice(-0) === slice(0) which returns the full string, so we must
      // special-case zero overlap to avoid carrying the entire previous chunk.
      const overlapText = overlapCharLimit > 0 ? chunkContent.slice(-overlapCharLimit) : '';
      currentPieces = overlapText.length > 0 ? [overlapText] : [];
    }

    currentPieces.push(piece);
    currentTokens = estimateTokenCount(currentPieces.join('\n\n'));
  }

  // Flush any remaining content.
  flushChunk();

  return results;
}
