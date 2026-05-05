import { useState } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';

interface ConservativeDefaultsButtonProps {
  budgetId: string;
  onApplied: () => void;
}

/**
 * One-click loader that POSTs conservative defaults to the spending budget service.
 * Per spec §14: per_txn=$20, daily=$100, monthly=$500, threshold=0,
 * descriptors: NAMECHEAP, OPENAI, ANTHROPIC, CLOUDFLARE, TWILIO, STRIPE.
 */
export default function ConservativeDefaultsButton({ budgetId, onApplied }: ConservativeDefaultsButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleLoad = async () => {
    setLoading(true);
    try {
      await api.post(`/api/spending-budgets/${budgetId}/conservative-defaults`);
      toast.success('Conservative defaults applied');
      onApplied();
    } catch {
      toast.error('Failed to apply conservative defaults');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLoad}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold rounded-md border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors duration-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [font-family:inherit]"
    >
      {loading ? 'Applying...' : 'Load conservative defaults'}
    </button>
  );
}
