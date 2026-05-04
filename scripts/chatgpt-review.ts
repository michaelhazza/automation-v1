#!/usr/bin/env tsx
/**
 * chatgpt-review.ts
 *
 * Dev-tool CLI that calls the OpenAI Chat Completions API to produce a
 * ChatGPT-style code or spec review. Replaces the manual copy/paste loop
 * in the chatgpt-pr-review and chatgpt-spec-review agents.
 *
 * The CLI is stateless: input → JSON findings on stdout. The agent owns
 * the per-round session log, the user-approval flow, and the KNOWLEDGE.md
 * finalisation step.
 *
 * Architecture:
 * - Bypasses server/services/providers/llmRouter on purpose. This is a
 *   developer-machine tool with its own OPENAI_API_KEY, not application
 *   code — see the spec at docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md
 *   § A1 for rationale.
 *
 * Usage:
 *   echo "<diff>" | tsx scripts/chatgpt-review.ts --mode pr
 *   tsx scripts/chatgpt-review.ts --mode spec --file docs/my-spec.md
 *
 * Env:
 *   OPENAI_API_KEY (required)
 *   CHATGPT_REVIEW_MODEL (optional, default: gpt-4o)
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  buildInputSummary,
  getSystemPrompt,
  parseModelOutput,
  stripJsonFence,
  type ChatGPTReviewResult,
  type ReviewMode,
} from './chatgpt-reviewPure.js';

const DEFAULT_MODEL = 'gpt-4.1';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

interface CliArgs {
  kind: 'ok';
  mode: ReviewMode;
  inputFile: string | null;
  model: string;
  help: boolean;
}

interface CliArgsError {
  kind: 'error';
  error: string;
}

function parseArgs(argv: string[]): CliArgs | CliArgsError {
  const args: CliArgs = {
    kind: 'ok',
    mode: 'pr',
    inputFile: null,
    model: process.env.CHATGPT_REVIEW_MODEL || DEFAULT_MODEL,
    help: false,
  };
  let modeSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') {
      const v = argv[++i];
      if (v !== 'pr' && v !== 'spec') return { kind: 'error', error: `--mode must be "pr" or "spec" (got: ${v})` };
      args.mode = v;
      modeSet = true;
    } else if (a === '--file') {
      args.inputFile = argv[++i] ?? null;
    } else if (a === '--model') {
      args.model = argv[++i] ?? args.model;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      return { kind: 'error', error: `unknown argument: ${a}` };
    }
  }
  if (args.help) return args;
  if (!modeSet) return { kind: 'error', error: '--mode pr|spec is required' };
  return args;
}

function printHelp(): void {
  process.stderr.write(
    `chatgpt-review — call OpenAI for a code or spec review\n` +
      `\n` +
      `usage:\n` +
      `  echo "<diff>" | tsx scripts/chatgpt-review.ts --mode pr\n` +
      `  tsx scripts/chatgpt-review.ts --mode spec --file docs/my-spec.md\n` +
      `\n` +
      `options:\n` +
      `  --mode pr|spec     review mode (required)\n` +
      `  --file <path>      read input from file instead of stdin\n` +
      `  --model <id>       OpenAI model (default: $CHATGPT_REVIEW_MODEL or ${DEFAULT_MODEL})\n` +
      `  -h, --help         show this help\n` +
      `\n` +
      `env:\n` +
      `  OPENAI_API_KEY            required\n` +
      `  CHATGPT_REVIEW_MODEL      optional model override\n`,
  );
}

async function readStdin(): Promise<string> {
  // S1: when invoked from a TTY with no piped input, 'end' never fires until
  // Ctrl-D, which silently hangs the CLI. Detect and return empty so the
  // caller's "no input received" branch surfaces a clean error.
  if (process.stdin.isTTY) return '';
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function safeGitBranch(): string | null {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userInput: string,
): Promise<string> {
  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as OpenAIChatResponse;
  if (json.error) {
    throw new Error(`OpenAI API error: ${json.error.message ?? 'unknown'}`);
  }
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI returned empty content');
  }
  return content;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === 'error') {
    process.stderr.write(`error: ${parsed.error}\n\n`);
    printHelp();
    process.exit(2);
  }
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write('error: OPENAI_API_KEY is not set\n');
    process.exit(2);
  }

  const input = parsed.inputFile
    ? readFileSync(parsed.inputFile, 'utf-8')
    : await readStdin();
  if (!input.trim()) {
    process.stderr.write('error: no input received (pass --file <path> or pipe to stdin)\n');
    process.exit(2);
  }

  const branch = safeGitBranch();
  const summary = buildInputSummary(parsed.mode, input, {
    branch,
    specPath: parsed.mode === 'spec' ? parsed.inputFile : null,
  });

  const systemPrompt = getSystemPrompt(parsed.mode);
  const rawContent = await callOpenAI(apiKey, parsed.model, systemPrompt, input);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFence(rawContent));
  } catch (err) {
    // Round-2 review: dump the FULL raw_response to stderr (no truncation) so
    // a malformed model reply is debuggable. The thrown error stays short for
    // the agent's per-round log; the full payload goes to stderr where the
    // operator can capture it (`2> debug.log` if needed).
    process.stderr.write(`--- raw response (full) ---\n${rawContent}\n--- end raw response ---\n`);
    throw new Error(
      `failed to parse model output as JSON: ${err instanceof Error ? err.message : String(err)} (full response written to stderr)`,
      { cause: err },
    );
  }

  const { findings, verdict } = parseModelOutput(parsedJson);

  const result: ChatGPTReviewResult = {
    mode: parsed.mode,
    model: parsed.model,
    input_summary: summary,
    findings,
    verdict,
    raw_response: rawContent,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
