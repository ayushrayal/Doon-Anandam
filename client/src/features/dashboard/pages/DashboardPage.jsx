import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../auth/index.js';
import { useRouter } from '../../../app/routing/RouterContext.jsx';
import { apiFetch } from '../../../shared/lib/api.js';
import { StatusBadge } from '../../../shared/components/StatusBadge.jsx';
import { LoadingState } from '../../../shared/components/LoadingState.jsx';
import { EmptyState } from '../../../shared/components/EmptyState.jsx';
import { formatSourceLabel } from '../../../shared/lib/formatters.js';
import {
  IconArrowRight,
  IconClock,
  IconAlertTriangle,
  IconCheckCircle,
  IconUsers,
  IconRefresh,
  IconFilter,
  IconCalendar,
  IconTrendingUp,
  IconPhone,
  IconMail,
  IconMessageCircle,
  IconFileText,
  IconInfo,
} from '../../../shared/components/Icons.jsx';
import './DashboardPage.scss';

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const { navigate } = useRouter();

  // Filter State
  const [preset, setPreset] = useState('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('all');
  const [activeUsers, setActiveUsers] = useState([]);

  // Data & UI State
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSemantics, setShowSemantics] = useState(false);

  // Prevent race conditions
  const activeFetchIdRef = useRef(0);

  // Fetch active users for admin executive dropdown
  useEffect(() => {
    let isMounted = true;
    if (isAdmin) {
      apiFetch('/users?isActive=true&limit=50')
        .then((res) => {
          if (isMounted) setActiveUsers(res.users || []);
        })
        .catch(() => {
          if (isMounted) setActiveUsers([]);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [isAdmin]);

  // Load analytics data
  const loadAnalytics = useCallback(async () => {
    const fetchId = ++activeFetchIdRef.current;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ preset });
      if (preset === 'custom') {
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
      }
      if (isAdmin && assignedTo !== 'all') {
        params.set('assignedTo', assignedTo);
      }

      const res = await apiFetch(`/analytics/dashboard?${params.toString()}`);
      if (activeFetchIdRef.current === fetchId) {
        setData(res);
      }
    } catch (err) {
      if (activeFetchIdRef.current === fetchId) {
        setError(err.message || 'Failed to load analytics dashboard data.');
      }
    } finally {
      if (activeFetchIdRef.current === fetchId) {
        setLoading(false);
      }
    }
  }, [preset, startDate, endDate, assignedTo, isAdmin]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Helper drill-down navigation
  const drillDownToLeads = (filterQuery) => {
    navigate(`/leads?${filterQuery}`);
  };

  const handleWorkloadDrillDown = (followUpStatus) => {
    const params = new URLSearchParams({ followUpStatus });
    if (followUpStatus === 'completed') {
      params.set('dateFilter', preset);
      if (preset === 'custom') {
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
      }
    }
    if (isAdmin && assignedTo && assignedTo !== 'all') {
      params.set('assignedTo', assignedTo);
    }
    drillDownToLeads(params.toString());
  };

  const cohort = data?.cohort || {
    total: 0,
    statusCounts: { new: 0, contacted: 0, follow_up: 0, qualified: 0, converted: 0, lost: 0 },
    conversionRate: 0.0,
    sources: [],
    trend: [],
  };

  const workload = data?.followUpWorkload || {
    overdue: 0,
    dueToday: 0,
    upcoming: 0,
    none: 0,
  };

  const allTimePipeline = data?.allTimePipeline || {
    total: 0,
    activeTotal: 0,
    statusCounts: {},
    unassigned: 0,
  };

  const historicalActivity = data?.historicalActivity || {
    conversionsInPeriod: 0,
    followUpsCompletedInPeriod: 0,
    uniqueLeadsCompletedInPeriod: 0,
  };

  const funnel = data?.pipelineFunnel || [];
  const executives = data?.executiveBreakdown || [];
  const activities = data?.recentActivities || [];
  const semantics = data?.filterSemantics || null;

  return (
    <div className="dashboard-view">
      {/* Top Executive Header */}
      <header className="dashboard-header">
        <div className="header-meta-group">
          <div className="system-status-indicator">
            <span className="live-dot" aria-hidden="true" />
            <span className="live-label">Enterprise Real Estate Intelligence</span>
          </div>
          <h1 className="dashboard-title">Doon Anandam CRM Analytics</h1>
          <p className="dashboard-subtext">
            {isAdmin
              ? 'Real-time sales velocity, lead lifecycle tracking, executive workload, and conversion performance.'
              : `Sales Executive workspace for ${user?.name || 'Representative'} — assigned pipeline and operational follow-ups.`}
          </p>
        </div>

        <div className="dashboard-header-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setShowSemantics(!showSemantics)}
            title="View metric definitions and date filter semantics"
          >
            <IconInfo size={14} />
            <span>KPI Definitions</span>
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => navigate('/leads')}
          >
            <span>Lead Pipeline</span>
            <IconArrowRight size={13} />
          </button>
        </div>
      </header>

      {/* KPI Semantics Banner (Transparent Explanations) */}
      {showSemantics && semantics && (
        <section className="analytics-semantics-card" role="region" aria-label="KPI Semantics">
          <div className="semantics-header">
            <div className="semantics-title">
              <IconInfo size={16} />
              <h3>Transparent KPI & Date Filter Semantics</h3>
            </div>
            <button
              type="button"
              className="semantics-close-btn"
              onClick={() => setShowSemantics(false)}
              aria-label="Dismiss definitions"
            >
              &times;
            </button>
          </div>
          <div className="semantics-grid">
            <div className="semantic-item">
              <span className="semantic-label">Cohort Window:</span>
              <p className="semantic-desc">
                <strong>{semantics.dateRangeLabel}</strong>: {semantics.cohortDefinition}
              </p>
            </div>
            <div className="semantic-item">
              <span className="semantic-label">Current Stage Distribution:</span>
              <p className="semantic-desc">{semantics.stageDistributionDefinition}</p>
            </div>
            <div className="semantic-item">
              <span className="semantic-label">Historical Conversions in Period:</span>
              <p className="semantic-desc">{semantics.conversionsInPeriodDefinition}</p>
            </div>
            <div className="semantic-item">
              <span className="semantic-label">Operational Follow-up Workload:</span>
              <p className="semantic-desc">{semantics.followUpWorkloadDefinition}</p>
            </div>
          </div>
        </section>
      )}

      {/* Analytics Toolbar */}
      <section className="analytics-toolbar" aria-label="Analytics Filters">
        <div className="preset-button-group" role="group" aria-label="Date Range Presets">
          {[
            { id: 'today', label: 'Today' },
            { id: '7d', label: 'Last 7 Days' },
            { id: '30d', label: 'Last 30 Days' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom Range' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`preset-btn ${preset === item.id ? 'preset-btn--active' : ''}`}
              onClick={() => setPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers */}
        {preset === 'custom' && (
          <div className="custom-date-controls">
            <div className="date-input-wrap">
              <label htmlFor="custom-start-date" className="date-label">
                Start:
              </label>
              <input
                id="custom-start-date"
                type="date"
                className="date-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="date-input-wrap">
              <label htmlFor="custom-end-date" className="date-label">
                End:
              </label>
              <input
                id="custom-end-date"
                type="date"
                className="date-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Admin Executive Selector */}
        {isAdmin && (
          <div className="executive-filter-wrap">
            <label htmlFor="executive-filter" className="sr-only">
              Filter by Sales Representative
            </label>
            <select
              id="executive-filter"
              className="executive-select"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="all">All Sales Representatives</option>
              <option value="unassigned">Unassigned Leads Only</option>
              {activeUsers.map((u) => (
                <option key={u.id || u._id} value={u.id || u._id}>
                  {u.name} ({u.role === 'admin' ? 'Admin' : 'Sales'})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Refresh Button */}
        <button
          type="button"
          className="refresh-btn"
          onClick={loadAnalytics}
          disabled={loading}
          aria-label="Refresh dashboard data"
        >
          <IconRefresh size={14} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </section>

      {/* Main Analytics Content */}
      {loading && !data ? (
        <LoadingState message="Aggregating pipeline metrics and operational workloads..." />
      ) : error ? (
        <div className="analytics-error-box" role="alert">
          <IconAlertTriangle size={20} />
          <p>{error}</p>
          <button type="button" className="retry-btn" onClick={loadAnalytics}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Operational Follow-up Workload Strip */}
          <section className="workload-section" aria-label="Operational Follow-up Tasks">
            <div className="workload-header">
              <div className="workload-title">
                <IconClock size={16} />
                <h2>Follow-Up Workload (Operational Deadlines)</h2>
              </div>
              <span className="workload-note">Click any card to inspect corresponding leads</span>
            </div>

            <div className="workload-grid">
              <div
                className="workload-tile workload-tile--due-today clickable"
                onClick={() => handleWorkloadDrillDown('today')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleWorkloadDrillDown('today')}
              >
                <div className="workload-tile__badge">DUE TODAY</div>
                <div className="workload-tile__value">{workload.dueToday}</div>
                <div className="workload-tile__desc">Scheduled for action today</div>
              </div>

              <div
                className="workload-tile workload-tile--overdue clickable"
                onClick={() => handleWorkloadDrillDown('overdue')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleWorkloadDrillDown('overdue')}
              >
                <div className="workload-tile__badge">OVERDUE</div>
                <div className="workload-tile__value">{workload.overdue}</div>
                <div className="workload-tile__desc">Passed scheduled deadline</div>
              </div>

              <div
                className="workload-tile workload-tile--upcoming clickable"
                onClick={() => handleWorkloadDrillDown('upcoming')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleWorkloadDrillDown('upcoming')}
              >
                <div className="workload-tile__badge">UPCOMING</div>
                <div className="workload-tile__value">{workload.upcoming}</div>
                <div className="workload-tile__desc">Future follow-up dates</div>
              </div>

              <div
                className="workload-tile workload-tile--completed clickable"
                onClick={() => handleWorkloadDrillDown('completed')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleWorkloadDrillDown('completed')}
              >
                <div className="workload-tile__badge">COMPLETED IN PERIOD</div>
                <div className="workload-tile__value">
                  {historicalActivity.uniqueLeadsCompletedInPeriod ?? historicalActivity.followUpsCompletedInPeriod}
                </div>
                <div className="workload-tile__desc">
                  {historicalActivity.followUpsCompletedInPeriod &&
                  historicalActivity.uniqueLeadsCompletedInPeriod &&
                  historicalActivity.followUpsCompletedInPeriod > historicalActivity.uniqueLeadsCompletedInPeriod
                    ? `${historicalActivity.uniqueLeadsCompletedInPeriod} leads (${historicalActivity.followUpsCompletedInPeriod} actions)`
                    : 'Follow-ups finalized during timeframe'}
                </div>
              </div>
            </div>
          </section>

          {/* Primary Cohort KPI Grid */}
          <section className="kpi-section" aria-label="Pipeline Stage Metrics">
            <div className="kpi-header">
              <h2>Cohort Ingestion & Stage Distribution ({semantics?.dateRangeLabel || 'Selected Period'})</h2>
              <span className="kpi-subtitle">
                Leads born in this window ({cohort.total} total). Click to drill down.
              </span>
            </div>

            <div className="kpi-grid">
              {/* Total Cohort Ingestion */}
              <div
                className="kpi-card kpi-card--total clickable"
                onClick={() => drillDownToLeads(`dateFilter=${preset}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && drillDownToLeads(`dateFilter=${preset}`)}
              >
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Total Ingestion</span>
                  <span className="kpi-card__badge">COHORT</span>
                </div>
                <div className="kpi-card__val">{cohort.total}</div>
                <div className="kpi-card__bottom">
                  <span>All-time account total: <strong>{allTimePipeline.total}</strong></span>
                </div>
              </div>

              {/* Contacted */}
              <div
                className="kpi-card kpi-card--contacted clickable"
                onClick={() => drillDownToLeads('status=contacted')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && drillDownToLeads('status=contacted')}
              >
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Contacted</span>
                  <span className="kpi-card__pct">
                    {cohort.total > 0
                      ? `${((cohort.statusCounts.contacted / cohort.total) * 100).toFixed(0)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="kpi-card__val">{cohort.statusCounts.contacted}</div>
                <div className="kpi-card__bottom">
                  <span>Initial outreach completed</span>
                </div>
              </div>

              {/* Follow Up */}
              <div
                className="kpi-card kpi-card--followup clickable"
                onClick={() => drillDownToLeads('status=follow_up')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && drillDownToLeads('status=follow_up')}
              >
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Follow Up Stage</span>
                  <span className="kpi-card__pct">
                    {cohort.total > 0
                      ? `${((cohort.statusCounts.follow_up / cohort.total) * 100).toFixed(0)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="kpi-card__val">{cohort.statusCounts.follow_up}</div>
                <div className="kpi-card__bottom">
                  <span>Active pipeline nurture</span>
                </div>
              </div>

              {/* Qualified */}
              <div
                className="kpi-card kpi-card--qualified clickable"
                onClick={() => drillDownToLeads('status=qualified')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && drillDownToLeads('status=qualified')}
              >
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Qualified</span>
                  <span className="kpi-card__pct">
                    {cohort.total > 0
                      ? `${((cohort.statusCounts.qualified / cohort.total) * 100).toFixed(0)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="kpi-card__val">{cohort.statusCounts.qualified}</div>
                <div className="kpi-card__bottom">
                  <span>Budget & requirements verified</span>
                </div>
              </div>

              {/* Converted */}
              <div
                className="kpi-card kpi-card--converted clickable"
                onClick={() => drillDownToLeads('status=converted')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && drillDownToLeads('status=converted')}
              >
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Converted</span>
                  <span className="kpi-card__pct">
                    {cohort.total > 0
                      ? `${((cohort.statusCounts.converted / cohort.total) * 100).toFixed(0)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="kpi-card__val">{cohort.statusCounts.converted}</div>
                <div className="kpi-card__bottom">
                  <span>Period transitions: <strong>{historicalActivity.conversionsInPeriod}</strong></span>
                </div>
              </div>

              {/* Lost */}
              <div
                className="kpi-card kpi-card--lost clickable"
                onClick={() => drillDownToLeads('status=lost')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && drillDownToLeads('status=lost')}
              >
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Lost</span>
                  <span className="kpi-card__pct">
                    {cohort.total > 0
                      ? `${((cohort.statusCounts.lost / cohort.total) * 100).toFixed(0)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="kpi-card__val">{cohort.statusCounts.lost}</div>
                <div className="kpi-card__bottom">
                  <span>Dropped with recorded reason</span>
                </div>
              </div>

              {/* Conversion Rate */}
              <div className="kpi-card kpi-card--rate">
                <div className="kpi-card__top">
                  <span className="kpi-card__label">Conversion Rate</span>
                  <IconTrendingUp size={16} className="rate-icon" />
                </div>
                <div className="kpi-card__val">{cohort.conversionRate}%</div>
                <div className="kpi-card__bottom">
                  <span>{cohort.statusCounts.converted} of {cohort.total} leads converted</span>
                </div>
              </div>
            </div>
          </section>

          {/* Two-Column Mid-Section: Pipeline Funnel + Lead Sources */}
          <div className="analytics-mid-grid">
            {/* Pipeline Funnel Progression */}
            <section className="card funnel-card" aria-label="Pipeline Funnel">
              <div className="card-header">
                <h3>Pipeline Funnel Progression</h3>
                <span className="card-subtitle">Cohort lead stage advancement</span>
              </div>
              <div className="card-body">
                <div className="funnel-container">
                  {funnel.map((item) => {
                    const pct =
                      cohort.total > 0 ? Math.round((item.count / cohort.total) * 100) : 0;
                    return (
                      <div
                        key={item.key}
                        className={`funnel-row clickable ${item.key === 'lost' ? 'funnel-row--lost' : ''}`}
                        onClick={() => {
                          if (item.key === 'total') drillDownToLeads(`dateFilter=${preset}`);
                          else drillDownToLeads(`status=${item.key}`);
                        }}
                      >
                        <div className="funnel-info">
                          <span className="funnel-stage-name">{item.stage}</span>
                          <span className="funnel-count">
                            {item.count} <small>({pct}%)</small>
                          </span>
                        </div>
                        <div className="funnel-bar-track">
                          <div
                            className={`funnel-bar-fill funnel-bar-fill--${item.key}`}
                            style={{ width: `${Math.max(pct, item.count > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Lead Sources Breakdown */}
            <section className="card sources-card" aria-label="Acquisition Sources">
              <div className="card-header">
                <h3>Acquisition Channels</h3>
                <span className="card-subtitle">Top ingestion sources in cohort</span>
              </div>
              <div className="card-body">
                {cohort.sources && cohort.sources.length > 0 ? (
                  <div className="sources-list">
                    {cohort.sources.map((src) => {
                      const pct =
                        cohort.total > 0 ? Math.round((src.count / cohort.total) * 100) : 0;
                      return (
                        <div key={src.source} className="source-item">
                          <div className="source-meta">
                            <span className="source-name">
                              {formatSourceLabel(src.source)}
                            </span>
                            <span className="source-count">
                              {src.count} <small>({pct}%)</small>
                            </span>
                          </div>
                          <div className="source-bar-track">
                            <div
                              className="source-bar-fill"
                              style={{ width: `${Math.max(pct, 4)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState title="No Source Data" message="No leads recorded for this period." />
                )}
              </div>
            </section>
          </div>

          {/* Admin Executive Performance Matrix */}
          {isAdmin && (
            <section className="card executive-matrix-card" aria-label="Sales Executive Matrix">
              <div className="card-header">
                <div className="matrix-title-wrap">
                  <IconUsers size={18} />
                  <h3>Sales Executive Workload & Performance</h3>
                </div>
                <span className="card-subtitle">
                  Workload distribution, active pipeline, and conversion rates
                </span>
              </div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="executive-table">
                    <thead>
                      <tr>
                        <th>Sales Executive</th>
                        <th>Role</th>
                        <th>Assigned</th>
                        <th>Active Pipeline</th>
                        <th>Overdue Tasks</th>
                        <th>Due Today</th>
                        <th>Converted</th>
                        <th>Conversion Rate</th>
                        <th className="text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executives.map((exec) => (
                        <tr key={exec.id || exec._id}>
                          <td>
                            <div className="exec-name-cell">
                              <strong>{exec.name}</strong>
                              <small>{exec.email}</small>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`exec-role-pill ${
                                exec.role === 'admin' ? 'pill-admin' : 'pill-sales'
                              }`}
                            >
                              {exec.role === 'admin' ? 'Admin' : 'Sales Executive'}
                            </span>
                          </td>
                          <td>
                            <strong>{exec.totalAssigned}</strong>
                          </td>
                          <td>{exec.activePipeline}</td>
                          <td>
                            <span
                              className={`status-chip ${
                                exec.overdueFollowUps > 0 ? 'status-chip--danger' : 'status-chip--neutral'
                              }`}
                            >
                              {exec.overdueFollowUps}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`status-chip ${
                                exec.dueTodayFollowUps > 0 ? 'status-chip--warning' : 'status-chip--neutral'
                              }`}
                            >
                              {exec.dueTodayFollowUps}
                            </span>
                          </td>
                          <td>
                            <strong className="text-success">{exec.converted}</strong>
                          </td>
                          <td>
                            <strong>{exec.conversionRate}%</strong>
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              className="btn btn--outline btn--xs"
                              onClick={() => drillDownToLeads(`assignedTo=${exec.id || exec._id}`)}
                            >
                              <span>View Leads</span>
                              <IconArrowRight size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* Recent Operational Activity Stream */}
          <section className="card activity-stream-card" aria-label="Recent Operational Activities">
            <div className="card-header">
              <h3>Recent Operational Activity (Append-Only Log)</h3>
              <span className="card-subtitle">
                Latest customer engagements, follow-up events, and stage transitions
              </span>
            </div>
            <div className="card-body">
              {activities.length > 0 ? (
                <div className="activity-feed">
                  {activities.map((act) => {
                    const actorName = act.performedBy?.name || 'System User';
                    const leadName = act.leadId?.fullName || 'Associated Lead';
                    const leadId = act.leadId?._id;
                    const dateFormatted = new Date(act.performedAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    // Icon selection by type
                    let TypeIcon = IconFileText;
                    let typeClass = 'type-default';
                    if (act.type === 'call') {
                      TypeIcon = IconPhone;
                      typeClass = 'type-call';
                    } else if (act.type === 'whatsapp') {
                      TypeIcon = IconMessageCircle;
                      typeClass = 'type-whatsapp';
                    } else if (act.type === 'email') {
                      TypeIcon = IconMail;
                      typeClass = 'type-email';
                    } else if (act.type === 'status_change') {
                      TypeIcon = IconTrendingUp;
                      typeClass = 'type-status';
                    } else if (act.type === 'follow_up_completed') {
                      TypeIcon = IconCheckCircle;
                      typeClass = 'type-complete';
                    } else if (act.type.startsWith('follow_up')) {
                      TypeIcon = IconClock;
                      typeClass = 'type-followup';
                    }

                    return (
                      <div key={act._id} className="activity-item">
                        <div className={`activity-icon-wrap ${typeClass}`}>
                          <TypeIcon size={14} />
                        </div>
                        <div className="activity-content">
                          <div className="activity-heading">
                            <span className="activity-actor">{actorName}</span>
                            <span className="activity-action-label">
                              {act.type.replace(/_/g, ' ')}
                            </span>
                            {leadId && (
                              <button
                                type="button"
                                className="activity-lead-link"
                                onClick={() => drillDownToLeads(`search=${encodeURIComponent(leadName)}`)}
                              >
                                for {leadName}
                              </button>
                            )}
                            <span className="activity-time">{dateFormatted}</span>
                          </div>
                          <p className="activity-summary">{act.summary}</p>
                          {act.metadata?.reason && (
                            <div className="activity-reason-tag">
                              Lost Reason: <strong>{act.metadata.reason}</strong>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No Recent Activity"
                  message="No logged sales activities recorded yet."
                />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
