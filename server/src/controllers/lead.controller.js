import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import { env } from '../config/env.js';
import { ALLOWED_STATUS_TRANSITIONS } from '../schemas/lead.schema.js';
import { syncFacebookLeads } from '../services/leadSync.service.js';
import { invalidateAnalyticsCache, computeDateBounds } from './analytics.controller.js';

export const MAX_EXPORT_LIMIT = 5000;

/**
 * Computes the operational follow-up indicator for a given follow-up date.
 * Returns: 'overdue' | 'today' | 'upcoming' | 'none'
 */
export function computeFollowUpIndicator(nextFollowUpDate, status = null) {
  if (status === 'converted' || status === 'lost') return 'none';
  if (!nextFollowUpDate) return 'none';
  const target = new Date(nextFollowUpDate);
  if (isNaN(target.getTime())) return 'none';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (target < todayStart) {
    return 'overdue';
  } else if (target <= todayEnd) {
    return 'today';
  } else {
    return 'upcoming';
  }
}

/**
 * Strips internal integration provider metadata (syncProvider) and attaches
 * dynamic operational indicators before returning leads to the client.
 */
export function formatLeadResponse(leadDoc) {
  if (!leadDoc) return null;
  const leadObj = leadDoc.toObject ? leadDoc.toObject() : { ...leadDoc };
  delete leadObj.syncProvider;
  leadObj.followUpIndicator = computeFollowUpIndicator(leadObj.nextFollowUpDate, leadObj.status);
  return leadObj;
}

/**
 * Sanitizes cell values to neutralize spreadsheet formula injection vulnerabilities.
 * Prefixes strings starting with =, +, -, @, \t, \r with a single quote.
 */
