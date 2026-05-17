// Deliberately direct boss.work() call — fixture for gate-portability harness
export function registerSeededWorker(boss: any) {
  boss.work('seeded-queue', async (job: any) => {
    return job;
  });
}
