// server/services/externalDocumentSingleFlight.ts

export class SingleFlightGuard<T> {
  private readonly inflight = new Map<string, Promise<T>>();
  constructor(private readonly maxEntries: number) {}

  async run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    if (this.inflight.size >= this.maxEntries) {
      return fn();
    }

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }
}
