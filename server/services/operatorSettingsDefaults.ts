/**
 * operatorSettingsDefaults.ts — hardcoded operator session settings defaults.
 *
 * These values are used in operatorManagedBackend.ts to snapshot settings
 * at dispatch time. They replace dynamic reading from effectiveSettings
 * for three critical fields to ensure consistency across chain links.
 *
 * See spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md
 */

/**
 * Grace period (minutes) for auto-extending a chain link's wall clock.
 * Prevents thrashing when a link is near timeout but still making progress.
 */
export const AUTO_EXTEND_GRACE_MINUTES = 30;

/**
 * Maximum number of chain links per operator session (bootstrap + continuations).
 * Acts as a safety fence to prevent infinite loops in session orchestration.
 */
export const MAX_CHAIN_LENGTH = 100;

/**
 * Maximum wall-clock time (days) allowed per task across all operator sessions.
 * Hard ceiling on task lifetime in the operator backend.
 */
export const MAX_WALL_CLOCK_PER_TASK_DAYS = 30;
