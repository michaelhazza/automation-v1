export class TaskAlreadyHasActiveRunError extends Error {
  readonly code = 'task_already_has_active_run' as const;
  constructor(public readonly taskId: string) {
    super(`Task ${taskId} already has an active workflow run`);
    this.name = 'TaskAlreadyHasActiveRunError';
  }
}
