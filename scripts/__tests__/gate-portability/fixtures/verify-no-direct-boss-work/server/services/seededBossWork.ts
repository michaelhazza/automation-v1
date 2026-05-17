// Deliberately direct boss.work() call — fixture for gate-portability harness
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSeededWorker(boss: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  boss.work('seeded-queue', async (job: any) => {
    return job;
  });
}
