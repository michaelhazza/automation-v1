/**
 * TeamsAdminPage.tsx
 *
 * Org Settings — Teams tab.
 * Lists teams, provides create / edit / delete CRUD, and member management.
 *
 * Spec: §16.2 #31
 */

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import { getActiveOrgId } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import UserPicker from '../components/UserPicker';
import type { AssignableUser } from '../../../shared/types/assignableUsers.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
  organisationId: string;
  subaccountId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

interface TeamMemberRow {
  teamId: string;
  userId: string;
  organisationId: string;
  addedAt: string;
  // joined from users
  firstName?: string;
  lastName?: string;
  email?: string;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

interface Props {
  embedded?: boolean;
}

export default function TeamsAdminPage({ embedded = false }: Props) {
  const orgId = getActiveOrgId();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  // Create / edit
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');

  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');

  // Delete
  const [deleteTeamId, setDeleteTeamId] = useState<string | null>(null);

  // Members panel
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, TeamMemberRow[]>>({});
  const [orgUsers, setOrgUsers] = useState<AssignableUser[]>([]);
  const [pickerValue, setPickerValue] = useState<AssignableUser[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // Load teams
  const loadTeams = async () => {
    if (!orgId) return;
    try {
      const { data } = await api.get(`/api/orgs/${orgId}/teams`);
      if (mountedRef.current) setTeams(data);
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTeams(); }, [orgId]);

  // Load org users for the member picker (use assignable-users endpoint).
  // Requires a subaccountId — org-level teams must select a subaccount first.
  const loadOrgUsers = async (subaccountId: string) => {
    if (!orgId) return;
    try {
      const { data } = await api.get(
        `/api/orgs/${orgId}/subaccounts/${subaccountId}/assignable-users?intent=pick_approver`
      );
      if (mountedRef.current) setOrgUsers(data.users ?? []);
    } catch {
      // silent
    }
  };

  // Load members for a team
  const loadMembers = async (teamId: string) => {
    if (!orgId) return;
    try {
      // Members are returned via team list — for now use the basic list and
      // fetch user details from org users list
      const { data } = await api.get(`/api/orgs/${orgId}/teams/${teamId}/members`);
      if (mountedRef.current) {
        setMembers((prev) => ({ ...prev, [teamId]: data }));
      }
    } catch {
      // Members endpoint may not exist yet; ignore
      if (mountedRef.current) {
        setMembers((prev) => ({ ...prev, [teamId]: [] }));
      }
    }
  };

  const handleExpand = async (teamId: string) => {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
      return;
    }
    setExpandedTeamId(teamId);
    setPickerValue([]);
    const team = teams.find((t) => t.id === teamId);
    if (team?.subaccountId) {
      await Promise.all([loadMembers(teamId), loadOrgUsers(team.subaccountId)]);
    } else {
      await loadMembers(teamId);
      setOrgUsers([]);
    }
  };

  // Create team
  const handleCreate = async () => {
    setCreateError('');
    if (!orgId || !createName.trim()) {
      setCreateError('Name is required');
      return;
    }
    try {
      await api.post(`/api/orgs/${orgId}/teams`, { name: createName.trim() });
      toast.success('Team created');
      setShowCreate(false);
      setCreateName('');
      loadTeams();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setCreateError(e.response?.data?.error ?? 'Failed to create team');
    }
  };

  // Edit team
  const handleEdit = async () => {
    setEditError('');
    if (!orgId || !editTeam || !editName.trim()) {
      setEditError('Name is required');
      return;
    }
    try {
      await api.patch(`/api/orgs/${orgId}/teams/${editTeam.id}`, { name: editName.trim() });
      toast.success('Team updated');
      setEditTeam(null);
      loadTeams();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setEditError(e.response?.data?.error ?? 'Failed to update team');
    }
  };

  // Delete team
  const handleDelete = async (teamId: string) => {
    if (!orgId) return;
    try {
      await api.delete(`/api/orgs/${orgId}/teams/${teamId}`);
      toast.success('Team deleted');
      setDeleteTeamId(null);
      if (expandedTeamId === teamId) setExpandedTeamId(null);
      loadTeams();
    } catch {
      toast.error('Failed to delete team');
    }
  };

  // Add members
  const handleAddMembers = async (teamId: string) => {
    if (!orgId || pickerValue.length === 0) return;
    setAddingMembers(true);
    try {
      await api.post(`/api/orgs/${orgId}/teams/${teamId}/members`, {
        userIds: pickerValue.map((u) => u.id),
      });
      toast.success(`${pickerValue.length} member(s) added`);
      setPickerValue([]);
      loadMembers(teamId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to add members');
    } finally {
      setAddingMembers(false);
    }
  };

  // Remove member
  const handleRemoveMember = async (teamId: string, userId: string) => {
    if (!orgId) return;
    try {
      await api.delete(`/api/orgs/${orgId}/teams/${teamId}/members/${userId}`);
      setMembers((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).filter((m) => m.userId !== userId),
      }));
    } catch {
      toast.error('Failed to remove member');
    }
  };

