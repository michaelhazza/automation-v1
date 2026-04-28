import type { RequestHandler } from 'express';
import { createPostCommitStore, runWithPostCommitStore } from '../lib/postCommitEmitter.js';
import { logger } from '../lib/logger.js';

export const postCommitEmitterMiddleware: RequestHandler = (req, res, next) => {
  const requestId = req.correlationId;
  const store = createPostCommitStore(requestId);

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      store.flushAll();
    } else {
      const droppedCount = store.pendingCount;
      store.reset();
      if (droppedCount > 0) {
        logger.info('post_commit_emit_dropped', { requestId, droppedCount, statusCode: res.statusCode });
      }
    }
  });

  // Premature disconnect — drop the queue regardless of status.
  // reset() is idempotent: if 'finish' already fired this is a no-op.
  res.on('close', () => {
    const droppedCount = store.pendingCount;
    store.reset();
    if (droppedCount > 0) {
      logger.info('post_commit_emit_dropped', { requestId, droppedCount });
    }
  });

  runWithPostCommitStore(store, async () => next()).catch(next);
};
