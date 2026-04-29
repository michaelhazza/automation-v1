import { expect, test } from 'vitest';
import { failedSourceNames } from '../dashboardErrorBannerPure.js';

test('assertions', () => {
  // 4-key DashboardPage error map — all false → empty
  {
    const result = failedSourceNames({ agents: false, activity: false, pulseAttention: false, clientHealth: false });
    expect(result, 'no failures → empty list').toStrictEqual([]);
  }
  
  // 4-key map — single failure
  {
    const result = failedSourceNames({ agents: true, activity: false, pulseAttention: false, clientHealth: false });
    expect(result, 'single agent failure').toStrictEqual(['Agents']);
  }
  
  // 4-key map — multiple failures
  {
    const result = failedSourceNames({ agents: true, activity: true, pulseAttention: false, clientHealth: true });
    expect(result, 'three failures in order').toStrictEqual(['Agents', 'Activity feed', 'Client health']);
  }
  
  // 4-key map — all failed
  {
    const result = failedSourceNames({ agents: true, activity: true, pulseAttention: true, clientHealth: true });
    expect(result.length, 'all four sources failed').toBe(4);
    expect(result.includes('Pending approvals')).toBeTruthy();
  }
  
  // 2-key ClientPulse error map
  {
    const result = failedSourceNames({ summary: true, prioritised: false });
    expect(result, 'summary maps to Health summary').toStrictEqual(['Health summary']);
  }
  
  // 2-key ClientPulse — both failed
  {
    const result = failedSourceNames({ summary: true, prioritised: true });
    expect(result, 'both clientpulse sources').toStrictEqual(['Health summary', 'High-risk clients']);
  }
  
  // Unknown key falls back to the key name
  {
    const result = failedSourceNames({ unknownSource: true });
    expect(result, 'unknown key falls back to key name').toStrictEqual(['unknownSource']);
  }
  
  // Permutation test (§8.21): key-iteration order must not affect the SET of names returned
  {
    const resultAB = failedSourceNames({ summary: true, prioritised: true });
    const resultBA = failedSourceNames({ prioritised: true, summary: true });
    // Both must contain exactly the same names (order may differ between JS engines; compare as sets)
    expect(new Set(resultAB), 'insertion order must not change the set of failed source names').toStrictEqual(new Set(resultBA));
  }
});
