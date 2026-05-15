// ---------------------------------------------------------------------------
// Proactive sync scheduler
// ---------------------------------------------------------------------------

type ProactiveSyncFn = (sourceId: string) => Promise<void>;

class DataSyncScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private syncFn?: ProactiveSyncFn;

  setSyncFn(fn: ProactiveSyncFn): void {
    this.syncFn = fn;
  }

  schedule(sourceId: string, intervalMs: number): void {
    this.cancel(sourceId);
    const timer = setInterval(() => void this.syncFn?.(sourceId), intervalMs);
    this.timers.set(sourceId, timer);
  }

  cancel(sourceId: string): void {
    const timer = this.timers.get(sourceId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(sourceId);
    }
  }

  activeCount(): number {
    return this.timers.size;
  }
}

export const dataSyncScheduler = new DataSyncScheduler();
