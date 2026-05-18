// humanize.ts — types for the humanize input-timing primitive
// Spec §6.2

export type HumanizeProfile = 'light' | 'balanced' | 'heavy';

export interface HumanizeOptions {
  profile: HumanizeProfile;
  seed: number; // integer >= 0
}

// PersistedHumanize: null = off (spec §6.2 — 'off' is never a profile value)
export type PersistedHumanize = HumanizeOptions | null;
