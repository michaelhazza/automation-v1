// ---------------------------------------------------------------------------
// Runtime cost calculation. Spec §11.3.4.
//
// Pricing is env-driven so each environment (local dev, VPS, Replit) sets
// its own rates. Local dev defaults to 0 — no fake cost in test runs.
// ---------------------------------------------------------------------------

import { env } from '../config/env.js';
import type { RuntimeSample } from './sampler.js';

export function computeRuntimeCostCents(sample: RuntimeSample): number {
  const cpuSec = sample.cpuMs / 1000;
  const memGbHr = (sample.peakRssBytes / 1024 ** 3) * (sample.wallMs / 3_600_000);
  const usd = (
    cpuSec * env.IEE_COST_CPU_USD_PER_SEC +
    memGbHr * env.IEE_COST_MEM_USD_PER_GB_HR +
    env.IEE_COST_FLAT_USD_PER_RUN
  );
  return Math.round(usd * 100);
}
