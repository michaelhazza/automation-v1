import { expect, test } from 'vitest';
import { parseContextSwitchCommand } from '../parseContextSwitchCommand.js';

test('parseContextSwitchCommand: positive and negative cases', () => {
  // positive — org synonyms
  expect(parseContextSwitchCommand('change to org Acme Pty Ltd')).toEqual({ entityType: 'org', entityName: 'Acme Pty Ltd', remainder: null });
  expect(parseContextSwitchCommand('switch to organisation Acme, show me today\'s tasks')).toEqual({ entityType: 'org', entityName: 'Acme', remainder: 'show me today\'s tasks' });
  expect(parseContextSwitchCommand('change to organization Acme')).toEqual({ entityType: 'org', entityName: 'Acme', remainder: null });

  // positive — subaccount synonyms
  expect(parseContextSwitchCommand('change to subaccount Sales Team, list all contacts')).toEqual({ entityType: 'subaccount', entityName: 'Sales Team', remainder: 'list all contacts' });
  expect(parseContextSwitchCommand('change to sub-account Sales')).toEqual({ entityType: 'subaccount', entityName: 'Sales', remainder: null });
  expect(parseContextSwitchCommand('change to client Breakout Solutions')).toEqual({ entityType: 'subaccount', entityName: 'Breakout Solutions', remainder: null });
  expect(parseContextSwitchCommand('switch to company Acme')).toEqual({ entityType: 'subaccount', entityName: 'Acme', remainder: null });

  // positive — no type keyword (entityType: null)
  expect(parseContextSwitchCommand('change to Acme, show tasks')).toEqual({ entityType: null, entityName: 'Acme', remainder: 'show tasks' });

  // negative — not a switch command
  expect(parseContextSwitchCommand('show me today\'s tasks')).toBe(null);
  expect(parseContextSwitchCommand('what is the status of the global account?')).toBe(null);
  expect(parseContextSwitchCommand('/remember do this')).toBe(null);

  // case insensitive
  expect(parseContextSwitchCommand('CHANGE TO ORG Acme')).toEqual({ entityType: 'org', entityName: 'Acme', remainder: null });

  // "please" in the middle of the entity segment (before the comma) is stripped
  expect(parseContextSwitchCommand('change to Acme please, create a campaign')).toEqual({ entityType: null, entityName: 'Acme', remainder: 'create a campaign' });

  // filler prefix + trailing please
  expect(parseContextSwitchCommand('can you change to org Acme please')).toEqual({ entityType: 'org', entityName: 'Acme', remainder: null });

  // "please" in the MIDDLE of an entity name must not be stripped
  expect(parseContextSwitchCommand('change to Please Holdings')).toEqual({ entityType: null, entityName: 'Please Holdings', remainder: null });
  expect(parseContextSwitchCommand('change to org Please Holdings, show tasks')).toEqual({ entityType: 'org', entityName: 'Please Holdings', remainder: 'show tasks' });
});
