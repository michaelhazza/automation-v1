/**
 * configAssistantModeService — Configuration Assistant mode resolver
 *
 * Resolves the correct system-prompt template and scoped toolset for each
 * mode the Configuration Assistant can run in.
 *
 * Modes:
 *   - org-admin                — existing, baseline behaviour
 *   - subaccount-onboarding    — new, 9-step onboarding arc (§8)
 *   - task-creation            — new, natural-language → task config (§5.6)
 *
 * **Invariant:** Every mode inherits the shipped `config-agent-guidelines`
 * memory block. The per-mode prompt builds on top — it never replaces the
 * guidelines.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.1, §5.6, §8 (S5 + S10)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

export type ConfigAssistantMode = 'org-admin' | 'subaccount-onboarding' | 'task-creation';

export interface ConfigAssistantModeResolution {
  mode: ConfigAssistantMode;
  /** Absolute path to the mode's prompt template (markdown). */
  promptPath: string;
  /** Prompt template contents. */
  promptContents: string;
  /** Allowed action types (subset of the full registry). */
  allowedActions: ReadonlyArray<string>;
}

const PROMPT_DIR = resolve(
  new URL(import.meta.url).pathname,
  '../../config/configAssistantPrompts',
);

const MODE_PROMPT_FILES: Readonly<Record<ConfigAssistantMode, string>> = Object.freeze({
  'org-admin': 'orgAdminPrompt.md', // legacy; optional
  'subaccount-onboarding': 'subaccountOnboardingPrompt.md',
  'task-creation': 'taskCreationPrompt.md',
});

/**
 * Toolsets per mode. Each mode has a focused subset of the skill registry.
 * org-admin is the open set (not constrained here — downstream topic filter
 * handles allowlist). Onboarding + task-creation are narrow by design.
 */
const MODE_ALLOWED_ACTIONS: Readonly<Record<ConfigAssistantMode, ReadonlyArray<string>>> = Object.freeze({
  'org-admin': [],
  'subaccount-onboarding': [
    'ask_clarifying_question',
    'request_clarification',
    'read_workspace',
    'web_search',
    'config_attach_data_source',
    'config_create_scheduled_task',
    'update_memory_block',
    'config_deliver_playbook_output',
  ],
  'task-creation': [
    'ask_clarifying_question',
    'read_workspace',
    'web_search',
    'config_create_scheduled_task',
  ],
});

export function resolveMode(mode: ConfigAssistantMode): ConfigAssistantModeResolution {
  const filename = MODE_PROMPT_FILES[mode];
  const promptPath = resolve(PROMPT_DIR, filename);

  let promptContents = '';
  try {
    promptContents = readFileSync(promptPath, 'utf-8');
  } catch {
    promptContents = `# ${mode} mode\n\n(Prompt template not yet populated.)`;
  }

  return {
    mode,
    promptPath,
    promptContents,
    allowedActions: MODE_ALLOWED_ACTIONS[mode],
  };
}

/**
 * Helper: return the universal + mode-specific action set.
 * Universal skills (ask_clarifying_question etc.) are always in play.
 */
export function getEffectiveActionSet(mode: ConfigAssistantMode): ReadonlyArray<string> {
  return MODE_ALLOWED_ACTIONS[mode];
}