export function sanitizeForExcel(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Maps database acquisition source to clean user-facing label.
 */
export function getExportSourceLabel(source) {
  if (!source) return 'Unknown';
  const s = source.toLowerCase();
  if (s === 'meta' || s.startsWith('facebook') || s.startsWith('fb')) return 'Meta';
  if (s === 'google' || s.startsWith('google')) return 'Google';
  if (s === 'manual') return 'Manual Entry';
  if (s === 'website') return 'Website';
  return source;
}

/**
 * Canonical query builder for leads.
 * Reused across paginated listing and full Excel export to guarantee 100% parameter parity.
 */
export async function buildLeadQueryFilter(query, user) {
  const {
    status = 'all',
    assignedTo,
    source,
    search,
    startDate,
    endDate,
    dateFilter,
    preset,
    followUpStatus = 'all',
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = query;

  // 1. Account isolation: scope to configured business account
  const filter = {
    isDeleted: { $ne: true },
  };
  if (env.WINDSOR_ACCOUNT_ID) {
    filter.accountId = env.WINDSOR_ACCOUNT_ID;
  }

  // 2. Role scoping: sales_executive can ONLY see their assigned leads
  if (user.role === 'sales_executive') {
    filter.assignedTo = user._id;
  } else if (user.role === 'admin') {
    if (assignedTo === 'unassigned') {
      filter.assignedTo = null;
    } else if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
      filter.assignedTo = assignedTo;
    }
  }

  // 3. Status filter
  if (status && status !== 'all') {
    filter.status = status;
  }

  // 4. Source filter (supports 'meta' mapping to Facebook/Meta lead channels)
  if (source && source.trim() && source !== 'all') {
    const src = source.trim();
    if (src.toLowerCase() === 'meta') {
      filter.source = { $in: ['meta', 'facebook_leads', 'facebook', 'facebook_ads'] };
    } else {
      filter.source = src;
    }
  }

  // 5. Follow-up status filter (reconciled with Dashboard operational workload definitions)
  if (followUpStatus && followUpStatus !== 'all') {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (followUpStatus === 'completed') {
      const datePreset = dateFilter || preset || 'all';
      const dateBounds = computeDateBounds(datePreset, startDate, endDate);
      const completedActivityFilter = {
        type: 'follow_up_completed',
        leadModel: { $ne: 'ImportedLead' },
      };
      if (env.WINDSOR_ACCOUNT_ID) {
        completedActivityFilter.accountId = env.WINDSOR_ACCOUNT_ID;
      }
      if (user.role === 'sales_executive') {
        completedActivityFilter.performedBy = user._id;
      } else if (user.role === 'admin' && assignedTo) {
        if (assignedTo !== 'all' && mongoose.Types.ObjectId.isValid(assignedTo)) {
          completedActivityFilter.performedBy = new mongoose.Types.ObjectId(assignedTo);
        }
      }
      if (dateBounds.start || dateBounds.end) {
        completedActivityFilter.performedAt = {};
        if (dateBounds.start) completedActivityFilter.performedAt.$gte = dateBounds.start;
        if (dateBounds.end) completedActivityFilter.performedAt.$lte = dateBounds.end;
      }

      const completedLeadIds = await Activity.distinct('leadId', completedActivityFilter).maxTimeMS(5000);
      filter._id = { $in: completedLeadIds };
    } else if (followUpStatus === 'scheduled') {
      filter.nextFollowUpDate = { $type: 'date' };
      if (!filter.status) {
        filter.status = { $nin: ['converted', 'lost'] };
      }
    } else if (followUpStatus === 'none') {
      filter.nextFollowUpDate = { $in: [null, undefined] };
      if (!filter.status) {
        filter.status = { $nin: ['converted', 'lost'] };
      }
    } else if (followUpStatus === 'overdue') {
      filter.nextFollowUpDate = { $type: 'date', $lt: todayStart };
      if (!filter.status) {
        filter.status = { $nin: ['converted', 'lost'] };
      }
    } else if (followUpStatus === 'today') {
      filter.nextFollowUpDate = { $type: 'date', $gte: todayStart, $lte: todayEnd };
      if (!filter.status) {
        filter.status = { $nin: ['converted', 'lost'] };
      }
    } else if (followUpStatus === 'upcoming') {
      filter.nextFollowUpDate = { $type: 'date', $gt: todayEnd };
      if (!filter.status) {
        filter.status = { $nin: ['converted', 'lost'] };
      }
    }
  }

  // 6. Date range filter on leadCreatedAt (or fallback to createdAt)
  if ((startDate || endDate) && followUpStatus !== 'completed') {
    const dateCond = {};
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        dateCond.$gte = start;
      }
    }
    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        if (endDate.length === 10) {
          end.setUTCHours(23, 59, 59, 999);
        }
        dateCond.$lte = end;
      }
    }
    if (Object.keys(dateCond).length > 0) {
      const dateMatch = [
        { leadCreatedAt: dateCond },
        { leadCreatedAt: { $exists: false }, createdAt: dateCond },
        { leadCreatedAt: null, createdAt: dateCond },
      ];
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: filter.$or });
        filter.$and.push({ $or: dateMatch });
        delete filter.$or;
      } else {
        filter.$or = dateMatch;
      }
    }
  }

  // 7. Search across fullName and phoneNumber only (case-insensitive name, partial phone)
  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escaped, 'i');
    const searchMatch = [
      { fullName: searchRegex },
      { phoneNumber: searchRegex },
    ];
    if (filter.$or) {
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: filter.$or });
      filter.$and.push({ $or: searchMatch });
      delete filter.$or;
    } else {
      filter.$or = searchMatch;
    }
  }

  // 8. Safe sorting
  const sortField = ['createdAt', 'leadCreatedAt', 'fullName', 'status', 'nextFollowUpDate'].includes(sortBy)
    ? sortBy
    : 'createdAt';
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortField]: sortDirection };

  return { filter, sort, sortField };
}

/**
 * GET /api/leads
 * Paginated lead listing with search, filtering, and safe sorting.
 *
 * Scopes:
 * - Account isolation: Scoped to env.WINDSOR_ACCOUNT_ID.
 * - Role scoping: Sales executives can ONLY see leads assigned to them.
 * - Pagination: Default 10, max 50.
 */
