// iee-browser harness entrypoint — runs inside the e2b sandbox
// Spec: tasks/builds/iee-browser-on-e2b/spec.md §7.3, §11

import { promises as fs } from 'fs';

/**
 * Input shape written to /workspace/input.json by the harness caller
 * (ieeBrowserProfileManager + IEE dispatch layer).
 */
interface HarnessInput {
  /**
   * IEE browser task envelope (actions, contract, etc.). Null when no envelope
   * was threaded through (e.g. unit-test fixtures without a task payload).
   * When null, the executor should fail with a clear "missing payload" reason.
   */
  taskPayload: unknown | null;
  /** Browser profile volume mount descriptor */
  profileMount: {
    userDataDirInSandbox: string;  // '/workspace/profile'
  };
  /** Artefacts output directory */
  artefactsDir: string;  // '/workspace/artefacts'
}

interface HarnessOutput {
  status: 'completed' | 'failed';
  reason?: string;
}

const INPUT_PATH = '/workspace/input.json';
const OUTPUT_PATH = '/workspace/output.json';

async function main(): Promise<void> {
  let input: HarnessInput;

  try {
    const raw = await fs.readFile(INPUT_PATH, 'utf8');
    input = JSON.parse(raw) as HarnessInput;
  } catch (err) {
    const output: HarnessOutput = {
      status: 'failed',
      reason: `harness: failed to read input: ${err instanceof Error ? err.message : String(err)}`,
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(output));
    process.exit(1);
  }

  const userDataDir = input.profileMount.userDataDirInSandbox ?? '/workspace/profile';
  const artefactsDir = input.artefactsDir ?? '/workspace/artefacts';

  // Ensure directories exist (verifies write access and shape).
  await fs.mkdir(userDataDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(artefactsDir, { recursive: true });

  // V1 stub: the real Playwright executor is wired by the CI template pipeline
  // once the e2b SDK is installed and the template image is built. Until then
  // this stub fails LOUDLY — never writes status:'completed' — so any
  // accidentally-deployed-without-real-executor sandbox surfaces as an obvious
  // failure rather than masking as silent success.
  // The interface contract (HarnessInput shape, exit codes) is stable; wiring
  // the executor swaps the failure below for the real execution loop.
  const output: HarnessOutput = {
    status: 'failed',
    reason:
      'harness: executor not yet wired. This is the V1 stub harness; the real ' +
      'Playwright executor is integrated by the CI template build pipeline when ' +
      'the e2b SDK is installed. See server/services/sandbox/e2bSandbox.ts for ' +
      'the SANDBOX-DEF-EGRESS-MECH decision context.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output));
  process.exit(1);
}

main().catch((err) => {
  console.error('harness: unhandled error', err);
  process.exit(1);
});
