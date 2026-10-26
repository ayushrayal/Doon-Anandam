import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../shared/lib/api.js';
import { StatusBadge } from '../../../shared/components/StatusBadge.jsx';
import { formatSourceLabel } from '../../../shared/lib/formatters.js';
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
  IconClock,
  IconMessageCircle,
  IconFileText,
  IconPlus,
  IconCheckCircle,
  IconUsers,
} from '../../../shared/components/Icons.jsx';
import './LeadDrawer.scss';

// Valid lifecycle transitions aligned strictly with backend ALLOWED_STATUS_TRANSITIONS
const ALLOWED_STATUS_TRANSITIONS = {
  new: ['contacted', 'follow_up', 'qualified', 'lost'],
  contacted: ['follow_up', 'qualified', 'lost', 'new'],
  follow_up: ['qualified', 'contacted', 'lost', 'new'],
  qualified: ['converted', 'lost', 'follow_up', 'contacted'],
  lost: ['contacted', 'follow_up', 'qualified', 'new'],
  converted: ['qualified'],
};

const STATUS_LABELS = {
  new: 'New Lead',
  contacted: 'Contacted',
  follow_up: 'Follow Up',
  qualified: 'Qualified',
  converted: 'Converted',
  lost: 'Lost',
};

const ACTIVITY_TYPE_CONFIG = {
  call: { label: 'Phone Call', color: 'blue' },
  whatsapp: { label: 'WhatsApp', color: 'green' },
  meeting: { label: 'In-Person Meeting', color: 'purple' },
  email: { label: 'Email', color: 'amber' },
  note: { label: 'General Note', color: 'slate' },
  follow_up_scheduled: { label: 'Follow-up Scheduled', color: 'navy' },
  follow_up_rescheduled: { label: 'Follow-up Rescheduled', color: 'navy' },
  follow_up_completed: { label: 'Follow-up Completed', color: 'emerald' },
  status_change: { label: 'Stage Transition', color: 'indigo' },
};

