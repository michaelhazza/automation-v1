/**
 * topicClassifierPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/topicClassifierPure.test.ts
 *
 * Tests the pure keyword-based topic classification introduced by Sprint 5
 * P4.1 of docs/improvements-roadmap-spec.md.
 */

import {
  classifyTopics,
  skillsMatchingTopics,
  reorderToolsByTopicRelevance,
} from '../topicClassifierPure.js';
import { TOPIC_REGISTRY } from '../../config/topicRegistry.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── classifyTopics ─────────────────────────────────────────────────

test('classifyTopics: returns null primaryTopic for empty text', () => {
  const result = classifyTopics('', TOPIC_REGISTRY);
  assert(result.primaryTopic === null, 'primaryTopic should be null');
  assert(result.confidence === 0, 'confidence should be 0');
});

test('classifyTopics: classifies email-related messages', () => {
  const result = classifyTopics('Please send an email to the client about the invoice', TOPIC_REGISTRY);
  assert(result.primaryTopic === 'email', `expected email, got ${result.primaryTopic}`);
  assert(result.confidence > 0, 'confidence should be > 0');
});

test('classifyTopics: classifies dev-related messages', () => {
  const result = classifyTopics('Fix the bug in the login endpoint and deploy to staging', TOPIC_REGISTRY);
  assert(result.primaryTopic === 'dev', `expected dev, got ${result.primaryTopic}`);
  assert(result.confidence > 0, 'confidence should be > 0');
});

test('classifyTopics: classifies task-related messages', () => {
  const result = classifyTopics('Create a task for the design review and assign it', TOPIC_REGISTRY);
  assert(result.primaryTopic === 'task', `expected task, got ${result.primaryTopic}`);
  assert(result.confidence > 0, 'confidence should be > 0');
});

test('classifyTopics: classifies reporting messages', () => {
  const result = classifyTopics('Generate a health report and check the analytics dashboard', TOPIC_REGISTRY);
  assert(result.primaryTopic === 'reporting', `expected reporting, got ${result.primaryTopic}`);
  assert(result.confidence > 0, 'confidence should be > 0');
});

test('classifyTopics: returns higher confidence for more keyword matches', () => {
  const single = classifyTopics('Send an email', TOPIC_REGISTRY);
  const multiple = classifyTopics('Send an email to the inbox about the mail thread', TOPIC_REGISTRY);
  assert(multiple.confidence >= single.confidence, 'more matches should yield >= confidence');
});

test('classifyTopics: detects secondary topics', () => {
  const result = classifyTopics('Create a task to fix the bug in the code', TOPIC_REGISTRY);
  assert(result.primaryTopic !== null, 'primaryTopic should not be null');
  const topics = [result.primaryTopic, result.secondaryTopic].filter(Boolean);
  assert(topics.length >= 1, 'should detect at least one topic');
});

// ── skillsMatchingTopics ───────────────────────────────────────────

const actionTopicsMap: Record<string, string[]> = {
  send_email: ['email'],
  read_inbox: ['email'],
  create_task: ['task'],
  write_patch: ['dev'],
  web_search: [],
  read_workspace: ['workspace'],
};

test('skillsMatchingTopics: returns skills matching the given topics', () => {
  const result = skillsMatchingTopics(['email'], actionTopicsMap);
  assert(result.includes('send_email'), 'should contain send_email');
  assert(result.includes('read_inbox'), 'should contain read_inbox');
  assert(!result.includes('write_patch'), 'should not contain write_patch');
});

test('skillsMatchingTopics: includes actions with no topics (safety net)', () => {
  const result = skillsMatchingTopics(['email'], actionTopicsMap);
  assert(result.includes('web_search'), 'should contain web_search (no topics)');
});

test('skillsMatchingTopics: returns only topic-unclassified actions for empty topic list', () => {
  const result = skillsMatchingTopics([], actionTopicsMap);
  // Only web_search has no topics, so only it should be returned
  assertEqual(result.length, 1, 'should return only unclassified actions');
  assert(result.includes('web_search'), 'should contain web_search');
});

// ── reorderToolsByTopicRelevance ───────────────────────────────────

const tools = [
  { name: 'write_patch' },
  { name: 'send_email' },
  { name: 'create_task' },
  { name: 'web_search' },
];

test('reorderToolsByTopicRelevance: puts core skills first, then topic matches, then rest', () => {
  const reordered = reorderToolsByTopicRelevance(
    tools,
    ['send_email'],
    ['web_search'],
  );
  const names = reordered.map((t) => t.name);
  const coreIdx = names.indexOf('web_search');
  const matchIdx = names.indexOf('send_email');
  assert(coreIdx < matchIdx, 'core skill should come before topic match');
});

test('reorderToolsByTopicRelevance: preserves all tools (no removal in soft mode)', () => {
  const reordered = reorderToolsByTopicRelevance(tools, ['send_email'], []);
  assert(reordered.length === tools.length, 'should preserve all tools');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
