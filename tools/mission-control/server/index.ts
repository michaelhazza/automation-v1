/**
 * index.ts
 *
 * Mission Control server entry. Read-only Express app exposing:
 *   GET /api/health         — liveness check
 *   GET /api/in-flight      — composed InFlightItem[] (the dashboard's primary feed)
 *   GET /api/builds         — list of build slugs found under tasks/builds/
 *   GET /api/current-focus  — parsed current-focus.md machine block (or null)
 *   GET /api/review-logs    — flat list of review-log filenames
 *
 * Binds to 127.0.0.1 only. No auth (localhost-only by design — see spec §10
 * Deferred items for the trigger condition that would require auth).
 */

import express from 'express';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './lib/config.js';
import { composeInFlight, listBuildSlugs, readActiveBuildSlug } from './lib/inFlight.js';
import {
  extractActiveBuildSlugFromProse,
  parseCurrentFocusBlock,
  parseReviewLogFilename,
} from './lib/logParsers.js';
import { readdir } from 'node:fs/promises';

const config = loadConfig();
const app = express();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    repoRoot: config.repoRoot,
    githubRepo: config.githubRepo,
    hasGithubToken: Boolean(config.githubToken),
  });
});

app.get('/api/in-flight', async (_req, res) => {
  try {
    const items = await composeInFlight(config);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/builds', async (_req, res) => {
  try {
    const slugs = await listBuildSlugs(config);
    res.json({ slugs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/current-focus', async (_req, res) => {
  try {
    let content = '';
    try {
      content = await readFile(config.currentFocusPath, 'utf-8');
    } catch {
      res.json({ block: null, exists: false, mismatch: null });
      return;
    }
    const block = parseCurrentFocusBlock(content);
    const fallback = await readActiveBuildSlug(config);
    // Spec § C3: prose is canonical when block ≠ prose. Surface the drift to
    // the consumer rather than silently rendering whichever the parser saw first.
    const proseSlug = extractActiveBuildSlugFromProse(content);
    const mismatch =
      block && proseSlug && proseSlug !== block.build_slug
        ? { block: block.build_slug, prose: proseSlug }
        : null;
    res.json({ block, fallback, exists: true, mismatch });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/review-logs', async (_req, res) => {
  try {
    let entries: string[] = [];
    try {
      entries = await readdir(config.reviewLogsDir);
    } catch {
      res.json({ logs: [] });
      return;
    }
    const logs = entries
      .filter((name) => name.endsWith('.md'))
      .map((name) => parseReviewLogFilename(name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== null)
      .sort((a, b) => (a.timestampIso > b.timestampIso ? -1 : 1));
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(
    `[mission-control] listening on http://127.0.0.1:${config.port}\n` +
      `  repoRoot: ${config.repoRoot}\n` +
      `  githubRepo: ${config.githubRepo ?? '(not configured)'}\n` +
      `  githubToken: ${config.githubToken ? 'set' : 'not set (rate-limited public access)'}`,
  );
});
