import { describe, it, expect } from 'vitest';
import { mutateActiveToolsPreservingUniversal } from '../agentExecutionServicePure.js';
import type { ProviderTool } from '../providers/types.js';

// Minimal tool stubs
function tool(name: string): ProviderTool {
  return { name, description: '', input_schema: { type: 'object', properties: {}, required: [] } };
}

describe('mutateActiveToolsPreservingUniversal', () => {
  it('re-injects universal tools removed by the transform', () => {
    const current = [tool('send_email'), tool('ask_clarifying_question'), tool('web_search')];
    const all = [...current, tool('read_workspace')];

    // Transform that removes everything except send_email
    const result = mutateActiveToolsPreservingUniversal(
      current,
      (tools) => tools.filter((t) => t.name === 'send_email'),
      all,
    );

    const names = result.map((t) => t.name);
    expect(names).toContain('send_email');
    // Universal skills should be re-injected
    expect(names).toContain('ask_clarifying_question');
    expect(names).toContain('web_search');
    expect(names).toContain('read_workspace');
  });

  it('does not duplicate tools that the transform kept', () => {
    const current = [tool('send_email'), tool('ask_clarifying_question')];
    const all = [...current];

    // Transform that keeps everything
    const result = mutateActiveToolsPreservingUniversal(
      current,
      (tools) => tools,
      all,
    );

    const names = result.map((t) => t.name);
    // No duplicates
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('handles empty transform result', () => {
    const current = [tool('send_email'), tool('web_search')];
    const all = [...current, tool('ask_clarifying_question'), tool('read_workspace')];

    const result = mutateActiveToolsPreservingUniversal(
      current,
      () => [],
      all,
    );

    const names = result.map((t) => t.name);
    // Only universal tools remain
    expect(names).toContain('ask_clarifying_question');
    expect(names).toContain('web_search');
    expect(names).toContain('read_workspace');
    expect(names).not.toContain('send_email');
  });
});
