import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import { User } from '../lib/auth';
import UserPicker from '../components/UserPicker';

interface TeamRow {
  id: string;
  name: string;
  organisationId: string;
  subaccountId: string | null;
  memberCount: number;
  createdAt: string;
}

interface TeamMemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export default function TeamsAdminPage({ user }: { user: User }) {
  const orgId = user.organisationId;

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSubaccountId, setCreateSubaccountId] = useState('');
  const [creating, setCreating] = useState(false);

  const [editTeam, setEditTeam] = useState<TeamRow | null>(null);
  const [editName, setEditName] = useState('');

  const [deleteTeamId, setDeleteTeamId] = useState<string | null>(null);

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberRow[]>>({});
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [addMemberSelectedIds, setAddMemberSelectedIds] = useState<string[]>([]);
  const [orgUsers, setOrgUsers] = useState<TeamMemberRow[]>([]);
  const [orgUsersLoaded, setOrgUsersLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ teams: TeamRow[] }>(`/api/orgs/${orgId}/teams`);
      setTeams(data.teams);
    } catch {
      toast.error('Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const loadOrgUsers = async () => {
    if (orgUsersLoaded) return;
    try {
      const { data } = await api.get<TeamMemberRow[]>('/api/users');
      setOrgUsers(data);
      setOrgUsersLoaded(true);
    } catch {
      toast.error('Failed to load users');
    }
  };

  const loadTeamMembers = async (teamId: string) => {
    try {
      const { data } = await api.get<{ members: TeamMemberRow[] }>(`/api/orgs/${orgId}/teams/${teamId}/members`);
      setTeamMembers(prev => ({ ...prev, [teamId]: data.members }));
    } catch {
      setTeamMembers(prev => ({ ...prev, [teamId]: [] }));
    }
  };

  const toggleExpand = async (teamId: string) => {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
      return;
    }
    setExpandedTeamId(teamId);
    if (!teamMembers[teamId]) {
      await loadTeamMembers(teamId);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await api.post(`/api/orgs/${orgId}/teams`, {
        name: createName.trim(),
        subaccountId: createSubaccountId.trim() || undefined,
      });
      setCreateName('');
      setCreateSubaccountId('');
      setShowCreate(false);
      toast.success('Team created');
      await load();
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } })?.response?.status;
      if (status === 409) {
        toast.error('A team with that name already exists');
      } else {
        toast.error('Failed to create team');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editTeam || !editName.trim()) return;
    try {
      await api.patch(`/api/orgs/${orgId}/teams/${editTeam.id}`, { name: editName.trim() });
      setEditTeam(null);
      toast.success('Team updated');
      await load();
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } })?.response?.status;
      if (status === 409) {
        toast.error('A team with that name already exists');
      } else {
        toast.error('Failed to update team');
      }
    }
  };

  const handleDelete = async (teamId: string) => {
    try {
      await api.delete(`/api/orgs/${orgId}/teams/${teamId}`);
      setDeleteTeamId(null);
      if (expandedTeamId === teamId) setExpandedTeamId(null);
      toast.success('Team deleted');
      await load();
    } catch {
      toast.error('Failed to delete team');
    }
  };

  const handleAddMembers = async (teamId: string) => {
    if (addMemberSelectedIds.length === 0) return;
    try {
      await api.post(`/api/orgs/${orgId}/teams/${teamId}/members`, { userIds: addMemberSelectedIds });
      setAddMemberTeamId(null);
      setAddMemberSelectedIds([]);
      toast.success('Members added');
      await loadTeamMembers(teamId);
      await load();
    } catch {
      toast.error('Failed to add members');
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    try {
      await api.delete(`/api/orgs/${orgId}/teams/${teamId}/members/${userId}`);
      toast.success('Member removed');
      await loadTeamMembers(teamId);
      await load();
    } catch {
      toast.error('Failed to remove member');
    }
  };

  const userPickerUsers = orgUsers.map(u => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
    role: u.role,
  }));

  if (loading) {
    return (
      <div className="p-8 text-sm text-slate-500">Loading teams...</div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Teams</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
        >
          New team
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Create team</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Team name"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subaccount ID (optional)</label>
              <input
                type="text"
                value={createSubaccountId}
                onChange={e => setCreateSubaccountId(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Leave blank for org-wide team"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={creating || !createName.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => { setShowCreate(false); setCreateName(''); setCreateSubaccountId(''); }}
                className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="text-sm text-slate-400 py-8 text-center">No teams yet. Create one above.</div>
      ) : (
        <div className="space-y-2">
          {teams.map(team => (
            <div key={team.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => toggleExpand(team.id)}
                    className="text-slate-400 hover:text-slate-600 text-xs"
                    aria-label={expandedTeamId === team.id ? 'Collapse' : 'Expand'}
                  >
                    {expandedTeamId === team.id ? '▼' : '▶'}
                  </button>
                  {editTeam?.id === team.id ? (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="border border-slate-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') handleEdit(); if (e.key === 'Escape') setEditTeam(null); }}
                      />
                      <button onClick={handleEdit} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Save</button>
                      <button onClick={() => setEditTeam(null)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-900">{team.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{team.memberCount} member{team.memberCount !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
                {editTeam?.id !== team.id && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => { setEditTeam(team); setEditName(team.name); }}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTeamId(team.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {expandedTeamId === team.id && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-600">Members</span>
                    <button
                      onClick={async () => {
                        await loadOrgUsers();
                        setAddMemberTeamId(team.id);
                        setAddMemberSelectedIds([]);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      + Add members
                    </button>
                  </div>

                  {addMemberTeamId === team.id && (
                    <div className="mb-3 bg-slate-50 rounded-md p-3">
                      <UserPicker
                        users={userPickerUsers}
                        selected={addMemberSelectedIds}
                        onChange={setAddMemberSelectedIds}
                        placeholder="Search users to add..."
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleAddMembers(team.id)}
                          disabled={addMemberSelectedIds.length === 0}
                          className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Add {addMemberSelectedIds.length > 0 ? `(${addMemberSelectedIds.length})` : ''}
                        </button>
                        <button
                          onClick={() => { setAddMemberTeamId(null); setAddMemberSelectedIds([]); }}
                          className="px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-md hover:bg-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {(teamMembers[team.id] ?? []).length === 0 ? (
                    <div className="text-xs text-slate-400 py-2">No members yet.</div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {(teamMembers[team.id] ?? []).map(member => (
                        <li key={member.id} className="flex items-center justify-between py-2">
                          <div>
                            <span className="text-sm text-slate-800">{member.firstName} {member.lastName}</span>
                            <span className="ml-2 text-xs text-slate-400">{member.email}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(team.id, member.id)}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTeamId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Delete team</h3>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to delete this team? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteTeamId)}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteTeamId(null)}
                className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
