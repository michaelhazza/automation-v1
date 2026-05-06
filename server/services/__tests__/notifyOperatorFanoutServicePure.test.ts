import { expect, test } from 'vitest';
import {
  deriveChannelAvailability,
  planFanout,
} from '../notifyOperatorChannels/availabilityPure.js';

test('availability — all configured', () => {
  expect(deriveChannelAvailability({
      emailFromAddress: 'noreply@agency.com',
      slackWebhookUrl: 'https://hooks.slack.com/services/...',
    })).toEqual({ inApp: true, email: true, slack: true });
});

test('availability — email missing', () => {
  expect(deriveChannelAvailability({ emailFromAddress: null, slackWebhookUrl: null })).toEqual({ inApp: true, email: false, slack: false });
});

test('availability — empty strings treated as unconfigured', () => {
  expect(deriveChannelAvailability({ emailFromAddress: '', slackWebhookUrl: '' })).toEqual({ inApp: true, email: false, slack: false });
});

test('plan — all requested + all available', () => {
  expect(planFanout({
      requested: ['in_app', 'email', 'slack'],
      availability: { inApp: true, email: true, slack: true },
    })).toEqual({ dispatch: ['in_app', 'email', 'slack'], skipped: [] });
});

test('plan — slack requested but unavailable → skipped', () => {
  expect(planFanout({
      requested: ['in_app', 'slack'],
      availability: { inApp: true, email: true, slack: false },
    })).toEqual({ dispatch: ['in_app'], skipped: ['slack'] });
});

test('plan — email + slack requested but only email available', () => {
  expect(planFanout({
      requested: ['email', 'slack'],
      availability: { inApp: true, email: true, slack: false },
    })).toEqual({ dispatch: ['email'], skipped: ['slack'] });
});

test('plan — empty requested → empty plan', () => {
  expect(planFanout({
      requested: [],
      availability: { inApp: true, email: true, slack: true },
    })).toEqual({ dispatch: [], skipped: [] });
});

test('plan — in_app always dispatches (always available)', () => {
  expect(planFanout({
      requested: ['in_app'],
      availability: { inApp: true, email: false, slack: false },
    })).toEqual({ dispatch: ['in_app'], skipped: [] });
});
