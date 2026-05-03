/**
 * taskEventStreamLoad.integration.test.ts — latency budget scaffold.
 *
 * DO NOT RUN LOCALLY — requires a provisioned dev DB with sustained load capacity.
 * Run in CI-only env with:
 *   npx vitest run --no-isolate server/services/__tests__/taskEventStreamLoad.integration.test.ts
 *
 * Acceptance criteria (Workflows V1 spec §8 latency budget):
 *   - 1000 events/second sustained for 60s, single-node dev DB.
 *   - p95 < 200ms end-to-end (server emit → client receive).
 *   - p99 < 500ms.
 *
 * Method:
 *   - Generate events from a fake engine (direct TaskEventService calls).
 *   - Capture emit timestamp at server.
 *   - Capture receive timestamp at a single in-process test client (Socket.IO client).
 *   - Compute latency percentiles from (receive - emit) pairs.
 */

import { describe, it } from 'vitest';

// Scaffold only — all test logic is commented out pending CI provisioning.

describe.skip('taskEventStream load (CI-only, latency budget)', () => {
  it.skip('p95 < 200ms and p99 < 500ms under 1000 events/s for 60s', async () => {
    // const DURATION_MS = 60_000;
    // const TARGET_EPS = 1000;
    // const latencies: number[] = [];

    // Setup:
    //   const org = await setupTestOrg();
    //   const task = await setupTestTask(org.id);
    //   const run = await setupTestAgentRun(org.id);
    //
    //   const client = io('http://localhost:3000', { auth: { token: testToken } });
    //   client.emit('join:task', task.id);
    //
    //   client.on('task:execution-event', (envelope) => {
    //     const receiveMs = Date.now();
    //     const emitMs = Number(envelope.payload.payload._emitTimestamp);
    //     latencies.push(receiveMs - emitMs);
    //   });

    // Emit loop:
    //   const start = Date.now();
    //   let seq = 0;
    //   while (Date.now() - start < DURATION_MS) {
    //     const batchStart = Date.now();
    //     const batchSize = TARGET_EPS;
    //     await Promise.all(
    //       Array.from({ length: batchSize }, (_, i) =>
    //         TaskEventService.appendAndEmit({
    //           taskId: task.id,
    //           runId: run.id,
    //           organisationId: org.id,
    //           eventOrigin: 'engine',
    //           event: {
    //             kind: 'step.started',
    //             payload: { stepId: `step-${seq++}`, _emitTimestamp: Date.now() },
    //           },
    //         }),
    //       ),
    //     );
    //     const batchMs = Date.now() - batchStart;
    //     if (batchMs < 1000) await sleep(1000 - batchMs);
    //   }

    // Assert percentiles:
    //   latencies.sort((a, b) => a - b);
    //   const p95 = latencies[Math.floor(latencies.length * 0.95)];
    //   const p99 = latencies[Math.floor(latencies.length * 0.99)];
    //   expect(p95).toBeLessThan(200);
    //   expect(p99).toBeLessThan(500);
  });
});
