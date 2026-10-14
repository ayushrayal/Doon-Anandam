import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { ALLOWED_STATUS_TRANSITIONS } from '../schemas/lead.schema.js';
import { syncFacebookLeads } from '../services/leadSync.service.js';

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

    // 5. Date range filter on leadCreatedAt (or fallback to createdAt)
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

    // 6. Search across fullName, email, phoneNumber, campaignName
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

    // 7. Safe sorting
    const sortField = ['createdAt', 'leadCreatedAt', 'fullName', 'status'].includes(sortBy)
      ? sortBy
      : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortDirection };

    // 8. Pagination with sensible caps
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [total, leads] = await Promise.all([
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
    const { status: targetStatus } = req.body;

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
      return res.status(200).json({
        success: true,
        message: `Lead is already in '${targetStatus}' status.`,
        lead,
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
    await lead.save();

    await lead.populate('assignedTo', '_id name email role');

    return res.status(200).json({
      success: true,
      message: 'Lead status updated successfully.',
      lead,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/leads/:id/assign
 * Assign or unassign a lead to an active user. Admin only.
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

    if (assignedTo === null) {
      lead.assignedTo = null;
    } else {
      const targetUser = await User.findById(assignedTo);
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

    return res.status(200).json({
      success: true,
      message: lead.assignedTo ? 'Lead assigned successfully.' : 'Lead unassigned successfully.',
      lead,
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
