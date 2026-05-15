// p-limit is ESM; import dynamically to avoid CommonJS issues
export async function getPLimit(concurrency: number) {
  const { default: pLimit } = await import('p-limit');
  return pLimit(concurrency);
}

export function consolidationWordCount(text: string | null): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const BATCH_SIZE = 100; // OpenAI embedding batch size
