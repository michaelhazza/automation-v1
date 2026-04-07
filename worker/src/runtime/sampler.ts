// ---------------------------------------------------------------------------
// In-process runtime cost sampler. Spec §11.3.3.
//
// Samples wall-clock, CPU (user+system), and peak RSS over the lifetime of
// a single execution loop. Cheap — uses process.cpuUsage() and
// process.memoryUsage().rss directly.
//
// Returned values feed runtimeCostConfig.computeRuntimeCostUsd() in the
// caller (handlers/browserTask.ts and handlers/devTask.ts).
// ---------------------------------------------------------------------------

export interface RuntimeSample {
  wallMs: number;
  cpuMs: number;
  peakRssBytes: number;
}

export interface RuntimeSamplerHandle {
  /** Take a measurement now (caller may invoke between steps to update peak RSS). */
  sample(): void;
  /** Stop and return the final aggregate. */
  finish(): RuntimeSample;
}

export function startRuntimeSampler(): RuntimeSamplerHandle {
  const wallStart = Date.now();
  const cpuStart = process.cpuUsage();
  let peakRss = process.memoryUsage().rss;

  return {
    sample(): void {
      const now = process.memoryUsage().rss;
      if (now > peakRss) peakRss = now;
    },
    finish(): RuntimeSample {
      const cpuEnd = process.cpuUsage(cpuStart);
      // process.cpuUsage returns microseconds — convert to milliseconds
      const cpuMs = Math.round((cpuEnd.user + cpuEnd.system) / 1000);
      const wallMs = Date.now() - wallStart;
      const finalRss = process.memoryUsage().rss;
      if (finalRss > peakRss) peakRss = finalRss;
      return { wallMs, cpuMs, peakRssBytes: peakRss };
    },
  };
}
