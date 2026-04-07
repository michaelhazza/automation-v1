// ---------------------------------------------------------------------------
// Dev command denylist. Spec §7.4 (literal denylist) + §13.5 (substitution
// pattern rejection).
//
// Defence-in-depth — NOT a sandbox. The primary safety net remains workspace
// path validation + sanitised env + workspace cwd. Sandboxing is in v2.
// ---------------------------------------------------------------------------

import { SafetyError } from '../../../shared/iee/failureReason.js';

const REJECT_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  // §13.5 — command substitution and process substitution
  { re: /\$\(/,            reason: 'command substitution $(...)' },
  { re: /`/,               reason: 'backtick command substitution' },
  { re: /<\(/,             reason: 'process substitution <(...)' },
  { re: /\beval\b/,        reason: 'eval' },
  { re: /\bexec\s+/,       reason: 'exec replacement' },

  // §7.4 — literal denylist
  { re: /^\s*sudo\b/,      reason: 'sudo' },
  { re: /^\s*su\s+/,       reason: 'su' },
  { re: /\brm\s+-rf\s+\//, reason: 'rm -rf /' },
  { re: /\brm\s+-rf\s+\*/, reason: 'rm -rf *' },
  { re: /\bmkfs\b/,        reason: 'mkfs' },
  { re: /\bdd\s+if=/,      reason: 'dd if=' },
  { re: /:\(\)\s*\{/,      reason: 'fork bomb' },
  { re: /\bchown\s+-R\s+\//, reason: 'chown -R /' },
  { re: /\bchmod\s+-R\s+\//, reason: 'chmod -R /' },
  { re: /\s\/etc(\/|\s|$)/, reason: 'touches /etc' },
  { re: /\s\/var(\/|\s|$)/, reason: 'touches /var' },
  { re: /\s\/root(\/|\s|$)/, reason: 'touches /root' },

  // No backgrounding (§7.4 — all commands must be foreground)
  { re: /[^&]&\s*$/,       reason: 'background &' },
  { re: /\bnohup\b/,       reason: 'nohup' },
  { re: /\bdisown\b/,      reason: 'disown' },
  { re: /\bsetsid\b/,      reason: 'setsid' },
];

export function assertCommandAllowed(command: string): void {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new SafetyError('empty command', 'denylisted_command');
  }
  for (const { re, reason } of REJECT_PATTERNS) {
    if (re.test(command)) {
      throw new SafetyError(`denylisted command: ${reason}`, 'denylisted_command');
    }
  }
}
