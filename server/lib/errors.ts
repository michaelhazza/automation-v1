import type { AppErrorCode } from '../../shared/errorCodes.js';

export interface AppErrorParams {
  code: AppErrorCode;
  statusCode: number;
  message: string;
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly context: Readonly<Record<string, unknown>> | undefined;

  constructor(params: AppErrorParams) {
    super(params.message);
    this.name = 'AppError';
    this.stack = new Error().stack; // ensure consistent stack capture across environments
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.context = params.context ? Object.freeze({ ...params.context }) : undefined;
  }
}

export class OptimisticLockError extends Error {
  readonly code = 'optimistic_lock_conflict';
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}
