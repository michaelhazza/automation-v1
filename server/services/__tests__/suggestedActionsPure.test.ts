import { describe, test, expect } from 'vitest';
import { parseSuggestedActions } from '../../../shared/types/messageSuggestedActions.js';
import { dispatchSuggestedAction } from '../suggestedActionDispatchService.js';

const CTX = { conversationId: 'test-conv-id' };

describe('parseSuggestedActions', () => {
  test('valid array parses correctly', () => {
    const content = `Here is some response.\n<suggested_actions>\n[{"kind":"prompt","label":"Save template","prompt":"Save as template"},{"kind":"system","label":"Schedule daily","actionKey":"schedule_daily"}]\n</suggested_actions>`;
    const { chips, strippedContent } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(2);
    expect(chips[0].kind).toBe('prompt');
    expect(chips[1].kind).toBe('system');
    expect(strippedContent).not.toContain('<suggested_actions>');
    expect(strippedContent).toContain('Here is some response.');
  });

  test('drops unknown actionKey, keeps valid sibling', () => {
    const content = `Text\n<suggested_actions>\n[{"kind":"system","label":"Bad","actionKey":"unknown_key"},{"kind":"prompt","label":"Good","prompt":"Do something"}]\n</suggested_actions>`;
    const { chips } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(1);
    expect(chips[0].kind).toBe('prompt');
  });

  test('drops malformed entry, keeps valid siblings', () => {
    const content = `Text\n<suggested_actions>\n[{"kind":"prompt","label":""},{"kind":"prompt","label":"Valid","prompt":"Do it"}]\n</suggested_actions>`;
    const { chips } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Valid');
  });

  test('empty array', () => {
    const content = `Text\n<suggested_actions>\n[]\n</suggested_actions>`;
    const { chips, strippedContent } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(0);
    expect(strippedContent).not.toContain('<suggested_actions>');
  });

  test('null input', () => {
    const { chips, strippedContent } = parseSuggestedActions(null, CTX);
    expect(chips).toHaveLength(0);
    expect(strippedContent).toBe('');
  });

  test('no block in content', () => {
    const { chips, strippedContent } = parseSuggestedActions('Just a plain response.', CTX);
    expect(chips).toHaveLength(0);
    expect(strippedContent).toBe('Just a plain response.');
  });

  test('max 4 chips enforced', () => {
    const chips5 = Array.from({ length: 5 }, (_, i) => ({ kind: 'prompt', label: `L${i}`, prompt: `P${i}` }));
    const content = `Text\n<suggested_actions>\n${JSON.stringify(chips5)}\n</suggested_actions>`;
    const { chips } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(4);
  });

  test('malformed JSON block', () => {
    const content = `Text\n<suggested_actions>\nnot json at all\n</suggested_actions>`;
    const { chips, strippedContent } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(0);
    expect(strippedContent).not.toContain('<suggested_actions>');
  });

  test('mid-content block is ignored (regex anchors to end of string)', () => {
    const content = 'Some response\n<suggested_actions>[{"kind":"prompt","label":"Click me","prompt":"Do something"}]</suggested_actions>\nMore text after';
    const { chips, strippedContent } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(0);
    expect(strippedContent).toBe(content);
  });

  test('chip with label > 80 chars is dropped, valid sibling kept', () => {
    const longLabel = 'A'.repeat(81);
    const validChip = { kind: 'prompt', label: 'Valid', prompt: 'Do something' };
    const overflowChip = { kind: 'prompt', label: longLabel, prompt: 'short prompt' };
    const content = `Text\n<suggested_actions>\n${JSON.stringify([overflowChip, validChip])}\n</suggested_actions>`;
    const { chips } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Valid');
  });

  test('chip with prompt > 2000 chars is dropped, valid sibling kept', () => {
    const longPrompt = 'B'.repeat(2001);
    const validChip = { kind: 'prompt', label: 'Valid', prompt: 'Do something' };
    const overflowChip = { kind: 'prompt', label: 'Short label', prompt: longPrompt };
    const content = `Text\n<suggested_actions>\n${JSON.stringify([overflowChip, validChip])}\n</suggested_actions>`;
    const { chips } = parseSuggestedActions(content, CTX);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Valid');
  });
});

describe('dispatchSuggestedAction', () => {
  const DISPATCH_PARAMS = {
    conversationId: 'conv-123',
    agentId: 'agent-456',
    userId: 'user-789',
    organisationId: 'org-abc',
  };

  test('save_thread_as_agent → redirectUrl with conversationId', async () => {
    const result = await dispatchSuggestedAction({ ...DISPATCH_PARAMS, actionKey: 'save_thread_as_agent' });
    expect(result.success).toBe(true);
    expect(result.redirectUrl).toContain('/admin/agents/new?fromConversation=conv-123');
  });

  test('schedule_daily → redirectUrl with agentId + tab=scheduling', async () => {
    const result = await dispatchSuggestedAction({ ...DISPATCH_PARAMS, actionKey: 'schedule_daily' });
    expect(result.success).toBe(true);
    expect(result.redirectUrl).toContain('/admin/agents/agent-456?tab=scheduling');
  });

  test('pin_skill → redirectUrl with agentId + tab=skills', async () => {
    const result = await dispatchSuggestedAction({ ...DISPATCH_PARAMS, actionKey: 'pin_skill' });
    expect(result.success).toBe(true);
    expect(result.redirectUrl).toContain('/admin/agents/agent-456?tab=skills');
  });
});
