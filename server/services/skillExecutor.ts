import './skillExecutor/adapter-registration.js'; // side-effect: registerAdapter('worker', ...) at module load
export { skillExecutor, SKILL_HANDLERS } from './skillExecutor/registry.js';
export type { SkillExecutionContext, SkillHandler } from './skillExecutor/context.js';
export { registerProcessor, setHandoffJobSender } from './skillExecutor/pipeline.js';
