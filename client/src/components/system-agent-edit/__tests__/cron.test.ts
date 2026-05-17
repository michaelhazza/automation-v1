import { expect, test } from 'vitest';
import { parseCron, buildCron } from '../cron.js';

// ── parseCron ─────────────────────────────────────────────────────────────

test('parseCron: null/undefined → defaults', () => {
  expect(parseCron(null)).toEqual({ hour: 9, minute: 0, interval: 0 });
  expect(parseCron(undefined)).toEqual({ hour: 9, minute: 0, interval: 0 });
  expect(parseCron('')).toEqual({ hour: 9, minute: 0, interval: 0 });
});

test('parseCron: single-hour cron "0 9 * * *" → {hour:9, minute:0, interval:24}', () => {
  expect(parseCron('0 9 * * *')).toEqual({ hour: 9, minute: 0, interval: 24 });
});

test('parseCron: multi-hour cron "30 9,13,17,21 * * *" → {hour:9, minute:30, interval:4}', () => {
  expect(parseCron('30 9,13,17,21 * * *')).toEqual({ hour: 9, minute: 30, interval: 4 });
});

test('parseCron: 8-hour interval "0 8,16 * * *" → {hour:8, minute:0, interval:8}', () => {
  expect(parseCron('0 8,16 * * *')).toEqual({ hour: 8, minute: 0, interval: 8 });
});

test('parseCron: malformed cron → defaults', () => {
  expect(parseCron('not-a-cron')).toEqual({ hour: 9, minute: 0, interval: 0 });
});

// ── buildCron ─────────────────────────────────────────────────────────────

test('buildCron: interval 0 → null (disabled)', () => {
  expect(buildCron(9, 0, 0)).toBeNull();
});

test('buildCron: interval 24 → single-hour cron', () => {
  expect(buildCron(9, 0, 24)).toBe('0 9 * * *');
});

test('buildCron: interval 4 starting at 9 → multi-hour cron', () => {
  expect(buildCron(9, 30, 4)).toBe('30 9,13,17,21 * * *');
});

test('buildCron: interval 8 starting at 8 → two-slot cron', () => {
  expect(buildCron(8, 0, 8)).toBe('0 8,16 * * *');
});

// ── round-trip ────────────────────────────────────────────────────────────

test('round-trip: parseCron(buildCron(h, m, iv)) → original values', () => {
  const cases: Array<[number, number, number]> = [
    [9, 0, 24],
    [9, 30, 4],
    [8, 0, 8],
    [0, 15, 6],
  ];
  for (const [hour, minute, interval] of cases) {
    const cron = buildCron(hour, minute, interval);
    expect(cron).not.toBeNull();
    const parsed = parseCron(cron!);
    expect(parsed.hour, `hour for interval=${interval}`).toBe(hour);
    expect(parsed.minute, `minute for interval=${interval}`).toBe(minute);
    expect(parsed.interval, `interval for interval=${interval}`).toBe(interval);
  }
});
