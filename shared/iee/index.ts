/**
 * IEE — shared types and zod schemas.
 *
 * Imported by `server/` (enqueue side, adapters, harness orchestration)
 * and by the e2b `iee-browser` sandbox harness (consume side). Only zod
 * schemas and type definitions live here so the contract stays in lockstep
 * across the two execution boundaries.
 *
 * The standalone IEE worker process that previously consumed this barrel
 * on the worker side was retired 2026-05-17 — see
 * `tasks/builds/iee-worker-retirement/spec.md`.
 *
 * Spec: docs/iee-development-spec.md §1.4 (`shared/iee/` folder rationale).
 */

export * from './failureReason.js';
export * from './failure.js';
export * from './observation.js';
export * from './actionSchema.js';
export * from './jobPayload.js';
export * from './trajectorySchema.js';
