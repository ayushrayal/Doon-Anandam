import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/index.js';
import { useRouter } from '../../../app/routing/RouterContext.jsx';
import { apiFetch } from '../../../shared/lib/api.js';
import { StatusBadge } from '../../../shared/components/StatusBadge.jsx';
import { LoadingState } from '../../../shared/components/LoadingState.jsx';
import { EmptyState } from '../../../shared/components/EmptyState.jsx';
import { IconUsers, IconArrowRight, IconShield, IconPlus } from '../../../shared/components/Icons.jsx';
import './DashboardPage.scss';

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const { navigate } = useRouter();

  const [stats, setStats] = useState(null);
  const [recentUsers, setRecentUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      setError('');
      try {
        if (isAdmin) {
          const [statsData, usersData] = await Promise.all([
            apiFetch('/users/stats'),
            apiFetch('/users?page=1&limit=5'),
          ]);
          setStats(statsData.stats);
          setRecentUsers(usersData.users || []);
        }
      } catch (err) {
        setError(err.message || 'Unable to load dashboard metrics');
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [isAdmin]);

  const userDisplayName = user?.name || 'Administrator';

  return (
    <div className="dashboard-view">
      {/* Executive Header Banner */}
      <header className="dashboard-header">
        <div className="header-meta-group">
          <div className="system-status-indicator">
            <span className="live-dot" aria-hidden="true" />
            <span className="live-label">Enterprise Operational System</span>
          </div>
          <h1 className="dashboard-title">Welcome back, {userDisplayName}</h1>
          <p className="dashboard-subtext">
            {isAdmin
              ? 'Executive control overview & organizational employee administration.'
              : 'Sales executive workspace & real estate lead portal.'}
          </p>
        </div>

        <div className="dashboard-header-actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => navigate('/leads')}
          >
            <span>Lead Pipeline</span>
            <IconArrowRight size={13} />
          </button>
          {isAdmin && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => navigate('/users')}
            >
              <span>Employee Directory</span>
              <IconArrowRight size={13} />
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <LoadingState message="Aggregating operational metrics..." />
      ) : error ? (
        <div className="dashboard-alert-box" role="alert">
          <p>{error}</p>
        </div>
      ) : (
        <>
          {/* Executive Stats Grid */}
          {isAdmin && stats && (
            <section className="metrics-section" aria-label="Organizational Metrics">
              <div className="metric-card">
                <div className="metric-card__header">
                  <span className="metric-card__label">Total Employees</span>
                </div>
                <div className="metric-card__body">
                  <span className="metric-card__value">{stats.total}</span>
                </div>
                <div className="metric-card__footer">
                  <span className="metric-card__hint">Provisioned accounts in CRM</span>
                </div>
              </div>

              <div className="metric-card metric-card--active">
                <div className="metric-card__header">
                  <span className="metric-card__label">Active Access</span>
                  <span className="metric-status-dot metric-status-dot--active" aria-hidden="true" />
                </div>
                <div className="metric-card__body">
                  <span className="metric-card__value">{stats.active}</span>
                </div>
                <div className="metric-card__footer">
                  <span className="metric-card__hint">Enabled &amp; authenticated</span>
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-card__header">
                  <span className="metric-card__label">Inactive Accounts</span>
                  <span className="metric-status-dot metric-status-dot--inactive" aria-hidden="true" />
                </div>
                <div className="metric-card__body">
                  <span className="metric-card__value">{stats.inactive}</span>
                </div>
                <div className="metric-card__footer">
                  <span className="metric-card__hint">Suspended or offboarded</span>
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-card__header">
                  <span className="metric-card__label">Sales Executives</span>
                </div>
                <div className="metric-card__body">
                  <span className="metric-card__value">{stats.salesExecutives}</span>
                </div>
                <div className="metric-card__footer">
                  <span className="metric-card__hint">Field &amp; client reps</span>
                </div>
              </div>
            </section>
          )}

          {/* Non-Admin Employee Portal Info */}
          {!isAdmin && (
            <div className="sales-overview-card">
              <div className="sales-overview-icon" aria-hidden="true">
                <IconShield size={24} />
              </div>
              <div className="sales-overview-content">
                <h3 className="sales-overview-title">Sales Representative Workspace</h3>
                <p className="sales-overview-text">
                  Your account is authorized with sales representative permissions. You have active access to your assigned lead pipeline, client contact details, and lifecycle stage updates.
                </p>
                <div style={{ marginTop: '0.875rem' }}>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => navigate('/leads')}
                  >
                    <span>Open Lead Pipeline</span>
                    <IconArrowRight size={13} />
                  </button>
                </div>
                <div className="sales-overview-meta" style={{ marginTop: '0.875rem' }}>
                  <span>Logged in as: <strong>{user?.email}</strong></span>
                  <span>Role: <strong>Sales Executive</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* Recent Users Provisioning Table */}
          {isAdmin && (
            <section className="dashboard-content-panel" aria-label="Recent Account Provisionings">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Recent Accounts</h2>
                  <p className="panel-subtitle">Latest employees provisioned in the enterprise directory</p>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => navigate('/users')}
                >
                  <span>Manage All</span>
                  <IconArrowRight size={13} />
                </button>
              </div>

              <div className="panel-table-wrap">
                {recentUsers.length === 0 ? (
                  <EmptyState
                    title="No accounts provisioned yet"
                    description="When employees are registered, their account metadata will appear here."
                  />
                ) : (
                  <table className="enterprise-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Provisioned Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentUsers.map((u) => {
                        const initial = u.name ? u.name.charAt(0).toUpperCase() : 'U';
                        return (
                          <tr key={u.id}>
                            <td>
                              <div className="employee-info-cell">
                                <div className="employee-avatar" aria-hidden="true">
                                  {initial}
                                </div>
                                <div className="employee-text">
                                  <span className="employee-name">{u.name}</span>
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
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
