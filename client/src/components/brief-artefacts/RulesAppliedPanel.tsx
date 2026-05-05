import { Link } from 'react-router-dom';

interface BlockCitation {
  memoryBlockId: string;
  citedSnippet?: string;
  citationScore: number;
}

interface RulesAppliedPanelProps {
  citations: BlockCitation[];
  ruleNames?: Record<string, string>;
}

/**
 * Phase 8 / W3c — renders which memory_block rules were applied in an agent output.
 * Click-through navigates to the Learned Rules library with the rule pre-selected.
 */
export function RulesAppliedPanel({ citations, ruleNames = {} }: RulesAppliedPanelProps) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-500 mb-1">
        Rules applied ({citations.length})
      </p>
      <ul className="space-y-0.5">
        {citations.map((c) => (
          <li key={c.memoryBlockId} className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
            <Link
              to={`/rules?ruleId=${c.memoryBlockId}`}
              className="text-indigo-600 hover:text-indigo-800 hover:underline truncate"
            >
              {ruleNames[c.memoryBlockId] ?? c.memoryBlockId.slice(0, 8) + '…'}
            </Link>
            {c.citedSnippet && (
              <span className="text-gray-400 truncate">"{c.citedSnippet}"</span>
            )}
            <span className="ml-auto text-gray-400 shrink-0">
              {Math.round(c.citationScore * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
