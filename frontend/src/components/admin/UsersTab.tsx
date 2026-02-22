import React, { useState, useEffect, useCallback } from 'react';
import { adminApi, AdminUser, UserTier } from '../../services/api';
import { TierBadge } from './TierBadge';
import { ConfirmModal } from './ConfirmModal';

interface UsersTabProps {
  authToken: string;
  currentUserId: string;
}

/**
 * Admin users tab with search, filtering, tier management, banning, and impersonation.
 */
export function UsersTab({ authToken, currentUserId }: UsersTabProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<UserTier | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [tierModal, setTierModal] = useState<{ user: AdminUser; tier: UserTier } | null>(null);
  const [banModal, setBanModal] = useState<AdminUser | null>(null);
  const [banReason, setBanReason] = useState('');

  const limit = 20;

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await adminApi.getUsers(authToken, {
        page,
        limit,
        search: search || undefined,
        tier: tierFilter || undefined,
      });
      setUsers(result.users);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, page, search, tierFilter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleTierChange = async () => {
    if (!tierModal) return;
    try {
      await adminApi.updateUserTier(authToken, tierModal.user.id, tierModal.tier);
      setTierModal(null);
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update tier');
    }
  };

  const handleBan = async () => {
    if (!banModal) return;
    try {
      if (banModal.isBanned) {
        await adminApi.unbanUser(authToken, banModal.id);
      } else {
        await adminApi.banUser(authToken, banModal.id, banReason || undefined);
      }
      setBanModal(null);
      setBanReason('');
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update ban status');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="Search by email, wallet, or ID..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-[200px] px-4 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-500 focus:outline-none focus:border-amber-500"
        />
        <select
          value={tierFilter}
          onChange={(e) => { setTierFilter(e.target.value as UserTier | ''); setPage(1); }}
          className="px-4 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white focus:outline-none focus:border-amber-500"
        >
          <option value="">All Tiers</option>
          <option value="free">Free</option>
          <option value="paid">Pro</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-20 text-red-400">{error}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-stone-400 text-sm border-b border-stone-700">
                  <th className="pb-3 font-medium">User</th>
                  <th className="pb-3 font-medium">Tier</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Configs</th>
                  <th className="pb-3 font-medium">Joined</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-stone-800/50">
                    <td className="py-3">
                      <div>
                        <p className="text-white font-medium">{user.email || '(no email)'}</p>
                        {user.walletAddress && (
                          <p className="text-stone-500 text-xs mt-0.5">
                            {user.walletAddress.slice(0, 8)}...{user.walletAddress.slice(-4)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <TierBadge tier={user.tier} />
                    </td>
                    <td className="py-3">
                      {user.isBanned ? (
                        <span className="px-2 py-0.5 text-xs rounded bg-red-900/50 text-red-400">
                          Banned
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded bg-green-900/50 text-green-400">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-stone-400">{user.configCount ?? 0}</td>
                    <td className="py-3 text-stone-400 text-sm">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        {user.id !== currentUserId && (
                          <>
                            <select
                              value={user.tier}
                              onChange={(e) => setTierModal({ user, tier: e.target.value as UserTier })}
                              className="px-2 py-1 bg-stone-700 border border-stone-600 rounded text-sm text-white"
                            >
                              <option value="free">Free</option>
                              <option value="paid">Pro</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button
                              onClick={() => setBanModal(user)}
                              className={`px-3 py-1 text-sm rounded ${
                                user.isBanned
                                  ? 'bg-green-900/50 text-green-400 hover:bg-green-900/70'
                                  : 'bg-red-900/50 text-red-400 hover:bg-red-900/70'
                              }`}
                            >
                              {user.isBanned ? 'Unban' : 'Ban'}
                            </button>
                            {user.tier !== 'admin' && (
                              <button
                                onClick={async () => {
                                  try {
                                    const result = await adminApi.impersonateUser(authToken, user.id);
                                    // Store impersonation token
                                    sessionStorage.setItem('impersonationToken', result.token);
                                    sessionStorage.setItem('impersonationUser', JSON.stringify(user));
                                    // Navigate to dashboard as impersonated user
                                    alert(`Impersonation token created. Feature fully implemented in a future update.`);
                                  } catch (err) {
                                    alert(err instanceof Error ? err.message : 'Failed to impersonate');
                                  }
                                }}
                                className="px-3 py-1 text-sm rounded bg-blue-900/50 text-blue-400 hover:bg-blue-900/70"
                                title="View as this user"
                              >
                                Impersonate
                              </button>
                            )}
                          </>
                        )}
                        {user.id === currentUserId && (
                          <span className="text-stone-500 text-sm">(You)</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-stone-400 text-sm">
                Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tier change modal */}
      <ConfirmModal
        isOpen={!!tierModal}
        title="Change User Tier"
        message={tierModal ? `Are you sure you want to change ${tierModal.user.email || 'this user'}'s tier to ${tierModal.tier === 'admin' ? 'Admin' : tierModal.tier === 'paid' ? 'Pro' : 'Free'}?` : ''}
        confirmText={tierModal?.tier === 'admin' ? 'Make Admin' : 'Change Tier'}
        confirmColor={tierModal?.tier === 'admin' ? 'purple' : 'amber'}
        onConfirm={handleTierChange}
        onCancel={() => setTierModal(null)}
      >
        {tierModal?.tier === 'admin' && (
          <div className="bg-purple-900/30 border border-purple-800/50 rounded-lg p-3 text-sm text-purple-300">
            Warning: This will give the user full admin access, including the ability to manage other users.
          </div>
        )}
      </ConfirmModal>

      {/* Ban modal */}
      <ConfirmModal
        isOpen={!!banModal}
        title={banModal?.isBanned ? 'Unban User' : 'Ban User'}
        message={banModal?.isBanned 
          ? `Are you sure you want to unban ${banModal?.email || 'this user'}?`
          : `Are you sure you want to ban ${banModal?.email || 'this user'}?`
        }
        confirmText={banModal?.isBanned ? 'Unban' : 'Ban User'}
        confirmColor={banModal?.isBanned ? 'green' : 'red'}
        onConfirm={handleBan}
        onCancel={() => { setBanModal(null); setBanReason(''); }}
      >
        {!banModal?.isBanned && (
          <div className="mt-4">
            <label className="block text-sm text-stone-400 mb-2">Reason (optional)</label>
            <input
              type="text"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Enter reason for ban..."
              className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-500"
            />
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
