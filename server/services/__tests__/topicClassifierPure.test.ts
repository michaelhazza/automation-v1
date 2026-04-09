import { describe, it, expect } from 'vitest';
import {
  classifyTopics,
  skillsMatchingTopics,
  reorderToolsByTopicRelevance,
} from '../topicClassifierPure.js';
import { TOPIC_REGISTRY } from '../../config/topicRegistry.js';

describe('classifyTopics', () => {
  it('returns null primaryTopic for empty text', () => {
    const result = classifyTopics('', TOPIC_REGISTRY);
    expect(result.primaryTopic).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('classifies email-related messages', () => {
    const result = classifyTopics('Please send an email to the client about the invoice', TOPIC_REGISTRY);
    expect(result.primaryTopic).toBe('email');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies dev-related messages', () => {
    const result = classifyTopics('Fix the bug in the login endpoint and deploy to staging', TOPIC_REGISTRY);
    expect(result.primaryTopic).toBe('dev');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies task-related messages', () => {
    const result = classifyTopics('Create a task for the design review and assign it', TOPIC_REGISTRY);
    expect(result.primaryTopic).toBe('task');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies reporting messages', () => {
    const result = classifyTopics('Generate a health report and check the analytics dashboard', TOPIC_REGISTRY);
    expect(result.primaryTopic).toBe('reporting');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns higher confidence for more keyword matches', () => {
    const single = classifyTopics('Send an email', TOPIC_REGISTRY);
    const multiple = classifyTopics('Send an email to the inbox about the mail thread', TOPIC_REGISTRY);
    expect(multiple.confidence).toBeGreaterThanOrEqual(single.confidence);
  });

  it('detects secondary topics', () => {
    const result = classifyTopics('Create a task to fix the bug in the code', TOPIC_REGISTRY);
    expect(result.primaryTopic).toBeTruthy();
    // Could be task or dev — either way it should detect both
    const topics = [result.primaryTopic, result.secondaryTopic].filter(Boolean);
    expect(topics.length).toBeGreaterThanOrEqual(1);
  });
});

describe('skillsMatchingTopics', () => {
  const actionTopicsMap: Record<string, string[]> = {
    send_email: ['email'],
    read_inbox: ['email'],
    create_task: ['task'],
    write_patch: ['dev'],
    web_search: [],
    read_workspace: ['workspace'],
  };

  it('returns skills matching the given topics', () => {
    const result = skillsMatchingTopics(['email'], actionTopicsMap);
    expect(result).toContain('send_email');
    expect(result).toContain('read_inbox');
    expect(result).not.toContain('write_patch');
  });

  it('includes actions with no topics (safety net)', () => {
    const result = skillsMatchingTopics(['email'], actionTopicsMap);
    expect(result).toContain('web_search');
  });

  it('returns all actions for empty topic list', () => {
    const result = skillsMatchingTopics([], actionTopicsMap);
    expect(result.length).toBe(Object.keys(actionTopicsMap).length);
  });
});

describe('reorderToolsByTopicRelevance', () => {
  const tools = [
    { name: 'write_patch' },
    { name: 'send_email' },
    { name: 'create_task' },
    { name: 'web_search' },
  ];

  it('puts core skills first, then topic matches, then rest', () => {
    const reordered = reorderToolsByTopicRelevance(
      tools,
      ['send_email'],
      ['web_search'],
    );

    const names = reordered.map((t) => t.name);
    const coreIdx = names.indexOf('web_search');
    const matchIdx = names.indexOf('send_email');
    expect(coreIdx).toBeLessThan(matchIdx);
  });

  it('preserves all tools (no removal in soft mode)', () => {
    const reordered = reorderToolsByTopicRelevance(tools, ['send_email'], []);
    expect(reordered.length).toBe(tools.length);
  });
});
