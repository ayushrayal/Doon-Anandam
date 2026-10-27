import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../auth/index.js';
import { useRouter } from '../../../app/routing/RouterContext.jsx';
import { apiFetch, apiDownload, API_BASE } from '../../../shared/lib/api.js';
import { LoadingState } from '../../../shared/components/LoadingState.jsx';
import { EmptyState } from '../../../shared/components/EmptyState.jsx';
import { StatusBadge } from '../../../shared/components/StatusBadge.jsx';
import { formatSourceLabel } from '../../../shared/lib/formatters.js';
import {
  IconFileSpreadsheet,
  IconDownload,
  IconUpload,
  IconCheckCircle,
  IconAlertTriangle,
  IconClose,
  IconClock,
  IconHistory,
  IconSearch,
  IconUsers,
  IconPhone,
  IconMail,
  IconCalendar,
  IconPlus,
  IconTrash,
} from '../../../shared/components/Icons.jsx';
import './ImportPage.scss';

export function ImportPage() {
  const { user, isAdmin } = useAuth();
  const { navigate } = useRouter();

  // Tab State: 'import' | 'records' | 'history'
  const [activeTab, setActiveTab] = useState(isAdmin ? 'import' : 'records');

  // Import Workflow State: 'upload' | 'preview' | 'completed'
  const [stage, setStage] = useState('upload');
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');

  // Preview Data
  const [previewData, setPreviewData] = useState(null);
  const [previewFilter, setPreviewFilter] = useState('all'); // 'all' | 'valid' | 'duplicate' | 'error'

  // Completion Data
  const [completeResult, setCompleteResult] = useState(null);

  // History State
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBatches, setHistoryBatches] = useState([]);
  const [selectedBatchDetails, setSelectedBatchDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Imported Records State
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [importedRecords, setImportedRecords] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordSearch, setRecordSearch] = useState('');
  const [recordStatusFilter, setRecordStatusFilter] = useState('all');
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordDrawerLoading, setRecordDrawerLoading] = useState(false);
  const [activeActivities, setActiveActivities] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [newFollowUpDate, setNewFollowUpDate] = useState('');
  const [newFollowUpRemarks, setNewFollowUpRemarks] = useState('');
  const [actionFeedback, setActionFeedback] = useState('');

  // Bulk Selection State for Imported Records
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [bulkAssignModalOpen, setBulkAssignModalOpen] = useState(false);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkAssignTarget, setBulkAssignTarget] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [activeUsers, setActiveUsers] = useState([]);

  const fileInputRef = useRef(null);

  const isSalesExecutive = user?.role === 'sales_executive';
  const hasAccess = isAdmin || isSalesExecutive;

  // Lock non-admins strictly to the 'records' tab
  useEffect(() => {
    if (!isAdmin && activeTab !== 'records') {
      setActiveTab('records');
    }
  }, [isAdmin, activeTab]);

  // If user is unauthenticated or has an unauthorized role, redirect to dashboard
  useEffect(() => {
    if (!hasAccess) {
      navigate('/dashboard');
    }
  }, [hasAccess, navigate]);

  // Load Active Users for Bulk Assignment (Admin only)
  useEffect(() => {
    if (isAdmin) {
      apiFetch('/users?isActive=true&limit=50')
        .then((res) => {
          if (res && res.users) setActiveUsers(res.users);
        })
        .catch((err) => console.error('[Load Users Error]', err));
    }
  }, [isAdmin]);

  if (!hasAccess) {
    return (
      <div className="import-page-unauthorized" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
        <h2>Access Restricted</h2>
        <p style={{ marginTop: '0.5rem', color: '#64748b' }}>
          You do not have permission to access imported leads. Redirecting to dashboard...
        </p>
      </div>
    );
  }

  // Reset bulk selection on tab switch, search, or status filter change
  useEffect(() => {
    setSelectedRecordIds([]);
  }, [activeTab, recordSearch, recordStatusFilter]);

  // Bulk Selection Handlers
  const toggleRecordSelection = (recordId) => {
    setSelectedRecordIds((prev) =>
      prev.includes(recordId) ? prev.filter((id) => id !== recordId) : [...prev, recordId]
    );
  };

  const handleSelectAllRecordsOnPage = () => {
    const allSelected =
      importedRecords.length > 0 &&
      importedRecords.every((r) => selectedRecordIds.includes(r._id));
    if (allSelected) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(importedRecords.map((r) => r._id));
    }
  };

  const handleConfirmBulkAssign = async () => {
    if (!bulkAssignTarget || selectedRecordIds.length === 0 || bulkActionLoading) return;
    setBulkActionLoading(true);
    try {
      const assignedToVal = bulkAssignTarget === 'unassigned' ? null : bulkAssignTarget;
      const res = await apiFetch('/leads/import/records/bulk/assign', {
        method: 'POST',
        body: JSON.stringify({
          leadIds: selectedRecordIds,
          assignedTo: assignedToVal,
        }),
      });
      setErrorBanner('');
      setSelectedRecordIds([]);
      setBulkAssignModalOpen(false);
      loadImportedRecords();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to bulk assign imported leads.');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedRecordIds.length === 0 || bulkActionLoading) return;
    setBulkActionLoading(true);
    try {
      const res = await apiFetch('/leads/import/records/bulk/delete', {
        method: 'POST',
        body: JSON.stringify({
          leadIds: selectedRecordIds,
        }),
      });
      setErrorBanner('');
      setSelectedRecordIds([]);
      setBulkDeleteModalOpen(false);
      loadImportedRecords();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to bulk delete imported leads.');
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Load Import History
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch('/leads/import/history?page=1&limit=25');
      if (res && res.data) {
        setHistoryBatches(res.data.batches || []);
      }
    } catch (err) {
      console.error('[Load Import History Error]', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load Imported Records
  const loadImportedRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '50' });
      if (recordSearch.trim()) params.set('search', recordSearch.trim());
      if (recordStatusFilter !== 'all') params.set('status', recordStatusFilter);

      const res = await apiFetch(`/leads/import/records?${params.toString()}`);
      if (res && res.data) {
        setImportedRecords(res.data.records || []);
        setRecordsTotal(res.data.pagination?.total || 0);
      }
    } catch (err) {
      console.error('[Load Imported Records Error]', err);
    } finally {
      setRecordsLoading(false);
    }
  }, [recordSearch, recordStatusFilter]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    } else if (activeTab === 'records') {
      loadImportedRecords();
    }
  }, [activeTab, loadHistory, loadImportedRecords]);

  // Load Single Record Details & Activities for Drawer
  const openRecordDrawer = async (recordId) => {
    setSelectedRecordId(recordId);
    setRecordDrawerLoading(true);
    setActionFeedback('');
    try {
      const [leadRes, actRes] = await Promise.all([
        apiFetch(`/leads/import/records/${recordId}`),
        apiFetch(`/leads/import/records/${recordId}/activities`),
      ]);
      if (leadRes && leadRes.data) setSelectedRecord(leadRes.data);
      if (actRes && actRes.data) setActiveActivities(actRes.data);
    } catch (err) {
      setErrorBanner('Failed to load lead details.');
    } finally {
      setRecordDrawerLoading(false);
    }
  };

  // Add Note Activity
  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedRecordId) return;
    try {
      await apiFetch(`/leads/import/records/${selectedRecordId}/activities`, {
        method: 'POST',
        body: JSON.stringify({ type: 'note', summary: newNote.trim() }),
      });
      setNewNote('');
      setActionFeedback('Note logged successfully.');
      // Refresh activities
      const actRes = await apiFetch(`/leads/import/records/${selectedRecordId}/activities`);
      if (actRes && actRes.data) setActiveActivities(actRes.data);
    } catch (err) {
      setErrorBanner(err.message || 'Failed to add note.');
    }
  };

  // Schedule Follow-Up
  const handleScheduleFollowUp = async () => {
    if (!newFollowUpDate || !selectedRecordId) return;
    try {
      const res = await apiFetch(`/leads/import/records/${selectedRecordId}/follow-up`, {
        method: 'POST',
        body: JSON.stringify({
          date: newFollowUpDate,
          remarks: newFollowUpRemarks.trim(),
        }),
      });
      if (res && res.data) setSelectedRecord(res.data);
      setNewFollowUpDate('');
      setNewFollowUpRemarks('');
      setActionFeedback('Follow-up scheduled successfully.');
      const actRes = await apiFetch(`/leads/import/records/${selectedRecordId}/activities`);
      if (actRes && actRes.data) setActiveActivities(actRes.data);
      loadImportedRecords();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to schedule follow-up.');
    }
  };

  // Complete Follow-Up
  const handleCompleteFollowUp = async () => {
    if (!selectedRecordId) return;
    try {
      const res = await apiFetch(`/leads/import/records/${selectedRecordId}/follow-up/complete`, {
        method: 'PATCH',
      });
      if (res && res.data) setSelectedRecord(res.data);
      setActionFeedback('Follow-up marked completed.');
      const actRes = await apiFetch(`/leads/import/records/${selectedRecordId}/activities`);
      if (actRes && actRes.data) setActiveActivities(actRes.data);
      loadImportedRecords();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to complete follow-up.');
    }
  };

  // Update Status
  const handleStatusChange = async (targetStatus) => {
    if (!selectedRecordId || selectedRecord?.status === targetStatus) return;
    try {
      const res = await apiFetch(`/leads/import/records/${selectedRecordId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus }),
      });
      if (res && res.data) setSelectedRecord(res.data);
      setActionFeedback(`Status updated to ${targetStatus}.`);
      const actRes = await apiFetch(`/leads/import/records/${selectedRecordId}/activities`);
      if (actRes && actRes.data) setActiveActivities(actRes.data);
      loadImportedRecords();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to update status.');
    }
  };

  // Handle Download Sample Template
  const handleDownloadTemplate = async () => {
    setTemplateLoading(true);
    setErrorBanner('');
    try {
      await apiDownload('/leads/import/template', 'Doon_Anandam_Lead_Import_Template.xlsx');
    } catch (err) {
      setErrorBanner(err.message || 'Failed to download sample template.');
    } finally {
      setTemplateLoading(false);
    }
  };

  // Upload and parse workbook to generate preview (25 MB limit)
  const handleProcessFile = async (selectedFile) => {
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
      setErrorBanner('Invalid file type. Please upload a genuine Excel (.xlsx) file.');
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      setErrorBanner('File exceeds maximum size of 25 MB.');
      return;
    }

    setFile(selectedFile);
    setErrorBanner('');
    setUploadLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${API_BASE}/leads/import/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(json.message || `Upload failed with status ${response.status}`);
      }

      setPreviewData(json.data);
      setStage('preview');
      setPreviewFilter('all');
    } catch (err) {
      setErrorBanner(err.message || 'Failed to process spreadsheet.');
      setFile(null);
    } finally {
      setUploadLoading(false);
    }
  };

  // Confirm Import
  const handleConfirmImport = async () => {
    if (!previewData || !previewData.batchId || confirmLoading) return;

    setConfirmLoading(true);
    setErrorBanner('');

    try {
      const res = await apiFetch('/leads/import/confirm', {
        method: 'POST',
        body: JSON.stringify({ batchId: previewData.batchId }),
      });

      if (res && res.data) {
        setCompleteResult(res.data);
        setStage('completed');
      }
    } catch (err) {
      setErrorBanner(err.message || 'Failed to confirm import batch.');
    } finally {
      setConfirmLoading(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  // View batch details in modal
  const handleViewBatchDetails = async (batchId) => {
    setDetailsLoading(true);
    try {
      const res = await apiFetch(`/leads/import/history/${batchId}`);
      if (res && res.data) {
        setSelectedBatchDetails(res.data);
      }
    } catch (err) {
      setErrorBanner('Failed to load batch details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  // Filter preview rows
  const filteredPreviewRows = (previewData?.previewRows || []).filter((r) => {
    if (previewFilter === 'all') return true;
    return r.status === previewFilter;
  });

  return (
    <div className="import-page">
      {/* Top Header */}
      <div className="import-page__header">
        <div className="import-page__title-group">
          <h1 className="import-page__title">
            {isAdmin ? 'Excel Lead Import' : 'Assigned Imported Leads'}
          </h1>
          <p className="import-page__subtitle">
            {isAdmin
              ? 'Upload, validate, and manage client leads in a dedicated workflow, completely separated from Meta/Windsor sync.'
              : 'View, track, and manage all Excel imported client leads assigned to you.'}
          </p>
        </div>

        {isAdmin && (
          <div className="import-page__header-actions">
            <button
              type="button"
              className="template-btn"
              onClick={handleDownloadTemplate}
              disabled={templateLoading}
              title="Download formatted sample Excel template (.xlsx)"
            >
              <IconDownload size={15} />
              <span>{templateLoading ? 'Generating...' : 'Download Template'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Tab Navigation (Only visible to Admin) */}
      {isAdmin && (
        <div className="import-page__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'import'}
            className={`tab-btn ${activeTab === 'import' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <IconFileSpreadsheet size={16} />
            <span>Import Leads</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'records'}
            className={`tab-btn ${activeTab === 'records' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('records')}
          >
            <IconUsers size={16} />
            <span>Imported Leads {recordsTotal > 0 && `(${recordsTotal.toLocaleString()})`}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`tab-btn ${activeTab === 'history' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <IconHistory size={16} />
            <span>Import History</span>
          </button>
        </div>
      )}

      {/* Global Error Banner */}
      {errorBanner && (
        <div className="import-page__error-banner" role="alert">
          <IconAlertTriangle size={18} className="error-icon" />
          <span className="error-message">{errorBanner}</span>
          <button
            type="button"
            className="dismiss-btn"
            onClick={() => setErrorBanner('')}
            aria-label="Dismiss message"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* TAB 1: IMPORT LEADS */}
      {activeTab === 'import' && (
        <div className="import-workflow">
          {/* STAGE 1: UPLOAD */}
          {stage === 'upload' && (
            <div className="upload-stage">
              <div
                className={`upload-dropzone ${dragActive ? 'upload-dropzone--drag' : ''} ${
                  uploadLoading ? 'upload-dropzone--loading' : ''
                }`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => !uploadLoading && fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden-file-input"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleProcessFile(e.target.files[0]);
                    }
                  }}
                />

                {uploadLoading ? (
                  <div className="dropzone-loading">
                    <LoadingState message="Analyzing workbook, validating schemas, and checking duplicates..." />
                  </div>
                ) : (
                  <div className="dropzone-content">
                    <div className="dropzone-icon-circle">
                      <IconUpload size={32} />
                    </div>
                    <h3 className="dropzone-title">Click to upload or drag & drop workbook</h3>
                    <p className="dropzone-subtitle">
                      Supports Excel files (<strong>.xlsx</strong>) up to <strong>25 MB</strong> (maximum 2,000 rows)
                    </p>
                    <span className="dropzone-cta-badge">Select File</span>
                  </div>
                )}
              </div>

              {/* Instructions & Guidelines Card */}
              <div className="import-guidelines-card">
                <h4 className="guidelines-title">Spreadsheet Guidelines & Field Rules</h4>
                <div className="guidelines-grid">
                  <div className="guidelines-col">
                    <span className="col-header required-col">Required Columns</span>
                    <ul className="guidelines-list">
                      <li>
                        <strong>Full Name:</strong> Customer's full name (e.g. "Aarav Sharma")
                      </li>
                      <li>
                        <strong>Phone Number:</strong> 10-15 digits (e.g. "9876543210" or "+919876543210")
                      </li>
                    </ul>
                  </div>

                  <div className="guidelines-col">
                    <span className="col-header optional-col">Optional Columns</span>
                    <ul className="guidelines-list">
                      <li>
                        <strong>Email Address:</strong> Valid client email (e.g. "client@example.com")
                      </li>
                      <li>
                        <strong>Status:</strong> New, Contacted, Follow Up, Qualified, Lost, Converted
                      </li>
                      <li>
                        <strong>Assigned Executive:</strong> Matches active CRM user. Leave blank or use <code>Unassigned</code> for unassigned leads.
                      </li>
                      <li>
                        <strong>Source:</strong> Walk-in, Referral, Exhibition, Google Ads, Meta, Website, etc.
                      </li>
                    </ul>
                  </div>

                  <div className="guidelines-col">
                    <span className="col-header system-col">Pipeline Separation & Duplicate Policy</span>
                    <ul className="guidelines-list">
                      <li>
                        <strong>Pipeline Isolation:</strong> Imported leads are maintained strictly in the Excel Import workspace and do NOT mix into Meta/Windsor leads.
                      </li>
                      <li>
                        <strong>Skip Duplicates:</strong> Existing CRM leads with matching phones or emails are automatically skipped and never overwritten.
                      </li>
                      <li>
                        <strong>Extra Columns:</strong> Any unsupported columns (e.g. City, Budget) are safely ignored without failing the workbook.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: PREVIEW & CONFIRMATION */}
          {stage === 'preview' && previewData && (
            <div className="preview-stage">
              {/* Stat Summary Cards */}
              <div className="preview-stats-grid">
                <div className="stat-card stat-card--total">
                  <span className="stat-label">Total Rows Analyzed</span>
                  <span className="stat-value">{previewData.totalRows.toLocaleString()}</span>
                </div>

                <div className="stat-card stat-card--valid">
                  <span className="stat-label">Ready to Ingest</span>
                  <span className="stat-value">{previewData.validCount.toLocaleString()}</span>
                  <span className="stat-subtext">Passes validation & uniqueness</span>
                </div>

                <div className="stat-card stat-card--duplicate">
                  <span className="stat-label">Duplicates to Skip</span>
                  <span className="stat-value">{previewData.duplicateCount.toLocaleString()}</span>
                  <span className="stat-subtext">Will not overwrite existing leads</span>
                </div>

                <div className="stat-card stat-card--error">
                  <span className="stat-label">Validation Errors</span>
                  <span className="stat-value">{previewData.errorCount.toLocaleString()}</span>
                  <span className="stat-subtext">Missing name or invalid phone</span>
                </div>
              </div>

              {/* Ignored Columns Warning Notice */}
              {previewData.ignoredColumns && previewData.ignoredColumns.length > 0 && (
                <div className="ignored-columns-notice">
                  <IconAlertTriangle size={16} />
                  <span>
                    Notice: <strong>{previewData.ignoredColumns.length}</strong> extra column(s) will be safely ignored:{' '}
                    <code>{previewData.ignoredColumns.join(', ')}</code>.
                  </span>
                </div>
              )}

              {/* Preview Table Header & Filters */}
              <div className="preview-table-card">
                <div className="preview-table-toolbar">
                  <div className="toolbar-info">
                    <h3 className="toolbar-title">Spreadsheet Data Preview</h3>
                    <span className="toolbar-count">
                      Showing sample of first {previewData.previewRows.length} rows from{' '}
                      <em>{previewData.originalFilename}</em>
                    </span>
                  </div>

                  <div className="preview-filter-buttons" role="group" aria-label="Filter preview rows">
                    <button
                      type="button"
                      className={`filter-btn ${previewFilter === 'all' ? 'filter-btn--active' : ''}`}
                      onClick={() => setPreviewFilter('all')}
                    >
                      All ({previewData.previewRows.length})
                    </button>
                    <button
                      type="button"
                      className={`filter-btn filter-btn--valid ${
                        previewFilter === 'valid' ? 'filter-btn--active' : ''
                      }`}
                      onClick={() => setPreviewFilter('valid')}
                    >
                      Ready ({previewData.validCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-btn filter-btn--duplicate ${
                        previewFilter === 'duplicate' ? 'filter-btn--active' : ''
                      }`}
                      onClick={() => setPreviewFilter('duplicate')}
                    >
                      Duplicates ({previewData.duplicateCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-btn filter-btn--error ${
                        previewFilter === 'error' ? 'filter-btn--active' : ''
                      }`}
                      onClick={() => setPreviewFilter('error')}
                    >
                      Errors ({previewData.errorCount})
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="preview-table-wrapper">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Row</th>
                        <th style={{ width: '110px' }}>Status</th>
                        <th>Full Name</th>
                        <th>Phone Number</th>
                        <th>Email Address</th>
                        <th>Status</th>
                        <th>Executive</th>
                        <th>Source</th>
                        <th>Validation Notes / Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPreviewRows.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="empty-cell">
                            No rows match the selected filter ({previewFilter}).
                          </td>
                        </tr>
                      ) : (
                        filteredPreviewRows.map((row) => {
                          const d = row.data || {};
                          return (
                            <tr key={row.rowNumber} className={`row-status--${row.status}`}>
                              <td className="row-num-cell">#{row.rowNumber}</td>
                              <td>
                                <span className={`status-pill status-pill--${row.status}`}>
                                  {row.status === 'valid' && 'Ready'}
                                  {row.status === 'duplicate' && 'Duplicate'}
                                  {row.status === 'error' && 'Error'}
                                </span>
                              </td>
                              <td className="cell-name">{d.fullName || '—'}</td>
                              <td className="cell-phone">{d.phoneNumber || '—'}</td>
                              <td className="cell-email">{d.email || '—'}</td>
                              <td className="cell-status">{d.status || 'new'}</td>
                              <td className="cell-exec">{d.assignedName || 'Unassigned'}</td>
                              <td className="cell-source">{d.source || 'manual'}</td>
                              <td className="cell-reason">
                                {row.status === 'duplicate' && (
                                  <span className="reason-duplicate">{row.reason}</span>
                                )}
                                {row.status === 'error' && (
                                  <span className="reason-error">
                                    {(row.errors || []).join(' ')}
                                  </span>
                                )}
                                {row.status === 'valid' && (
                                  <span className="reason-valid">Passed validation</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Actions Footer */}
                <div className="preview-actions-footer">
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setStage('upload');
                      setFile(null);
                      setPreviewData(null);
                    }}
                    disabled={confirmLoading}
                  >
                    Cancel / Choose Another File
                  </button>

                  <div className="confirm-group">
                    <span className="confirm-summary-note">
                      {previewData.validCount > 0 ? (
                        <>
                          Ready to ingest <strong>{previewData.validCount}</strong> lead
                          {previewData.validCount === 1 ? '' : 's'}.{' '}
                          {previewData.duplicateCount > 0 &&
                            `(${previewData.duplicateCount} duplicates will be skipped)`}
                        </>
                      ) : (
                        'No valid leads to ingest.'
                      )}
                    </span>

                    <button
                      type="button"
                      className="confirm-btn"
                      onClick={handleConfirmImport}
                      disabled={confirmLoading || previewData.validCount === 0}
                    >
                      <IconCheckCircle size={16} />
                      <span>
                        {confirmLoading
                          ? 'Importing Leads...'
                          : `Confirm & Import ${previewData.validCount} Leads`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 3: COMPLETED CELEBRATION */}
          {stage === 'completed' && completeResult && (
            <div className="completed-stage">
              <div className="completed-card">
                <div className="completed-icon-wrapper">
                  <IconCheckCircle size={48} className="check-icon" />
                </div>
                <h2 className="completed-title">Lead Import Finished Successfully</h2>
                <p className="completed-subtitle">
                  {completeResult.message || 'All valid records have been securely added to your Excel Import workspace.'}
                </p>

                <div className="completed-metrics-box">
                  <div className="metric-item">
                    <span className="metric-label">Successfully Ingested</span>
                    <span className="metric-val text-green">
                      {completeResult.insertedCount?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="metric-divider" />
                  <div className="metric-item">
                    <span className="metric-label">Duplicates Skipped</span>
                    <span className="metric-val text-amber">
                      {completeResult.skippedCount?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="metric-divider" />
                  <div className="metric-item">
                    <span className="metric-label">Errors / Failed</span>
                    <span className="metric-val text-red">
                      {completeResult.errorCount?.toLocaleString() || 0}
                    </span>
                  </div>
                </div>

                <div className="completed-actions">
                  <button
                    type="button"
                    className="view-pipeline-btn"
                    onClick={() => setActiveTab('records')}
                  >
                    View Imported Leads
                  </button>

                  <button
                    type="button"
                    className="import-another-btn"
                    onClick={() => {
                      setStage('upload');
                      setFile(null);
                      setPreviewData(null);
                      setCompleteResult(null);
                    }}
                  >
                    Import Another Spreadsheet
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IMPORTED LEADS (SEPARATE PIPELINE) */}
      {activeTab === 'records' && (
        <div className="records-tab">
          {/* Controls Bar */}
          <div className="records-toolbar">
            <div className="search-box">
              <IconSearch size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search imported leads by name or phone number"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
              />
              {recordSearch && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setRecordSearch('')}
                >
                  <IconClose size={14} />
                </button>
              )}
            </div>

            <div className="filter-dropdowns">
              <select
                value={recordStatusFilter}
                onChange={(e) => setRecordStatusFilter(e.target.value)}
                className="status-select"
              >
                <option value="all">All Stages</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="follow_up">Follow Up</option>
                <option value="qualified">Qualified</option>
                <option value="converted">Converted</option>
                <option value="lost">Lost</option>
              </select>
            </div>
          </div>

          {/* Records Table */}
          {recordsLoading ? (
            <LoadingState message="Loading imported leads..." />
          ) : importedRecords.length === 0 ? (
            <EmptyState
              title={isAdmin ? 'No Imported Leads Found' : 'No Assigned Leads Found'}
              message={
                recordSearch || recordStatusFilter !== 'all'
                  ? 'No imported leads match your search or filter criteria.'
                  : isAdmin
                  ? 'No Excel leads have been imported yet. Use the "Import Leads" tab to upload your first workbook.'
                  : 'You currently have no imported leads assigned to you.'
              }
            />
          ) : (
            <div className="records-table-card">
              <table className="records-table">
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={{ width: '44px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label="Select all imported leads on current page"
                          checked={
                            importedRecords.length > 0 &&
                            importedRecords.every((r) => selectedRecordIds.includes(r._id))
                          }
                          onChange={handleSelectAllRecordsOnPage}
                        />
                      </th>
                    )}
                    <th>Lead Name</th>
                    <th>Phone Number</th>
                    <th>Email Address</th>
                    <th>Stage</th>
                    <th>Assigned Executive</th>
                    <th>Source</th>
                    <th>Campaign / Project</th>
                    <th>Next Follow-Up</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {importedRecords.map((lead) => {
                    const followUpDateStr = lead.nextFollowUpDate
                      ? new Date(lead.nextFollowUpDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—';

                    return (
                      <tr
                        key={lead._id}
                        onClick={() => openRecordDrawer(lead._id)}
                        className={`record-row-clickable ${
                          selectedRecordIds.includes(lead._id) ? 'record-row--selected' : ''
                        }`}
                      >
                        {isAdmin && (
                          <td
                            style={{ width: '44px', textAlign: 'center' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${lead.fullName}`}
                              checked={selectedRecordIds.includes(lead._id)}
                              onChange={() => toggleRecordSelection(lead._id)}
                            />
                          </td>
                        )}
                        <td className="lead-name-cell">
                          <strong>{lead.fullName}</strong>
                        </td>
                        <td className="phone-cell">{lead.phoneNumber}</td>
                        <td className="email-cell">{lead.email || '—'}</td>
                        <td>
                          <StatusBadge status={lead.status} />
                        </td>
                        <td className="exec-cell">
                          {lead.assignedTo?.name || (
                            <span className="unassigned-tag">Unassigned</span>
                          )}
                        </td>
                        <td className="source-cell">{formatSourceLabel(lead.source)}</td>
                        <td className="campaign-cell">{lead.campaignName || '—'}</td>
                        <td className="followup-cell">
                          <span className={`followup-indicator followup-indicator--${lead.followUpIndicator}`}>
                            {followUpDateStr}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="manage-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRecordDrawer(lead._id);
                            }}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: IMPORT HISTORY */}
      {activeTab === 'history' && (
        <div className="history-tab">
          {historyLoading ? (
            <LoadingState message="Loading historical import batches..." />
          ) : historyBatches.length === 0 ? (
            <EmptyState
              title="No Import History"
              message="No Excel spreadsheets have been imported into this CRM account yet."
            />
          ) : (
            <div className="history-table-card">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Batch ID</th>
                    <th>Date & Time</th>
                    <th>Filename</th>
                    <th>Imported By</th>
                    <th>Total Rows</th>
                    <th>Created</th>
                    <th>Skipped</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyBatches.map((b) => {
                    const dateStr = b.createdAt
                      ? new Date(b.createdAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—';

                    return (
                      <tr key={b._id}>
                        <td className="batch-id-cell">#{b._id.slice(-6)}</td>
                        <td className="date-cell">{dateStr}</td>
                        <td className="filename-cell" title={b.originalFilename}>
                          <IconFileSpreadsheet size={14} />
                          <span>{b.originalFilename}</span>
                        </td>
                        <td className="user-cell">{b.uploadedBy?.name || 'Administrator'}</td>
                        <td className="rows-cell">{b.totalRows || 0}</td>
                        <td className="created-cell text-green">
                          +{b.summary?.insertedCount ?? b.validCount ?? 0}
                        </td>
                        <td className="skipped-cell text-amber">
                          {b.duplicateCount || 0}
                        </td>
                        <td>
                          <span
                            className={`history-status-badge history-status-badge--${
                              b.status === 'completed' ? 'completed' : 'failed'
                            }`}
                          >
                            {b.status === 'completed' ? 'Completed' : 'Failed'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="details-btn"
                            onClick={() => handleViewBatchDetails(b._id)}
                            disabled={detailsLoading}
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Record Details & Management Drawer */}
      {selectedRecordId && (
        <div className="drawer-backdrop" onClick={() => setSelectedRecordId(null)}>
          <div className="record-drawer" onClick={(e) => e.stopPropagation()}>
            {recordDrawerLoading || !selectedRecord ? (
              <LoadingState message="Loading imported lead details..." />
            ) : (
              <>
                <div className="drawer-header">
                  <div className="drawer-title-group">
                    <h2 className="drawer-lead-name">{selectedRecord.fullName}</h2>
                    <span className="drawer-lead-sub">
                      Imported Lead • Batch #{selectedRecord.importBatchId?._id?.slice(-6) || '—'} •{' '}
                      {new Date(selectedRecord.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="drawer-close-btn"
                    onClick={() => setSelectedRecordId(null)}
                    aria-label="Close drawer"
                  >
                    <IconClose size={20} />
                  </button>
                </div>

                {actionFeedback && (
                  <div className="action-feedback-banner">{actionFeedback}</div>
                )}

                <div className="drawer-body">
                  {/* Lead Info Grid */}
                  <div className="drawer-info-grid">
                    <div className="info-item">
                      <span className="info-label">Phone Number</span>
                      <span className="info-val">
                        <IconPhone size={14} /> {selectedRecord.phoneNumber}
                      </span>
                    </div>

                    <div className="info-item">
                      <span className="info-label">Email Address</span>
                      <span className="info-val">
                        <IconMail size={14} /> {selectedRecord.email || '—'}
                      </span>
                    </div>

                    <div className="info-item">
                      <span className="info-label">Acquisition Channel</span>
                      <span className="info-val">
                        {formatSourceLabel(selectedRecord.source)}
                      </span>
                    </div>

                    <div className="info-item">
                      <span className="info-label">Assigned Executive</span>
                      <span className="info-val">
                        {selectedRecord.assignedTo?.name || 'Unassigned'}
                      </span>
                    </div>
                  </div>

                  {/* Stage Transition Selector */}
                  <div className="drawer-section">
                    <h4 className="section-title">Pipeline Stage</h4>
                    <div className="stage-selector">
                      {['new', 'contacted', 'follow_up', 'qualified', 'converted', 'lost'].map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            className={`stage-pill ${
                              selectedRecord.status === st ? 'stage-pill--active' : ''
                            }`}
                            onClick={() => handleStatusChange(st)}
                          >
                            {st.replace('_', ' ')}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Follow-up Section */}
                  <div className="drawer-section">
                    <h4 className="section-title">Follow-up Management</h4>
                    {selectedRecord.nextFollowUpDate ? (
                      <div className="active-followup-card">
                        <div className="followup-info">
                          <IconClock size={16} />
                          <span>
                            Scheduled: <strong>{new Date(selectedRecord.nextFollowUpDate).toLocaleDateString()}</strong>
                            {selectedRecord.nextFollowUpRemarks && ` — ${selectedRecord.nextFollowUpRemarks}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="complete-followup-btn"
                          onClick={handleCompleteFollowUp}
                        >
                          Mark Completed
                        </button>
                      </div>
                    ) : (
                      <div className="no-followup-notice">No active follow-up scheduled.</div>
                    )}

                    <div className="schedule-followup-form">
                      <input
                        type="date"
                        value={newFollowUpDate}
                        onChange={(e) => setNewFollowUpDate(e.target.value)}
                        className="date-input"
                      />
                      <input
                        type="text"
                        placeholder="Remarks or call agenda..."
                        value={newFollowUpRemarks}
                        onChange={(e) => setNewFollowUpRemarks(e.target.value)}
                        className="remarks-input"
                      />
                      <button
                        type="button"
                        onClick={handleScheduleFollowUp}
                        disabled={!newFollowUpDate}
                        className="schedule-btn"
                      >
                        Schedule
                      </button>
                    </div>
                  </div>

                  {/* Notes & Activity Timeline */}
                  <div className="drawer-section">
                    <h4 className="section-title">Add Operational Note</h4>
                    <div className="add-note-box">
                      <textarea
                        rows={3}
                        placeholder="Log client discussion or note..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={handleAddNote}
                        disabled={!newNote.trim()}
                        className="save-note-btn"
                      >
                        Save Note
                      </button>
                    </div>

                    <h4 className="section-title" style={{ marginTop: '1.5rem' }}>
                      Activity History ({activeActivities.length})
                    </h4>
                    <div className="activity-timeline">
                      {activeActivities.length === 0 ? (
                        <div className="no-activities">No activities recorded yet.</div>
                      ) : (
                        activeActivities.map((act) => (
                          <div key={act._id} className="timeline-item">
                            <div className="timeline-dot" />
                            <div className="timeline-content">
                              <span className="timeline-summary">{act.summary}</span>
                              <span className="timeline-meta">
                                {new Date(act.performedAt).toLocaleString()} •{' '}
                                {act.performedBy?.name || 'Administrator'}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Batch Details Modal */}
      {selectedBatchDetails && (
        <div className="modal-backdrop" onClick={() => setSelectedBatchDetails(null)}>
          <div className="batch-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <h3 className="modal-title">
                  Import Batch #{selectedBatchDetails._id.slice(-6)} Details
                </h3>
                <span className="modal-subtitle">
                  {selectedBatchDetails.originalFilename} •{' '}
                  {new Date(selectedBatchDetails.createdAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedBatchDetails(null)}
              >
                <IconClose size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-summary-grid">
                <div className="summary-pill">
                  <span>Total:</span> <strong>{selectedBatchDetails.totalRows}</strong>
                </div>
                <div className="summary-pill text-green">
                  <span>Created:</span>{' '}
                  <strong>
                    {selectedBatchDetails.summary?.insertedCount ??
                      selectedBatchDetails.validCount}
                  </strong>
                </div>
                <div className="summary-pill text-amber">
                  <span>Skipped:</span> <strong>{selectedBatchDetails.duplicateCount}</strong>
                </div>
                <div className="summary-pill text-red">
                  <span>Errors:</span> <strong>{selectedBatchDetails.errorCount}</strong>
                </div>
              </div>

              {selectedBatchDetails.ignoredColumns?.length > 0 && (
                <div className="modal-ignored-notice">
                  Ignored columns: {selectedBatchDetails.ignoredColumns.join(', ')}
                </div>
              )}

              <h4 className="modal-section-title">Row Log Details</h4>
              <div className="modal-rows-table-wrapper">
                <table className="modal-rows-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Status</th>
                      <th>Full Name</th>
                      <th>Phone</th>
                      <th>Reason / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedBatchDetails.rows || []).slice(0, 50).map((r) => (
                      <tr key={r.rowNumber} className={`modal-row--${r.status}`}>
                        <td>#{r.rowNumber}</td>
                        <td>
                          <span className={`status-pill status-pill--${r.status}`}>
                            {r.status}
                          </span>
                        </td>
                        <td>{r.data?.fullName || '—'}</td>
                        <td>{r.data?.phoneNumber || '—'}</td>
                        <td className="reason-text">
                          {r.reason || (r.errors || []).join(' ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-done-btn"
                onClick={() => setSelectedBatchDetails(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar for Imported Leads (Admin only) */}
      {isAdmin && activeTab === 'records' && selectedRecordIds.length > 0 && (
        <div className="bulk-action-bar">
          <div className="bulk-action-bar__left">
            <span className="bulk-selection-count">
              <strong>{selectedRecordIds.length}</strong> imported lead{selectedRecordIds.length === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              className="bulk-cancel-btn"
              onClick={() => setSelectedRecordIds([])}
            >
              Cancel Selection
            </button>
          </div>
          <div className="bulk-action-bar__actions">
            {isAdmin && (
              <>
                <button
                  type="button"
                  className="bulk-action-btn bulk-action-btn--assign"
                  onClick={() => {
                    setBulkAssignTarget('');
                    setBulkAssignModalOpen(true);
                  }}
                >
                  <IconUsers size={16} />
                  <span>Assign</span>
                </button>
                <button
                  type="button"
                  className="bulk-action-btn bulk-action-btn--delete"
                  onClick={() => setBulkDeleteModalOpen(true)}
                >
                  <IconTrash size={16} />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bulk Assign Modal for Imported Leads */}
      {bulkAssignModalOpen && (
        <div className="modal-overlay" onClick={() => !bulkActionLoading && setBulkAssignModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Bulk Assign Imported Leads</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setBulkAssignModalOpen(false)}
                disabled={bulkActionLoading}
              >
                <IconClose size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Select an executive to assign to the <strong>{selectedRecordIds.length}</strong> selected imported lead(s).
              </p>
              <div className="modal-form-group">
                <label htmlFor="bulk-assign-imported-select" className="modal-label">Assign To</label>
                <select
                  id="bulk-assign-imported-select"
                  className="modal-select"
                  value={bulkAssignTarget}
                  onChange={(e) => setBulkAssignTarget(e.target.value)}
                  disabled={bulkActionLoading}
                >
                  <option value="">-- Choose Executive --</option>
                  <option value="unassigned">Unassign (Remove Assignment)</option>
                  {activeUsers.map((u) => (
                    <option key={u.id || u._id} value={u.id || u._id}>
                      {u.name} ({u.role === 'admin' ? 'Admin' : 'Sales Representative'})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => setBulkAssignModalOpen(false)}
                disabled={bulkActionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                onClick={handleConfirmBulkAssign}
                disabled={!bulkAssignTarget || bulkActionLoading}
              >
                {bulkActionLoading ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal for Imported Leads */}
      {bulkDeleteModalOpen && (
        <div className="modal-overlay" onClick={() => !bulkActionLoading && setBulkDeleteModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Delete Selected Imported Leads</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={bulkActionLoading}
              >
                <IconClose size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-warning-box">
                <IconAlertTriangle size={20} className="modal-warning-icon" />
                <div>
                  <strong>Warning:</strong> You are about to delete <strong>{selectedRecordIds.length}</strong> imported lead(s).
                </div>
              </div>
              <p className="modal-desc">
                These records will be removed from your active imported leads pipeline. Their activity history will be retained for audit purposes.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={bulkActionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleConfirmBulkDelete}
                disabled={bulkActionLoading}
              >
                {bulkActionLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
