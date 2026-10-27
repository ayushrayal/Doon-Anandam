import mongoose from 'mongoose';
import ImportBatch from '../models/ImportBatch.js';
import ImportedLead from '../models/ImportedLead.js';
import Activity from '../models/Activity.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import {
  parseAndPreviewWorkbook,
  confirmImportBatch,
  generateImportTemplate,
  safeUnlink,
} from '../services/leadImport.service.js';
import { computeFollowUpIndicator } from './lead.controller.js';
import { ALLOWED_STATUS_TRANSITIONS } from '../schemas/lead.schema.js';

/**
 * Defense-in-depth helper: guarantees only authenticated users with verified Admin role can execute import logic.
 */
export function requireAdmin(req) {
  if (!req.user || req.user.role !== 'admin') {
    const error = new Error('Forbidden: Only Administrators can access Excel Import operations.');
    error.status = 403;
    error.code = 'FORBIDDEN_ADMIN_ONLY';
    throw error;
  }
}

/**
 * Defense-in-depth helper: allows Admin and Sales Executive to access imported lead records,
 * while rejecting unauthorized or deactivated users.
 */
export function requireRecordAccess(req) {
  if (!req.user || !['admin', 'sales_executive'].includes(req.user.role)) {
    const error = new Error('Forbidden: You do not have permission to access imported lead records.');
    error.status = 403;
    error.code = 'FORBIDDEN_RECORD_ACCESS';
    throw error;
  }
}

/**
 * GET /api/leads/import/template
 * Downloads a pre-formatted Excel workbook template for lead importing.
 */
export async function downloadTemplate(req, res, next) {
  try {
    requireAdmin(req);
    const workbook = await generateImportTemplate();
    const filename = 'Doon_Anandam_Lead_Import_Template.xlsx';

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/leads/import/preview
 * Accepts uploaded Excel file, validates rows, identifies duplicates, and saves a preview batch with TTL.
 */
export async function previewImport(req, res, next) {
  const filePath = req.file?.path;

  try {
    requireAdmin(req);
    if (!req.file || (!req.file.path && !req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please upload a valid .xlsx workbook.',
      });
    }

    const preview = await parseAndPreviewWorkbook({
      filePath: req.file.path,
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      fileSizeBytes: req.file.size,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      message: 'Workbook parsed and validated successfully.',
      data: preview,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        missingRequired: err.missingRequired,
        ignoredColumns: err.ignoredColumns,
      });
    }
    next(err);
  } finally {
    if (filePath) {
      await safeUnlink(filePath);
    }
  }
}

/**
 * POST /api/leads/import/confirm
 * Atomically confirms a previewed batch, inserts valid leads, and records audit activity.
 */
export async function confirmImport(req, res, next) {
  try {
    requireAdmin(req);
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: 'Import batch ID is required.',
      });
    }

    const result = await confirmImportBatch({
      batchId,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: err.code,
      });
    }
    next(err);
  }
}

/**
 * GET /api/leads/import/history
 * Returns paginated list of completed/historical import batches for the account.
 */
