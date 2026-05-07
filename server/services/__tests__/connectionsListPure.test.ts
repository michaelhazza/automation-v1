import { describe, it, expect } from 'vitest';
import {
  dbAuthTypeToContract,
  mcpAuthMethod,
  dbConnectionStatusToContract,
  encodeCursor,
  decodeCursor,
  UnknownEnumValueError,
} from '../connectionsListPure.js';

describe('connectionsListPure', () => {
  describe('dbAuthTypeToContract', () => {
    it('maps known auth types correctly', () => {
      expect(dbAuthTypeToContract('oauth2')).toBe('oauth');
      expect(dbAuthTypeToContract('api_key')).toBe('api_key');
      expect(dbAuthTypeToContract('service_account')).toBe('web_login');
      expect(dbAuthTypeToContract('web_login')).toBe('web_login');
      expect(dbAuthTypeToContract('github_app')).toBe('oauth');
    });
    it('throws on unknown auth type (INVARIANT I2)', () => {
      expect(() => dbAuthTypeToContract('unknown_type')).toThrow(UnknownEnumValueError);
    });
  });

  describe('mcpAuthMethod', () => {
    it('always returns mcp', () => {
      expect(mcpAuthMethod()).toBe('mcp');
    });
  });

  describe('dbConnectionStatusToContract', () => {
    it('maps known connection statuses', () => {
      expect(dbConnectionStatusToContract('active')).toBe('connected');
      expect(dbConnectionStatusToContract('revoked')).toBe('failed');
      expect(dbConnectionStatusToContract('error')).toBe('failed');
    });
    it('oauth_status takes precedence when present', () => {
      expect(dbConnectionStatusToContract('active', 'expired')).toBe('expired');
      expect(dbConnectionStatusToContract('active', 'error')).toBe('failed');
      expect(dbConnectionStatusToContract('error', 'active')).toBe('connected');
    });
    it('throws on unknown status without oauth_status (INVARIANT I2)', () => {
      expect(() => dbConnectionStatusToContract('unknown_status')).toThrow(UnknownEnumValueError);
    });
    it('throws on unknown oauthStatus (INVARIANT I2)', () => {
      expect(() => dbConnectionStatusToContract('active', 'unknown_oauth_state')).toThrow(UnknownEnumValueError);
    });
  });

  describe('cursor encode/decode', () => {
    it('round-trips', () => {
      const p = { primary: '2026-05-07T00:00:00.000Z', id: 'abc' };
      expect(decodeCursor(encodeCursor(p))).toEqual(p);
    });
    it('returns null on invalid input', () => {
      expect(decodeCursor('garbage')).toBeNull();
    });
  });
});
