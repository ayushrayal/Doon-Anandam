import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../auth/index.js';
import { useRouter } from '../../../app/routing/RouterContext.jsx';
import { apiFetch } from '../../../shared/lib/api.js';
import { StatusBadge } from '../../../shared/components/StatusBadge.jsx';
import { LoadingState } from '../../../shared/components/LoadingState.jsx';
import { EmptyState } from '../../../shared/components/EmptyState.jsx';
import { formatSourceLabel } from '../../../shared/lib/formatters.js';
import { LeadDrawer } from '../components/LeadDrawer.jsx';
import {
  IconSearch,
  IconClose,
  IconRefresh,
  IconFilter,
  IconChevronLeft,
  IconChevronRight,
  IconArrowRight,
  IconPhone,
  IconMail,
  IconAlertTriangle,
  IconCheckCircle,
  IconClock,
} from '../../../shared/components/Icons.jsx';
import './LeadsPage.scss';

export function LeadsPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const { currentSearch } = useRouter();

  // Leads list state
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  // Read initial query parameters for drill-down navigation support
  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const initialStatus = queryParams.get('status') || 'all';
  const initialFollowUp = queryParams.get('followUpStatus') || queryParams.get('followUp') || 'all';
  const initialAssigned = queryParams.get('assignedTo') || 'all';
  const initialDate = queryParams.get('dateFilter') || 'all';
  const initialSource = queryParams.get('source') || 'all';
  const initialSearch = queryParams.get('search') || '';
  const initialStartDate = queryParams.get('startDate') || '';
  const initialEndDate = queryParams.get('endDate') || '';

  // Filter state
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [sourceFilter, setSourceFilter] = useState(initialSource);
  const [assignedFilter, setAssignedFilter] = useState(initialAssigned);
  const [dateFilter, setDateFilter] = useState(initialDate);
  const [customStartDate, setCustomStartDate] = useState(initialStartDate);
  const [customEndDate, setCustomEndDate] = useState(initialEndDate);
  const [followUpFilter, setFollowUpFilter] = useState(initialFollowUp);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  // Synchronize when currentSearch changes (e.g., from Dashboard drill-down cards)
  useEffect(() => {
    if (currentSearch !== undefined) {
      const q = new URLSearchParams(currentSearch || (typeof window !== 'undefined' ? window.location.search : ''));
      setStatusFilter(q.get('status') || 'all');
      setFollowUpFilter(q.get('followUpStatus') || q.get('followUp') || 'all');
      setAssignedFilter(q.get('assignedTo') || 'all');
      setDateFilter(q.get('dateFilter') || 'all');
      setSourceFilter(q.get('source') || 'all');
      setCustomStartDate(q.get('startDate') || '');
      setCustomEndDate(q.get('endDate') || '');
      const searchQuery = q.get('search') || '';
      setSearch(searchQuery);
      setDebouncedSearch(searchQuery);
      setPage(1);
    }
  }, [currentSearch]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [syncLoading, setSyncLoading] = useState(false);

  // Selected lead for drawer
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  // Active users list (for admin assignment dropdown)
  const [activeUsers, setActiveUsers] = useState([]);

  // Race-condition prevention ref
  const activeFetchIdRef = useRef(0);

  // Fetch active users for admin assignment
  useEffect(() => {
    let isMounted = true;
    if (isAdmin) {
      apiFetch('/users?isActive=true&limit=50')
        .then((data) => {
          if (isMounted) setActiveUsers(data.users || []);
        })
        .catch(() => {
          if (isMounted) setActiveUsers([]);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [isAdmin]);

  // Debounce search input (300ms) - only run timer if search diverged
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  // Build query params and fetch leads
  const fetchLeads = useCallback(async () => {
    const fetchId = ++activeFetchIdRef.current;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sortBy,
        sortOrder,
      });

      if (debouncedSearch.trim()) {
        params.set('search', debouncedSearch.trim());
      }
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (sourceFilter !== 'all') {
        params.set('source', sourceFilter);
      }
      if (isAdmin && assignedFilter !== 'all') {
        params.set('assignedTo', assignedFilter);
      }
      if (followUpFilter !== 'all') {
        params.set('followUpStatus', followUpFilter);
      }

      // Date range filtering
      if (dateFilter && dateFilter !== 'all') {
        params.set('dateFilter', dateFilter);
      }
      if (customStartDate) {
        params.set('startDate', customStartDate);
      }
      if (customEndDate) {
        params.set('endDate', customEndDate);
      }
      if (dateFilter !== 'all' && !customStartDate) {
        const now = new Date();
        let startDate;
        if (dateFilter === 'today') {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        } else if (dateFilter === '7d') {
          const d = new Date();
          d.setDate(d.getDate() - 7);
          startDate = d.toISOString();
        } else if (dateFilter === '30d') {
          const d = new Date();
          d.setDate(d.getDate() - 30);
          startDate = d.toISOString();
        }
        if (startDate) {
          params.set('startDate', startDate);
        }
      }

      const data = await apiFetch(`/leads?${params.toString()}`);

      // Ensure response is not stale
      if (fetchId === activeFetchIdRef.current) {
        setLeads(data.leads || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      if (fetchId === activeFetchIdRef.current) {
        setError(err.message || 'Unable to retrieve leads.');
        setLeads([]);
      }
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [page, limit, debouncedSearch, statusFilter, sourceFilter, assignedFilter, dateFilter, customStartDate, customEndDate, followUpFilter, sortBy, sortOrder, isAdmin]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Handle lead update from Drawer
  const handleLeadUpdated = (updatedLead) => {
    setLeads((prevLeads) =>
      prevLeads.map((l) => (l._id === updatedLead._id ? updatedLead : l))
    );
  };

  // Trigger manual lead sync (Admin only)
  const handleManualSync = async () => {
    if (syncLoading) return;
    setSyncLoading(true);
    setFeedback({ type: '', message: '' });

    try {
      const data = await apiFetch('/leads/sync', { method: 'POST' });
      const summary = data.summary || {};
      setFeedback({
        type: 'success',
        message: `Lead sync completed. Fetched: ${summary.fetched || 0}, Inserted: ${summary.inserted || 0}, Updated: ${summary.updated || 0}.`,
      });
      fetchLeads();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Lead sync failed.',
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('all');
    setSourceFilter('all');
    setAssignedFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setFollowUpFilter('all');
    setSortBy('createdAt');
    setSortOrder('desc');
    setPage(1);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      window.history.pushState({}, '', window.location.pathname);
    }
  };

  const isFiltered =
    Boolean(search.trim()) ||
    statusFilter !== 'all' ||
    sourceFilter !== 'all' ||
    assignedFilter !== 'all' ||
    dateFilter !== 'all' ||
    Boolean(customStartDate) ||
    Boolean(customEndDate) ||
    followUpFilter !== 'all';

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="leads-page">
      {/* Top Banner / Actions Header */}
      <div className="leads-page__header">
        <div className="leads-page__header-title">
          <div className="title-row">
            <h1 className="page-title">Lead Pipeline</h1>
            <span className="leads-count-badge">
              {total} {total === 1 ? 'Prospect' : 'Prospects'}
            </span>
          </div>
          <p className="page-subtitle">
            {isAdmin
              ? 'Real-time prospective customer records ingested from Facebook Lead Ads and campaigns.'
              : 'Your assigned prospective customer pipeline and interaction stages.'}
          </p>
        </div>

        <div className="leads-page__header-actions">
          {isAdmin && (
            <button
              type="button"
              className="sync-leads-btn"
              onClick={handleManualSync}
              disabled={syncLoading}
              title="Sync latest leads"
            >
              <IconRefresh size={14} className={syncLoading ? 'spin' : ''} />
              <span>{syncLoading ? 'Syncing...' : 'Sync Leads'}</span>
            </button>
          )}

          <button
            type="button"
            className="refresh-btn"
            onClick={fetchLeads}
            disabled={loading}
            title="Refresh lead data"
          >
            <IconRefresh size={14} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {feedback.message && (
        <div className={`feedback-banner feedback-banner--${feedback.type}`}>
          {feedback.type === 'success' ? (
            <IconCheckCircle size={16} />
          ) : (
            <IconAlertTriangle size={16} />
          )}
          <span>{feedback.message}</span>
          <button
            type="button"
            className="feedback-close-btn"
            onClick={() => setFeedback({ type: '', message: '' })}
            aria-label="Dismiss message"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* Unified Filters Bar */}
      <div className="leads-toolbar">
        {/* Search Input */}
        <div className="leads-search-wrap">
          <IconSearch size={16} className="search-icon" />
          <input
            type="text"
            className="leads-search-input"
            placeholder="Search by lead name, phone, email, campaign..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch('')}
              aria-label="Clear search query"
            >
              <IconClose size={14} />
            </button>
          )}
        </div>

        {/* Filter Controls Row */}
        <div className="leads-filter-controls">
          {/* Status Filter */}
          <div className="filter-select-wrap">
            <label htmlFor="filter-status" className="sr-only">
              Filter by Status
            </label>
            <select
              id="filter-status"
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Stages</option>
              <option value="new">New Lead</option>
              <option value="contacted">Contacted</option>
              <option value="follow_up">Follow Up</option>
              <option value="qualified">Qualified</option>
              <option value="converted">Converted</option>
              <option value="lost">Lost</option>
            </select>
          </div>

          {/* Assignment Filter (Admin Only) */}
          {isAdmin && (
            <div className="filter-select-wrap">
              <label htmlFor="filter-assigned" className="sr-only">
                Filter by Assignment
              </label>
              <select
                id="filter-assigned"
                className="filter-select"
                value={assignedFilter}
                onChange={(e) => {
                  setAssignedFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All Assignments</option>
                <option value="unassigned">Unassigned Only</option>
                {activeUsers.map((u) => (
                  <option key={u.id || u._id} value={u.id || u._id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date Range Filter */}
          <div className="filter-select-wrap">
            <label htmlFor="filter-date" className="sr-only">
              Filter by Date
            </label>
            <select
              id="filter-date"
              className="filter-select"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          {/* Follow-Up Status Filter */}
          <div className="filter-select-wrap">
            <label htmlFor="filter-followup" className="sr-only">
              Filter by Follow-Up
            </label>
            <select
              id="filter-followup"
              className="filter-select"
              value={followUpFilter}
              onChange={(e) => {
                setFollowUpFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Follow-ups</option>
              <option value="today">Due Today</option>
              <option value="overdue">Overdue</option>
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed in Period</option>
              <option value="scheduled">Any Scheduled</option>
              <option value="none">No Follow-up</option>
            </select>
          </div>

          {/* Safe Sort By */}
          <div className="filter-select-wrap">
            <label htmlFor="filter-sort" className="sr-only">
              Sort By
            </label>
            <select
              id="filter-sort"
              className="filter-select"
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split('-');
                setSortBy(sb);
                setSortOrder(so);
                setPage(1);
              }}
            >
              <option value="createdAt-desc">Newest Ingestion</option>
              <option value="createdAt-asc">Oldest Ingestion</option>
              <option value="leadCreatedAt-desc">Newest Form Submission</option>
              <option value="fullName-asc">Lead Name (A–Z)</option>
              <option value="fullName-desc">Lead Name (Z–A)</option>
              <option value="status-asc">Status</option>
            </select>
          </div>

          {/* Reset Filters */}
          {isFiltered && (
            <button
              type="button"
              className="reset-filters-btn"
              onClick={handleResetFilters}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Table / Content Section */}
      <div className="leads-table-container">
        {loading && (
          <div className="leads-table-overlay-loading">
            <LoadingState message="Retrieving leads..." />
          </div>
        )}

        {error && !loading && (
          <div className="leads-table-error">
            <IconAlertTriangle size={24} />
            <p>{error}</p>
            {error.toLowerCase().includes('too many requests') ? (
              <div className="rate-limit-notice" style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  Temporary rate limit reached for this IP. Please wait a brief moment before refreshing.
                </p>
                <button
                  type="button"
                  className="retry-btn"
                  onClick={fetchLeads}
                  disabled={loading}
                >
                  <IconRefresh size={14} className={loading ? 'spin' : ''} /> Check Again
                </button>
              </div>
            ) : (
              <button type="button" className="retry-btn" onClick={fetchLeads} disabled={loading}>
                <IconRefresh size={14} className={loading ? 'spin' : ''} /> Retry
              </button>
            )}
          </div>
        )}

        {!loading && !error && leads.length === 0 && (
          <EmptyState
            title={isFiltered ? 'No leads match your active filters' : 'No leads ingested yet'}
            description={
              isFiltered
                ? 'Try broadening your search term or adjusting status and date parameters.'
                : 'Connect campaign sources or trigger a manual sync to populate leads.'
            }
            actionLabel={isFiltered ? 'Reset All Filters' : isAdmin ? 'Sync Leads Now' : ''}
            onAction={isFiltered ? handleResetFilters : isAdmin ? handleManualSync : undefined}
          />
        )}

        {!loading && !error && leads.length > 0 && (
          <div className="table-responsive">
            <table className="leads-table">
              <thead>
                <tr>
                  <th scope="col" className="col-name">Prospect Details</th>
                  <th scope="col" className="col-contact">Contact Channels</th>
                  <th scope="col" className="col-campaign">Attribution & Form</th>
                  <th scope="col" className="col-status">Pipeline Stage</th>
                  <th scope="col" className="col-followup">Next Follow-Up</th>
                  <th scope="col" className="col-assigned">Assigned Executive</th>
                  <th scope="col" className="col-date">Ingested</th>
                  <th scope="col" className="col-actions text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const assignedName = lead.assignedTo?.name;
                  const assignedInitial = assignedName ? assignedName.charAt(0).toUpperCase() : '?';

                  return (
                    <tr
                      key={lead._id}
                      className="lead-row"
                      onClick={() => setSelectedLeadId(lead._id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedLeadId(lead._id);
                        }
                      }}
                    >
                      {/* Name / Account */}
                      <td className="col-name">
                        <div className="prospect-info">
                          <span className="prospect-name">
                            {lead.fullName || 'Unnamed Prospect'}
                          </span>
                          <span className="prospect-account">
                            {lead.accountName || 'Doon Anandam'}
                          </span>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="col-contact">
                        <div className="contact-cell">
                          {lead.phoneNumber ? (
                            <span className="contact-item">
                              <IconPhone size={13} className="contact-icon" />
                              <a
                                href={`tel:${lead.phoneNumber}`}
                                onClick={(e) => e.stopPropagation()}
                                className="contact-link"
                              >
                                {lead.phoneNumber}
                              </a>
                            </span>
                          ) : (
                            <span className="contact-item empty">No phone</span>
                          )}

                          {lead.email ? (
                            <span className="contact-item">
                              <IconMail size={13} className="contact-icon" />
                              <a
                                href={`mailto:${lead.email}`}
                                onClick={(e) => e.stopPropagation()}
                                className="contact-link"
                              >
                                {lead.email}
                              </a>
                            </span>
                          ) : (
                            <span className="contact-item empty">No email</span>
                          )}
                        </div>
                      </td>

                      {/* Campaign / Form */}
                      <td className="col-campaign">
                        <div className="campaign-cell">
                          <span
                            className={`source-pill source-pill--${
                              formatSourceLabel(lead.source) === 'Meta' ? 'meta' : 'unknown'
                            }`}
                          >
                            {formatSourceLabel(lead.source)}
                          </span>
                          <span className="campaign-name" title={lead.campaignName || '—'}>
                            {lead.campaignName || 'Organic / Direct'}
                          </span>
                          <span className="form-name" title={lead.formName || '—'}>
                            {lead.formName || 'Standard Inquiry'}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="col-status">
                        <StatusBadge type="leadStatus" value={lead.status} />
                      </td>

                      {/* Next Follow-Up */}
                      <td className="col-followup">
                        {lead.nextFollowUpDate ? (
                          <div
                            className={`table-followup-badge table-followup-badge--${lead.followUpIndicator || 'upcoming'}`}
                            title={
                              lead.nextFollowUpRemarks
                                ? `Reminder: ${lead.nextFollowUpRemarks}`
                                : 'Follow-up scheduled'
                            }
                          >
                            <IconClock size={11} />
                            <span>{formatDate(lead.nextFollowUpDate)}</span>
                          </div>
                        ) : lead.lastFollowUpCompletedAt ? (
                          <div
                            className="table-followup-badge table-followup-badge--completed"
                            title={`Follow-up completed on ${formatDate(lead.lastFollowUpCompletedAt)}`}
                          >
                            <IconClock size={11} />
                            <span>Done {formatDate(lead.lastFollowUpCompletedAt)}</span>
                          </div>
                        ) : (
                          <span className="table-followup-none">—</span>
                        )}
                      </td>

                      {/* Assigned Rep */}
                      <td className="col-assigned">
                        {lead.assignedTo ? (
                          <div className="assignee-chip">
                            <span className="assignee-avatar" aria-hidden="true">
                              {assignedInitial}
                            </span>
                            <div className="assignee-meta">
                              <span className="assignee-name">{assignedName}</span>
                              <span className="assignee-role">
                                {lead.assignedTo.role === 'admin' ? 'Admin' : 'Sales Rep'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="unassigned-badge">Unassigned</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="col-date">
                        <span className="date-cell" title={new Date(lead.createdAt).toLocaleString()}>
                          {formatDate(lead.createdAt)}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="col-actions text-right">
                        <button
                          type="button"
                          className="view-lead-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLeadId(lead._id);
                          }}
                          aria-label={`View details for ${lead.fullName || 'prospect'}`}
                        >
                          <span>Details</span>
                          <IconArrowRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!loading && !error && leads.length > 0 && (
          <div className="leads-pagination">
            <div className="pagination-count">
              Showing{' '}
              <strong>{(page - 1) * limit + 1}</strong> –{' '}
              <strong>{Math.min(page * limit, total)}</strong> of{' '}
              <strong>{total}</strong> leads
            </div>

            <div className="pagination-controls">
              {/* Limit selector */}
              <div className="limit-selector-wrap">
                <label htmlFor="limit-select" className="sr-only">
                  Per page
                </label>
                <select
                  id="limit-select"
                  className="limit-select"
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                </select>
              </div>

              {/* Prev / Next buttons */}
              <button
                type="button"
                className="page-nav-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <IconChevronLeft size={16} />
                <span>Prev</span>
              </button>

              <span className="page-indicator">
                Page {page} of {totalPages}
              </span>

              <button
                type="button"
                className="page-nav-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <span>Next</span>
                <IconChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lead Details Slide-Over Drawer */}
      {selectedLeadId && (
        <LeadDrawer
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onLeadUpdated={handleLeadUpdated}
          activeUsers={activeUsers}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
