import { test, expect } from 'vitest';
import {
  computeDedupeKey,
  applySignature,
  resolveThreadId,
  type ThreadLookup,
} from '../workspaceEmailPipelinePure.js';

test('computeDedupeKey is deterministic', () => {
  const k1 = computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:00Z', providerMessageId: 'pmid-1' });
  const k2 = computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:00Z', providerMessageId: 'pmid-1' });
  expect(k1).toBe(k2);
  expect(k1).not.toBe(
    computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:01Z', providerMessageId: 'pmid-1' }),
  );
});

test('applySignature stamps the agent signature on the body', () => {
  const stamped = applySignature('Hello', {
    template: '{agent-name}\n{role} · {subaccount-name}',
    agentName: 'Sarah',
    role: 'Specialist',
    subaccountName: 'Acme',
    discloseAsAgent: false,
  });
  expect(stamped.endsWith('Sarah\nSpecialist · Acme')).toBe(true);
});

test('applySignature includes "AI agent" when discloseAsAgent is true', () => {
  const disclosed = applySignature('Hi', {
    template: '{agent-name}',
    agentName: 'Sarah',
    role: 'Specialist',
    subaccountName: 'Acme',
    discloseAsAgent: true,
    agencyName: 'Maya Ops',
  });
  expect(disclosed.includes('AI agent')).toBe(true);
});

test('resolveThreadId reuses an existing thread when in-reply-to matches', async () => {
  const lookup: ThreadLookup = async (externalIds) => {
    if (externalIds.includes('msg-existing')) return 'thread-X';
    return null;
  };
  const reused = await resolveThreadId(
    { inReplyToExternalId: 'msg-existing', referencesExternalIds: [] },
    lookup,
  );
  expect(reused).toBe('thread-X');
});

test('resolveThreadId mints a fresh uuid when no thread is found', async () => {
  const lookup: ThreadLookup = async () => null;
  const fresh = await resolveThreadId(
    { inReplyToExternalId: 'unknown-msg', referencesExternalIds: [] },
    lookup,
  );
  expect(fresh).toMatch(/^[0-9a-f-]{36}$/i);
});