export async function getImportHistory(req, res, next) {
  try {
    requireAdmin(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const filter = {
      accountId,
      status: { $in: ['completed', 'failed'] },
    };

    const [batches, total] = await Promise.all([
      ImportBatch.find(filter)
        .select('-rows')
        .populate('uploadedBy', '_id name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ImportBatch.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        batches,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/leads/import/history/:batchId
 * Returns detailed row-level breakdown and error details for a single batch.
 */
export async function getImportBatchDetails(req, res, next) {
  try {
    requireAdmin(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { batchId } = req.params;

    const batch = await ImportBatch.findOne({ _id: batchId, accountId })
      .populate('uploadedBy', '_id name email role')
      .lean();

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Import batch not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: batch,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/leads/import/records
 * Returns paginated list of imported leads for the account (completely decoupled from /api/leads).
 */
export async function getImportedRecords(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const {
      status,
      assignedTo,
      source,
      batchId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = { accountId, isDeleted: { $ne: true } };

    // Role scoping: sales_executive can ONLY see their assigned imported leads
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    } else if (req.user.role === 'admin') {
      if (assignedTo === 'unassigned') {
        filter.assignedTo = null;
      } else if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
        filter.assignedTo = new mongoose.Types.ObjectId(assignedTo);
      }
    }

    if (batchId && mongoose.Types.ObjectId.isValid(batchId)) {
      filter.importBatchId = new mongoose.Types.ObjectId(batchId);
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (source && source !== 'all') {
      filter.source = source;
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { fullName: searchRegex },
        { phoneNumber: searchRegex },
        { email: searchRegex },
        { campaignName: searchRegex },
      ];
    }

    const sort = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    sort[sortBy] = order;

    const [total, rawDocs] = await Promise.all([
      ImportedLead.countDocuments(filter),
      ImportedLead.find(filter)
        .populate('assignedTo', '_id name email role')
        .populate('importBatchId', '_id originalFilename')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const records = rawDocs.map((doc) => ({
      ...doc,
      followUpIndicator: computeFollowUpIndicator(doc.nextFollowUpDate, doc.status),
    }));

    return res.status(200).json({
      success: true,
      data: {
        records,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/leads/import/records/:id
 * Retrieve single imported lead details.
 */
export async function getImportedRecordById(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
    }

    const filter = { _id: id, accountId, isDeleted: { $ne: true } };
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await ImportedLead.findOne(filter)
      .populate('assignedTo', '_id name email role')
      .populate('importBatchId', '_id originalFilename createdAt')
      .lean();

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Imported lead not found.' });
    }

    lead.followUpIndicator = computeFollowUpIndicator(lead.nextFollowUpDate, lead.status);

    return res.status(200).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/leads/import/records/:id/status
 * Update imported lead status with lifecycle transition validation.
 */
export async function updateImportedRecordStatus(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { id } = req.params;
    const { status: targetStatus, note, lostReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
    }

    const filter = { _id: id, accountId, isDeleted: { $ne: true } };
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await ImportedLead.findOne(filter);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Imported lead not found.' });
    }

    if (lead.status !== targetStatus) {
      const allowedNext = ALLOWED_STATUS_TRANSITIONS[lead.status] || [];
      if (!allowedNext.includes(targetStatus)) {
        return res.status(400).json({
          success: false,
          message: `Cannot transition status from '${lead.status}' to '${targetStatus}'.`,
        });
      }
    }

    const previousStatus = lead.status;
    lead.status = targetStatus;
    if (note && note.trim()) {
      lead.notes = lead.notes
        ? `${lead.notes}\n\n[Status Change - ${new Date().toISOString().slice(0, 10)}] ${note.trim()}`
        : `[Status Change - ${new Date().toISOString().slice(0, 10)}] ${note.trim()}`;
    }
    await lead.save();

    // Log status transition activity
    await Activity.create({
      leadId: lead._id,
      leadModel: 'ImportedLead',
      accountId,
      type: 'status_change',
      summary: `Lead status changed from ${previousStatus} to ${targetStatus}${
        note ? `: ${note.trim()}` : ''
      }${lostReason ? ` (Reason: ${lostReason})` : ''}`,
      performedBy: req.user._id,
      metadata: { previousStatus, newStatus: targetStatus, lostReason },
    });

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully.',
      data: lead,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/leads/import/records/:id/follow-up
 * Schedule follow-up on imported lead.
 */
export async function scheduleImportedRecordFollowUp(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { id } = req.params;
    const { date, nextFollowUpDate, remarks } = req.body;
    const rawDate = date || nextFollowUpDate;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
    }

    const filter = { _id: id, accountId, isDeleted: { $ne: true } };
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await ImportedLead.findOne(filter);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Imported lead not found.' });
    }

    const parsedDate = new Date(rawDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid follow-up date.' });
    }

    const isReschedule = Boolean(lead.nextFollowUpDate);
    lead.nextFollowUpDate = parsedDate;
    lead.nextFollowUpRemarks = remarks ? String(remarks).trim() : '';
    await lead.save();

    await Activity.create({
      leadId: lead._id,
      leadModel: 'ImportedLead',
      accountId,
      type: isReschedule ? 'follow_up_rescheduled' : 'follow_up_scheduled',
      summary: `Follow-up ${isReschedule ? 'rescheduled' : 'scheduled'} for ${parsedDate.toISOString().slice(0, 10)}${
        remarks ? `: ${remarks.trim()}` : ''
      }`,
      performedBy: req.user._id,
      metadata: { followUpDate: parsedDate, remarks },
    });

    return res.status(200).json({
      success: true,
      message: `Follow-up ${isReschedule ? 'rescheduled' : 'scheduled'} successfully.`,
      data: lead,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/leads/import/records/:id/follow-up/complete
 * Complete follow-up on imported lead.
 */
export async function completeImportedRecordFollowUp(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { id } = req.params;
    const { outcomeNotes } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
    }

    const filter = { _id: id, accountId, isDeleted: { $ne: true } };
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await ImportedLead.findOne(filter);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Imported lead not found.' });
    }

    const now = new Date();
    lead.lastFollowUpCompletedAt = now;
    lead.nextFollowUpDate = null;
    lead.nextFollowUpRemarks = '';
    await lead.save();

    await Activity.create({
      leadId: lead._id,
      leadModel: 'ImportedLead',
      accountId,
      type: 'follow_up_completed',
      summary: `Follow-up marked completed${outcomeNotes ? `: ${outcomeNotes.trim()}` : ''}`,
      performedBy: req.user._id,
      metadata: { outcomeNotes },
    });

    return res.status(200).json({
      success: true,
      message: 'Follow-up marked as completed.',
      data: lead,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/leads/import/records/:id/activities
 * Retrieve activity timeline for an imported lead.
 */
export async function getImportedRecordActivities(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
    }

    const filter = { _id: id, accountId, isDeleted: { $ne: true } };
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await ImportedLead.findOne(filter).select('_id');
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Imported lead not found.' });
    }

    const activities = await Activity.find({
      leadId: id,
      leadModel: 'ImportedLead',
      accountId,
    })
      .populate('performedBy', '_id name email role')
      .sort({ performedAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: activities });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/leads/import/records/:id/activities
 * Log direct activity on an imported lead.
 */
export async function createImportedRecordActivity(req, res, next) {
  try {
    requireRecordAccess(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { id } = req.params;
    const { type, summary, metadata = {} } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
    }

    const filter = { _id: id, accountId, isDeleted: { $ne: true } };
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await ImportedLead.findOne(filter);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Imported lead not found.' });
    }

    if (!type || !['call', 'whatsapp', 'meeting', 'email', 'note'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid activity type.' });
    }

    if (!summary || !summary.trim()) {
      return res.status(400).json({ success: false, message: 'Activity summary is required.' });
    }

    const activity = await Activity.create({
      leadId: lead._id,
      leadModel: 'ImportedLead',
      accountId,
      type,
      summary: summary.trim(),
      performedBy: req.user._id,
      metadata,
    });

    return res.status(201).json({
      success: true,
      message: 'Activity logged successfully.',
      data: activity,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/leads/import/records/bulk/assign
 * Bulk assign or unassign multiple imported leads to an active sales representative or admin.
 * Admin-only operation.
 */
export async function bulkAssignImportedRecords(req, res, next) {
  try {
    requireAdmin(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { leadIds, assignedTo } = req.body;
    const uniqueLeadIds = [...new Set(leadIds)];

    let targetUser = null;
    if (assignedTo !== null) {
      targetUser = await User.findById(assignedTo);
      if (!targetUser) {
        return res.status(400).json({
          success: false,
          message: 'Assigned user does not exist.',
        });
      }
      if (!targetUser.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Cannot assign leads to a deactivated user.',
        });
      }
      if (!['admin', 'sales_executive'].includes(targetUser.role)) {
        return res.status(400).json({
          success: false,
          message: `Cannot assign leads to user with role '${targetUser.role}'.`,
        });
      }
    }

    const filter = {
      _id: { $in: uniqueLeadIds },
      accountId,
      isDeleted: { $ne: true },
    };

    const recordsToUpdate = await ImportedLead.find(filter).select('_id accountId assignedTo');
    const foundIdSet = new Set(recordsToUpdate.map((l) => l._id.toString()));
    const successfulIds = [];
    const failedIds = uniqueLeadIds.filter((id) => !foundIdSet.has(id));

    if (recordsToUpdate.length > 0) {
      const targetId = targetUser ? targetUser._id : null;
      await ImportedLead.updateMany(
        { _id: { $in: recordsToUpdate.map((l) => l._id) } },
        { $set: { assignedTo: targetId } }
      );
      successfulIds.push(...recordsToUpdate.map((l) => l._id.toString()));

      const activityDocs = recordsToUpdate.map((l) => ({
        leadId: l._id,
        leadModel: 'ImportedLead',
        accountId: l.accountId,
        type: 'note',
        summary: targetUser
          ? `Imported lead assigned to ${targetUser.name} (${targetUser.role === 'admin' ? 'Admin' : 'Sales Representative'}) via bulk action.`
          : 'Imported lead unassigned via bulk action.',
        performedBy: req.user._id,
        metadata: { assignedTo: targetId, bulk: true },
      }));

      try {
        await Activity.insertMany(activityDocs);
      } catch (actErr) {
        console.error('[Activity Error] Failed to insert bulk assign activities:', actErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: targetUser
        ? `Assigned ${successfulIds.length} imported lead${successfulIds.length === 1 ? '' : 's'} to ${targetUser.name}.`
        : `Unassigned ${successfulIds.length} imported lead${successfulIds.length === 1 ? '' : 's'}.`,
      data: {
        requestedCount: uniqueLeadIds.length,
        successCount: successfulIds.length,
        failedCount: failedIds.length,
        successfulIds,
        failedIds,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/leads/import/records/bulk/delete
 * Bulk soft-delete multiple imported leads.
 * Admin-only operation.
 */
export async function bulkDeleteImportedRecords(req, res, next) {
  try {
    requireAdmin(req);
    const accountId = env.WINDSOR_ACCOUNT_ID;
    const { leadIds } = req.body;
    const uniqueLeadIds = [...new Set(leadIds)];

    const filter = {
      _id: { $in: uniqueLeadIds },
      accountId,
      isDeleted: { $ne: true },
    };

    const recordsToDelete = await ImportedLead.find(filter).select('_id accountId');
    const foundIdSet = new Set(recordsToDelete.map((l) => l._id.toString()));
    const successfulIds = [];
    const failedIds = uniqueLeadIds.filter((id) => !foundIdSet.has(id));

    if (recordsToDelete.length > 0) {
      const now = new Date();
      await ImportedLead.updateMany(
        { _id: { $in: recordsToDelete.map((l) => l._id) } },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
            deletedBy: req.user._id,
          },
        }
      );
      successfulIds.push(...recordsToDelete.map((l) => l._id.toString()));

      const activityDocs = recordsToDelete.map((l) => ({
        leadId: l._id,
        leadModel: 'ImportedLead',
        accountId: l.accountId,
        type: 'note',
        summary: 'Imported lead soft-deleted via bulk action.',
        performedBy: req.user._id,
        metadata: { deletedAt: now, bulk: true },
      }));

      try {
        await Activity.insertMany(activityDocs);
      } catch (actErr) {
        console.error('[Activity Error] Failed to insert bulk delete activities:', actErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Deleted ${successfulIds.length} imported lead${successfulIds.length === 1 ? '' : 's'} successfully.`,
      data: {
        requestedCount: uniqueLeadIds.length,
        successCount: successfulIds.length,
        failedCount: failedIds.length,
        successfulIds,
        failedIds,
      },
    });
  } catch (err) {
    next(err);
  }
}
