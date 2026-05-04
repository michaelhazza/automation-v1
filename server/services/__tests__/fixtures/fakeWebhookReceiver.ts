/**
 * Fake webhook receiver — shared test fixture.
 *
 * Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md §1.1.
 *
 * Boots a localhost HTTP server bound to `127.0.0.1` on an OS-assigned port,
 * records every request that arrives at it, and exposes the recorded calls
 * for direct assertion. Multiple integration tests can each spin one up,
 * exercise production code that fires webhooks at it, and assert on the
 * captured calls.
 *
 * Per-receiver invariants:
 *   - The request body is fully read BEFORE any record-or-drop decision.
 *     A self-test asserts the recorded body matches the bytes sent (no
 *     truncation). Recording happens after the body's `end` event fires.
 *   - Headers are normalised on the recorded call: keys are lowercased
 *     (Node's HTTP stack already does this; the harness re-asserts it),
 *     and any multi-value header (Node represents these as `string[]` on
 *     `req.headers`) is joined into a single string with `, ` as the
 *     separator. Tests assert against `headers['x-signature']` (lowercase),
 *     never against the original casing.
 *   - `setDropConnection(true)` destroys the underlying socket without
 *     writing a response — but ONLY after the body has been fully read
 *     and the call has been recorded. Dropping mid-body-stream is its own
 *     failure-injection class and is explicitly NOT supported.
 *
 * Production code MUST NOT import this module — it lives under `__tests__/`.
 */

import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeWebhookCall {
  receivedAt: Date;
  method: string;
  path: string;
  /**
   * Normalised: keys are lowercase; multi-value headers are joined with
   * `, ` into a single string. Tests assert against lowercase keys
   * (e.g. `headers['x-signature']`, never `headers['X-Signature']`).
   */
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeWebhookReceiver {
  /** Base URL, e.g. `http://127.0.0.1:54321`. */
  readonly url: string;
  readonly calls: readonly FakeWebhookCall[];
  readonly callCount: number;
  /** For testing 4xx/5xx response paths. Default 200. */
  setStatusCode(status: number): void;
  /** Override the JSON response body. Default `{ ok: true }`. */
  setResponseBody(body: unknown): void;
  /** Simulate a slow webhook (timeout tests). Applied before responding. */
  setLatencyMs(ms: number): void;
  /**
   * When true, the receiver records the request (with the complete body)
   * then destroys the socket without writing a response. Lets tests exercise
   * timeout / connection-reset paths without spinning up a separate harness.
   * Drop happens AFTER body-read and AFTER the call is recorded.
   */
  setDropConnection(drop: boolean): void;
  /** Clear `calls` and reset all overrides (status, latency, body, drop). */
  reset(): void;
  /** Release the port. Resolves once the underlying server emits its close callback. */
  close(): Promise<void>;
}

function normaliseHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined) continue;
    const key = rawKey.toLowerCase();
    out[key] = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
  }
  return out;
}

async function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(buf: Buffer, contentType: string | undefined): unknown {
  if (buf.length === 0) return null;
  if (contentType && contentType.toLowerCase().includes('application/json')) {
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      // Fall through to raw — a deliberately-malformed body should still be
      // recorded so a test can assert on it. The catch keeps the harness
      // from masking a producer-side bug as a harness-side parse failure.
      return buf;
    }
  }
  return buf;
}

export async function startFakeWebhookReceiver(): Promise<FakeWebhookReceiver> {
  const calls: FakeWebhookCall[] = [];
  let statusCode = 200;
  let responseBody: unknown = { ok: true };
  let latencyMs = 0;
  let dropConnection = false;

  const server: Server = createServer(async (req, res) => {
    let bodyBuf: Buffer;
    try {
      bodyBuf = await readBodyBuffer(req);
    } catch {
      // If body-read errors, we still don't record — the call boundary is
      // body-complete-or-skip. Destroy the socket and return.
      res.socket?.destroy();
      return;
    }
    const body = parseBody(bodyBuf, req.headers['content-type']);

    calls.push({
      receivedAt: new Date(),
      method: req.method ?? 'UNKNOWN',
      path: req.url ?? '/',
      headers: normaliseHeaders(req),
      body,
    });

    if (dropConnection) {
      // Destroy the socket without writing a response. Recorded above so a
      // test can still assert "the request reached us" even though no
      // response was returned.
      res.socket?.destroy();
      return;
    }

    if (latencyMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
    }

    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    get calls() { return calls; },
    get callCount() { return calls.length; },
    setStatusCode(status: number) { statusCode = status; },
    setResponseBody(body: unknown) { responseBody = body; },
    setLatencyMs(ms: number) { latencyMs = ms; },
    setDropConnection(drop: boolean) { dropConnection = drop; },
    reset() {
      calls.length = 0;
      statusCode = 200;
      responseBody = { ok: true };
      latencyMs = 0;
      dropConnection = false;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        // Destroy any open sockets (drop-connection mode leaves them dangling)
        // so close() does not hang forever.
        try { (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* node < 18.2 */ }
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
