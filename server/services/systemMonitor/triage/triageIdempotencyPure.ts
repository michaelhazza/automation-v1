export function shouldIncrementAttemptCount(
  currentJobId: string | null,
  candidateJobId: string,
): boolean {
  return currentJobId !== candidateJobId;
}
