import { Router } from 'express';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

const RUNS_DIR = resolve(process.cwd(), '.test-runs');

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

interface TestFile {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  tests: TestResult[];
}

interface TestRunResult {
  id: string;
  suite: 'server' | 'client';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  testFiles: TestFile[];
}

// ── Run tests with SSE streaming ───────────────────────────────────────────

router.get(
  '/api/system/tests/run-stream',
  // SSE cannot send Authorization header — accept token as query param
  (req, res, next) => {
    const token = req.query.token as string | undefined;
    if (token) req.headers.authorization = `Bearer ${token}`;
    next();
  },
  authenticate,
  requireSystemAdmin,
  (req, res) => {
    const suite = (req.query.suite as string) ?? 'all';
    const configMap: Record<string, string> = {
      server: 'vitest.config.ts',
      client: 'vitest.config.client.ts',
      all: 'vitest.config.all.ts',
    };
    const configFile = configMap[suite] ?? 'vitest.config.all.ts';
    const startedAt = new Date();
    const id = `run-${Date.now()}`;

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('status', { phase: 'starting', suite, id });

    // Use vitest binary directly (not npx — npx breaks vitest worker init)
    const vitestBin = resolve(process.cwd(), 'node_modules/.bin/vitest');
    const child = spawn(vitestBin, ['run', '--config', configFile, '--reporter=verbose'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL!.replace(/\/[^/]+$/, '/automation_os_test'),
        JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
        EMAIL_FROM: 'test@test.com',
        NODE_ENV: 'test',
        NO_COLOR: '1',
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let fullOutput = '';

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      fullOutput += text;

      // Parse each line for test results and stream them
      const cleanText = stripAnsi(text);
      for (const line of cleanText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Individual test result: " ✓ |server| path > Describe > test name 3ms"
        const testMatch = line.match(/\|\w+\|\s+(.+?\.test\.tsx?)\s+>\s+(.+?)(?:\s+(\d+)ms)?\s*$/);
        if (testMatch) {
          const filePath = testMatch[1].replace(/\\/g, '/').trim();
          const testName = testMatch[2].trim();
          const duration = testMatch[3] ? parseInt(testMatch[3]) : 0;
          const prefix = line.slice(0, line.indexOf('|')).trim();
          let status: 'passed' | 'failed' | 'skipped' = 'passed';
          if (prefix.includes('\u00d7') || prefix.includes('\u2717') || prefix.includes('×')) status = 'failed';
          else if (prefix.includes('↓') || prefix.includes('\u2193')) status = 'skipped';
          send('test', { file: filePath, name: testName, status, duration });
          continue;
        }

        // Summary line: "Test Files  11 passed (11)"
        if (trimmed.includes('Test Files')) {
          send('summary', { line: trimmed });
        }
        // Tests summary: "Tests  57 passed (57)"
        if (trimmed.startsWith('Tests') && trimmed.includes('passed')) {
          send('summary', { line: trimmed });
        }
        // Duration line
        if (trimmed.startsWith('Duration')) {
          send('summary', { line: trimmed });
        }
      }
    };

    child.stdout.on('data', handleChunk);
    // Vitest writes test results to stderr on some platforms
    child.stderr.on('data', handleChunk);

    child.on('close', async () => {
      const result = parseVitestOutput(id, suite as 'server' | 'client', startedAt, fullOutput);
      await saveRun(result);
      send('complete', result);
      res.end();
    });

    child.on('error', (err) => {
      send('error', { message: err.message });
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      child.kill();
    });
  }
);

// ── Run tests (non-streaming, fallback) ────────────────────────────────────

router.post(
  '/api/system/tests/run',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const suite = (req.body.suite as string) ?? 'all';
    const configMap: Record<string, string> = {
      server: 'vitest.config.ts',
      client: 'vitest.config.client.ts',
      all: 'vitest.config.all.ts',
    };
    const configFile = configMap[suite] ?? 'vitest.config.all.ts';
    const startedAt = new Date();
    const id = `run-${Date.now()}`;

    const result = await new Promise<TestRunResult>((resolve, reject) => {
      const vitestBin = resolve(process.cwd(), 'node_modules/.bin/vitest');
      const child = spawn(vitestBin, ['run', '--config', configFile, '--reporter=verbose'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL!.replace(/\/[^/]+$/, '/automation_os_test'),
          JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
          EMAIL_FROM: 'test@test.com',
          NODE_ENV: 'test',
          NO_COLOR: '1',
        },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      child.stdout.on('data', (c: Buffer) => { output += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { output += c.toString(); });
      child.on('close', () => resolve(parseVitestOutput(id, suite as 'server' | 'client', startedAt, output)));
      child.on('error', reject);
    });

    await saveRun(result);
    res.json(result);
  })
);

// ── List past runs ─────────────────────────────────────────────────────────

router.get(
  '/api/system/tests/runs',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    try {
      await mkdir(RUNS_DIR, { recursive: true });
      const files = await readdir(RUNS_DIR);
      const runs: TestRunResult[] = [];

      for (const file of files.sort().reverse().slice(0, 50)) {
        if (!file.endsWith('.json')) continue;
        const content = await readFile(resolve(RUNS_DIR, file), 'utf-8');
        runs.push(JSON.parse(content));
      }

      res.json(runs);
    } catch {
      res.json([]);
    }
  })
);

