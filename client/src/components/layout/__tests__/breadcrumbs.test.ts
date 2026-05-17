import { describe, it, expect } from 'vitest';
import { buildBreadcrumbs } from '../breadcrumbs.js';

describe('buildBreadcrumbs', () => {
  it('returns [] for root pathname', () => {
    expect(buildBreadcrumbs('/', null)).toEqual([]);
  });

  it('uses clientName as label for UUID after subaccounts', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const crumbs = buildBreadcrumbs(`/subaccounts/${uuid}/agents`, 'Acme Corp');
    const uuidCrumb = crumbs.find(c => c.to === `/subaccounts/${uuid}`);
    expect(uuidCrumb).toBeDefined();
    expect(uuidCrumb?.label).toBe('Acme Corp');
  });

  it('skips UUID when not preceded by subaccounts', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const crumbs = buildBreadcrumbs(`/agents/${uuid}`, 'Acme Corp');
    const uuidCrumb = crumbs.find(c => c.to === `/agents/${uuid}`);
    expect(uuidCrumb).toBeUndefined();
  });

  it('skips segments where SEG value is null (e.g. admin, system)', () => {
    const crumbs = buildBreadcrumbs('/admin/system/settings', null);
    const adminCrumb = crumbs.find(c => c.label === 'admin' || c.label === 'Admin');
    const systemCrumb = crumbs.find(c => c.label === 'system' || c.label === 'System');
    expect(adminCrumb).toBeUndefined();
    expect(systemCrumb).toBeUndefined();
  });

  it('falls back to title-case for unknown segments not in SEG', () => {
    const crumbs = buildBreadcrumbs('/something-new', null);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].label).toBe('Something New');
  });
});
