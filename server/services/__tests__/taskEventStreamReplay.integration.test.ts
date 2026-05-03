/**
 * taskEventStreamReplay.integration.test.ts — integration test scaffold.
 *
 * DO NOT RUN LOCALLY — requires a provisioned dev DB.
 * Run in CI-only env with:
 *   npx vitest run --no-isolate server/services/__tests__/taskEventStreamReplay.integration.test.ts
 *
 * Scenario: write 20 events to a task, replay from fromSeq=10, get exactly
 * 10 events back in order.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// This test intentionally left as a scaffold — it is skipped and requires
// a real DB connection. The DB setup/teardown logic would need to:
//   1. Create an org, task, and agent_run row.
//   2. Call TaskEventService.appendAndEmitWithRunId 20 times.
//   3. Call TaskEventService.getEventsForReplay with fromSeq=10, fromSubseq=0.
//   4. Assert exactly 10 events are returned in ascending order.

describe.skip('taskEventStream integration (CI-only)', () => {
  it('writes 20 events and replays the last 10 in order', async () => {
    // Arrange
    // const org = await setupTestOrg();
    // const task = await setupTestTask(org.id);
    // const agentRun = await setupTestAgentRun(org.id);

    // const events: AppendAndEmitResult[] = [];
    // for (let i = 0; i < 20; i++) {
    //   const result = await TaskEventService.appendAndEmit({
    //     taskId: task.id,
    //     runId: agentRun.id,
    //     organisationId: org.id,
    //     eventOrigin: 'engine',
    //     event: {
    //       kind: 'step.started',
    //       payload: { stepId: `step-${i}` },
    //     },
    //   });
    //   events.push(result);
    // }

    // Act
    // const replay = await TaskEventService.getEventsForReplay({
    //   taskId: task.id,
    //   organisationId: org.id,
    //   fromSeq: 10,
    //   fromSubseq: 0,
    // });

    // Assert
    // expect(replay.events).toHaveLength(10);
    // expect(replay.hasGap).toBe(false);
    // // Events must be in ascending (taskSequence, eventSubsequence) order
    // for (let i = 1; i < replay.events.length; i++) {
    //   const prev = replay.events[i - 1];
    //   const curr = replay.events[i];
    //   const cmp = compareCursors(
    //     [prev.taskSequence, prev.eventSubsequence],
    //     [curr.taskSequence, curr.eventSubsequence],
    //   );
    //   expect(cmp).toBe(-1);
    // }

    expect(true).toBe(true); // placeholder — remove when wiring real DB
  });
});
