import { test, expect } from 'vitest';
import { googleDriveResolver, normaliseSheetsCsv, normaliseDriveDocsText, isSupportedDriveMimeType } from '../googleDriveResolver.js';

test('isSupportedDriveMimeType — accepts the three v1 supported types', () => {
  expect(isSupportedDriveMimeType('application/vnd.google-apps.document')).toBe(true);
  expect(isSupportedDriveMimeType('application/vnd.google-apps.spreadsheet')).toBe(true);
  expect(isSupportedDriveMimeType('application/pdf')).toBe(true);
});

test('isSupportedDriveMimeType — rejects unsupported types', () => {
  expect(isSupportedDriveMimeType('application/vnd.google-apps.presentation')).toBe(false);
  expect(isSupportedDriveMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
  expect(isSupportedDriveMimeType('image/png')).toBe(false);
});

test('normaliseDriveDocsText — passthrough preserves content (deterministic)', () => {
  const input = 'Some prose.\n\nSecond paragraph.';
  expect(normaliseDriveDocsText(input)).toBe(input);
  expect(normaliseDriveDocsText(input)).toBe(normaliseDriveDocsText(input));
});

test('normaliseSheetsCsv — preserves CSV structure deterministically', () => {
  const input = 'a,b,c\n1,2,3\n4,5,6\n';
  const out = normaliseSheetsCsv(input);
  expect(out).toBe(input);
  expect(out).toBe(normaliseSheetsCsv(input));
});

test('googleDriveResolver.resolverVersion — exposes 1 for v1', () => {
  expect(googleDriveResolver.resolverVersion).toBe(1);
  expect(googleDriveResolver.providerKey).toBe('google_drive');
});
