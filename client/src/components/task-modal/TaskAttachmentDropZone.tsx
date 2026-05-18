import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addFiles,
  transitionRow,
  type AttachmentRowState,
} from './TaskAttachmentDropZonePure';

interface TaskAttachmentDropZoneProps {
  taskId: string | null;
  uploadAttachment(args: {
    taskId: string;
    file: File;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<{ attachmentId: string; filename: string }>;
  deleteAttachment(args: { attachmentId: string }): Promise<void>;
  onAttachmentsChange?(state: AttachmentRowState[]): void;
  disabled?: boolean;
}

let _ikey = 0;
function nextIdempotencyKey(): string {
  return `ik-${Date.now()}-${++_ikey}`;
}

export function TaskAttachmentDropZone({
  taskId,
  uploadAttachment,
  deleteAttachment,
  onAttachmentsChange,
  disabled = false,
}: TaskAttachmentDropZoneProps) {
  const [rows, setRows] = useState<AttachmentRowState[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const updateRows = useCallback(
    (next: AttachmentRowState[]) => {
      setRows(next);
      onAttachmentsChange?.(next);
    },
    [onAttachmentsChange],
  );

  const startUpload = useCallback(
    (localId: string, file: File, taskIdValue: string) => {
      const idempotencyKey = nextIdempotencyKey();
      const controller = new AbortController();

      setRows((current) => {
        const uploading = transitionRow(current, localId, {
          state: 'uploading',
          localId,
          file,
          idempotencyKey,
          controller,
        });
        onAttachmentsChange?.(uploading);
        return uploading;
      });

      uploadAttachment({ taskId: taskIdValue, file, idempotencyKey, signal: controller.signal })
        .then(({ attachmentId, filename }) => {
          setRows((current) => {
            const next = transitionRow(current, localId, {
              state: 'succeeded',
              localId,
              attachmentId,
              filename,
            });
            onAttachmentsChange?.(next);
            return next;
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : 'Upload failed';
          setRows((current) => {
            const row = current.find((r) => r.localId === localId);
            if (!row || row.state !== 'uploading') return current;
            const next = transitionRow(current, localId, {
              state: 'failed_recoverable',
              localId,
              file,
              idempotencyKey,
              error: message,
            });
            onAttachmentsChange?.(next);
            return next;
          });
        });
    },
    [uploadAttachment, onAttachmentsChange],
  );

  // When taskId becomes available, start uploading all pending rows
  const prevTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (taskId && prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      const pending = rowsRef.current.filter((r) => r.state === 'pending');
      for (const row of pending) {
        if (row.state === 'pending') {
          startUpload(row.localId, row.file, taskId);
        }
      }
    }
  }, [taskId, startUpload]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      const next = addFiles(rowsRef.current, files);
      updateRows(next);

      if (taskId) {
        const newPending = next.filter(
          (r) => r.state === 'pending' && !rowsRef.current.some((old) => old.localId === r.localId),
        );
        for (const row of newPending) {
          if (row.state === 'pending') {
            startUpload(row.localId, row.file, taskId);
          }
        }
      }
    },
    [disabled, taskId, updateRows, startUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    },
    [handleFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      handleFiles(files);
      e.target.value = '';
    },
    [handleFiles],
  );

  const handleRemove = useCallback(
    (localId: string) => {
      const row = rowsRef.current.find((r) => r.localId === localId);
      if (!row) return;

      if (row.state === 'uploading') {
        row.controller.abort();
      }

      if (row.state === 'succeeded') {
        void deleteAttachment({ attachmentId: row.attachmentId });
      }

      setRows((current) => {
        const next = current.filter((r) => r.localId !== localId);
        onAttachmentsChange?.(next);
        return next;
      });
    },
    [deleteAttachment, onAttachmentsChange],
  );

  const handleRetry = useCallback(
    (localId: string) => {
      if (!taskId) return;
      const row = rowsRef.current.find((r) => r.localId === localId);
      if (!row || row.state !== 'failed_recoverable') return;
      startUpload(localId, row.file, taskId);
    },
    [taskId, startUpload],
  );

  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Attachments</label>
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to browse"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${
          isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />
        <p className="text-[13px] text-slate-500 m-0">Drop files here or click to browse</p>
      </div>

      {rows.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 list-none p-0 m-0">
          {rows.map((row) => (
            <li key={row.localId} className="flex items-center gap-2 text-[13px]">
              <span className="flex-1 truncate text-slate-700">
                {row.state === 'pending' ? row.file.name
                  : row.state === 'uploading' ? row.file.name
                  : row.state === 'succeeded' ? row.filename
                  : row.state === 'failed_recoverable' ? row.file.name
                  : row.state === 'failed_unrecoverable' ? row.filename
                  : row.filename}
              </span>
              <span className={`text-[11px] shrink-0 ${
                row.state === 'succeeded' ? 'text-green-600'
                  : row.state === 'uploading' ? 'text-indigo-500'
                  : row.state === 'failed_recoverable' || row.state === 'failed_unrecoverable' ? 'text-red-500'
                  : row.state === 'cancelled' ? 'text-slate-400'
                  : 'text-slate-400'
              }`}>
                {row.state === 'pending' ? 'Pending'
                  : row.state === 'uploading' ? 'Uploading...'
                  : row.state === 'succeeded' ? 'Uploaded'
                  : row.state === 'failed_recoverable' ? row.error
                  : row.state === 'failed_unrecoverable' ? row.error
                  : 'Cancelled'}
              </span>
              {row.state === 'failed_recoverable' && taskId && (
                <button
                  type="button"
                  onClick={() => handleRetry(row.localId)}
                  className="bg-transparent border-0 cursor-pointer text-indigo-600 hover:text-indigo-800 text-[12px] shrink-0"
                >
                  Retry
                </button>
              )}
              {row.state !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => handleRemove(row.localId)}
                  className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-[12px] shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[12px] text-slate-400 m-0">
        Attachments are uploaded as context to help your agent understand your request. They are not guaranteed to be processed in every workflow step.
      </p>
    </div>
  );
}
