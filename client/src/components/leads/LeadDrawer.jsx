import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api.js';
import { StatusBadge } from '../common/StatusBadge.jsx';
import {
  IconClose,
  IconPhone,
  IconMail,
  IconCopy,
  IconCheck,
  IconCalendar,
  IconUserCheck,
  IconAlertTriangle,
  IconBuilding,
  IconRefresh,
} from '../common/Icons.jsx';
import './LeadDrawer.scss';

// Valid lifecycle transitions aligned strictly with backend ALLOWED_STATUS_TRANSITIONS
const ALLOWED_STATUS_TRANSITIONS = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'lost', 'new'],
  qualified: ['converted', 'lost', 'contacted'],
  lost: ['contacted', 'qualified', 'new'],
  converted: ['qualified'],
};

const STATUS_LABELS = {
  new: 'New Lead',
  contacted: 'Contacted',
  qualified: 'Qualified',
  converted: 'Converted',
  lost: 'Lost',
};

export function LeadDrawer({ leadId, onClose, onLeadUpdated, activeUsers = [], isAdmin = false }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Status mutation state
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [statusSuccess, setStatusSuccess] = useState('');

  // Assignment mutation state
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  // Copy feedback
  const [copiedField, setCopiedField] = useState('');

  const fetchLeadDetails = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError('');
    setStatusError('');
    setAssignError('');
    try {
      const data = await apiFetch(`/leads/${leadId}`);
      setLead(data.lead);
      setSelectedAssignee(data.lead.assignedTo ? data.lead.assignedTo._id : 'unassigned');
    } catch (err) {
      setError(err.message || 'Unable to load lead details');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchLeadDetails();
  }, [fetchLeadDetails]);

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(''), 2000);
  };

  const handleStatusTransition = async (nextStatus) => {
    if (!lead || statusLoading) return;
    setStatusLoading(true);
    setStatusError('');
    setStatusSuccess('');

    try {
      const data = await apiFetch(`/leads/${lead._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setLead(data.lead);
      setStatusSuccess(`Status transitioned to ${STATUS_LABELS[nextStatus] || nextStatus}.`);
      if (onLeadUpdated) onLeadUpdated(data.lead);
      setTimeout(() => setStatusSuccess(''), 3000);
    } catch (err) {
      setStatusError(err.message || 'Status transition failed.');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleAssignmentChange = async (e) => {
    const newUserId = e.target.value;
    setSelectedAssignee(newUserId);
    setAssignLoading(true);
    setAssignError('');
    setAssignSuccess('');

    const targetPayload = newUserId === 'unassigned' ? null : newUserId;

    try {
      const data = await apiFetch(`/leads/${lead._id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedTo: targetPayload }),
      });
      setLead(data.lead);
      setAssignSuccess(
        data.lead.assignedTo
          ? `Assigned to ${data.lead.assignedTo.name}.`
          : 'Lead unassigned successfully.'
      );
      if (onLeadUpdated) onLeadUpdated(data.lead);
      setTimeout(() => setAssignSuccess(''), 3000);
    } catch (err) {
      setAssignError(err.message || 'Assignment failed.');
      // Revert selection to current lead state
      setSelectedAssignee(lead.assignedTo ? lead.assignedTo._id : 'unassigned');
    } finally {
      setAssignLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const allowedNextStatuses = lead ? ALLOWED_STATUS_TRANSITIONS[lead.status] || [] : [];

  return (
    <div className="lead-drawer-overlay" onClick={onClose} aria-modal="true" role="dialog">
      <div
        className="lead-drawer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Lead Details Panel"
      >
        {/* Drawer Header */}
        <div className="lead-drawer__header">
          <div className="lead-drawer__header-left">
            <span className="lead-drawer__eyebrow">
              {lead?.source ? lead.source.replace('_', ' ').toUpperCase() : 'LEAD RECORD'}
            </span>
            <h2 className="lead-drawer__title">
              {lead ? lead.fullName || 'Unnamed Prospect' : 'Loading Lead...'}
            </h2>
          </div>
          <button
            type="button"
            className="lead-drawer__close-btn"
            onClick={onClose}
            aria-label="Close lead details"
          >
            <IconClose size={20} />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="lead-drawer__body">
          {loading && (
            <div className="lead-drawer__loading">
              <IconRefresh size={24} className="spin" />
              <span>Fetching verified lead details...</span>
            </div>
          )}

          {error && !loading && (
            <div className="lead-drawer__error">
              <IconAlertTriangle size={24} />
              <p>{error}</p>
              <button type="button" className="retry-btn" onClick={fetchLeadDetails}>
                <IconRefresh size={14} /> Retry
              </button>
            </div>
          )}

          {!loading && !error && lead && (
            <>
              {/* SECTION: Lifecycle Status Management */}
              <div className="drawer-card drawer-card--status">
                <div className="drawer-card__header">
                  <span className="drawer-card__title">Pipeline Lifecycle Stage</span>
                  <StatusBadge type="leadStatus" value={lead.status} />
                </div>

                <div className="status-transitions">
                  <div className="status-transitions__label">Allowed Stage Actions:</div>
                  <div className="status-transitions__buttons">
                    {allowedNextStatuses.map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`transition-btn transition-btn--${st}`}
                        disabled={statusLoading}
                        onClick={() => handleStatusTransition(st)}
                      >
                        {statusLoading ? 'Updating...' : `Move to ${STATUS_LABELS[st] || st}`}
                      </button>
                    ))}
                    {allowedNextStatuses.length === 0 && (
                      <span className="status-transitions__empty">
                        No further transitions allowed from current stage.
                      </span>
                    )}
                  </div>
                </div>

                {statusSuccess && (
                  <div className="status-feedback status-feedback--success">
                    <IconCheck size={14} /> {statusSuccess}
                  </div>
                )}
                {statusError && (
                  <div className="status-feedback status-feedback--error">
                    <IconAlertTriangle size={14} /> {statusError}
                  </div>
                )}
              </div>

              {/* SECTION: Assignment (Admin Only) */}
              {isAdmin && (
                <div className="drawer-card drawer-card--assignment">
                  <div className="drawer-card__header">
                    <span className="drawer-card__title">Sales Representative Assignment</span>
                    <IconUserCheck size={18} className="drawer-card__icon" />
                  </div>

                  <div className="assignment-control">
                    <label htmlFor="assignee-select" className="assignment-control__label">
                      Assigned To:
                    </label>
                    <div className="assignment-control__input-wrap">
                      <select
                        id="assignee-select"
                        value={selectedAssignee}
                        onChange={handleAssignmentChange}
                        disabled={assignLoading}
                        className="assignment-select"
                      >
                        <option value="unassigned">— Unassigned (Awaiting Rep) —</option>
                        {activeUsers.map((u) => (
                          <option key={u.id || u._id} value={u.id || u._id}>
                            {u.name} ({u.role === 'admin' ? 'Admin' : 'Sales Rep'})
                          </option>
                        ))}
                      </select>
                      {assignLoading && <span className="assign-spinner">Saving...</span>}
                    </div>
                  </div>

                  {assignSuccess && (
                    <div className="status-feedback status-feedback--success">
                      <IconCheck size={14} /> {assignSuccess}
                    </div>
                  )}
                  {assignError && (
                    <div className="status-feedback status-feedback--error">
                      <IconAlertTriangle size={14} /> {assignError}
                    </div>
                  )}
                </div>
              )}

              {/* SECTION: Contact Information */}
              <div className="drawer-card">
                <div className="drawer-card__header">
                  <span className="drawer-card__title">Direct Contact Information</span>
                </div>
                <div className="contact-rows">
                  <div className="contact-row">
                    <div className="contact-row__icon">
                      <IconPhone size={16} />
                    </div>
                    <div className="contact-row__content">
                      <span className="contact-row__label">Phone Number</span>
                      {lead.phoneNumber ? (
                        <div className="contact-row__val-wrap">
                          <a href={`tel:${lead.phoneNumber}`} className="contact-row__link">
                            {lead.phoneNumber}
                          </a>
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => handleCopy(lead.phoneNumber, 'phone')}
                            title="Copy phone"
                          >
                            {copiedField === 'phone' ? (
                              <IconCheck size={14} className="copied" />
                            ) : (
                              <IconCopy size={14} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="contact-row__empty">Not provided in form submission</span>
                      )}
                    </div>
                  </div>

                  <div className="contact-row">
                    <div className="contact-row__icon">
                      <IconMail size={16} />
                    </div>
                    <div className="contact-row__content">
                      <span className="contact-row__label">Email Address</span>
                      {lead.email ? (
                        <div className="contact-row__val-wrap">
                          <a href={`mailto:${lead.email}`} className="contact-row__link">
                            {lead.email}
                          </a>
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => handleCopy(lead.email, 'email')}
                            title="Copy email"
                          >
                            {copiedField === 'email' ? (
                              <IconCheck size={14} className="copied" />
                            ) : (
                              <IconCopy size={14} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="contact-row__empty">Not provided in form submission</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: Marketing Attribution */}
              <div className="drawer-card">
                <div className="drawer-card__header">
                  <span className="drawer-card__title">Campaign & Marketing Attribution</span>
                </div>
                <div className="attribute-grid">
                  <div className="attribute-item">
                    <span className="attribute-item__label">Campaign</span>
                    <span className="attribute-item__value" title={lead.campaignName || '—'}>
                      {lead.campaignName || '—'}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">Campaign ID</span>
                    <span className="attribute-item__value mono">
                      {lead.campaignId || '—'}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">Ad Set</span>
                    <span className="attribute-item__value" title={lead.adsetName || '—'}>
                      {lead.adsetName || '—'}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">Ad Creative</span>
                    <span className="attribute-item__value" title={lead.adName || '—'}>
                      {lead.adName || '—'}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">Instant Form</span>
                    <span className="attribute-item__value" title={lead.formName || '—'}>
                      {lead.formName || '—'}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">Submission Time</span>
                    <span className="attribute-item__value">
                      {formatDate(lead.leadCreatedAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION: Operational Notes */}
              <div className="drawer-card">
                <div className="drawer-card__header">
                  <span className="drawer-card__title">Operational Notes & Remarks</span>
                </div>
                <div className="notes-box">
                  <p>{lead.notes || 'No CRM remarks attached to this prospect record yet.'}</p>
                </div>
              </div>

              {/* SECTION: Traceability & Account Scope */}
              <div className="drawer-card drawer-card--meta">
                <div className="drawer-card__header">
                  <span className="drawer-card__title">Account & Record Traceability</span>
                  <IconBuilding size={16} />
                </div>
                <div className="attribute-grid">
                  <div className="attribute-item">
                    <span className="attribute-item__label">Connected Account</span>
                    <span className="attribute-item__value">
                      {lead.accountName || lead.accountId || '—'}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">External Lead ID</span>
                    <span className="attribute-item__value mono">
                      {lead.externalLeadId}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">System Ingestion</span>
                    <span className="attribute-item__value">
                      {formatDate(lead.createdAt)}
                    </span>
                  </div>
                  <div className="attribute-item">
                    <span className="attribute-item__label">Last State Change</span>
                    <span className="attribute-item__value">
                      {formatDate(lead.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
