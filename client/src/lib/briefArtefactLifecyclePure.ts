import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

export interface ArtefactChainState {
  artefacts: BriefChatArtefact[];
}

export interface ResolvedChains {
  /** Map from chain root artefactId to the current tip artefact. */
  chainTips: Map<string, BriefChatArtefact>;
  /** Artefacts whose parentArtefactId points to an absent artefact — treated as new roots. */
  orphans: BriefChatArtefact[];
  /** Artefacts superseded by a later child in the chain (kept for history). */
  superseded: Map<string, BriefChatArtefact[]>;
}

/**
 * Pure lifecycle resolver for BriefChatArtefact chains.
 *
 * Algorithm (single pass, deterministic):
 * 1. Build parent → children index from parentArtefactId links.
 * 2. A tip = artefact with no children in the index.
 * 3. Walk each tip back to its chain root; accumulate superseded artefacts.
 * 4. Orphans: parentArtefactId present but parent absent → treated as new roots.
 * 5. Multi-tip state (partial knowledge) is not an error — render all candidate tips.
 */
export function resolveLifecyclePure(state: ArtefactChainState): ResolvedChains {
  const { artefacts } = state;
  if (artefacts.length === 0) {
    return { chainTips: new Map(), orphans: [], superseded: new Map() };
  }

  const byId = new Map<string, BriefChatArtefact>(artefacts.map(a => [a.artefactId, a]));

  // Build children index: parentId → [child, ...]
  const childrenIndex = new Map<string, string[]>();
  for (const a of artefacts) {
    if (a.parentArtefactId) {
      const siblings = childrenIndex.get(a.parentArtefactId) ?? [];
      siblings.push(a.artefactId);
      childrenIndex.set(a.parentArtefactId, siblings);
    }
  }

  // Tips: artefacts with no children
  const tips = artefacts.filter(a => !childrenIndex.has(a.artefactId));

  const chainTips = new Map<string, BriefChatArtefact>();
  const superseded = new Map<string, BriefChatArtefact[]>();
  const orphans: BriefChatArtefact[] = [];

  for (const tip of tips) {
    const chain: BriefChatArtefact[] = [];
    let current: BriefChatArtefact | undefined = tip;
    let isOrphan = false;

    // Walk to root
    while (current) {
      chain.push(current);
      if (!current.parentArtefactId) break;
      const parent = byId.get(current.parentArtefactId);
      if (!parent) {
        // Parent referenced but absent — this tip is an orphan chain
        isOrphan = true;
        break;
      }
      current = parent;
    }

    const root = chain[chain.length - 1]!;

    if (isOrphan) {
      orphans.push(tip);
    } else {
      chainTips.set(root.artefactId, tip);
    }

    // Everything between root and tip (exclusive of tip) is superseded
    if (chain.length > 1) {
      const hist = chain.slice(1); // indices 1..n are ancestors; 0 is tip
      superseded.set(root.artefactId, hist);
    }
  }

  return { chainTips, orphans, superseded };
}
