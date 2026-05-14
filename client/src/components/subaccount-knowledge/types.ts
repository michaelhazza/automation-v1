export interface Reference {
  id: string;
  content: string;
  entryType: string;
  createdAt: string;
}

export interface Insight {
  id: string;
  content: string;
  entryType: string;
  domain: string | null;
  topic: string | null;
  taskSlug: string | null;
  qualityScore: number | null;
  createdAt: string;
  agentRunId: string | null;
  agentId: string | null;
  agentName: string | null;
  runStatus: string | null;
  runStartedAt: string | null;
}

export interface InsightFacets {
  domains: string[];
  topics: string[];
  entryTypes: string[];
  taskSlugs: string[];
}

export interface MemoryBlock {
  id: string;
  name: string;
  content: string;
  subaccountId: string | null;
  sourceReferenceId: string | null;
  updatedAt: string;
}

export type Tab = 'references' | 'insights' | 'blocks';

export const MEMORY_BLOCK_LABEL_MAX = 80;
export const MEMORY_BLOCK_CONTENT_MAX = 2000;
export const REFERENCE_PROMOTE_PREVIEW_MAX = 500;
export const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
