import { useState } from 'react';
import api from '../../../lib/api';

interface CreateProjectModalProps {
  open: boolean;
  activeClientId: string;
  onClose(): void;
  onCreated(projectId: string): void;
}

export function CreateProjectModal({ open, activeClientId, onClose, onCreated }: CreateProjectModalProps) {
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#6366f1');
  const [newProjectRepoUrl, setNewProjectRepoUrl] = useState('');
  const [createProjectLoading, setCreateProjectLoading] = useState(false);

  if (!open || !activeClientId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">New Project</h2>
          <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!newProjectName.trim() || createProjectLoading) return;
          setCreateProjectLoading(true);
          try {
            const { data } = await api.post(`/api/subaccounts/${activeClientId}/projects`, { name: newProjectName.trim(), color: newProjectColor, repoUrl: newProjectRepoUrl.trim() || undefined });
            setNewProjectName('');
            setNewProjectColor('#6366f1');
            setNewProjectRepoUrl('');
            onCreated(data.id);
            onClose();
          } catch { /* ignore */ }
          finally { setCreateProjectLoading(false); }
        }} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
            <input autoFocus type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Colour</label>
            <div className="flex gap-2">
              {['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#0ea5e9','#eab308'].map(c => (
                <button key={c} type="button" onClick={() => setNewProjectColor(c)} className={`w-7 h-7 rounded-full border-2 cursor-pointer transition-all ${newProjectColor === c ? 'border-slate-900 scale-110' : 'border-transparent'}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">GitHub repo <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="url" value={newProjectRepoUrl} onChange={(e) => setNewProjectRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!newProjectName.trim() || createProjectLoading} className="btn btn-primary">{createProjectLoading ? 'Creating...' : 'Create Project'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