export function LeadDrawer({ leadId, onClose, onLeadUpdated, activeUsers = [], isAdmin = false }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Status mutation state
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [statusSuccess, setStatusSuccess] = useState('');
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [stageNoteInput, setStageNoteInput] = useState('');
  const [lostReasonInput, setLostReasonInput] = useState('budget_constraint');

  // Assignment mutation state
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  // Copy feedback
  const [copiedField, setCopiedField] = useState('');

  // Follow-up state
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpDateInput, setFollowUpDateInput] = useState('');
  const [followUpRemarksInput, setFollowUpRemarksInput] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [followUpSuccess, setFollowUpSuccess] = useState('');

  // Complete follow-up state
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [completeNotesInput, setCompleteNotesInput] = useState('');
  const [completeLoading, setCompleteLoading] = useState(false);
  const [completeError, setCompleteError] = useState('');

  // Activities state
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [activityType, setActivityType] = useState('call');
  const [activitySummary, setActivitySummary] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activitySuccess, setActivitySuccess] = useState('');

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

  const fetchActivities = useCallback(async () => {
    if (!leadId) return;
    setActivitiesLoading(true);
    try {
      const data = await apiFetch(`/leads/${leadId}/activities`);
      setActivities(data.activities || []);
    } catch (err) {
      console.error('Failed to load lead activities:', err.message);
    } finally {
      setActivitiesLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchLeadDetails();
    fetchActivities();
  }, [fetchLeadDetails, fetchActivities]);

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

  const handleStatusTransition = async (nextStatus, note = '', reason = '') => {
    if (!lead || statusLoading) return;
    setStatusLoading(true);
    setStatusError('');
    setStatusSuccess('');

    try {
      const payload = { status: nextStatus };
      if (note && note.trim()) payload.note = note.trim();
      if (nextStatus === 'lost' && reason) payload.reason = reason;

      const data = await apiFetch(`/leads/${lead._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setLead(data.lead);
      setStatusSuccess(`Status transitioned to ${STATUS_LABELS[nextStatus] || nextStatus}.`);
      setPendingStatusChange(null);
      setStageNoteInput('');
      if (onLeadUpdated) onLeadUpdated(data.lead);
      fetchActivities();
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
      fetchActivities();
      setTimeout(() => setAssignSuccess(''), 3000);
    } catch (err) {
      setAssignError(err.message || 'Assignment failed.');
      setSelectedAssignee(lead.assignedTo ? lead.assignedTo._id : 'unassigned');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleScheduleFollowUp = async (e) => {
    e.preventDefault();
    if (!followUpDateInput) {
      setFollowUpError('Please select a date and time for the follow-up.');
      return;
    }
    setFollowUpLoading(true);
    setFollowUpError('');
    setFollowUpSuccess('');

    try {
      const data = await apiFetch(`/leads/${lead._id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify({
          followUpDate: new Date(followUpDateInput).toISOString(),
          remarks: followUpRemarksInput.trim(),
        }),
      });
      setLead(data.lead);
      setFollowUpSuccess(data.message || 'Follow-up saved successfully.');
      setShowFollowUpForm(false);
      setFollowUpDateInput('');
      setFollowUpRemarksInput('');
      if (onLeadUpdated) onLeadUpdated(data.lead);
      fetchActivities();
      setTimeout(() => setFollowUpSuccess(''), 3500);
    } catch (err) {
      setFollowUpError(err.message || 'Failed to schedule follow-up.');
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleCompleteFollowUp = async (e) => {
    e.preventDefault();
    setCompleteLoading(true);
    setCompleteError('');

    try {
      const data = await apiFetch(`/leads/${lead._id}/follow-up/complete`, {
        method: 'PATCH',
        body: JSON.stringify({
          notes: completeNotesInput.trim(),
        }),
      });
      setLead(data.lead);
      setShowCompleteForm(false);
      setCompleteNotesInput('');
      setFollowUpSuccess('Follow-up marked as completed.');
      if (onLeadUpdated) onLeadUpdated(data.lead);
      fetchActivities();
      setTimeout(() => setFollowUpSuccess(''), 3500);
    } catch (err) {
      setCompleteError(err.message || 'Failed to complete follow-up.');
    } finally {
      setCompleteLoading(false);
    }
  };

  const handleRecordActivity = async (e) => {
    e.preventDefault();
    if (!activitySummary.trim()) {
      setActivityError('Activity description or notes cannot be empty.');
      return;
    }
    setActivityLoading(true);
    setActivityError('');
    setActivitySuccess('');

    try {
      await apiFetch(`/leads/${lead._id}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          type: activityType,
          summary: activitySummary.trim(),
        }),
      });
      setActivitySuccess('Activity recorded successfully.');
      setActivitySummary('');
      setShowActivityForm(false);
      fetchActivities();
      setTimeout(() => setActivitySuccess(''), 3500);
    } catch (err) {
      setActivityError(err.message || 'Failed to record activity.');
    } finally {
      setActivityLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  };

  const allowedTransitions = lead ? ALLOWED_STATUS_TRANSITIONS[lead.status] || [] : [];

  // Helper for activity type icon rendering
  const renderActivityIcon = (type) => {
    switch (type) {
      case 'call':
        return <IconPhone size={14} />;
      case 'whatsapp':
        return <IconMessageCircle size={14} />;
      case 'meeting':
        return <IconUsers size={14} />;
      case 'email':
        return <IconMail size={14} />;
      case 'follow_up_completed':
        return <IconCheckCircle size={14} />;
      case 'follow_up_scheduled':
      case 'follow_up_rescheduled':
        return <IconCalendar size={14} />;
      case 'status_change':
        return <IconRefresh size={14} />;
      case 'note':
      default:
        return <IconFileText size={14} />;
    }
  };

  // Min datetime for follow-up date input (current local time)
  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };

  return (
    <div
      className="lead-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-lead-title"
    >
      <div className="lead-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="lead-drawer__header">
          <div className="lead-drawer__header-left">
            <span className="lead-drawer__eyebrow">Lead Record</span>
            <h2 id="drawer-lead-title" className="lead-drawer__title">
              {lead?.fullName || 'Prospect Details'}
            </h2>
          </div>
          <button
            type="button"
            className="lead-drawer__close-btn"
            onClick={onClose}
            aria-label="Close details panel"
          >
            <IconClose size={20} />
          </button>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="lead-drawer__body">
          {loading && (
            <div className="lead-drawer__loading">
              <IconRefresh size={28} className="spin" />
              <span>Loading complete prospect details...</span>
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
              {/* SECTION: Lifecycle Stage Controller */}
              <div className="drawer-card drawer-card--lifecycle">
                <div className="drawer-card__header">
                  <span className="drawer-card__title">Pipeline Lifecycle Stage</span>
                  <StatusBadge type="leadStatus" value={lead.status} />
                </div>

                <div className="stage-controller">
                  <div className="stage-controller__select-wrap">
                    <label htmlFor="stage-select" className="stage-controller__label">
                      Move lead to:
                    </label>
                    <select
                      id="stage-select"
                      className="stage-select"
                      value={pendingStatusChange || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPendingStatusChange(val || null);
                        setStatusError('');
                        setStatusSuccess('');
                      }}
                      disabled={statusLoading || allowedTransitions.length === 0}
                    >
                      <option value="">
                        {allowedTransitions.length === 0
                          ? '— Terminal stage reached (no further transitions) —'
                          : '— Select next pipeline stage —'}
                      </option>
                      {allowedTransitions.map((nextStatus) => (
                        <option key={nextStatus} value={nextStatus}>
                          {STATUS_LABELS[nextStatus] || nextStatus}
                        </option>
                      ))}
                    </select>
                  </div>

                  {allowedTransitions.length === 0 && (
                    <p className="stage-terminal-note">
                      This prospect has reached the terminal state for its pipeline lifecycle.
                    </p>
                  )}

                  {pendingStatusChange && (
                    <form
                      className="stage-confirm-panel"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleStatusTransition(
                          pendingStatusChange,
                          stageNoteInput,
                          pendingStatusChange === 'lost' ? lostReasonInput : ''
                        );
                      }}
                    >
                      <div className="stage-confirm-panel__header">
                        <span className="stage-transition-summary">
                          Moving from <strong>{STATUS_LABELS[lead.status]}</strong> to{' '}
                          <span className={`stage-target-badge stage-target-badge--${pendingStatusChange}`}>
                            {STATUS_LABELS[pendingStatusChange]}
                          </span>
                        </span>
                      </div>

                      {pendingStatusChange === 'lost' && (
                        <div className="stage-confirm-panel__field">
                          <label htmlFor="lost-reason-select" className="stage-field-label">
                            Primary Reason for Lost <span className="req">*</span>:
                          </label>
                          <select
                            id="lost-reason-select"
                            className="stage-input stage-input--select"
                            value={lostReasonInput}
                            onChange={(e) => setLostReasonInput(e.target.value)}
                            required
                          >
                            <option value="budget_constraint">Budget / Price Constraint</option>
                            <option value="location_unsuitable">Location / Connectivity Unsuitable</option>
                            <option value="bought_elsewhere">Purchased Another Property</option>
                            <option value="unresponsive">Unresponsive / Invalid Contact</option>
                            <option value="not_interested">Not Interested</option>
                            <option value="other">Other Reason</option>
                          </select>
                        </div>
                      )}

                      <div className="stage-confirm-panel__field">
                        <div className="stage-label-row">
                          <label htmlFor="stage-note" className="stage-field-label">
                            Stage Note / Remarks (Optional):
                          </label>
                          <span className="char-count">{stageNoteInput.length}/1000</span>
                        </div>
                        <textarea
                          id="stage-note"
                          className="stage-input stage-input--textarea"
                          placeholder="Add operational context, customer comments, or requirements discussed..."
                          value={stageNoteInput}
                          onChange={(e) => setStageNoteInput(e.target.value)}
                          rows={2}
                          maxLength={1000}
                        />
                      </div>

                      <div className="stage-confirm-panel__actions">
                        <button
                          type="button"
                          className="stage-btn stage-btn--cancel"
                          onClick={() => {
                            setPendingStatusChange(null);
                            setStageNoteInput('');
                            setStatusError('');
                          }}
                          disabled={statusLoading}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="stage-btn stage-btn--confirm"
                          disabled={statusLoading}
                        >
                          {statusLoading ? (
                            <>
                              <IconRefresh size={13} className="spin" />
                              <span>Updating Stage...</span>
                            </>
                          ) : (
                            <>
                              <IconCheck size={14} />
                              <span>Confirm Move to {STATUS_LABELS[pendingStatusChange]}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
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

              {/* SECTION: Sales Follow-Up Management */}
              <div className="drawer-card drawer-card--followup">
                <div className="drawer-card__header">
                  <div className="drawer-card__header-title-group">
                    <span className="drawer-card__title">Sales Follow-Up & Next Step</span>
                    {lead.followUpIndicator && lead.followUpIndicator !== 'none' && (
                      <span className={`followup-indicator followup-indicator--${lead.followUpIndicator}`}>
                        <IconClock size={12} />
                        {lead.followUpIndicator === 'overdue' && 'Overdue'}
                        {lead.followUpIndicator === 'today' && 'Due Today'}
                        {lead.followUpIndicator === 'upcoming' && 'Upcoming'}
                      </span>
                    )}
                  </div>
                  <IconCalendar size={18} className="drawer-card__icon" />
                </div>

                {followUpSuccess && (
                  <div className="status-feedback status-feedback--success">
                    <IconCheck size={14} /> {followUpSuccess}
                  </div>
                )}
                {followUpError && (
                  <div className="status-feedback status-feedback--error">
                    <IconAlertTriangle size={14} /> {followUpError}
                  </div>
                )}

                {/* Follow-up current status summary */}
                <div className="followup-summary-box">
                  {lead.nextFollowUpDate ? (
                    <div className="followup-scheduled-view">
                      <div className="followup-date-row">
                        <span className="followup-date-label">Scheduled Date & Time:</span>
                        <span className="followup-date-val">{formatDate(lead.nextFollowUpDate)}</span>
                      </div>
                      {lead.nextFollowUpRemarks && (
                        <div className="followup-remarks-row">
                          <span className="followup-remarks-label">Purpose / Reminder:</span>
                          <p className="followup-remarks-text">{lead.nextFollowUpRemarks}</p>
                        </div>
                      )}
                      <div className="followup-actions">
                        <button
                          type="button"
                          className="btn-complete-followup"
                          onClick={() => {
                            setShowCompleteForm(!showCompleteForm);
                            setShowFollowUpForm(false);
                          }}
                        >
                          <IconCheckCircle size={14} /> Mark Completed
                        </button>
                        <button
                          type="button"
                          className="btn-reschedule-followup"
                          onClick={() => {
                            setShowFollowUpForm(!showFollowUpForm);
                            setShowCompleteForm(false);
                          }}
                        >
                          <IconCalendar size={14} /> Reschedule
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="followup-empty-view">
                      <p className="followup-empty-text">No pending follow-up scheduled for this prospect.</p>
                      <button
                        type="button"
                        className="btn-schedule-new"
                        onClick={() => {
                          setShowFollowUpForm(!showFollowUpForm);
                          setShowCompleteForm(false);
                        }}
                      >
                        <IconPlus size={14} /> Schedule Follow-Up
                      </button>
                    </div>
                  )}
                </div>

                {/* Complete Follow-up Form */}
                {showCompleteForm && (
                  <form className="drawer-subform complete-subform" onSubmit={handleCompleteFollowUp}>
                    <h4 className="drawer-subform__title">Complete Follow-Up</h4>
                    <label htmlFor="complete-notes" className="drawer-subform__label">
                      Outcome Notes & Feedback (Optional):
                    </label>
                    <textarea
                      id="complete-notes"
                      className="drawer-subform__textarea"
                      placeholder="e.g. Spoke to client, explained 3BHK duplex layout, scheduled site visit for Sunday."
                      value={completeNotesInput}
                      onChange={(e) => setCompleteNotesInput(e.target.value)}
                      rows={3}
                      maxLength={2000}
                    />
                    {completeError && (
                      <div className="status-feedback status-feedback--error">
                        <IconAlertTriangle size={14} /> {completeError}
                      </div>
                    )}
                    <div className="drawer-subform__footer">
                      <button
                        type="button"
                        className="btn-subform-cancel"
                        onClick={() => setShowCompleteForm(false)}
                        disabled={completeLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-subform-submit"
                        disabled={completeLoading}
                      >
                        {completeLoading ? 'Saving...' : 'Confirm Completed'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Schedule/Reschedule Form */}
                {showFollowUpForm && (
                  <form className="drawer-subform schedule-subform" onSubmit={handleScheduleFollowUp}>
                    <h4 className="drawer-subform__title">
                      {lead.nextFollowUpDate ? 'Reschedule Follow-Up' : 'Schedule New Follow-Up'}
                    </h4>
                    <div className="drawer-subform__group">
                      <label htmlFor="followup-date" className="drawer-subform__label">
                        Follow-up Date & Time <span className="req">*</span>:
                      </label>
                      <input
                        type="datetime-local"
                        id="followup-date"
                        className="drawer-subform__input"
                        min={getMinDateTime()}
                        value={followUpDateInput}
                        onChange={(e) => setFollowUpDateInput(e.target.value)}
                        required
                      />
                    </div>
                    <div className="drawer-subform__group">
                      <label htmlFor="followup-remarks" className="drawer-subform__label">
                        Follow-up Purpose / Reminder:
                      </label>
                      <input
                        type="text"
                        id="followup-remarks"
                        className="drawer-subform__input"
                        placeholder="e.g. Discuss loan eligibility & payment schedule"
                        value={followUpRemarksInput}
                        onChange={(e) => setFollowUpRemarksInput(e.target.value)}
                        maxLength={500}
                      />
                    </div>
                    {followUpError && (
                      <div className="status-feedback status-feedback--error">
                        <IconAlertTriangle size={14} /> {followUpError}
                      </div>
                    )}
                    <div className="drawer-subform__footer">
                      <button
                        type="button"
                        className="btn-subform-cancel"
                        onClick={() => setShowFollowUpForm(false)}
                        disabled={followUpLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-subform-submit"
                        disabled={followUpLoading}
                      >
                        {followUpLoading ? 'Saving...' : 'Save Follow-Up'}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* SECTION: Activity Timeline */}
              <div className="drawer-card drawer-card--timeline">
                <div className="drawer-card__header">
                  <div className="drawer-card__header-title-group">
                    <span className="drawer-card__title">Activity Timeline & Logs</span>
                    <span className="activity-count-badge">{activities.length}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-toggle-activity-form"
                    onClick={() => setShowActivityForm(!showActivityForm)}
                  >
                    <IconPlus size={14} /> Log Activity
                  </button>
                </div>

                {activitySuccess && (
                  <div className="status-feedback status-feedback--success">
                    <IconCheck size={14} /> {activitySuccess}
                  </div>
                )}
                {activityError && (
                  <div className="status-feedback status-feedback--error">
                    <IconAlertTriangle size={14} /> {activityError}
                  </div>
                )}

                {/* Add Activity Subform */}
                {showActivityForm && (
                  <form className="drawer-subform activity-subform" onSubmit={handleRecordActivity}>
                    <h4 className="drawer-subform__title">Record Direct Interaction</h4>
                    <div className="activity-type-picker">
                      <label className="drawer-subform__label">Channel / Interaction Type:</label>
                      <div className="activity-type-buttons">
                        {[
                          { type: 'call', label: 'Call', icon: <IconPhone size={13} /> },
                          { type: 'whatsapp', label: 'WhatsApp', icon: <IconMessageCircle size={13} /> },
                          { type: 'meeting', label: 'Meeting', icon: <IconUsers size={13} /> },
                          { type: 'email', label: 'Email', icon: <IconMail size={13} /> },
                          { type: 'note', label: 'Note', icon: <IconFileText size={13} /> },
                        ].map((btn) => (
                          <button
                            key={btn.type}
                            type="button"
                            className={`activity-type-chip ${activityType === btn.type ? 'active' : ''}`}
                            onClick={() => setActivityType(btn.type)}
                          >
                            {btn.icon}
                            <span>{btn.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="drawer-subform__group">
                      <label htmlFor="activity-summary" className="drawer-subform__label">
                        Interaction Notes & Discussion Details <span className="req">*</span>:
                      </label>
                      <textarea
                        id="activity-summary"
                        className="drawer-subform__textarea"
                        placeholder="e.g. Called client. Expressed keen interest in corner 3BHK villa. Sent brochure on WhatsApp."
                        value={activitySummary}
                        onChange={(e) => setActivitySummary(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        required
                      />
                      <span className="char-counter">{activitySummary.length} / 2000</span>
                    </div>

                    <div className="drawer-subform__footer">
                      <button
                        type="button"
                        className="btn-subform-cancel"
                        onClick={() => setShowActivityForm(false)}
                        disabled={activityLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-subform-submit"
                        disabled={activityLoading}
                      >
                        {activityLoading ? 'Saving...' : 'Record Activity'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Timeline Items List */}
                <div className="activity-timeline-feed">
                  {activitiesLoading ? (
                    <div className="activity-loading">
                      <IconRefresh size={16} className="spin" />
                      <span>Loading history...</span>
                    </div>
                  ) : activities.length === 0 ? (
                    <div className="activity-empty">
                      <IconFileText size={20} className="activity-empty__icon" />
                      <p className="activity-empty__text">No interactions logged yet. Log a call or note above.</p>
                    </div>
                  ) : (
                    <div className="timeline-items">
                      {activities.map((act) => {
                        const config = ACTIVITY_TYPE_CONFIG[act.type] || {
                          label: act.type,
                          color: 'slate',
                        };
                        return (
                          <div key={act._id} className={`timeline-entry timeline-entry--${config.color}`}>
                            <div className="timeline-entry__marker">
                              <span className="timeline-entry__icon-wrap">
                                {renderActivityIcon(act.type)}
                              </span>
                              <div className="timeline-entry__line" />
                            </div>
                            <div className="timeline-entry__content">
                              <div className="timeline-entry__header">
                                <span className={`timeline-type-pill timeline-type-pill--${config.color}`}>
                                  {config.label}
                                </span>
                                <span className="timeline-entry__date">
                                  {formatDate(act.performedAt || act.createdAt)}
                                </span>
                              </div>
                              <p className="timeline-entry__summary">{act.summary}</p>
                              {act.performedBy && (
                                <div className="timeline-entry__actor">
                                  <span className="actor-name">{act.performedBy.name}</span>
                                  <span className="actor-role">
                                    {act.performedBy.role === 'admin' ? 'Admin' : 'Sales Rep'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

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
                    <span className="attribute-item__label">Acquisition Channel</span>
                    <span className="attribute-item__value">
                      {formatSourceLabel(lead.source)}
                    </span>
                  </div>
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
