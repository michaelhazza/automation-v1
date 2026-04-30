/**
 * conversationCostServicePure.test.ts — Pure tests for cost aggregation logic.
 *
 * Tests the aggregation/breakdown logic in isolation using in-memory data,
 * without hitting the database. Validates that totals, model breakdowns, and
 * sort order are computed correctly from raw message row data.
 *
 * Run via: npx tsx server/services/__tests__/conversationCostServicePure.test.ts
 */

import { expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Pure aggregation helper — extracted here to enable isolated testing without
// booting the DB. Mirrors the logic in getConversationCost().
// ---------------------------------------------------------------------------

interface MessageCostRow {
  modelId: string | null;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  messageCount: number;
}

interface ModelBreakdown {
  modelId: string;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  messageCount: number;
}

interface CostSummary {
  totalCostCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  messageCount: number;
  modelBreakdown: ModelBreakdown[];
}

function aggregateCostRows(rows: MessageCostRow[]): CostSummary {
  const modelBreakdown: ModelBreakdown[] = rows
    .filter((r) => r.modelId !== null)
    .map((r) => ({
      modelId:      r.modelId as string,
      costCents:    r.costCents,
      tokensIn:     r.tokensIn,
      tokensOut:    r.tokensOut,
      messageCount: r.messageCount,
    }))
    .sort((a, b) => b.costCents - a.costCents);

  const totalCostCents  = rows.reduce((s, r) => s + r.costCents, 0);
  const totalTokensIn   = rows.reduce((s, r) => s + r.tokensIn, 0);
  const totalTokensOut  = rows.reduce((s, r) => s + r.tokensOut, 0);
  const messageCount    = rows.reduce((s, r) => s + r.messageCount, 0);

  return {
    totalCostCents,
    totalTokensIn,
    totalTokensOut,
    totalTokens: totalTokensIn + totalTokensOut,
    messageCount,
    modelBreakdown,
  };
}

// ── Empty / zero cases ────────────────────────────────────────────────────────

test('empty rows → all zeros', () => {
  const result = aggregateCostRows([]);
  expect(result.totalCostCents).toBe(0);
  expect(result.totalTokensIn).toBe(0);
  expect(result.totalTokensOut).toBe(0);
  expect(result.totalTokens).toBe(0);
  expect(result.messageCount).toBe(0);
  expect(result.modelBreakdown).toEqual([]);
});

// ── Single model ──────────────────────────────────────────────────────────────

test('single model row — totals equal row values', () => {
  const rows: MessageCostRow[] = [
    { modelId: 'claude-sonnet-4-6', costCents: 12, tokensIn: 500, tokensOut: 200, messageCount: 2 },
  ];
  const result = aggregateCostRows(rows);
  expect(result.totalCostCents).toBe(12);
  expect(result.totalTokensIn).toBe(500);
  expect(result.totalTokensOut).toBe(200);
  expect(result.totalTokens).toBe(700);
  expect(result.messageCount).toBe(2);
  expect(result.modelBreakdown).toHaveLength(1);
  expect(result.modelBreakdown[0].modelId).toBe('claude-sonnet-4-6');
});

// ── Multiple models ───────────────────────────────────────────────────────────

test('two models — totals sum correctly', () => {
  const rows: MessageCostRow[] = [
    { modelId: 'claude-sonnet-4-6', costCents: 10, tokensIn: 300, tokensOut: 100, messageCount: 1 },
    { modelId: 'claude-haiku-4-5',  costCents: 2,  tokensIn: 100, tokensOut: 50,  messageCount: 1 },
  ];
  const result = aggregateCostRows(rows);
  expect(result.totalCostCents).toBe(12);
  expect(result.totalTokens).toBe(550);
  expect(result.messageCount).toBe(2);
});

// ── Sort order: highest cost first ───────────────────────────────────────────

test('model breakdown sorted by costCents DESC', () => {
  const rows: MessageCostRow[] = [
    { modelId: 'cheap-model',   costCents: 2,  tokensIn: 100, tokensOut: 50, messageCount: 1 },
    { modelId: 'pricey-model',  costCents: 50, tokensIn: 800, tokensOut: 400, messageCount: 3 },
    { modelId: 'medium-model',  costCents: 20, tokensIn: 400, tokensOut: 200, messageCount: 2 },
  ];
  const result = aggregateCostRows(rows);
  expect(result.modelBreakdown[0].modelId).toBe('pricey-model');
  expect(result.modelBreakdown[1].modelId).toBe('medium-model');
  expect(result.modelBreakdown[2].modelId).toBe('cheap-model');
});

// ── null modelId excluded from breakdown but included in totals ───────────────

test('null modelId row excluded from breakdown, included in totals', () => {
  const rows: MessageCostRow[] = [
    { modelId: 'claude-sonnet-4-6', costCents: 10, tokensIn: 300, tokensOut: 100, messageCount: 1 },
    { modelId: null,                costCents: 5,  tokensIn: 100, tokensOut: 50,  messageCount: 1 },
  ];
  const result = aggregateCostRows(rows);
  expect(result.totalCostCents).toBe(15);
  expect(result.modelBreakdown).toHaveLength(1);
  expect(result.modelBreakdown[0].modelId).toBe('claude-sonnet-4-6');
});

// ── totalTokens = tokensIn + tokensOut ────────────────────────────────────────

test('totalTokens is sum of tokensIn and tokensOut', () => {
  const rows: MessageCostRow[] = [
    { modelId: 'model-a', costCents: 1, tokensIn: 400, tokensOut: 100, messageCount: 1 },
    { modelId: 'model-b', costCents: 1, tokensIn: 600, tokensOut: 200, messageCount: 1 },
  ];
  const result = aggregateCostRows(rows);
  expect(result.totalTokens).toBe(1300);
  expect(result.totalTokensIn).toBe(1000);
  expect(result.totalTokensOut).toBe(300);
});

console.log('');
