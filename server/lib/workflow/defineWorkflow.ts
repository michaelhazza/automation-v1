/**
 * defineWorkflow — identity helper that powers TypeScript inference for
 * playbook definition files. The function does not transform the input;
 * it returns it unchanged so the type system can infer the literal shape
 * (`as const`-style narrowing).
 *
 * Spec: tasks/workflows-spec.md §3.2.
 *
 * Validation runs in:
 *   - The seeder (server/scripts/seedWorkflows.ts) when loading a system
 *     template file.
 *   - playbookTemplateService.publishOrgTemplate() when an org publishes
 *     a new version.
 *   - playbookRunService.startRun() as a defense-in-depth check (catches
 *     drift between publish and run start).
 *
 * Authoring example:
 *
 *   import { defineWorkflow } from '../lib/workflow/defineWorkflow.js';
 *   import { z } from 'zod';
 *
 *   export default defineWorkflow({
 *     slug: 'event-creation',
 *     name: 'Create a New Event',
 *     description: '...',
 *     version: 1,
 *     initialInputSchema: z.object({ eventName: z.string() }),
 *     steps: [
 *       {
 *         id: 'event_basics',
 *         name: 'Confirm event basics',
 *         type: 'user_input',
 *         dependsOn: [],
 *         sideEffectType: 'none',
 *         formSchema: z.object({ venue: z.string() }),
 *         outputSchema: z.object({ venue: z.string() }),
 *       },
 *     ],
 *   });
 */

import type { WorkflowDefinition } from './types.js';

export function defineWorkflow(def: WorkflowDefinition): WorkflowDefinition {
  return def;
}
