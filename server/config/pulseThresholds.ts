export const PULSE_MAJOR_THRESHOLD_DEFAULTS = {
  perActionMinor: 5_000,    // AUD $50.00
  perRunMinor: 50_000,      // AUD $500.00
} as const;

export const CURRENCY_DEFAULT = 'AUD' as const;

export const PULSE_MAJOR_THRESHOLD_MAX_MINOR = 1_000_000;  // AUD $10,000

export type PulseMajorThresholds = {
  perActionMinor: number;
  perRunMinor: number;
};
