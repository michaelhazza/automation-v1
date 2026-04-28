import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './logger.js';

export interface PostCommitStore {
  enqueue(emit: () => void): void;
  flushAll(): void;
  reset(): void;
  readonly isClosed: boolean;
  readonly pendingCount: number;
}

export function createPostCommitStore(requestId?: string): PostCommitStore {
  const queue: Array<() => void> = [];
  let closed = false;

  return {
    get isClosed() { return closed; },
    get pendingCount() { return queue.length; },

    enqueue(emit: () => void): void {
      if (closed) {
        logger.info('post_commit_emit_fallback', { reason: 'closed_store' });
        emit();
        return;
      }
      queue.push(emit);
    },

    flushAll(): void {
      if (closed) return;
      const emits = queue.splice(0);
      closed = true;
      logger.info('post_commit_emit_flushed', { requestId, emitCount: emits.length });
      for (const fn of emits) {
        try {
          fn();
        } catch (err) {
          logger.error('post_commit_emit_error', { requestId, err: String(err) });
        }
      }
    },

    reset(): void {
      if (closed) return;
      queue.splice(0);
      closed = true;
    },
  };
}

const als = new AsyncLocalStorage<PostCommitStore>();

export function getPostCommitStore(): PostCommitStore | null {
  return als.getStore() ?? null;
}

export function runWithPostCommitStore<T>(
  store: PostCommitStore,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(store, fn);
}
