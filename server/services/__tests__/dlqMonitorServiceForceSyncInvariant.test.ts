// guard-ignore-file: pure-helper-convention reason="uses dynamic imports to set stub env vars before module load; no static sibling import is possible for this pattern"
import { expect, test } from 'vitest';
/**
 * dlqMonitorServiceForceSyncInvariant.test.ts
 *
 * Verifies that dlqMonitorService passes forceSync: true to recordIncident
 * for every DLQ job — ensuring DLQ handlers always write incidents inline
 * regardless of SYSTEM_INCIDENT_INGEST_MODE.
 *
 * Uses dependency injection (startDlqMonitor accepts an optional deps.recordIncident)
 * instead of mock.module, which is not available under tsx v4.x.
 *
 * Uses dynamic imports to set stub env vars before module load (env.ts validates
 * at parse time and requires DATABASE_URL / JWT_SECRET / EMAIL_FROM).
 */

// Set required env stubs BEFORE any module that imports env.ts is loaded.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://stub:stub@localhost/stub';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'stub-secret-at-least-32-chars-long!!';
process.env.EMAIL_FROM = process.env.EMAIL_FROM ?? 'stub@example.com';
process.env.NODE_ENV ??= 'test';
// Disable actual ingest so no DB writes occur if recordIncident leaks through.
process.env.SYSTEM_INCIDENT_INGEST_ENABLED ??= 'false';

test('dlqMonitorService passes forceSync: true to recordIncident', async () => {
  const { startDlqMonitor } = await import('../dlqMonitorService.js');
  type IncidentInput = Awaited<ReturnType<typeof import('../incidentIngestor.js')['recordIncident']>> extends void
    ? Parameters<typeof import('../incidentIngestor.js')['recordIncident']>[0]
    : never;

  const captured: Array<{ input: unknown; opts: unknown }> = [];

  const handlers = new Map<string, (job: unknown) => Promise<void>>();
  const fakeBoss = {
    work: async (name: string, _opts: unknown, handler: (job: unknown) => Promise<void>) => {
      handlers.set(name, handler);
      return name;
    },
  };

  await startDlqMonitor(
    fakeBoss as unknown as Parameters<typeof startDlqMonitor>[0],
    {
      recordIncident: async (input, opts) => {
        captured.push({ input, opts });
      },
    },
  );

  // Invoke one captured handler with a fake DLQ job.
  const [firstHandler] = handlers.values();
  expect(firstHandler).toBeTruthy();

  await firstHandler({
    id: 'job-1',
    data: { organisationId: 'org-1', subaccountId: 'sub-1' },
  });

  expect(captured.length, 'expected exactly one recordIncident call').toBe(1);
  expect(captured[0].opts).toEqual({ forceSync: true });
});
