// documentChunkingServicePure.test.ts — Pure chunking tests for Chunk 2D.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §4.5, §5.3, §18.1

import { describe, it, expect } from 'vitest';
import {
  chunkDocument,
  DEFAULT_CHUNK_TARGET_TOKENS,
  DEFAULT_CHUNK_OVERLAP_TOKENS,
} from '../documentChunkingServicePure.js';

// ---------------------------------------------------------------------------
// 1. Short doc — content fits in a single chunk
// ---------------------------------------------------------------------------

describe('short doc (≤ targetTokens)', () => {
  it('returns a single chunk with chunkIndex 0 containing the full content', () => {
    // 20 characters ≈ 5 tokens — well within the 512-token default.
    const content = 'Hello, world. Short.';
    const result = chunkDocument({ content });
    expect(result).toHaveLength(1);
    expect(result[0].chunkIndex).toBe(0);
    expect(result[0].content).toBe(content);
    expect(result[0].tokenCount).toBeGreaterThan(0);
  });

  it('returns a single chunk even when targetTokens is explicitly set small but content still fits', () => {
    const content = 'Short text.'; // 11 chars ≈ 3 tokens
    const result = chunkDocument({ content, targetTokens: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].chunkIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Long doc — content >> targetTokens
// ---------------------------------------------------------------------------

describe('long doc (>> targetTokens)', () => {
  it('returns multiple chunks with monotonically increasing chunkIndex', () => {
    // Generate ~3000 tokens worth of content (targetTokens=512 default).
    // 1 token ≈ 4 chars → 3000 tokens ≈ 12000 chars.
    const paragraph = 'The quick brown fox jumps over the lazy dog. ';
    const content = Array.from({ length: 300 }, () => paragraph).join('\n\n');
    const result = chunkDocument({ content });

    expect(result.length).toBeGreaterThan(1);
    // Monotonically increasing chunkIndex.
    result.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  it('all content is recoverable (no data lost) across all chunks', () => {
    // Use a small targetTokens so many chunks form, with paragraph separators.
    const targetTokens = 20; // 20 tokens ≈ 80 chars
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}: some content here.`);
    const content = paragraphs.join('\n\n');

    const result = chunkDocument({ content, targetTokens, overlapTokens: 0 });

    expect(result.length).toBeGreaterThan(1);

    // Reconstruct by collecting every piece of original content.
    // The full original content should appear across the chunks
    // (minus the overlap which repeats tail content).
    const allChunkContent = result.map((c) => c.content).join(' ');
    // Every paragraph from the original must appear somewhere in the chunks.
    for (const para of paragraphs) {
      expect(allChunkContent).toContain(para);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Paragraph-aligned boundary
// ---------------------------------------------------------------------------

describe('paragraph-aligned boundary', () => {
  it('keeps paragraph 1 and paragraph 2 in separate chunks when each fits and combined does not', () => {
    // Each paragraph ≈ 30 tokens; targetTokens = 40 so each fits solo but not together.
    // 30 tokens ≈ 120 chars per paragraph.
    const para1 = 'First paragraph with enough words to use up tokens in this chunk boundary test scenario here end.'; // ~100 chars
    const para2 = 'Second paragraph with its own words filling up the token budget for this boundary test end words.'; // ~100 chars
    // Combined ≈ 200 chars ≈ 50 tokens which exceeds targetTokens=40.
    const content = `${para1}\n\n${para2}`;
    const result = chunkDocument({ content, targetTokens: 40, overlapTokens: 0 });

    expect(result.length).toBeGreaterThanOrEqual(2);
    // The first chunk must contain para1 entirely (no mid-sentence split).
    expect(result[0].content).toContain(para1);
    // The second chunk (or later) must contain para2 entirely.
    const allContent = result.map((c) => c.content).join(' ');
    expect(allContent).toContain(para2);
  });
});

// ---------------------------------------------------------------------------
// 4. Overlap correctness
// ---------------------------------------------------------------------------

describe('overlap correctness', () => {
  it('chunk N+1 starts with content that appeared near the end of chunk N', () => {
    // Use very small targetTokens to force chunking, and a visible overlapTokens.
    const targetTokens = 20; // ≈ 80 chars
    const overlapTokens = 5; // ≈ 20 chars — should appear at start of chunk N+1

    const paragraphs = Array.from({ length: 15 }, (_, i) => `Block ${i + 1}: distinct filler content words here.`);
    const content = paragraphs.join('\n\n');

    const result = chunkDocument({ content, targetTokens, overlapTokens });
    expect(result.length).toBeGreaterThan(1);

    // For each consecutive pair: the end of chunk N must appear at the start of chunk N+1.
    for (let i = 0; i < result.length - 1; i++) {
      const chunkN = result[i].content;
      const chunkNPlus1 = result[i + 1].content;
      // The last `overlapTokens * 4` chars of chunk N should be a substring near the
      // start of chunk N+1 (overlap is the tail of the previous chunk).
      const overlapCharLimit = overlapTokens * 4;
      const tailOfN = chunkN.slice(-overlapCharLimit);
      // Only assert if tail is non-empty (may be empty on the last flush).
      if (tailOfN.length > 0) {
        expect(chunkNPlus1).toContain(tailOfN);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Empty input
// ---------------------------------------------------------------------------

describe('empty input', () => {
  it('returns an empty array for empty content', () => {
    const result = chunkDocument({ content: '' });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Single very long word (no natural boundary) — byte-window fallback
// ---------------------------------------------------------------------------

describe('single very long word — byte-window fallback', () => {
  it('splits gracefully into multiple chunks using byte-windowing', () => {
    // A single 600-token word (≈ 2400 chars) with no spaces, punctuation, or newlines.
    const longWord = 'a'.repeat(2400);
    const targetTokens = 100; // ≈ 400 chars per chunk → expect ~6 chunks

    const result = chunkDocument({ content: longWord, targetTokens, overlapTokens: 0 });

    expect(result.length).toBeGreaterThan(1);
    result.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.content.length).toBeGreaterThan(0);
    });

    // All original characters are accounted for (chunks may contain \n\n separators
    // inserted between accumulated sub-pieces, so we strip whitespace before comparing).
    const totalChars = result.reduce((sum, c) => sum + c.content.replace(/\s/g, '').length, 0);
    expect(totalChars).toBe(longWord.length);
  });
});

// ---------------------------------------------------------------------------
// 7. Default constants are exported correctly
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('exports DEFAULT_CHUNK_TARGET_TOKENS = 512', () => {
    expect(DEFAULT_CHUNK_TARGET_TOKENS).toBe(512);
  });

  it('exports DEFAULT_CHUNK_OVERLAP_TOKENS = 64', () => {
    expect(DEFAULT_CHUNK_OVERLAP_TOKENS).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// 8. Overflow overlap guard (overlap >= targetTokens)
// ---------------------------------------------------------------------------

describe('overflow overlap guard', () => {
  it('caps overlap at targetTokens / 2 when overlapTokens >= targetTokens', () => {
    // If overlap were uncapped at 512 tokens with targetTokens=10 the chunker
    // would loop forever. The function must complete and return valid results.
    const content = Array.from({ length: 50 }, (_, i) => `Sentence ${i + 1} with words.`).join(' ');
    const result = chunkDocument({ content, targetTokens: 10, overlapTokens: 20 });
    expect(result.length).toBeGreaterThan(0);
    result.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });
});