export const getLeads = async (req, res, next) => {
  try {
    const query = req.validatedQuery || req.query;
    const { page = 1, limit = 10 } = query;

    const { filter, sort, sortField } = await buildLeadQueryFilter(query, req.user);

    // 9. Pagination with sensible caps
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Fast path: When filter matches an empty _id.$in array (e.g. no completed follow-ups in period),
    // immediately return empty results without issuing redundant countDocuments and find queries.
    if (filter._id && Array.isArray(filter._id.$in) && filter._id.$in.length === 0) {
      return res.status(200).json({
        success: true,
        leads: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 1,
        },
        page: pageNum,
        limit: limitNum,
        total: 0,
        totalPages: 1,
      });
    }

    let leadQuery = Lead.find(filter)
      .select('-__v')
      .populate('assignedTo', '_id name email role')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .maxTimeMS(5000)
      .lean();

    // Collation is strictly needed only for alphabetical sorting on textual fullName
    // Leaving it off for Date and ID sorting allows standard B-tree index scans
    if (sortField === 'fullName') {
      leadQuery = leadQuery.collation({ locale: 'en' });
    }

    const [total, rawLeads] = await Promise.all([
      Lead.countDocuments(filter).maxTimeMS(5000),
      leadQuery,
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    // Attach dynamic operational indicators and strip internal syncProvider
    const leads = rawLeads.map(formatLeadResponse);

    return res.status(200).json({
      success: true,
      leads,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    });
  } catch (err) {
    if (
      err.name === 'MongoServerError' &&
      (err.code === 50 || err.message?.includes('time limit') || err.message?.includes('execution terminated'))
    ) {
      return res.status(504).json({
        success: false,
        message: 'Lead query timed out. Please refine your filter parameters.',
      });
    }
    next(err);
  }
};

/**
 * GET /api/leads/export
 * Streams a genuine, formatted Excel (.xlsx) workbook containing ALL leads matching
 * active filter criteria, without page/limit pagination constraints.
 */
export const exportLeadsExcel = async (req, res, next) => {
  try {
    const query = req.validatedQuery || req.query;
    const { filter, sort } = await buildLeadQueryFilter(query, req.user);

    // Fast path: When filter matches an empty _id.$in array, avoid querying countDocuments
    if (filter._id && Array.isArray(filter._id.$in) && filter._id.$in.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No leads found matching the selected filter criteria to export.',
      });
    }

    // 1. Pre-flight check: total count
    const totalCount = await Lead.countDocuments(filter).maxTimeMS(5000);

    if (totalCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No leads found matching the selected filter criteria to export.',
      });
    }

    if (totalCount > MAX_EXPORT_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `Export limit exceeded: Found ${totalCount.toLocaleString()} matching leads. The maximum export size is ${MAX_EXPORT_LIMIT.toLocaleString()} leads. Please refine your date range or filter criteria before exporting.`,
      });
    }

    // 2. Set response headers for binary XLSX download
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const filename = `Doon_Anandam_Leads_${dateStr}_${timeStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // 3. Initialize streaming Excel workbook
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true,
      useSharedStrings: true,
    });

    const worksheet = workbook.addWorksheet('Leads Pipeline', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    // 4. Configure columns with widths
    worksheet.columns = [
      { header: 'Lead ID', key: 'id', width: 26 },
      { header: 'External ID', key: 'externalLeadId', width: 20 },
      { header: 'Full Name', key: 'fullName', width: 24 },
      { header: 'Phone Number', key: 'phoneNumber', width: 18 },
      { header: 'Email Address', key: 'email', width: 28 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Assigned Executive', key: 'assignedTo', width: 22 },
      { header: 'Acquisition Source', key: 'source', width: 18 },
      { header: 'Campaign Name', key: 'campaignName', width: 28 },
      { header: 'Form Name', key: 'formName', width: 24 },
      { header: 'Ingestion Date', key: 'leadCreatedAt', width: 20 },
      { header: 'Next Follow-Up Date', key: 'nextFollowUpDate', width: 20 },
      { header: 'Follow-Up Remarks', key: 'nextFollowUpRemarks', width: 30 },
      { header: 'Last Completed Follow-Up', key: 'lastFollowUpCompletedAt', width: 22 },
      { header: 'CRM Notes', key: 'notes', width: 36 },
    ];

    // Format Header Row (Navy Blue #1A2C50 with white bold text)
    const headerRow = worksheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1A2C50' },
      };
      cell.font = {
        name: 'Segoe UI',
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 11,
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF007EFF' } },
      };
    });
    headerRow.commit();

    // 5. Query matching leads with Mongoose cursor for memory-safe streaming
    const leadCursor = Lead.find(filter)
      .select('-__v -syncProvider')
      .populate('assignedTo', '_id name email role')
      .sort(sort)
      .maxTimeMS(30000)
      .cursor();

    let rowIndex = 2;

    for await (const doc of leadCursor) {
      const assignedName = doc.assignedTo?.name || 'Unassigned';
      const formattedStatus = doc.status
        ? doc.status.charAt(0).toUpperCase() + doc.status.slice(1).replace('_', ' ')
        : '—';
      const formattedSource = getExportSourceLabel(doc.source);

      const rowValues = {
        id: doc._id.toString(),
        externalLeadId: sanitizeForExcel(doc.externalLeadId || ''),
        fullName: sanitizeForExcel(doc.fullName || ''),
        phoneNumber: sanitizeForExcel(doc.phoneNumber || ''),
        email: sanitizeForExcel(doc.email || ''),
        status: formattedStatus,
        assignedTo: sanitizeForExcel(assignedName),
        source: formattedSource,
        campaignName: sanitizeForExcel(doc.campaignName || 'Organic / Direct'),
        formName: sanitizeForExcel(doc.formName || 'Standard Inquiry'),
        leadCreatedAt: doc.leadCreatedAt
          ? new Date(doc.leadCreatedAt)
          : doc.createdAt
            ? new Date(doc.createdAt)
            : null,
        nextFollowUpDate: doc.nextFollowUpDate ? new Date(doc.nextFollowUpDate) : null,
        nextFollowUpRemarks: sanitizeForExcel(doc.nextFollowUpRemarks || ''),
        lastFollowUpCompletedAt: doc.lastFollowUpCompletedAt
          ? new Date(doc.lastFollowUpCompletedAt)
          : null,
        notes: sanitizeForExcel(doc.notes || ''),
      };

      const row = worksheet.addRow(rowValues);
      row.height = 20;

      // Subtle zebra striping
      const isEven = rowIndex % 2 === 0;
      row.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = { vertical: 'middle' };

        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8F9FA' },
          };
        }

        if (cell.value instanceof Date) {
          cell.numFmt = 'yyyy-mm-dd hh:mm';
        }
      });

      row.commit();
      rowIndex++;
    }

    // Set auto-filter across all columns from row 1 to rowIndex - 1
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rowIndex - 1), column: 15 },
    };

    worksheet.commit();
    await workbook.commit();
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      console.error('[Excel Export Stream Error]', err);
      res.end();
    }
  }
};

/**
 * GET /api/leads/:id
 * Retrieve single lead details with validation, role scoping, and account isolation.
 */
export const getLeadById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    // Sales executive can only view their own assigned lead
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await Lead.findOne(filter)
      .select('-__v')
      .populate('assignedTo', '_id name email role')
      .lean();

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    return res.status(200).json({
      success: true,
      lead: formatLeadResponse(lead),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/leads/:id/status
 * Transition lead status through strict CRM lifecycle states.
 */
export const updateLeadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status: targetStatus, note = '', reason = '' } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    // Sales executive can only update their own assigned lead
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await Lead.findOne(filter);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    const currentStatus = lead.status;
    if (currentStatus === targetStatus) {
      // No-op transition
      await lead.populate('assignedTo', '_id name email role');
      return res.status(200).json({
        success: true,
        message: `Lead is already in '${targetStatus}' status.`,
        lead: formatLeadResponse(lead),
      });
    }

    const allowedNext = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedNext.includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions: ${allowedNext.join(', ')}`,
      });
    }

    lead.status = targetStatus;

    // If an operational note was provided, append it to lead notes for fast reference
    if (note && note.trim()) {
      const timestampStr = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const formattedNote = `[${timestampStr} - ${targetStatus.toUpperCase()}]: ${note.trim()}`;
      lead.notes = lead.notes ? `${lead.notes}\n${formattedNote}` : formattedNote;
    }

    await lead.save();
    await lead.populate('assignedTo', '_id name email role');
    invalidateAnalyticsCache(lead.accountId);

    // Build descriptive activity log summary
    let summaryText = `Lead stage changed from '${currentStatus}' to '${targetStatus}'.`;
    if (targetStatus === 'lost' && reason) {
      summaryText = `Lead marked as Lost. Reason: ${reason}.${note ? ` Note: ${note.trim()}` : ''}`;
    } else if (note && note.trim()) {
      summaryText = `Lead stage changed from '${currentStatus}' to '${targetStatus}'. Note: ${note.trim()}`;
    }

    // Append status transition activity record (guaranteed append-only history)
    try {
      await Activity.create({
        leadId: lead._id,
        accountId: lead.accountId,
        type: 'status_change',
        summary: summaryText,
        performedBy: req.user._id,
        metadata: {
          previousStatus: currentStatus,
          newStatus: targetStatus,
          note: note ? note.trim() : '',
          reason: reason ? reason.trim() : '',
        },
      });
    } catch (actErr) {
      console.error('[Activity Error] Failed to record status change activity:', actErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Lead status updated successfully.',
      lead: formatLeadResponse(lead),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/leads/:id/assign
 * Reassign or unassign lead to an active sales representative or admin.
 * Admin-only operation.
 */
export const assignLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    const lead = await Lead.findOne(filter);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    let targetUser = null;
    if (assignedTo === null) {
      lead.assignedTo = null;
    } else {
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
          message: 'Cannot assign lead to a deactivated user.',
        });
      }

      if (!['admin', 'sales_executive'].includes(targetUser.role)) {
        return res.status(400).json({
          success: false,
          message: `Cannot assign lead to user with role '${targetUser.role}'.`,
        });
      }

      lead.assignedTo = targetUser._id;
    }

    await lead.save();
    await lead.populate('assignedTo', '_id name email role');
    invalidateAnalyticsCache(lead.accountId);

    // Append assignment activity record
    try {
      await Activity.create({
        leadId: lead._id,
        accountId: lead.accountId,
        type: 'note',
        summary: targetUser
          ? `Lead assigned to ${targetUser.name} (${targetUser.role === 'admin' ? 'Admin' : 'Sales Representative'}).`
          : 'Lead unassigned.',
        performedBy: req.user._id,
        metadata: {
          assignedTo: lead.assignedTo,
        },
      });
    } catch (actErr) {
      console.error('[Activity Error] Failed to record assignment activity:', actErr.message);
    }

    return res.status(200).json({
      success: true,
      message: lead.assignedTo ? 'Lead assigned successfully.' : 'Lead unassigned successfully.',
      lead: formatLeadResponse(lead),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/leads/:id/follow-up
 * Schedule or reschedule a sales follow-up.
 */
export const scheduleFollowUp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { followUpDate, remarks = '' } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const targetDate = new Date(followUpDate);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid follow-up date and time format.',
      });
    }

    if (targetDate.getTime() < Date.now() - 5 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: 'Follow-up date and time must be in the future.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await Lead.findOne(filter);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    const isReschedule = Boolean(lead.nextFollowUpDate);
    lead.nextFollowUpDate = targetDate;
    lead.nextFollowUpRemarks = remarks || '';
    await lead.save();
    await lead.populate('assignedTo', '_id name email role');
    invalidateAnalyticsCache(lead.accountId);

    const activityType = isReschedule ? 'follow_up_rescheduled' : 'follow_up_scheduled';
    const formattedDate = targetDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });
    const summaryText = remarks
      ? `${isReschedule ? 'Rescheduled' : 'Scheduled'} follow-up for ${formattedDate}. Reminder: ${remarks}`
      : `${isReschedule ? 'Rescheduled' : 'Scheduled'} follow-up for ${formattedDate}.`;

    await Activity.create({
      leadId: lead._id,
      accountId: lead.accountId,
      leadModel: 'Lead',
      type: activityType,
      summary: summaryText,
      performedBy: req.user._id,
      metadata: {
        scheduledFor: targetDate,
        remarks: remarks || '',
        isReschedule,
      },
    });

    return res.status(200).json({
      success: true,
      message: isReschedule
        ? 'Follow-up rescheduled successfully.'
        : 'Follow-up scheduled successfully.',
      lead: formatLeadResponse(lead),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/leads/:id/follow-up/complete
 * Complete a scheduled follow-up and clear the pending follow-up date.
 */
export const completeFollowUp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes = '' } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await Lead.findOne(filter);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    if (!lead.nextFollowUpDate) {
      return res.status(400).json({
        success: false,
        message: 'No pending follow-up scheduled for this lead.',
      });
    }

    const previousScheduledDate = lead.nextFollowUpDate;
    lead.nextFollowUpDate = null;
    lead.nextFollowUpRemarks = '';
    lead.lastFollowUpCompletedAt = new Date();
    await lead.save();
    await lead.populate('assignedTo', '_id name email role');
    invalidateAnalyticsCache(lead.accountId);

    const summaryText = notes
      ? `Follow-up completed. Notes: ${notes}`
      : 'Follow-up marked as completed.';

    await Activity.create({
      leadId: lead._id,
      accountId: lead.accountId,
      leadModel: 'Lead',
      type: 'follow_up_completed',
      summary: summaryText,
      performedBy: req.user._id,
      metadata: {
        previousScheduledDate,
        completedAt: lead.lastFollowUpCompletedAt,
        notes: notes || '',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Follow-up marked as completed.',
      lead: formatLeadResponse(lead),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leads/:id/activities
 * Retrieve chronological activity timeline for a lead.
 */
export const getLeadActivities = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await Lead.findOne(filter).select('_id accountId').lean();
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    const activities = await Activity.find({ leadId: lead._id })
      .populate('performedBy', '_id name email role')
      .sort({ performedAt: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      activities,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/leads/:id/activities
 * Append an activity record (call, whatsapp, meeting, email, note).
 */
export const createLeadActivity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, summary, metadata = {} } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead ID format.',
      });
    }

    const filter = { _id: id, isDeleted: { $ne: true } };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    }

    const lead = await Lead.findOne(filter);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.',
      });
    }

    const activity = await Activity.create({
      leadId: lead._id,
      accountId: lead.accountId,
      type,
      summary,
      performedBy: req.user._id,
      metadata,
    });

    await activity.populate('performedBy', '_id name email role');
    invalidateAnalyticsCache(lead.accountId);

    return res.status(201).json({
      success: true,
      message: 'Activity recorded successfully.',
      activity,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/leads/sync
 * Admin-only endpoint to trigger manual synchronization from Windsor.ai.
 */
export const syncLeads = async (req, res, next) => {
  try {
    const summary = await syncFacebookLeads();

    return res.status(200).json({
      success: true,
      message: 'Lead synchronization completed successfully.',
      summary,
    });
  } catch (err) {
    const statusCode = err.status || 500;
    const sanitizedMessage =
      statusCode === 500
        ? 'An unexpected error occurred during lead synchronization.'
        : err.message;

    return res.status(statusCode).json({
      success: false,
      message: sanitizedMessage,
    });
  }
};

/**
 * POST /api/leads/bulk/assign
 * Bulk assign or unassign multiple regular leads to an active sales representative or admin.
 * Admin-only operation.
 */
export const bulkAssignLeads = async (req, res, next) => {
  try {
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
      isDeleted: { $ne: true },
    };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    const leadsToUpdate = await Lead.find(filter).select('_id accountId assignedTo');
    const foundIdSet = new Set(leadsToUpdate.map((l) => l._id.toString()));
    const successfulIds = [];
    const failedIds = uniqueLeadIds.filter((id) => !foundIdSet.has(id));

    if (leadsToUpdate.length > 0) {
      const targetId = targetUser ? targetUser._id : null;
      await Lead.updateMany(
        { _id: { $in: leadsToUpdate.map((l) => l._id) } },
        { $set: { assignedTo: targetId } }
      );
      successfulIds.push(...leadsToUpdate.map((l) => l._id.toString()));

      const activityDocs = leadsToUpdate.map((l) => ({
        leadId: l._id,
        leadModel: 'Lead',
        accountId: l.accountId,
        type: 'note',
        summary: targetUser
          ? `Lead assigned to ${targetUser.name} (${targetUser.role === 'admin' ? 'Admin' : 'Sales Representative'}) via bulk action.`
          : 'Lead unassigned via bulk action.',
        performedBy: req.user._id,
        metadata: { assignedTo: targetId, bulk: true },
      }));

      try {
        await Activity.insertMany(activityDocs);
      } catch (actErr) {
        console.error('[Activity Error] Failed to insert bulk assign activities:', actErr.message);
      }

      invalidateAnalyticsCache(leadsToUpdate[0].accountId);
    }

    return res.status(200).json({
      success: true,
      message: targetUser
        ? `Assigned ${successfulIds.length} lead${successfulIds.length === 1 ? '' : 's'} to ${targetUser.name}.`
        : `Unassigned ${successfulIds.length} lead${successfulIds.length === 1 ? '' : 's'}.`,
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
};

/**
 * POST /api/leads/bulk/delete
 * Bulk soft-delete multiple regular leads.
 * Admin-only operation.
 */
export const bulkDeleteLeads = async (req, res, next) => {
  try {
    const { leadIds } = req.body;
    const uniqueLeadIds = [...new Set(leadIds)];

    const filter = {
      _id: { $in: uniqueLeadIds },
      isDeleted: { $ne: true },
    };
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    const leadsToDelete = await Lead.find(filter).select('_id accountId');
    const foundIdSet = new Set(leadsToDelete.map((l) => l._id.toString()));
    const successfulIds = [];
    const failedIds = uniqueLeadIds.filter((id) => !foundIdSet.has(id));

    if (leadsToDelete.length > 0) {
      const now = new Date();
      await Lead.updateMany(
        { _id: { $in: leadsToDelete.map((l) => l._id) } },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
            deletedBy: req.user._id,
          },
        }
      );
      successfulIds.push(...leadsToDelete.map((l) => l._id.toString()));

      const activityDocs = leadsToDelete.map((l) => ({
        leadId: l._id,
        leadModel: 'Lead',
        accountId: l.accountId,
        type: 'note',
        summary: 'Lead soft-deleted via bulk action.',
        performedBy: req.user._id,
        metadata: { deletedAt: now, bulk: true },
      }));

      try {
        await Activity.insertMany(activityDocs);
      } catch (actErr) {
        console.error('[Activity Error] Failed to insert bulk delete activities:', actErr.message);
      }

      invalidateAnalyticsCache(leadsToDelete[0].accountId);
    }

    return res.status(200).json({
      success: true,
      message: `Deleted ${successfulIds.length} lead${successfulIds.length === 1 ? '' : 's'} successfully.`,
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
};
