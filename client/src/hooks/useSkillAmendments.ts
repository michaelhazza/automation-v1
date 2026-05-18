import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AmendmentListItem,
  AmendmentDetail,
  RejectReason,
  RetirementReason,
  IncidentSeverity,
} from '../../../shared/types/skillAmendments.js';
import {
  listPendingAmendments,
  getAmendment,
  acceptAmendment,
  acceptAfterEdit,
  rejectAmendment,
  retireAmendment,
} from '../lib/skillAmendmentsApi.js';

export interface UseListPendingAmendmentsResult {
  items: AmendmentListItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useListPendingAmendments(subaccountId: string): UseListPendingAmendmentsResult {
  const [items, setItems] = useState<AmendmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!subaccountId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    try {
      const data = await listPendingAmendments(subaccountId);
      if (!cancelled && mountedRef.current) {
        setItems(data);
      }
    } catch {
      if (!cancelled && mountedRef.current) {
        setError('Failed to load proposed amendments');
      }
    } finally {
      if (!cancelled && mountedRef.current) {
        setLoading(false);
      }
    }
    return () => { cancelled = true; };
  }, [subaccountId]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);

    listPendingAmendments(subaccountId)
      .then((data) => {
        if (!cancelled && mountedRef.current) {
          setItems(data);
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) {
          setError('Failed to load proposed amendments');
        }
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [subaccountId]);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return { items, loading, error, refetch };
}

export interface UseAmendmentDetailResult {
  detail: AmendmentDetail | null;
  loading: boolean;
  error: string | null;
}

export function useAmendmentDetail(
  subaccountId: string,
  id: string | null,
): UseAmendmentDetailResult {
  const [detail, setDetail] = useState<AmendmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getAmendment(subaccountId, id)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load amendment details');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [subaccountId, id]);

  return { detail, loading, error };
}

export interface AmendmentMutations {
  accept: (id: string) => Promise<void>;
  acceptAfterEdit: (id: string, body: string) => Promise<void>;
  reject: (id: string, rejectReason: RejectReason) => Promise<void>;
  retire: (id: string, retirementReason: RetirementReason, incidentSeverity?: IncidentSeverity) => Promise<void>;
}

export function useAmendmentMutations(
  subaccountId: string,
  onSuccess: () => void,
): AmendmentMutations {
  const accept = useCallback(async (id: string) => {
    await acceptAmendment(subaccountId, id);
    onSuccess();
  }, [subaccountId, onSuccess]);

  const acceptAfterEditFn = useCallback(async (id: string, body: string) => {
    await acceptAfterEdit(subaccountId, id, body);
    onSuccess();
  }, [subaccountId, onSuccess]);

  const reject = useCallback(async (id: string, rejectReason: RejectReason) => {
    await rejectAmendment(subaccountId, id, rejectReason);
    onSuccess();
  }, [subaccountId, onSuccess]);

  const retire = useCallback(async (
    id: string,
    retirementReason: RetirementReason,
    incidentSeverity?: IncidentSeverity,
  ) => {
    await retireAmendment(subaccountId, id, retirementReason, incidentSeverity);
    onSuccess();
  }, [subaccountId, onSuccess]);

  return { accept, acceptAfterEdit: acceptAfterEditFn, reject, retire };
}
