import { JOB_CONFIG } from '../config/jobConfig.js';

/**
 * Derive the deduplicated list of DLQ queue names from JOB_CONFIG.
 *
 * Pure — no DB, no async, no logger. Throws at boot if any entry's
 * deadLetter value doesn't match the `<queue>__dlq` convention so a
 * misconfiguration fails fast instead of silently subscribing to the
 * wrong DLQ.
 */
export function deriveDlqQueueNames(config: typeof JOB_CONFIG): string[] {
  const dlqs = new Set<string>();
  for (const [queueName, entry] of Object.entries(config)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string' || dlq.length === 0) continue;

    const expected = `${queueName}__dlq`;
    if (dlq !== expected) {
      throw new Error(
        `[deriveDlqQueueNames] JOB_CONFIG['${queueName}'].deadLetter must equal '${expected}', got '${dlq}'`,
      );
    }

    dlqs.add(dlq);
  }
  return Array.from(dlqs).sort();
}
