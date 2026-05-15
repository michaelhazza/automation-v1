import { MAX_LOG_BYTES_PER_ORG_PER_DAY } from '../../lib/sandboxRetentionConstants.js';

export { MAX_LOG_BYTES_PER_ORG_PER_DAY } from '../../lib/sandboxRetentionConstants.js';

export interface LogQuotaCheckInput {
  organisationId: string;
  todayBytesAlreadyPersisted: number;
  thisBatchBytes: number;
}

export interface LogQuotaCheckResult {
  allowed: boolean;
  capBytes: number;
  exceededBy?: number;
}

export function checkLogStorageQuota(input: LogQuotaCheckInput): LogQuotaCheckResult {
  const cap = MAX_LOG_BYTES_PER_ORG_PER_DAY;
  const total = input.todayBytesAlreadyPersisted + input.thisBatchBytes;
  if (total <= cap) {
    return { allowed: true, capBytes: cap };
  }
  return {
    allowed: false,
    capBytes: cap,
    exceededBy: total - cap,
  };
}
