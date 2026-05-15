import { describe, it, expect } from 'vitest';
import { checkLogStorageQuota, MAX_LOG_BYTES_PER_ORG_PER_DAY } from '../logStorageQuotaPure.js';

const MB = 1024 * 1024;

describe('checkLogStorageQuota', () => {
  it('allows when today bytes is 0 and batch is 1 MB', () => {
    const result = checkLogStorageQuota({
      organisationId: 'org-1',
      todayBytesAlreadyPersisted: 0,
      thisBatchBytes: MB,
    });
    expect(result.allowed).toBe(true);
    expect(result.capBytes).toBe(MAX_LOG_BYTES_PER_ORG_PER_DAY);
    expect(result.exceededBy).toBeUndefined();
  });

  it('rejects when today bytes is 99 MB and batch is 2 MB', () => {
    const result = checkLogStorageQuota({
      organisationId: 'org-1',
      todayBytesAlreadyPersisted: 99 * MB,
      thisBatchBytes: 2 * MB,
    });
    expect(result.allowed).toBe(false);
    expect(result.capBytes).toBe(MAX_LOG_BYTES_PER_ORG_PER_DAY);
    expect(result.exceededBy).toBe(MB);
  });

  it('allows when today bytes equals cap and batch is 0 (boundary)', () => {
    const result = checkLogStorageQuota({
      organisationId: 'org-1',
      todayBytesAlreadyPersisted: MAX_LOG_BYTES_PER_ORG_PER_DAY,
      thisBatchBytes: 0,
    });
    expect(result.allowed).toBe(true);
    expect(result.capBytes).toBe(MAX_LOG_BYTES_PER_ORG_PER_DAY);
  });

  it('rejects when today bytes is 0 and batch exceeds cap by 1', () => {
    const result = checkLogStorageQuota({
      organisationId: 'org-1',
      todayBytesAlreadyPersisted: 0,
      thisBatchBytes: MAX_LOG_BYTES_PER_ORG_PER_DAY + 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.capBytes).toBe(MAX_LOG_BYTES_PER_ORG_PER_DAY);
    expect(result.exceededBy).toBe(1);
  });
});
