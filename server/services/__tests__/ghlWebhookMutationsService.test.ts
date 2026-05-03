/**
 * ghlWebhookMutationsService.test.ts
 * Run: npx vitest run server/services/__tests__/ghlWebhookMutationsService.test.ts
 */
import { test, expect } from 'vitest';
import {
  classifyWebhookEvent,
} from '../ghlWebhookMutationsPure.js';

test('classifyWebhookEvent: INSTALL with installType=Company → install_company', () => {
  expect(classifyWebhookEvent({ type: 'INSTALL', installType: 'Company', webhookId: 'wh-1', companyId: 'co-1' }))
    .toBe('install_company');
});

test('classifyWebhookEvent: INSTALL with installType=Location → install_location_ignored', () => {
  expect(classifyWebhookEvent({ type: 'INSTALL', installType: 'Location', webhookId: 'wh-2', companyId: 'co-1' }))
    .toBe('install_location_ignored');
});

test('classifyWebhookEvent: UNINSTALL → uninstall', () => {
  expect(classifyWebhookEvent({ type: 'UNINSTALL', webhookId: 'wh-3', companyId: 'co-1' }))
    .toBe('uninstall');
});

test('classifyWebhookEvent: LocationCreate → location_create', () => {
  expect(classifyWebhookEvent({ type: 'LocationCreate', webhookId: 'wh-4', companyId: 'co-1', locationId: 'loc-1' }))
    .toBe('location_create');
});

test('classifyWebhookEvent: missing webhookId → throws', () => {
  expect(() => classifyWebhookEvent({ type: 'INSTALL', installType: 'Company', companyId: 'co-1' }))
    .toThrow('webhookId');
});
