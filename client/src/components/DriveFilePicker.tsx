import { useEffect, useState } from 'react';
import { fetchPickerToken } from '../api/externalDocumentReferences';

const SUPPORTED_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/pdf',
];

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

interface DriveConnection {
  id: string;
  label?: string | null;
  ownerEmail?: string | null;
}

interface DriveFilePickerProps {
  connections: DriveConnection[];
  isOpen: boolean;
  onClose: () => void;
  onPick: (file: DriveFile, connectionId: string) => void;
}

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export function DriveFilePicker({ connections, isOpen, onClose, onPick }: DriveFilePickerProps) {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    connections.length === 1 ? connections[0].id : null
  );
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen || scriptLoaded) return;
    loadPickerScript().then(() => setScriptLoaded(true));
  }, [isOpen, scriptLoaded]);

  useEffect(() => {
    if (!isOpen || !scriptLoaded || !selectedConnectionId) return;
    openPicker(selectedConnectionId, onPick, onClose);
  }, [isOpen, scriptLoaded, selectedConnectionId, onPick, onClose]);

  if (!isOpen) return null;

  if (connections.length > 1 && !selectedConnectionId) {
    return (
      <ModalShell onClose={onClose} title="Pick a Google Drive connection">
        <ul className="space-y-2">
          {connections.map(c => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full text-left rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50"
                onClick={() => setSelectedConnectionId(c.id)}
              >
                <div className="font-medium">{c.label ?? 'Google Drive'}</div>
                {c.ownerEmail && <div className="text-sm text-slate-500">{c.ownerEmail}</div>}
              </button>
            </li>
          ))}
        </ul>
      </ModalShell>
    );
  }

  return <ModalShell onClose={onClose} title="Pick from Google Drive"><p className="text-sm text-slate-500">Opening picker...</p></ModalShell>;
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-slate-700">×</button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function loadPickerScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if (window.gapi && window.google?.picker) return resolve();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => {
      window.gapi.load('picker', { callback: () => resolve() });
    };
    document.body.appendChild(s);
  });
}

async function openPicker(
  connectionId: string,
  onPick: (file: DriveFile, connectionId: string) => void,
  onClose: () => void,
): Promise<void> {
  const { accessToken, pickerApiKey, appId } = await fetchPickerToken(connectionId);

  const view = new window.google.picker.DocsView()
    .setMimeTypes(SUPPORTED_MIME_TYPES.join(','))
    .setSelectFolderEnabled(false);

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .setAppId(appId)
    .setOAuthToken(accessToken)
    .setDeveloperKey(pickerApiKey)
    .setCallback((data: any) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const doc = data.docs?.[0];
        if (doc) {
          onPick({ id: doc.id, name: doc.name, mimeType: doc.mimeType, url: doc.url }, connectionId);
        }
        onClose();
      } else if (data.action === window.google.picker.Action.CANCEL) {
        onClose();
      }
    })
    .build();
  picker.setVisible(true);
}