// ── Get single run detail ──────────────────────────────────────────────────

router.get(
  '/api/system/tests/runs/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    try {
      const content = await readFile(resolve(RUNS_DIR, `${req.params.id}.json`), 'utf-8');
      res.json(JSON.parse(content));
    } catch {
      throw { statusCode: 404, message: 'Test run not found' };
    }
  })
);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function parseVitestOutput(
  id: string,
  suite: 'server' | 'client',
  startedAt: Date,
  stdout: string
): TestRunResult {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  // Collect tests grouped by file
  const fileMap = new Map<string, TestFile>();

  const cleanStdout = stripAnsi(stdout);
  for (const line of cleanStdout.split('\n')) {
    // Match lines containing "|server|" or "|client|" with ">" separator — the vitest verbose format
    // Example: " ✓ |server| tests/server/unit/lib/rateLimiter.test.ts > RateLimiter > allows acquisition 1ms"
    // The leading character varies by encoding (✓, ×, ↓) so we match on the structure instead
    const testMatch = line.match(/\|\w+\|\s+(.+?\.test\.tsx?)\s+>\s+(.+?)(?:\s+(\d+)ms)?\s*$/);
    if (testMatch) {
      const filePath = testMatch[1].replace(/\\/g, '/').trim();
      const testName = testMatch[2].trim();
      const duration = testMatch[3] ? parseInt(testMatch[3]) : 0;

      // Determine status from the character before |server|/|client|
      const prefix = line.slice(0, line.indexOf('|')).trim();
      let status: 'passed' | 'failed' | 'skipped' = 'passed';
      // × (U+00D7) or ✗ or failed indicators
      if (prefix.includes('\u00d7') || prefix.includes('\u2717') || prefix.includes('\u2718') || prefix.includes('×')) {
        status = 'failed';
      } else if (prefix.includes('\u2193') || prefix.includes('\u2191') || prefix.includes('↓')) {
        status = 'skipped';
      }
      // ✓ (U+2713) or anything else = passed

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, { name: filePath, status: 'passed', duration: 0, tests: [] });
      }
      const file = fileMap.get(filePath)!;
      file.tests.push({ name: testName, status, duration });
      file.duration += duration;
      if (status === 'failed') file.status = 'failed';
    }
  }

  const testFiles = Array.from(fileMap.values());
  const passedTests = testFiles.reduce((s, f) => s + f.tests.filter(t => t.status === 'passed').length, 0);
  const failedTests = testFiles.reduce((s, f) => s + f.tests.filter(t => t.status === 'failed').length, 0);
  const skippedTests = testFiles.reduce((s, f) => s + f.tests.filter(t => t.status === 'skipped').length, 0);
  const totalTests = passedTests + failedTests + skippedTests;

  return {
    id,
    suite,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    status: failedTests > 0 ? 'failed' : 'passed',
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    testFiles,
  };
}

async function saveRun(result: TestRunResult) {
  await mkdir(RUNS_DIR, { recursive: true });
  await writeFile(resolve(RUNS_DIR, `${result.id}.json`), JSON.stringify(result, null, 2));
}

export default router;
