// browserHardening.ts
// Disclosure copy strings for browser hardening primitives (spec §15, Q13)
// CONSUMER: tenant proxy-config UI (deferred per BHP-1)
//           humanize toggle UI (deferred per architect-pick item 9, path (c))
//           detection harness status (internal staff UI, deferred)

export const browserHardeningCopy = {
  humanize:
    'Human-paced input timing. When enabled, this workflow types and clicks with realistic human pauses. Slower per action; helps on sites that flag machine-speed automation.',
  proxyAlignment:
    'When you configure a proxy for this workflow, browser locale, timezone, and language are aligned with the proxy region by default. Override in workflow settings if needed.',
  detectionHarness:
    'Synthetos browser-layer regression testing. Surfaces drift in detection-site scores when our stack changes.',
} as const;

export type BrowserHardeningCopyKey = keyof typeof browserHardeningCopy;
