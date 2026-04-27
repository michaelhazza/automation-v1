// Pure helpers for the incident-silence synthetic check — no DB, no framework.
//
// Extracted so `*Pure.test.ts` can import the predicate / parsing logic without
// transitively pulling in `db`, satisfying the §7 / verify-pure-helper-convention
// gate. The IO module (`incidentSilence.ts`) re-imports these helpers.

const DEFAULT_SILENCE_HOURS = 12;
const DEFAULT_PROOF_OF_LIFE_HOURS = 24;

// Pure: predicate. true iff zero incidents in the silence window AND at least
// one synthetic-check fire in the proof-of-life window. The proof-of-life arm
// prevents the check from firing on cold-start (where zero incidents is the
// expected state).
export function isMonitoringSilent(
  incidentsInWindow: number,
  syntheticFiresInProofWindow: number,
): boolean {
  return incidentsInWindow === 0 && syntheticFiresInProofWindow >= 1;
}

// Pure: parse SYSTEM_MONITOR_INCIDENT_SILENCE_HOURS with NaN / non-positive guards.
export function parseSilenceHoursEnv(
  raw: string | undefined = process.env.SYSTEM_MONITOR_INCIDENT_SILENCE_HOURS,
): number {
  if (raw === undefined || raw === '') return DEFAULT_SILENCE_HOURS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SILENCE_HOURS;
  return parsed;
}

// Pure: parse SYSTEM_MONITOR_INCIDENT_SILENCE_PROOF_OF_LIFE_HOURS with NaN / non-positive guards.
export function parseProofOfLifeHoursEnv(
  raw: string | undefined = process.env.SYSTEM_MONITOR_INCIDENT_SILENCE_PROOF_OF_LIFE_HOURS,
): number {
  if (raw === undefined || raw === '') return DEFAULT_PROOF_OF_LIFE_HOURS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROOF_OF_LIFE_HOURS;
  return parsed;
}
