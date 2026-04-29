import { strict as assert } from 'node:assert';
import {
  computeDedupeKey,
  applySignature,
  resolveThreadId,
  type ThreadLookup,
} from '../workspaceEmailPipelinePure.js';

// computeDedupeKey is deterministic
const k1 = computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:00Z', providerMessageId: 'pmid-1' });
const k2 = computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:00Z', providerMessageId: 'pmid-1' });
assert.equal(k1, k2, 'dedupe key is deterministic');
assert.notEqual(k1, computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:01Z', providerMessageId: 'pmid-1' }));

// Signature stamping
const stamped = applySignature('Hello', { template: '{agent-name}\n{role} · {subaccount-name}', agentName: 'Sarah', role: 'Specialist', subaccountName: 'Acme', discloseAsAgent: false });
assert.ok(stamped.endsWith('Sarah\nSpecialist · Acme'));

const disclosed = applySignature('Hi', { template: '{agent-name}', agentName: 'Sarah', role: 'Specialist', subaccountName: 'Acme', discloseAsAgent: true, agencyName: 'Maya Ops' });
assert.ok(disclosed.includes('AI agent'));

// Thread resolution
const lookup: ThreadLookup = async (externalIds) => {
  if (externalIds.includes('msg-existing')) return 'thread-X';
  return null;
};
assert.equal(await resolveThreadId({ inReplyToExternalId: 'msg-existing', referencesExternalIds: [] }, lookup), 'thread-X', 'reuses existing thread');
const fresh = await resolveThreadId({ inReplyToExternalId: 'unknown-msg', referencesExternalIds: [] }, lookup);
assert.match(fresh, /^[0-9a-f-]{36}$/i, 'new thread is a uuid');

console.log('workspaceEmailPipelinePure.test: OK');
