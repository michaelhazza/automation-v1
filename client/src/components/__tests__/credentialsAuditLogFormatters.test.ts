import { expect, test } from 'vitest';
import {
  formatProviderName,
  formatAuditAction,
  formatAuditTimestamp,
} from '../credentialsAuditLogFormatters.js';

// formatProviderName
test('formatProviderName maps known provider types', () => {
  expect(formatProviderName('slack')).toBe('Slack');
  expect(formatProviderName('gmail')).toBe('Gmail');
  expect(formatProviderName('github')).toBe('GitHub');
  expect(formatProviderName('hubspot')).toBe('HubSpot');
  expect(formatProviderName('ghl')).toBe('GoHighLevel');
  expect(formatProviderName('teamwork')).toBe('Teamwork');
  expect(formatProviderName('web_login')).toBe('Web Login');
  expect(formatProviderName('custom')).toBe('Custom');
  expect(formatProviderName('google_drive')).toBe('Google Drive');
});

test('formatProviderName returns the raw key for unknown providers', () => {
  expect(formatProviderName('my_custom_provider')).toBe('my_custom_provider');
});

test('formatProviderName handles null and undefined', () => {
  expect(formatProviderName(null)).toBe('Unknown provider');
  expect(formatProviderName(undefined)).toBe('Unknown provider');
});

// formatAuditAction
test('formatAuditAction maps known action values', () => {
  expect(formatAuditAction('issued')).toBe('Issued');
  expect(formatAuditAction('refreshed')).toBe('Refreshed');
  expect(formatAuditAction('revoked')).toBe('Revoked');
  expect(formatAuditAction('used')).toBe('Used');
});

test('formatAuditAction title-cases unknown actions', () => {
  expect(formatAuditAction('expired')).toBe('Expired');
  expect(formatAuditAction('rotated')).toBe('Rotated');
});

test('formatAuditAction handles null and undefined', () => {
  expect(formatAuditAction(null)).toBe('Unknown action');
  expect(formatAuditAction(undefined)).toBe('Unknown action');
});

// formatAuditTimestamp
test('formatAuditTimestamp returns a non-empty string for a valid ISO date', () => {
  const result = formatAuditTimestamp('2026-01-15T10:30:00.000Z');
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
  expect(result).not.toBe('Invalid date');
});

test('formatAuditTimestamp accepts a Date object', () => {
  const d = new Date('2026-03-20T14:00:00.000Z');
  const result = formatAuditTimestamp(d);
  expect(typeof result).toBe('string');
  expect(result).not.toBe('Invalid date');
});

test('formatAuditTimestamp handles null and undefined', () => {
  expect(formatAuditTimestamp(null)).toBe('Unknown time');
  expect(formatAuditTimestamp(undefined)).toBe('Unknown time');
});

test('formatAuditTimestamp returns Invalid date for a malformed string', () => {
  expect(formatAuditTimestamp('not-a-date')).toBe('Invalid date');
});
