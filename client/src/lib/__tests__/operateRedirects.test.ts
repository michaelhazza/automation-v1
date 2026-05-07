import { describe, it, expect } from 'vitest';
import { buildOperateRedirectUrl } from '../operateRedirects';

describe('buildOperateRedirectUrl', () => {
  describe('no promotion (simple passthrough)', () => {
    it('returns base path when no search and no hash', () => {
      expect(buildOperateRedirectUrl('/run-trace/abc', '', undefined, '')).toBe('/run-trace/abc');
    });

    it('passes query string through verbatim', () => {
      expect(buildOperateRedirectUrl('/run-trace/abc', '?step=3', undefined, '')).toBe('/run-trace/abc?step=3');
    });

    it('passes hash through unchanged', () => {
      expect(buildOperateRedirectUrl('/run-trace/abc', '', undefined, '#section')).toBe('/run-trace/abc#section');
    });

    it('passes both query and hash', () => {
      expect(buildOperateRedirectUrl('/run-trace/abc', '?step=3', undefined, '#section')).toBe('/run-trace/abc?step=3#section');
    });

    it('treats bare ? as empty search', () => {
      expect(buildOperateRedirectUrl('/inbox', '?', undefined, '')).toBe('/inbox');
    });

    it('treats bare # as empty hash', () => {
      expect(buildOperateRedirectUrl('/inbox', '', undefined, '#')).toBe('/inbox');
    });
  });

  describe('with promoted param', () => {
    it('emits promoted param first, then inbound keys in original order', () => {
      const result = buildOperateRedirectUrl('/inbox', '?tab=open', { key: 'subaccountId', value: 'x1' });
      expect(result).toBe('/inbox?subaccountId=x1&tab=open');
    });

    it('promoted key wins over inbound duplicate; inbound duplicate is skipped', () => {
      const result = buildOperateRedirectUrl('/inbox', '?subaccountId=old&tab=open', { key: 'subaccountId', value: 'x1' });
      expect(result).toBe('/inbox?subaccountId=x1&tab=open');
    });

    it('preserves non-conflicting inbound key order', () => {
      const result = buildOperateRedirectUrl('/run-trace/abc', '?b=2&a=1', { key: 'subaccountId', value: 'x1' });
      // promoted first, then b, then a — no sorting
      expect(result).toBe('/run-trace/abc?subaccountId=x1&b=2&a=1');
    });

    it('emits only promoted param when inbound search is empty', () => {
      const result = buildOperateRedirectUrl('/inbox', '', { key: 'subaccountId', value: 'x1' });
      expect(result).toBe('/inbox?subaccountId=x1');
    });

    it('passes hash through with promoted param', () => {
      const result = buildOperateRedirectUrl('/inbox', '?tab=open', { key: 'subaccountId', value: 'x1' }, '#top');
      expect(result).toBe('/inbox?subaccountId=x1&tab=open#top');
    });
  });
});
