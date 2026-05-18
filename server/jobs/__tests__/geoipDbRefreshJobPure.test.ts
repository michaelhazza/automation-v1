import { describe, it, expect } from 'vitest';
import { QUEUE, SINGLETON_KEY, SINGLETON_MINUTES, CRON } from '../geoipDbRefreshJob.js';

describe('geoipDbRefreshJob registration contract', () => {
  it('uses the correct queue name', () => {
    expect(QUEUE).toBe('geoip-db-refresh');
  });

  it('uses the correct singleton key', () => {
    expect(SINGLETON_KEY).toBe('geoip-db-refresh-active');
  });

  it('uses singleton minutes = 60', () => {
    expect(SINGLETON_MINUTES).toBe(60);
  });

  it('uses Sunday 4am UTC cron', () => {
    expect(CRON).toBe('0 4 * * 0');
  });
});
