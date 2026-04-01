/**
 * TripWire — typed abort mechanism for processor hooks.
 *
 * Distinguishes retryable halts (soft abort — skip this step, agent continues)
 * from fatal halts (kill the run entirely).
 *
 * Usage inside a ProcessorHook:
 *
 *   throw new TripWire('Budget exceeded', { retry: false });          // fatal
 *   throw new TripWire('Rate limit hit, back off', { retry: true });  // soft — skip step
 */
export class TripWire extends Error {
  constructor(
    public readonly reason: string,
    public readonly options: { retry: boolean; code?: string } = { retry: false },
  ) {
    super(reason);
    this.name = 'TripWire';
  }
}
