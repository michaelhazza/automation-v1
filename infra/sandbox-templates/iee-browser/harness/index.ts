// iee-browser harness entrypoint — runs inside the e2b sandbox
// Spec: tasks/builds/iee-browser-on-e2b/spec.md §7.3, §11

import { promises as fs } from 'fs';

interface ProxyAlignment {
  timezone: string;
  locale: string;
  language: string;
  webrtcPolicy: 'disable_non_proxied_udp';
}

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
  /**
   * Resolved proxy alignment (spec §6.1, BHP chunk 8).
   * When non-null, the executor applies locale/timezone/language and WebRTC policy.
   * Null when no proxy is configured or PROXY_ALIGNMENT flag is off.
   */
  proxyAlignment?: ProxyAlignment | null;
  /**
   * Name of the env var holding the credential-resolved proxy URL.
   * The executor reads process.env[proxyUrlEnvKey] for the --proxy-server Chromium flag.
   * Null when no proxy is configured or when proxyConfig has no credentialId.
   */
  proxyUrlEnvKey?: string | null;
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

  // Proxy alignment: when non-null, the real executor (once wired) applies these
  // Playwright context options and Chromium flags. No-op in V1: executor is stub.
  //
  // When e2b SDK is wired, apply:
  //   - newContext({ timezoneId: proxyAlignment.timezone })
  //   - newContext({ locale: proxyAlignment.locale })
  //   - newContext({ extraHTTPHeaders: { 'Accept-Language': proxyAlignment.language } })
  //   - Chromium flags: --lang=${proxyAlignment.locale}
  //   - Chromium flags: --force-webrtc-ip-handling-policy=disable_non_proxied_udp
  //   - Proxy: --proxy-server=<value from process.env[proxyUrlEnvKey]>
  //     (env var set by credentialBrokerService.injectIntoEnvironment at sandbox launch)
  const proxyAlignment = input.proxyAlignment ?? null;
  const proxyUrlEnvKey = input.proxyUrlEnvKey ?? null;
  if (proxyAlignment) {
    // When e2b SDK is wired: apply the context options and Chromium flags listed above.
    // (No-op in V1: executor is stub, real Playwright not wired yet.)
    void proxyUrlEnvKey; // will be used by the real executor to read the proxy URL env var
  }

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
