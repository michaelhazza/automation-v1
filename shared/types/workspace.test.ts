import { strict as assert } from 'node:assert';
import { deriveActorState } from './workspace.js';

// No identities → inactive
assert.equal(deriveActorState([]), 'inactive', 'empty array → inactive');

// All non-active statuses → inactive
assert.equal(deriveActorState([{ status: 'provisioned' }, { status: 'archived' }]), 'inactive', 'provisioned + archived → inactive');

// Any active → active (wins over others)
assert.equal(deriveActorState([{ status: 'active' }]), 'active', 'single active → active');
assert.equal(
  deriveActorState([{ status: 'active' }, { status: 'suspended' }, { status: 'revoked' }]),
  'active',
  'active wins over suspended',
);

// Suspended with no active → suspended
assert.equal(deriveActorState([{ status: 'suspended' }]), 'suspended', 'single suspended → suspended');
assert.equal(
  deriveActorState([{ status: 'suspended' }, { status: 'provisioned' }]),
  'suspended',
  'suspended wins over provisioned',
);

console.log('workspace.test: OK');
