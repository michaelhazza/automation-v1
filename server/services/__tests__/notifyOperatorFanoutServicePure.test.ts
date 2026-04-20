import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  deriveChannelAvailability,
  planFanout,
} from '../notifyOperatorChannels/availabilityPure.js';

test('availability — all configured', () => {
  assert.deepEqual(
    deriveChannelAvailability({
      emailFromAddress: 'noreply@agency.com',
      slackWebhookUrl: 'https://hooks.slack.com/services/...',
    }),
    { inApp: true, email: true, slack: true },
  );
});

test('availability — email missing', () => {
  assert.deepEqual(
    deriveChannelAvailability({ emailFromAddress: null, slackWebhookUrl: null }),
    { inApp: true, email: false, slack: false },
  );
});

test('availability — empty strings treated as unconfigured', () => {
  assert.deepEqual(
    deriveChannelAvailability({ emailFromAddress: '', slackWebhookUrl: '' }),
    { inApp: true, email: false, slack: false },
  );
});

test('plan — all requested + all available', () => {
  assert.deepEqual(
    planFanout({
      requested: ['in_app', 'email', 'slack'],
      availability: { inApp: true, email: true, slack: true },
    }),
    { dispatch: ['in_app', 'email', 'slack'], skipped: [] },
  );
});

test('plan — slack requested but unavailable → skipped', () => {
  assert.deepEqual(
    planFanout({
      requested: ['in_app', 'slack'],
      availability: { inApp: true, email: true, slack: false },
    }),
    { dispatch: ['in_app'], skipped: ['slack'] },
  );
});

test('plan — email + slack requested but only email available', () => {
  assert.deepEqual(
    planFanout({
      requested: ['email', 'slack'],
      availability: { inApp: true, email: true, slack: false },
    }),
    { dispatch: ['email'], skipped: ['slack'] },
  );
});

test('plan — empty requested → empty plan', () => {
  assert.deepEqual(
    planFanout({
      requested: [],
      availability: { inApp: true, email: true, slack: true },
    }),
    { dispatch: [], skipped: [] },
  );
});

test('plan — in_app always dispatches (always available)', () => {
  assert.deepEqual(
    planFanout({
      requested: ['in_app'],
      availability: { inApp: true, email: false, slack: false },
    }),
    { dispatch: ['in_app'], skipped: [] },
  );
});
