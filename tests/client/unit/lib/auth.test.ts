// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getToken,
  setToken,
  removeToken,
  isAuthenticated,
  setUserRole,
  getUserRole,
  removeUserRole,
  setActiveOrg,
  getActiveOrgId,
  getActiveOrgName,
  removeActiveOrg,
  setActiveClient,
  getActiveClientId,
  getActiveClientName,
  removeActiveClient,
} from '@/lib/auth';

describe('auth utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isAuthenticated returns false when no token', () => {
    expect(isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when token is set', () => {
    setToken('jwt-token-123');
    expect(isAuthenticated()).toBe(true);
    expect(getToken()).toBe('jwt-token-123');
  });

  it('removeToken clears the token', () => {
    setToken('jwt-token-123');
    removeToken();
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('setUserRole stores and getUserRole retrieves correctly', () => {
    expect(getUserRole()).toBeNull();
    setUserRole('admin');
    expect(getUserRole()).toBe('admin');
  });

  it('removeUserRole clears the stored role', () => {
    setUserRole('system_admin');
    removeUserRole();
    expect(getUserRole()).toBeNull();
  });

  it('setActiveOrg stores org id and name', () => {
    setActiveOrg('org-1', 'My Organisation');
    expect(getActiveOrgId()).toBe('org-1');
    expect(getActiveOrgName()).toBe('My Organisation');
  });

  it('removeActiveOrg clears org data', () => {
    setActiveOrg('org-1', 'My Organisation');
    removeActiveOrg();
    expect(getActiveOrgId()).toBeNull();
    expect(getActiveOrgName()).toBeNull();
  });

  it('setActiveClient / getActiveClient aliases work for subaccount', () => {
    setActiveClient('sub-1', 'Acme Corp');
    expect(getActiveClientId()).toBe('sub-1');
    expect(getActiveClientName()).toBe('Acme Corp');
  });

  it('removeActiveClient clears subaccount data', () => {
    setActiveClient('sub-1', 'Acme Corp');
    removeActiveClient();
    expect(getActiveClientId()).toBeNull();
    expect(getActiveClientName()).toBeNull();
  });
});