  if (!orgId) return null;

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const btnCls = 'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors';

  const content = (
    <div>
      <div className="flex items-center justify-between mb-4">
        {!embedded && (
          <h2 className="text-[20px] font-bold text-slate-900">Teams</h2>
        )}
        <button
          className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 ml-auto`}
          onClick={() => { setShowCreate(true); setCreateName(''); setCreateError(''); }}
        >
          New Team
        </button>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading...</p>
      ) : teams.length === 0 ? (
        <p className="text-[13px] text-slate-400">No teams yet. Create the first one.</p>
      ) : (
        <div className="space-y-2">
          {teams.map((team) => {
            const isExpanded = expandedTeamId === team.id;
            const teamMembers = members[team.id] ?? [];

            return (
              <div key={team.id} className="border border-slate-200 rounded-lg overflow-hidden">
                {/* Row */}
                <div className="flex items-center justify-between px-4 py-3 bg-white">
                  <button
                    className="text-[14px] font-medium text-slate-800 hover:text-indigo-600 text-left"
                    onClick={() => handleExpand(team.id)}
                  >
                    {team.name}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      className={`${btnCls} text-slate-600 hover:bg-slate-100`}
                      onClick={() => { setEditTeam(team); setEditName(team.name); setEditError(''); }}
                    >
                      Edit
                    </button>
                    <button
                      className={`${btnCls} text-red-600 hover:bg-red-50`}
                      onClick={() => setDeleteTeamId(team.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Members panel */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Members</p>

                    {!team.subaccountId ? (
                      <p className="text-[12px] text-slate-400 mb-3">
                        Select a subaccount to manage members.
                      </p>
                    ) : (
                      <>
                        {teamMembers.length === 0 ? (
                          <p className="text-[12px] text-slate-400 mb-3">No members yet.</p>
                        ) : (
                          <ul className="space-y-1 mb-3">
                            {teamMembers.map((m) => (
                              <li key={m.userId} className="flex items-center justify-between">
                                <span className="text-[13px] text-slate-700">
                                  {m.firstName && m.lastName
                                    ? `${m.firstName} ${m.lastName}`
                                    : m.email ?? m.userId}
                                </span>
                                <button
                                  className="text-[12px] text-red-500 hover:text-red-700"
                                  onClick={() => handleRemoveMember(team.id, m.userId)}
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <UserPicker
                              users={orgUsers}
                              value={pickerValue}
                              onChange={setPickerValue}
                              multiple
                              placeholder="Add members..."
                            />
                          </div>
                          <button
                            className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 shrink-0`}
                            disabled={pickerValue.length === 0 || addingMembers}
                            onClick={() => handleAddMembers(team.id)}
                          >
                            Add
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Team" onClose={() => setShowCreate(false)}>
          <div className="space-y-4 p-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Team name</label>
              <input
                className={inputCls}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Sales Team"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                autoFocus
              />
              {createError && <p className="text-[12px] text-red-500 mt-1">{createError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={() => setShowCreate(false)}>Cancel</button>
              <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} onClick={handleCreate}>Create</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editTeam && (
        <Modal title="Edit Team" onClose={() => setEditTeam(null)}>
          <div className="space-y-4 p-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Team name</label>
              <input
                className={inputCls}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEdit(); }}
                autoFocus
              />
              {editError && <p className="text-[12px] text-red-500 mt-1">{editError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={() => setEditTeam(null)}>Cancel</button>
              <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} onClick={handleEdit}>Save</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteTeamId && (
        <ConfirmDialog
          title="Delete team"
          message="This will permanently delete the team and remove all members. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(deleteTeamId)}
          onCancel={() => setDeleteTeamId(null)}
        />
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] p-6 max-w-3xl">
      {content}
    </div>
  );
}
