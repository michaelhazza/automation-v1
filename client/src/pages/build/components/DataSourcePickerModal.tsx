import React, { useState } from 'react';
import Modal from '../../../components/Modal';
import { SearchBox } from '../../../components/SearchBox';
import type { DataSourceBindingPayload } from '../../../../../shared/types/build';

// Phase 1: placeholder — data source picker connects to a data source endpoint in a future iteration.
// The modal structure is in place; the catalogue fetch is a PLAN_GAP.

interface DataSourcePickerModalProps {
  onSelect: (source: DataSourceBindingPayload) => void;
  onClose: () => void;
  existingIds: string[];
}

export function DataSourcePickerModal({ onSelect: _onSelect, onClose, existingIds: _existingIds }: DataSourcePickerModalProps) {
  const [q, setQ] = useState('');

  return (
    <Modal title="Add data source" onClose={onClose} maxWidth={600}>
      <SearchBox value={q} onChange={setQ} placeholder="Search data sources..." autoFocus />
      <p className="text-sm text-slate-400 mt-4 text-center">
        Data source catalogue coming in a future release.
      </p>
    </Modal>
  );
}
