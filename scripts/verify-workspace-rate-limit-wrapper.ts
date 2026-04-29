import { execSync } from 'node:child_process';

const allowed = ['server/services/workspace/workspaceEmailRateLimit.ts'];
const output = (() => {
  try {
    return execSync(
      `git grep -n "rateLimitKeys\\.workspaceEmail" -- "server/**/*.ts"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
  } catch {
    return '';
  }
})();

const lines = output.split('\n').filter(Boolean);
const violations = lines.filter((line) => !allowed.some((f) => line.startsWith(f)));
if (violations.length > 0) {
  console.error('verify-workspace-rate-limit-wrapper: FAIL');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('verify-workspace-rate-limit-wrapper: OK');
