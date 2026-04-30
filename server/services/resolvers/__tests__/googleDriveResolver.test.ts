import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { googleDriveResolver, normaliseSheetsCsv, normaliseDriveDocsText, isSupportedDriveMimeType } from '../googleDriveResolver';

test('isSupportedDriveMimeType — accepts the three v1 supported types', () => {
  assert.equal(isSupportedDriveMimeType('application/vnd.google-apps.document'), true);
  assert.equal(isSupportedDriveMimeType('application/vnd.google-apps.spreadsheet'), true);
  assert.equal(isSupportedDriveMimeType('application/pdf'), true);
});

test('isSupportedDriveMimeType — rejects unsupported types', () => {
  assert.equal(isSupportedDriveMimeType('application/vnd.google-apps.presentation'), false);
  assert.equal(isSupportedDriveMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
  assert.equal(isSupportedDriveMimeType('image/png'), false);
});

test('normaliseDriveDocsText — passthrough preserves content (deterministic)', () => {
  const input = 'Some prose.\n\nSecond paragraph.';
  assert.equal(normaliseDriveDocsText(input), input);
  assert.equal(normaliseDriveDocsText(input), normaliseDriveDocsText(input));
});

test('normaliseSheetsCsv — preserves CSV structure deterministically', () => {
  const input = 'a,b,c\n1,2,3\n4,5,6\n';
  const out = normaliseSheetsCsv(input);
  assert.equal(out, input);
  assert.equal(out, normaliseSheetsCsv(input));
});

test('googleDriveResolver.resolverVersion — exposes 1 for v1', () => {
  assert.equal(googleDriveResolver.resolverVersion, 1);
  assert.equal(googleDriveResolver.providerKey, 'google_drive');
});
