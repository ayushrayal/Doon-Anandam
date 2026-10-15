import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import { env } from '../config/env.js';
import { ALLOWED_STATUS_TRANSITIONS } from '../schemas/lead.schema.js';
import { syncFacebookLeads } from '../services/leadSync.service.js';

/**
 * Computes the operational follow-up indicator for a given follow-up date.
 * Returns: 'overdue' | 'today' | 'upcoming' | 'none'
 */
export function computeFollowUpIndicator(nextFollowUpDate) {
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
    const {
      page = 1,
      limit = 10,
      status = 'all',
      assignedTo,
      source,
      search,
      startDate,
      endDate,
      followUpStatus = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // 1. Account isolation: scope to configured business account
    const filter = {};
    if (env.WINDSOR_ACCOUNT_ID) {
      filter.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    // 2. Role scoping: sales_executive can ONLY see their assigned leads
    if (req.user.role === 'sales_executive') {
      filter.assignedTo = req.user._id;
    } else if (req.user.role === 'admin') {
      // Admins can filter by specific user or unassigned leads
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

    // 4. Source filter
    if (source && source.trim()) {
      filter.source = source.trim();
    }

    // 5. Follow-up status filter
    if (followUpStatus && followUpStatus !== 'all') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      if (followUpStatus === 'scheduled') {
        filter.nextFollowUpDate = { $ne: null };
      } else if (followUpStatus === 'none') {
        filter.nextFollowUpDate = null;
      } else if (followUpStatus === 'overdue') {
        filter.nextFollowUpDate = { $ne: null, $lt: todayStart };
      } else if (followUpStatus === 'today') {
        filter.nextFollowUpDate = { $gte: todayStart, $lte: todayEnd };
      } else if (followUpStatus === 'upcoming') {
        filter.nextFollowUpDate = { $gt: todayEnd };
      }
    }

    // 6. Date range filter on leadCreatedAt (or fallback to createdAt)
    if (startDate || endDate) {
      filter.leadCreatedAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          filter.leadCreatedAt.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          if (endDate.length === 10) {
            end.setUTCHours(23, 59, 59, 999);
          }
          filter.leadCreatedAt.$lte = end;
        }
      }
      if (Object.keys(filter.leadCreatedAt).length === 0) {
        delete filter.leadCreatedAt;
      }
    }

    // 7. Search across fullName, email, phoneNumber, campaignName
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { phoneNumber: searchRegex },
        { campaignName: searchRegex },
      ];
    }

    // 8. Safe sorting
    const sortField = ['createdAt', 'leadCreatedAt', 'fullName', 'status', 'nextFollowUpDate'].includes(sortBy)
      ? sortBy
      : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortDirection };

    // 9. Pagination with sensible caps
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [total, rawLeads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter)
        .collation({ locale: 'en' })
        .select('-__v')
        .populate('assignedTo', '_id name email role')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    // Attach dynamic operational indicators
    const leads = rawLeads.map((lead) => ({
      ...lead,
      followUpIndicator: computeFollowUpIndicator(lead.nextFollowUpDate),
    }));

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
    next(err);
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

    const filter = { _id: id };
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

    lead.followUpIndicator = computeFollowUpIndicator(lead.nextFollowUpDate);

    return res.status(200).json({
      success: true,
      lead,
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

    const filter = { _id: id };
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
      const leadObj = lead.toObject();
      leadObj.followUpIndicator = computeFollowUpIndicator(lead.nextFollowUpDate);
      return res.status(200).json({
        success: true,
        message: `Lead is already in '${targetStatus}' status.`,
        lead: leadObj,
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

    const leadObj = lead.toObject();
    leadObj.followUpIndicator = computeFollowUpIndicator(lead.nextFollowUpDate);

    return res.status(200).json({
      success: true,
      message: 'Lead status updated successfully.',
      lead: leadObj,
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

    const filter = { _id: id };
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

    const leadObj = lead.toObject();
    leadObj.followUpIndicator = computeFollowUpIndicator(lead.nextFollowUpDate);

    return res.status(200).json({
      success: true,
      message: lead.assignedTo ? 'Lead assigned successfully.' : 'Lead unassigned successfully.',
      lead: leadObj,
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

    const filter = { _id: id };
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
      type: activityType,
      summary: summaryText,
      performedBy: req.user._id,
      metadata: {
        scheduledFor: targetDate,
        remarks: remarks || '',
        isReschedule,
      },
    });

    const leadObj = lead.toObject();
    leadObj.followUpIndicator = computeFollowUpIndicator(lead.nextFollowUpDate);

    return res.status(200).json({
      success: true,
      message: isReschedule
        ? 'Follow-up rescheduled successfully.'
        : 'Follow-up scheduled successfully.',
      lead: leadObj,
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

    const filter = { _id: id };
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

    const summaryText = notes
      ? `Follow-up completed. Notes: ${notes}`
      : 'Follow-up marked as completed.';

    await Activity.create({
      leadId: lead._id,
      accountId: lead.accountId,
      type: 'follow_up_completed',
      summary: summaryText,
      performedBy: req.user._id,
      metadata: {
        previousScheduledDate,
        completedAt: lead.lastFollowUpCompletedAt,
        notes: notes || '',
      },
    });

    const leadObj = lead.toObject();
    leadObj.followUpIndicator = 'none';

    return res.status(200).json({
      success: true,
      message: 'Follow-up marked as completed.',
      lead: leadObj,
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

    const filter = { _id: id };
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

    const filter = { _id: id };
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
