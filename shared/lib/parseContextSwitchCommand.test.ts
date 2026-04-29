import { strict as assert } from 'node:assert';
import { parseContextSwitchCommand } from './parseContextSwitchCommand.js';

// positive — org synonyms
assert.deepStrictEqual(
  parseContextSwitchCommand('change to org Acme Pty Ltd'),
  { entityType: 'org', entityName: 'Acme Pty Ltd', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('switch to organisation Acme, show me today\'s tasks'),
  { entityType: 'org', entityName: 'Acme', remainder: 'show me today\'s tasks' },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to organization Acme'),
  { entityType: 'org', entityName: 'Acme', remainder: null },
);

// positive — subaccount synonyms
assert.deepStrictEqual(
  parseContextSwitchCommand('change to subaccount Sales Team, list all contacts'),
  { entityType: 'subaccount', entityName: 'Sales Team', remainder: 'list all contacts' },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to sub-account Sales'),
  { entityType: 'subaccount', entityName: 'Sales', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to client Breakout Solutions'),
  { entityType: 'subaccount', entityName: 'Breakout Solutions', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('switch to company Acme'),
  { entityType: 'subaccount', entityName: 'Acme', remainder: null },
);

// positive — no type keyword (entityType: null)
assert.deepStrictEqual(
  parseContextSwitchCommand('change to Acme, show tasks'),
  { entityType: null, entityName: 'Acme', remainder: 'show tasks' },
);

// negative — not a switch command
assert.strictEqual(parseContextSwitchCommand('show me today\'s tasks'), null);
assert.strictEqual(parseContextSwitchCommand('what is the status of the global account?'), null);
assert.strictEqual(parseContextSwitchCommand('/remember do this'), null);

// case insensitive
assert.deepStrictEqual(
  parseContextSwitchCommand('CHANGE TO ORG Acme'),
  { entityType: 'org', entityName: 'Acme', remainder: null },
);

// "please" in the middle of the entity segment (before the comma) is stripped
assert.deepStrictEqual(
  parseContextSwitchCommand('change to Acme please, create a campaign'),
  { entityType: null, entityName: 'Acme', remainder: 'create a campaign' },
);

// filler prefix + trailing please
assert.deepStrictEqual(
  parseContextSwitchCommand('can you change to org Acme please'),
  { entityType: 'org', entityName: 'Acme', remainder: null },
);

// "please" in the MIDDLE of an entity name must not be stripped (regression
// guard: a global \bplease\b strip would mangle entities like "Please Holdings")
assert.deepStrictEqual(
  parseContextSwitchCommand('change to Please Holdings'),
  { entityType: null, entityName: 'Please Holdings', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to org Please Holdings, show tasks'),
  { entityType: 'org', entityName: 'Please Holdings', remainder: 'show tasks' },
);

console.log('All parseContextSwitchCommand tests passed.');
