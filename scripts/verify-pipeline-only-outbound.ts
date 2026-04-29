import { execSync } from 'node:child_process';

const allowed = [
  'server/services/workspace/workspaceEmailPipeline.ts',
  'server/adapters/workspace/__tests__/',
];

let rawOutput = '';
try {
  rawOutput = execSync(
    `git grep -n "\\.sendEmail(" -- "server/**/*.ts" "client/**/*.ts"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
  );
} catch (err: unknown) {
  // git grep exits with code 1 when no matches found — that is not a failure here.
  const execErr = err as { status?: number; stdout?: string };
  if (execErr.status === 1 && !execErr.stdout) {
    rawOutput = '';
  } else if (execErr.stdout) {
    rawOutput = execErr.stdout;
  } else {
    throw err;
  }
}

const out = rawOutput.split('\n').filter(Boolean);
const violations = out.filter((line) => !allowed.some((f) => line.startsWith(f)));

if (violations.length > 0) {
  console.error('verify-pipeline-only-outbound: FAIL');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('verify-pipeline-only-outbound: OK');
