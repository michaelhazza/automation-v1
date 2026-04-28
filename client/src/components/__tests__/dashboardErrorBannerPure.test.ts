import assert from 'node:assert';
import { failedSourceNames } from '../dashboardErrorBannerPure.js';

// 4-key DashboardPage error map — all false → empty
{
  const result = failedSourceNames({ agents: false, activity: false, pulseAttention: false, clientHealth: false });
  assert.deepStrictEqual(result, [], 'no failures → empty list');
}

// 4-key map — single failure
{
  const result = failedSourceNames({ agents: true, activity: false, pulseAttention: false, clientHealth: false });
  assert.deepStrictEqual(result, ['Agents'], 'single agent failure');
}

// 4-key map — multiple failures
{
  const result = failedSourceNames({ agents: true, activity: true, pulseAttention: false, clientHealth: true });
  assert.deepStrictEqual(result, ['Agents', 'Activity feed', 'Client health'], 'three failures in order');
}

// 4-key map — all failed
{
  const result = failedSourceNames({ agents: true, activity: true, pulseAttention: true, clientHealth: true });
  assert.strictEqual(result.length, 4, 'all four sources failed');
  assert.ok(result.includes('Pending approvals'), 'pulseAttention maps to Pending approvals');
}

// 2-key ClientPulse error map
{
  const result = failedSourceNames({ summary: true, prioritised: false });
  assert.deepStrictEqual(result, ['Health summary'], 'summary maps to Health summary');
}

// 2-key ClientPulse — both failed
{
  const result = failedSourceNames({ summary: true, prioritised: true });
  assert.deepStrictEqual(result, ['Health summary', 'High-risk clients'], 'both clientpulse sources');
}

// Unknown key falls back to the key name
{
  const result = failedSourceNames({ unknownSource: true });
  assert.deepStrictEqual(result, ['unknownSource'], 'unknown key falls back to key name');
}

console.log('dashboardErrorBannerPure: all assertions passed');
