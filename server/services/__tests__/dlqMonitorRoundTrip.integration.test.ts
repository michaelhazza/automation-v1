import { test } from 'vitest';

const SKIP = process.env.NODE_ENV !== 'integration';

// The DLQ round-trip is a stub: the body never enqueues a poison job
// (the pg-boss enqueue line is commented out as "implementer-supplied"),
// so under integration env it polled for 30 s and timed out as
// "test failure". Mark as todo until the enqueue side is filled in
// — the round-trip cannot be exercised without it.
test.todo.skipIf(SKIP)('DLQ round-trip: poison job → __dlq → system_incidents row');
