declare module 'wink-bm25-text-search' {
  interface BM25Engine {
    defineConfig(config: Record<string, unknown>): void;
    definePrepTasks(tasks: Array<(text: string) => string>): void;
    addDoc(doc: Record<string, string>, id: string): void;
    consolidate(): void;
    search(query: string, limit?: number): Array<[string, number, number]>;
  }
  export default function BM25(): BM25Engine;
}
