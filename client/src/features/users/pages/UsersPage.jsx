import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../auth/index.js';
import { apiFetch } from '../../../shared/lib/api.js';
import { StatusBadge } from '../../../shared/components/StatusBadge.jsx';
import { LoadingState } from '../../../shared/components/LoadingState.jsx';
import { EmptyState } from '../../../shared/components/EmptyState.jsx';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog.jsx';
import { CreateUserModal } from '../components/CreateUserModal.jsx';
import { EditUserModal } from '../components/EditUserModal.jsx';
import {
  IconSearch,
  IconPlus,
  IconCheckCircle,
  IconAlertTriangle,
  IconClose,
} from '../../../shared/components/Icons.jsx';
import './UsersPage.scss';

export function UsersPage() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(10);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [statusTargetUser, setStatusTargetUser] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      if (search.trim()) queryParams.set('search', search.trim());
      if (roleFilter !== 'all') queryParams.set('role', roleFilter);
      if (statusFilter !== 'all') queryParams.set('isActive', statusFilter);

      const data = await apiFetch(`/users?${queryParams.toString()}`);
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message || 'Failed to fetch user directory');
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const handleUserCreated = (newUser) => {
    setFeedback({ type: 'success', message: `Employee "${newUser.name}" created successfully.` });
    fetchUsers();
  };

  const handleUserUpdated = (updatedUser) => {
    setFeedback({ type: 'success', message: `Employee "${updatedUser.name}" updated successfully.` });
    fetchUsers();
  };

  const handleStatusConfirm = async () => {
    if (!statusTargetUser) return;
    setStatusLoading(true);
    const newStatus = !statusTargetUser.isActive;

    try {
      const data = await apiFetch(`/users/${statusTargetUser.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: newStatus }),
      });
      setFeedback({
        type: 'success',
        message: data.message || `Account status updated to ${newStatus ? 'Active' : 'Inactive'}.`,
      });
      setStatusTargetUser(null);
      fetchUsers();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to update account status.',
      });
      setStatusTargetUser(null);
    } finally {
      setStatusLoading(false);
    }
  };

  const hasActiveFilters = search || roleFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="users-view">
      {/* Page Header */}
      <header className="users-page-header">
        <div className="users-header-meta">
          <h1 className="users-page-title">User Management</h1>
          <p className="users-page-description">
            Manage employee access, role permissions, and active credential provisioning
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setIsCreateOpen(true)}
        >
          <IconPlus size={15} />
          <span>Add Employee</span>
        </button>
      </header>

      {/* Operational Feedback Toast/Banner */}
      {feedback.message && (
        <div
          className={`operational-banner operational-banner--${feedback.type}`}
          role="status"
        >
          <div className="banner-content">
            {feedback.type === 'success' ? (
              <IconCheckCircle size={16} className="banner-icon" />
            ) : (
              <IconAlertTriangle size={16} className="banner-icon" />
            )}
            <span className="banner-text">{feedback.message}</span>
          </div>
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setFeedback({ type: '', message: '' })}
            aria-label="Dismiss message"
          >
            <IconClose size={15} />
          </button>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="directory-toolbar">
        <form className="search-box" onSubmit={handleSearchSubmit}>
          <IconSearch size={15} className="search-icon" aria-hidden="true" />
          <input
            type="text"
            className="search-field"
            placeholder="Search by employee name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              aria-label="Clear search query"
            >
              <IconClose size={14} />
            </button>
          )}
          <button type="submit" className="btn btn--secondary btn--sm">
            Search
          </button>
        </form>

        <div className="filter-controls-group">
          <div className="select-wrapper">
            <label htmlFor="filter-role" className="select-label">
              Role
            </label>
            <select
              id="filter-role"
              className="toolbar-select"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Roles</option>
              <option value="admin">Administrator</option>
              <option value="sales_executive">Sales Executive</option>
            </select>
          </div>

          <div className="select-wrapper">
            <label htmlFor="filter-status" className="select-label">
              Status
            </label>
            <select
              id="filter-status"
              className="toolbar-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Statuses</option>
              <option value="true">Active Only</option>
              <option value="false">Inactive Only</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setSearch('');
                setRoleFilter('all');
                setStatusFilter('all');
                setPage(1);
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* User Directory Table Card */}
      <div className="directory-table-card">
        {loading ? (
          <LoadingState message="Fetching employee records..." />
        ) : error ? (
          <div className="directory-error-box" role="alert">
            <p>{error}</p>
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            title="No employee records match"
            description="Try modifying your search term or adjusting role/status filters."
            action={
              hasActiveFilters && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setSearch('');
                    setRoleFilter('all');
                    setStatusFilter('all');
                    setPage(1);
                  }}
                >
                  Clear Active Filters
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="table-responsive-container">
              <table className="directory-table">
                <thead>
                  <tr>
                    <th>Employee Details</th>
                    <th>Role</th>
                    <th>Account Status</th>
                    <th>Provisioned</th>
                    <th className="th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = currentUser && currentUser.id === u.id;
                    const initial = u.name ? u.name.charAt(0).toUpperCase() : 'U';

                    return (
                      <tr key={u.id} className={isSelf ? 'row-self' : ''}>
                        <td>
                          <div className="employee-cell">
                            <div className="employee-avatar" aria-hidden="true">
                              {initial}
                            </div>
                            <div className="employee-meta">
                              <div className="employee-name-line">
                                <span className="employee-name">{u.name}</span>
                                {isSelf && <span className="self-tag">(You)</span>}
                              </div>
                              <span className="employee-email">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <StatusBadge type="role" value={u.role} />
                        </td>
                        <td>
                          <StatusBadge type="status" value={u.isActive} />
                        </td>
                        <td className="cell-date">
                          {new Date(u.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="th-actions">
                          <div className="row-actions-group">
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm action-btn-edit"
                              onClick={() => setEditingUser(u)}
                              title="Edit employee details"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={`btn btn--sm ${u.isActive ? 'btn--danger' : 'btn--secondary'} action-btn-status`}
                              onClick={() => setStatusTargetUser(u)}
                              disabled={isSelf && u.isActive}
                              title={
                                isSelf
                                  ? 'You cannot deactivate your own administrative account'
                                  : u.isActive
                                  ? 'Deactivate employee account'
                                  : 'Reactivate employee account'
                              }
                            >
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="directory-pagination">
              <span className="pagination-summary">
                Showing <strong>{users.length}</strong> of <strong>{total}</strong> employees &bull; Page {page} of {totalPages}
              </span>
              <div className="pagination-nav-group">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={handleUserCreated}
      />

      {/* Edit User Modal */}
      <EditUserModal
        isOpen={Boolean(editingUser)}
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSuccess={handleUserUpdated}
      />

      {/* Status Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(statusTargetUser)}
        title={statusTargetUser?.isActive ? 'Deactivate Employee Account' : 'Reactivate Employee Account'}
        message={
          statusTargetUser?.isActive
            ? `Are you sure you want to deactivate ${statusTargetUser?.name}? They will immediately lose access to Doon Anandam CRM data and sessions.`
            : `Reactivate ${statusTargetUser?.name}'s account and restore their access to the Doon Anandam CRM workspace?`
        }
        confirmLabel={statusTargetUser?.isActive ? 'Deactivate Account' : 'Activate Account'}
        isDangerous={statusTargetUser?.isActive}
        isLoading={statusLoading}
        onConfirm={handleStatusConfirm}
        onCancel={() => setStatusTargetUser(null)}
      />
    </div>
  );
}
