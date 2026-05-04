export class OptimisticLockError extends Error {
  readonly code = 'optimistic_lock_conflict';
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}
