/**
 * Video analysis feasibility pilot — throwaway measurement script.
 *
 * Runs each video in tasks/pilots/video-analysis/inputs.json through:
 *   1. Supadata /transcript + /metadata
 *   2. Gemini 2.5 Flash generateContent with the video URL + structured prompt
 * Writes per-video JSON to tasks/pilots/video-analysis/outputs/<slug>.json and
 * a results-<YYYY-MM-DD-HHMM>.md report at the end.
 *
 * Direct fetch() to vendor APIs only. No platform code touched.
 *   npx tsx scripts/pilots/video-analysis-pilot.ts
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- Constants ----------

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const INPUTS_PATH = resolve(ROOT, 'tasks/pilots/video-analysis/inputs.json');
const OUTPUTS_DIR = resolve(ROOT, 'tasks/pilots/video-analysis/outputs');
const PILOT_DIR = resolve(ROOT, 'tasks/pilots/video-analysis');

const SUPADATA_BASE = 'https://api.supadata.ai/v1';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Pricing — Gemini 2.5 Flash Standard tier (https://ai.google.dev/gemini-api/docs/pricing)
const GEMINI_INPUT_PRICE_PER_M = 0.30;
const GEMINI_OUTPUT_PRICE_PER_M = 2.50;

// Sanity guardrail — abort run if cumulative Gemini spend approaches this
const SPEND_CAP_USD = 15.0;

const ANALYSIS_PROMPT = `You are analyzing a short-form social video to explain why it performed well. Return strict JSON matching this schema:
{
  "topic": "1 sentence summary of what the video is about",
  "hook": { "first_seconds": "what happens in the first 3-5 seconds", "why_it_works": "1-2 sentences" },
  "structure": [{ "timestamp": "MM:SS", "beat": "what happens here, 1 sentence" }],
  "creator_intent": "1-2 sentences on what the creator was trying to do",
  "why_it_worked": "3-5 sentences on the actual mechanics: tension, payoff, audience signal, novelty, format choice"
}
Output JSON only. No prose outside the JSON.`;

// ---------- Types ----------

type Platform = 'youtube' | 'tiktok' | 'instagram' | string;

interface InputRow {
  url: string;
  platform: Platform;
  expected_to_perform_well: boolean;
  note?: string;
}

interface PerVideoRecord {
  input: InputRow;
  slug: string;
  fetch: {
    ok: boolean;
    transcript_status?: number;
    metadata_status?: number;
    transcript?: { content?: unknown; lang?: string; availableLangs?: string[] };
    metadata?: Record<string, unknown>;
    error?: string;
    duration_ms: number;
  };
  analysis: {
    ok: boolean;
    status?: number;
    raw_text?: string;
    parsed_json?: unknown;
    parse_error?: string;
    usage?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    cost_usd?: number;
    error?: string;
    duration_ms: number;
  };
  total_duration_ms: number;
  failure_class?: 'supadata_4xx' | 'supadata_5xx' | 'supadata_network' | 'gemini_quota' | 'gemini_parse' | 'gemini_other' | 'other' | null;
}

// ---------- Helpers ----------

function abort(msg: string): never {
  console.error(`\nABORT: ${msg}\n`);
  process.exit(1);
}

function slugify(url: string, platform: string): string {
  const idMatch =
    url.match(/[?&]v=([^&]+)/) ||              // youtube watch
    url.match(/youtu\.be\/([^?&/]+)/) ||       // youtu.be
    url.match(/\/video\/(\d+)/) ||             // tiktok
    url.match(/\/reel\/([^/?]+)/);             // instagram reel
  const id = idMatch ? idMatch[1] : url.replace(/[^a-z0-9]/gi, '_').slice(-20);
  return `${platform}_${id}`.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
}

function nowSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function classifyFailure(rec: PerVideoRecord): PerVideoRecord['failure_class'] {
  if (rec.fetch.ok && rec.analysis.ok) return null;
  if (!rec.fetch.ok) {
    const s = rec.fetch.transcript_status ?? rec.fetch.metadata_status ?? 0;
    if (s >= 400 && s < 500) return 'supadata_4xx';
    if (s >= 500 && s < 600) return 'supadata_5xx';
    return 'supadata_network';
  }
  if (rec.analysis.status === 429) return 'gemini_quota';
  if (rec.analysis.parse_error) return 'gemini_parse';
  if (rec.analysis.error || (rec.analysis.status && rec.analysis.status >= 400)) return 'gemini_other';
  return 'other';
}

async function callSupadataTranscript(url: string, apiKey: string): Promise<{ status: number; body: any; error?: string }> {
  const u = `${SUPADATA_BASE}/transcript?url=${encodeURIComponent(url)}&text=true`;
  try {
    const res = await fetch(u, { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function callSupadataMetadata(url: string, apiKey: string): Promise<{ status: number; body: any; error?: string }> {
  const u = `${SUPADATA_BASE}/metadata?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(u, { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function callGeminiAnalyze(videoUrl: string, apiKey: string): Promise<{ status: number; body: any; error?: string }> {
  const reqBody = {
    contents: [{
      parts: [
        { file_data: { file_uri: videoUrl } },
        { text: ANALYSIS_PROMPT },
      ],
    }],
    generationConfig: {
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
      responseMimeType: 'application/json',
    },
  };
  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function extractGeminiText(body: any): string | null {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const textPart = parts.find((p: any) => typeof p?.text === 'string');
  return textPart?.text ?? null;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // Strip markdown fences if Gemini wrapped output
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try { return { ok: true, value: JSON.parse(t) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

function computeCost(usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined): number {
  if (!usage) return 0;
  const inTok = usage.promptTokenCount ?? 0;
  const outTok = usage.candidatesTokenCount ?? 0;
  return (inTok / 1_000_000) * GEMINI_INPUT_PRICE_PER_M + (outTok / 1_000_000) * GEMINI_OUTPUT_PRICE_PER_M;
}

// ---------- Per-video execution ----------

async function processOne(input: InputRow, supadataKey: string, geminiKey: string): Promise<PerVideoRecord> {
  const t0 = Date.now();
  const slug = slugify(input.url, input.platform);
  const rec: PerVideoRecord = {
    input,
    slug,
    fetch: { ok: false, duration_ms: 0 },
    analysis: { ok: false, duration_ms: 0 },
    total_duration_ms: 0,
  };

  // Step 1 — Supadata transcript + metadata (serialized — Supadata's per-second
  // rate limit on the free tier 429s when these fire concurrently)
  const fetchT0 = Date.now();
  const tx = await callSupadataTranscript(input.url, supadataKey);
  const md = await callSupadataMetadata(input.url, supadataKey);
  rec.fetch.duration_ms = Date.now() - fetchT0;
  rec.fetch.transcript_status = tx.status;
  rec.fetch.metadata_status = md.status;
  if (tx.status === 200) rec.fetch.transcript = tx.body;
  if (md.status === 200) rec.fetch.metadata = md.body;
  if (tx.error || md.error) rec.fetch.error = [tx.error, md.error].filter(Boolean).join('; ');
  // "Fetch ok" = transcript fetched successfully (the more important signal)
  rec.fetch.ok = tx.status === 200;

  // Step 2 — Gemini analysis (always attempt; failures are data)
  const anT0 = Date.now();
  const an = await callGeminiAnalyze(input.url, geminiKey);
  rec.analysis.duration_ms = Date.now() - anT0;
  rec.analysis.status = an.status;
  if (an.error) rec.analysis.error = an.error;
  if (an.status === 200 && an.body?.candidates?.[0]) {
    const text = extractGeminiText(an.body);
    rec.analysis.raw_text = text ?? undefined;
    rec.analysis.usage = an.body.usageMetadata;
    rec.analysis.cost_usd = computeCost(an.body.usageMetadata);
    if (text) {
      const parsed = tryParseJson(text);
      if (parsed.ok) {
        rec.analysis.parsed_json = parsed.value;
        rec.analysis.ok = true;
      } else {
        rec.analysis.parse_error = parsed.error;
      }
    } else {
      rec.analysis.parse_error = 'No text part in Gemini response';
    }
  } else if (an.status !== 200) {
    rec.analysis.error = rec.analysis.error
      ? `${rec.analysis.error}; HTTP ${an.status}: ${JSON.stringify(an.body).slice(0, 500)}`
      : `HTTP ${an.status}: ${JSON.stringify(an.body).slice(0, 500)}`;
  }

  rec.total_duration_ms = Date.now() - t0;
  rec.failure_class = classifyFailure(rec);
  return rec;
}

// ---------- Report writer ----------

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

function writeReport(records: PerVideoRecord[], skipped: InputRow[], reportPath: string, runMeta: { startedAt: string; finishedAt: string }) {
  const total = records.length;
  const fetchOk = records.filter(r => r.fetch.ok).length;
  const analysisOk = records.filter(r => r.analysis.ok).length;

  const byPlat = (records: PerVideoRecord[]) => {
    const m = new Map<string, { total: number; fetchOk: number; analysisOk: number }>();
    for (const r of records) {
      const k = r.input.platform;
      const e = m.get(k) ?? { total: 0, fetchOk: 0, analysisOk: 0 };
      e.total++;
      if (r.fetch.ok) e.fetchOk++;
      if (r.analysis.ok) e.analysisOk++;
      m.set(k, e);
    }
    return [...m.entries()];
  };

  const lats = records.map(r => r.total_duration_ms);
  const totalCost = records.reduce((acc, r) => acc + (r.analysis.cost_usd ?? 0), 0);
  const successCount = records.filter(r => r.fetch.ok && r.analysis.ok).length;
  const avgPerSuccess = successCount > 0 ? totalCost / successCount : 0;

  const failureGroups = new Map<string, number>();
  for (const r of records) {
    if (r.failure_class) failureGroups.set(r.failure_class, (failureGroups.get(r.failure_class) ?? 0) + 1);
  }

  const platRows = byPlat(records).map(([p, e]) =>
    `| ${p} | ${e.total} | ${e.fetchOk}/${e.total} (${pct(e.fetchOk, e.total)}) | ${e.analysisOk}/${e.total} (${pct(e.analysisOk, e.total)}) |`
  ).join('\n');

  const tableRows = records.map(r => {
    const lat = (r.total_duration_ms / 1000).toFixed(1) + 's';
    const cost = r.analysis.cost_usd != null ? `$${r.analysis.cost_usd.toFixed(5)}` : '—';
    const fetch = r.fetch.ok ? 'ok' : `fail (${r.fetch.transcript_status ?? '?'})`;
    const an = r.analysis.ok ? 'ok' : `fail (${r.analysis.status ?? '?'})`;
    return `| ${r.input.url} | ${r.input.platform} | ${fetch} | ${an} | ${lat} | ${cost} | [json](outputs/${r.slug}.json) |`;
  }).join('\n');

  // 5 sample outputs — prefer mix of platforms, prefer successful analyses
  const samples = pickSamples(records, 5);
  const sampleBlocks = samples.map(r => {
    const heading = `### ${r.input.platform} — ${r.input.url}`;
    const body = r.analysis.parsed_json
      ? '```json\n' + JSON.stringify(r.analysis.parsed_json, null, 2) + '\n```'
      : `_No parsed JSON. Status: ${r.analysis.status ?? '?'}. Error: ${r.analysis.error ?? r.analysis.parse_error ?? 'unknown'}_`;
    return `${heading}\n\n${body}`;
  }).join('\n\n---\n\n');

  const failureRows = [...failureGroups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  const recommendation = buildRecommendation({
    total, fetchOk, analysisOk, avgPerSuccess, totalCost, byPlatform: byPlat(records),
  });

  const md = `# Video analysis pilot — results

**Run:** ${runMeta.startedAt} → ${runMeta.finishedAt}
**Branch:** \`claude/video-analysis-integration-8MAK6\`
**Inputs:** ${total} processed, ${skipped.length} skipped (TODO_* placeholders)
**Model:** ${GEMINI_MODEL} @ \`mediaResolution=MEDIA_RESOLUTION_LOW\`, \`responseMimeType=application/json\`

---

## 1. Headline numbers

- **Fetch success rate (overall):** ${fetchOk}/${total} (${pct(fetchOk, total)})
- **Analysis success rate (overall):** ${analysisOk}/${total} (${pct(analysisOk, total)})
- **Latency (end-to-end):** p50 ${(median(lats)/1000).toFixed(1)}s · p95 ${(p95(lats)/1000).toFixed(1)}s
- **Total Gemini spend:** $${totalCost.toFixed(4)}
- **Average cost per successful video:** $${avgPerSuccess.toFixed(4)} _(Gemini only — Supadata credit cost not exposed in API responses; tracked per their billing dashboard)_
- **Skipped (TODO_\\* placeholders):** ${skipped.length}

### Per-platform breakdown

| Platform | Count | Fetch ok | Analysis ok |
|---|---|---|---|
${platRows || '| _no records_ | | | |'}

---

## 2. Per-video table

| URL | Platform | Fetch | Analysis | Latency | Gemini cost | Output |
|---|---|---|---|---|---|---|
${tableRows || '| _no records_ | | | | | | |'}

---

## 3. Sample outputs (5)

${sampleBlocks || '_No samples available._'}

---

## 4. Failure breakdown

| Class | Count |
|---|---|
${failureRows || '| _no failures_ | 0 |'}

**Failure class definitions:**
- \`supadata_4xx\` — Supadata returned 4xx (URL invalid, unsupported platform, auth issue, rate limit)
- \`supadata_5xx\` — Supadata returned 5xx (vendor outage / scraper failure)
- \`supadata_network\` — fetch threw before getting a response
- \`gemini_quota\` — Gemini returned 429
- \`gemini_parse\` — Gemini returned 200 but output wasn't valid JSON
- \`gemini_other\` — Gemini returned non-200 / threw

---

## 5. Recommendation

${recommendation}

---

## Skipped inputs

${skipped.length === 0 ? '_None._' : skipped.map(s => `- \`${s.url}\` (${s.platform})`).join('\n')}
`;

  writeFileSync(reportPath, md);
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function pickSamples(records: PerVideoRecord[], n: number): PerVideoRecord[] {
  const successByPlat = new Map<string, PerVideoRecord[]>();
  for (const r of records.filter(x => x.analysis.ok)) {
    const arr = successByPlat.get(r.input.platform) ?? [];
    arr.push(r);
    successByPlat.set(r.input.platform, arr);
  }
  const out: PerVideoRecord[] = [];
  // Round-robin one per platform first, then fill with remaining successes, then any
  const plats = [...successByPlat.keys()];
  let i = 0;
  while (out.length < n && plats.length > 0) {
    const p = plats[i % plats.length];
    const arr = successByPlat.get(p);
    if (arr && arr.length > 0) out.push(arr.shift()!);
    else plats.splice(i % plats.length, 1);
    i++;
  }
  if (out.length < n) {
    for (const r of records) {
      if (out.length >= n) break;
      if (!out.includes(r)) out.push(r);
    }
  }
  return out;
}

function buildRecommendation(s: {
  total: number;
  fetchOk: number;
  analysisOk: number;
  avgPerSuccess: number;
  totalCost: number;
  byPlatform: [string, { total: number; fetchOk: number; analysisOk: number }][];
}): string {
  if (s.total === 0) return '_No records — cannot recommend._';

  const fetchPct = (s.fetchOk / s.total) * 100;
  const analysisPct = (s.analysisOk / s.total) * 100;
  const lines: string[] = [];

  lines.push(`**Headline:** Fetch ${fetchPct.toFixed(0)}% · Analysis ${analysisPct.toFixed(0)}% · ~$${s.avgPerSuccess.toFixed(3)}/successful video.`);
  lines.push('');
  lines.push('**Per-platform read:**');
  for (const [p, e] of s.byPlatform) {
    const fp = (e.fetchOk / e.total) * 100;
    const ap = (e.analysisOk / e.total) * 100;
    lines.push(`- **${p}:** fetch ${fp.toFixed(0)}% (${e.fetchOk}/${e.total}), end-to-end ${ap.toFixed(0)}% (${e.analysisOk}/${e.total}).`);
  }
  lines.push('');

  const verdict =
    fetchPct >= 90 && analysisPct >= 80 && s.avgPerSuccess <= 0.13
      ? 'GO — vendor stack delivers within the modelled cost envelope; recommend wiring as a first-class skill.'
      : fetchPct >= 70 && analysisPct >= 60
      ? 'CONDITIONAL — feasibility holds but with caveats; ship behind admin-only or low-volume use case while resolving the failure modes called out above.'
      : 'NO-GO (as specced) — fetch or analysis success too low to justify integration without a different vendor stack or fetch path.';
  lines.push(`**Verdict:** ${verdict}`);

  if (s.byPlatform.some(([, e]) => e.total === 0 || (e.fetchOk / Math.max(e.total, 1)) < 0.5)) {
    lines.push('');
    lines.push('**Caveat:** under-sampled or low-fetch platforms above mean the per-platform numbers are not yet load-bearing. Re-run with more URLs (especially TikTok/Instagram, which were left as TODO_\\* placeholders) before locking the integration decision.');
  }

  return lines.join('\n');
}

// ---------- Main ----------

async function main() {
  const supadataKey = process.env.SUPADATA_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supadataKey) {
    abort('SUPADATA_API_KEY is not set in .env. Add it and re-run. Get one at https://supadata.ai.');
  }
  if (!geminiKey) {
    abort('GEMINI_API_KEY is not set in .env. Add it and re-run. Get one at https://aistudio.google.com/apikey.');
  }

  if (!existsSync(INPUTS_PATH)) {
    abort(`inputs.json not found at ${INPUTS_PATH}. Create it as an array of {url, platform, expected_to_perform_well} objects before running.`);
  }
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  const inputs: InputRow[] = JSON.parse(readFileSync(INPUTS_PATH, 'utf8'));
  const skipped = inputs.filter(r => r.url.startsWith('TODO_'));
  const toRun = inputs.filter(r => !r.url.startsWith('TODO_'));

  console.log(`\nVideo analysis pilot`);
  console.log(`====================`);
  console.log(`Total inputs: ${inputs.length}`);
  console.log(`Skipped (TODO_* placeholders): ${skipped.length}`);
  console.log(`To process: ${toRun.length}`);
  console.log(`Output dir: ${OUTPUTS_DIR}`);
  console.log('');

  const startedAt = new Date().toISOString();
  const records: PerVideoRecord[] = [];
  let cumulativeCost = 0;
  let stoppedEarly = false;

  for (let i = 0; i < toRun.length; i++) {
    const input = toRun[i];
    const tag = `[${i + 1}/${toRun.length}] ${input.platform}`;
    process.stdout.write(`${tag} ${input.url} ... `);
    try {
      const rec = await processOne(input, supadataKey, geminiKey);
      records.push(rec);
      cumulativeCost += rec.analysis.cost_usd ?? 0;
      writeFileSync(resolve(OUTPUTS_DIR, `${rec.slug}.json`), JSON.stringify(rec, null, 2));
      const f = rec.fetch.ok ? 'ok' : `FAIL(${rec.fetch.transcript_status ?? '?'})`;
      const a = rec.analysis.ok ? 'ok' : `FAIL(${rec.analysis.status ?? '?'})`;
      const c = rec.analysis.cost_usd != null ? `$${rec.analysis.cost_usd.toFixed(5)}` : '—';
      console.log(`fetch=${f} analysis=${a} ${(rec.total_duration_ms / 1000).toFixed(1)}s ${c}`);
    } catch (e) {
      console.log(`UNHANDLED ERROR: ${e instanceof Error ? e.message : String(e)}`);
      records.push({
        input,
        slug: slugify(input.url, input.platform),
        fetch: { ok: false, duration_ms: 0, error: 'unhandled' },
        analysis: { ok: false, duration_ms: 0, error: e instanceof Error ? e.message : String(e) },
        total_duration_ms: 0,
        failure_class: 'other',
      });
    }
    if (cumulativeCost >= SPEND_CAP_USD) {
      console.log(`\n!!! Spend cap of $${SPEND_CAP_USD} reached at $${cumulativeCost.toFixed(4)}. Stopping early. !!!`);
      stoppedEarly = true;
      break;
    }
  }

  const finishedAt = new Date().toISOString();
  const reportPath = resolve(PILOT_DIR, `results-${nowSlug()}.md`);
  writeReport(records, skipped, reportPath, { startedAt, finishedAt });

  console.log('');
  console.log(`====================`);
  console.log(`Done. ${records.length} records.`);
  console.log(`Total Gemini spend: $${cumulativeCost.toFixed(4)}`);
  if (stoppedEarly) console.log(`Stopped early due to spend cap.`);
  console.log(`Report: ${reportPath}`);
}

main().catch(e => {
  console.error('Fatal error in main:', e);
  process.exit(1);
});
