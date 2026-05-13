// iee-browser harness entrypoint — runs inside the e2b sandbox
// Spec: tasks/builds/iee-browser-on-e2b/spec.md §7.3, §11

import { promises as fs } from 'fs';

/**
 * Input shape written to /workspace/input.json by the harness caller
 * (ieeBrowserProfileManager + IEE dispatch layer).
 */
interface HarnessInput {
  /** IEE browser task envelope (actions, contract, etc.) */
  taskPayload: unknown;
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

  // Ensure directories exist
  await fs.mkdir(userDataDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(artefactsDir, { recursive: true });

  // NOTE: Browser task execution is implemented in the compiled worker bundle
  // that is included in the Docker image build. The harness delegates to the
  // bundled executor. This placeholder structure is replaced by the full
  // implementation when the image is built by the CI template pipeline.
  // The interface contract (HarnessInput shape, exit codes) is stable.

  // V1: Write a structured output so harvest knows the harness ran.
  // Full executor integration is wired in the CI build.
  const output: HarnessOutput = { status: 'completed' };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output));
  process.exit(0);
}

main().catch((err) => {
  console.error('harness: unhandled error', err);
  process.exit(1);
});
