import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import Activity from '../models/Activity.js';
import User from '../models/User.js';
import { env } from '../config/env.js';

// Short-lived in-memory cache to absorb concurrent dashboard requests
const analyticsCache = new Map();
const inFlightRequests = new Map(); // Collapses concurrent requests for identical cacheKey

export const ANALYTICS_CACHE_TTL_MS =
  (parseInt(process.env.ANALYTICS_CACHE_TTL_SECONDS, 10) || 30) * 1000; // Configurable TTL (default 30 seconds)
let maxAnalyticsCacheEntries = 200; // Configurable upper capacity limit
export const ANALYTICS_QUERY_TIMEOUT_MS = 8000; // 8 seconds timeout limit for aggregations

/**
 * Prunes expired entries and evicts oldest entries (FIFO) when capacity is exceeded.
 */
export function setBoundedAnalyticsCache(key, data, ttlMs = ANALYTICS_CACHE_TTL_MS) {
  const now = Date.now();

  // 1. Prune expired entries first
  for (const [k, v] of analyticsCache) {
    if (v.expiresAt <= now) {
      analyticsCache.delete(k);
    }
  }

  // If key already exists in cache, delete it first to re-insert at end (fresh insertion order)
  if (analyticsCache.has(key)) {
    analyticsCache.delete(key);
  }

  // 2. If still at/over capacity, evict oldest entry (FIFO using Map insertion order)
  while (analyticsCache.size >= maxAnalyticsCacheEntries) {
    const oldestKey = analyticsCache.keys().next().value;
    if (oldestKey !== undefined) {
      analyticsCache.delete(oldestKey);
    } else {
      break;
    }
  }

  analyticsCache.set(key, {
    data,
    expiresAt: now + ttlMs,
  });
}

export function setAnalyticsCacheCapacity(limit) {
  maxAnalyticsCacheEntries = Math.max(1, limit);
}

export function getAnalyticsCacheCapacity() {
  return maxAnalyticsCacheEntries;
}

export function invalidateAnalyticsCache(accountId = null) {
  if (!accountId) {
    analyticsCache.clear();
    inFlightRequests.clear();
    return;
  }
  for (const [key] of analyticsCache) {
    if (key.includes(`:${accountId}:`)) {
      analyticsCache.delete(key);
    }
  }
  for (const [key] of inFlightRequests) {
    if (key.includes(`:${accountId}:`)) {
      inFlightRequests.delete(key);
    }
  }
}

export function getAnalyticsCacheSize() {
  return analyticsCache.size;
}

export function getInFlightRequestsCount() {
  return inFlightRequests.size;
}

export function getAnalyticsCacheEntry(key) {
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    analyticsCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Computes calendar date boundaries based on preset or explicit ISO dates.
 * Ensures strict date isolation with start of day (00:00:00.000) and end of day (23:59:59.999).
 */
export function computeDateBounds(preset, startDate, endDate) {
  const now = new Date();

  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: 'Today' };
  }

  if (preset === '7d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: 'Last 7 Days' };
  }

  if (preset === '30d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: 'Last 30 Days' };
  }

  if (preset === 'custom' && (startDate || endDate)) {
    const start = startDate ? new Date(new Date(startDate).setHours(0, 0, 0, 0)) : null;
    const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : null;
    return { start, end, label: 'Custom Range' };
  }

  // Preset 'all' or default all-time
  return { start: null, end: null, label: 'All Time' };
}

/**
 * Generates a role- and account-isolated cache key for dashboard queries.
 */
export function buildDashboardCacheKey(role, userId, accountScope, query = {}) {
  const { preset = '30d', startDate = '', endDate = '', assignedTo = 'all', source = 'all' } = query;
  return role === 'admin'
    ? `admin:${accountScope}:${preset}:${startDate}:${endDate}:${assignedTo}:${source}`
    : `exec:${userId}:${accountScope}:${preset}:${startDate}:${endDate}:${source}`;
}

/**
 * GET /api/analytics/dashboard
 * Aggregates enterprise CRM metrics with rigorous date semantics, account isolation,
 * role scoping, pipeline funnels, follow-up workloads, and executive performance.
 */
export const getDashboardAnalytics = async (req, res, next) => {
  try {
    const { preset = '30d', startDate, endDate, assignedTo, source } = req.query;

    const isTest = process.env.NODE_ENV === 'test';
    const accountScope = env.WINDSOR_ACCOUNT_ID || 'global';

    // Strict user-role isolated cache key:
    // - For sales executives: keyed by their user ID so they can NEVER see other rep data
    // - For admins: keyed by requested assignedTo filter and account scope
    const cacheKey = buildDashboardCacheKey(req.user.role, req.user._id, accountScope, req.query);

    if (!isTest) {
      const cached = getAnalyticsCacheEntry(cacheKey);
      if (cached) {
        return res.status(200).json(cached);
      }

      // In-flight deduplication: await in-flight calculation if identical query is currently computing
      if (inFlightRequests.has(cacheKey)) {
        const payload = await inFlightRequests.get(cacheKey);
        return res.status(200).json(payload);
      }
    }

    const computeDashboardPayload = async () => {
    const dateBounds = computeDateBounds(preset, startDate, endDate);

    // Current date boundaries for operational follow-up workload
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // 1. Construct base match query for account isolation and role scoping
    const baseMatch = {
      isDeleted: { $ne: true },
    };
    if (env.WINDSOR_ACCOUNT_ID) {
      baseMatch.accountId = env.WINDSOR_ACCOUNT_ID;
    }

    // Role-based executive scoping
    if (req.user.role === 'sales_executive') {
      baseMatch.assignedTo = req.user._id;
    } else if (assignedTo) {
      if (assignedTo === 'unassigned') {
        baseMatch.assignedTo = null;
      } else if (assignedTo !== 'all' && mongoose.Types.ObjectId.isValid(assignedTo)) {
        baseMatch.assignedTo = new mongoose.Types.ObjectId(assignedTo);
      }
    }

    if (source && source !== 'all') {
      baseMatch.source = source;
    }

    // 2. Construct cohort match query (leads ingested within selected date bounds)
    const cohortMatch = { ...baseMatch };
    if (dateBounds.start || dateBounds.end) {
      const dateCond = {};
      if (dateBounds.start) dateCond.$gte = dateBounds.start;
      if (dateBounds.end) dateCond.$lte = dateBounds.end;

      cohortMatch.$or = [
        { leadCreatedAt: dateCond },
        { leadCreatedAt: { $exists: false }, createdAt: dateCond },
        { leadCreatedAt: null, createdAt: dateCond },
      ];
    }

    // 3. Execute aggregate for Cohort Metrics, Funnel, Sources, and Trend
    const [cohortResults] = await Lead.aggregate([
      { $match: cohortMatch },
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          sources: [
            { $group: { _id: { $ifNull: ['$source', 'unspecified'] }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          leadsOverTime: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: { $ifNull: ['$leadCreatedAt', '$createdAt'] },
                  },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]).option({ maxTimeMS: ANALYTICS_QUERY_TIMEOUT_MS });

    // Format Cohort Metrics
    const cohortTotal = cohortResults?.totalCount?.[0]?.count || 0;
    const cohortStatusMap = {
      new: 0,
      contacted: 0,
      follow_up: 0,
      qualified: 0,
      converted: 0,
      lost: 0,
    };

    if (cohortResults?.statusCounts) {
      cohortResults.statusCounts.forEach((sc) => {
        if (cohortStatusMap.hasOwnProperty(sc._id)) {
          cohortStatusMap[sc._id] = sc.count;
        }
      });
    }

    const cohortConversionRate =
      cohortTotal > 0 ? Number(((cohortStatusMap.converted / cohortTotal) * 100).toFixed(1)) : 0.0;

    // 4. Execute All-Time Active Pipeline & Operational Follow-Up Aggregation
    const [allTimeResults] = await Lead.aggregate([
      { $match: baseMatch },
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          unassignedCount: [{ $match: { assignedTo: null } }, { $count: 'count' }],
          followUps: [
            {
              $group: {
                _id: null,
                overdue: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$status', 'converted'] },
                          { $ne: ['$status', 'lost'] },
                          { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                          { $lt: ['$nextFollowUpDate', startOfToday] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                dueToday: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$status', 'converted'] },
                          { $ne: ['$status', 'lost'] },
                          { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                          { $gte: ['$nextFollowUpDate', startOfToday] },
                          { $lte: ['$nextFollowUpDate', endOfToday] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                upcoming: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$status', 'converted'] },
                          { $ne: ['$status', 'lost'] },
                          { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                          { $gt: ['$nextFollowUpDate', endOfToday] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                none: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$status', 'converted'] },
                          { $ne: ['$status', 'lost'] },
                          { $in: [{ $type: '$nextFollowUpDate' }, ['missing', 'null']] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]).option({ maxTimeMS: ANALYTICS_QUERY_TIMEOUT_MS });

    const allTimeTotal = allTimeResults?.totalCount?.[0]?.count || 0;
    const allTimeStatusMap = {
      new: 0,
      contacted: 0,
      follow_up: 0,
      qualified: 0,
      converted: 0,
      lost: 0,
    };

    if (allTimeResults?.statusCounts) {
      allTimeResults.statusCounts.forEach((sc) => {
        if (allTimeStatusMap.hasOwnProperty(sc._id)) {
          allTimeStatusMap[sc._id] = sc.count;
        }
      });
    }

    const unassignedCount = allTimeResults?.unassignedCount?.[0]?.count || 0;
    const followUpStats = allTimeResults?.followUps?.[0] || {
      overdue: 0,
      dueToday: 0,
      upcoming: 0,
      none: 0,
    };

    // 5. Query verified historical milestone events occurred during this period from Activity collection
    const periodConversionFilter = {
      type: 'status_change',
      'metadata.newStatus': 'converted',
    };
    if (env.WINDSOR_ACCOUNT_ID) {
      periodConversionFilter.accountId = env.WINDSOR_ACCOUNT_ID;
    }
    if (req.user.role === 'sales_executive') {
      periodConversionFilter.performedBy = req.user._id;
    }
    if (dateBounds.start || dateBounds.end) {
      periodConversionFilter.performedAt = {};
      if (dateBounds.start) periodConversionFilter.performedAt.$gte = dateBounds.start;
      if (dateBounds.end) periodConversionFilter.performedAt.$lte = dateBounds.end;
    }
    const verifiedConversionsInPeriod = await Activity.countDocuments(periodConversionFilter).maxTimeMS(
      ANALYTICS_QUERY_TIMEOUT_MS
    );

    // Completed follow-ups during selected period
    const completedFollowUpsFilter = {
      type: 'follow_up_completed',
    };
    if (env.WINDSOR_ACCOUNT_ID) {
      completedFollowUpsFilter.accountId = env.WINDSOR_ACCOUNT_ID;
    }
    if (req.user.role === 'sales_executive') {
      completedFollowUpsFilter.performedBy = req.user._id;
    } else if (assignedTo && assignedTo !== 'all' && mongoose.Types.ObjectId.isValid(assignedTo)) {
      completedFollowUpsFilter.performedBy = new mongoose.Types.ObjectId(assignedTo);
    }
    if (dateBounds.start || dateBounds.end) {
      completedFollowUpsFilter.performedAt = {};
      if (dateBounds.start) completedFollowUpsFilter.performedAt.$gte = dateBounds.start;
      if (dateBounds.end) completedFollowUpsFilter.performedAt.$lte = dateBounds.end;
    }
    const followUpsCompletedInPeriod = await Activity.countDocuments(completedFollowUpsFilter).maxTimeMS(
      ANALYTICS_QUERY_TIMEOUT_MS
    );
    const uniqueLeadIdsCompletedInPeriod = await Activity.distinct('leadId', completedFollowUpsFilter).maxTimeMS(
      ANALYTICS_QUERY_TIMEOUT_MS
    );
    const uniqueLeadsCompletedInPeriod = uniqueLeadIdsCompletedInPeriod.length;

    // 6. Pipeline Funnel Progression (Evaluated for the selected cohort)
    const pipelineFunnel = [
      { stage: 'Total Ingested', key: 'total', count: cohortTotal },
      {
        stage: 'Contacted',
        key: 'contacted',
        count:
          cohortStatusMap.contacted +
          cohortStatusMap.follow_up +
          cohortStatusMap.qualified +
          cohortStatusMap.converted,
      },
      {
        stage: 'Follow Up Stage',
        key: 'follow_up',
        count: cohortStatusMap.follow_up,
      },
      {
        stage: 'Qualified',
        key: 'qualified',
        count: cohortStatusMap.qualified + cohortStatusMap.converted,
      },
      { stage: 'Converted', key: 'converted', count: cohortStatusMap.converted },
      { stage: 'Lost Drop-off', key: 'lost', count: cohortStatusMap.lost },
    ];

    // 7. Executive Performance Breakdown
    let executiveBreakdown = [];
    if (req.user.role === 'admin') {
      const activeExecs = await User.find({ isActive: true })
        .select('_id name email role')
        .sort({ name: 1 })
        .maxTimeMS(ANALYTICS_QUERY_TIMEOUT_MS)
        .lean();

      const execAggregation = await Lead.aggregate([
        {
          $match: {
            ...(env.WINDSOR_ACCOUNT_ID ? { accountId: env.WINDSOR_ACCOUNT_ID } : {}),
            assignedTo: { $ne: null },
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: '$assignedTo',
            totalAssigned: { $sum: 1 },
            activePipeline: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['new', 'contacted', 'follow_up', 'qualified']] },
                  1,
                  0,
                ],
              },
            },
            follow_up: {
              $sum: { $cond: [{ $eq: ['$status', 'follow_up'] }, 1, 0] },
            },
            qualified: {
              $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] },
            },
            converted: {
              $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] },
            },
            lost: {
              $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] },
            },
            overdueFollowUps: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$status', ['new', 'contacted', 'follow_up', 'qualified']] },
                      { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                      { $lt: ['$nextFollowUpDate', startOfToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            dueTodayFollowUps: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$status', ['new', 'contacted', 'follow_up', 'qualified']] },
                      { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                      { $gte: ['$nextFollowUpDate', startOfToday] },
                      { $lte: ['$nextFollowUpDate', endOfToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]).option({ maxTimeMS: ANALYTICS_QUERY_TIMEOUT_MS });

      const execStatsMap = new Map();
      execAggregation.forEach((item) => {
        execStatsMap.set(String(item._id), item);
      });

      executiveBreakdown = activeExecs.map((exec) => {
        const stats = execStatsMap.get(String(exec._id)) || {
          totalAssigned: 0,
          activePipeline: 0,
          follow_up: 0,
          qualified: 0,
          converted: 0,
          lost: 0,
          overdueFollowUps: 0,
          dueTodayFollowUps: 0,
        };
        const convRate =
          stats.totalAssigned > 0
            ? Number(((stats.converted / stats.totalAssigned) * 100).toFixed(1))
            : 0.0;
        return {
          id: exec._id,
          name: exec.name,
          email: exec.email,
          role: exec.role,
          ...stats,
          conversionRate: convRate,
        };
      });
    } else {
      // Sales executive view: own performance summary
      const execStats = await Lead.aggregate([
        {
          $match: {
            ...(env.WINDSOR_ACCOUNT_ID ? { accountId: env.WINDSOR_ACCOUNT_ID } : {}),
            assignedTo: req.user._id,
          },
        },
        {
          $group: {
            _id: '$assignedTo',
            totalAssigned: { $sum: 1 },
            activePipeline: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['new', 'contacted', 'follow_up', 'qualified']] },
                  1,
                  0,
                ],
              },
            },
            follow_up: {
              $sum: { $cond: [{ $eq: ['$status', 'follow_up'] }, 1, 0] },
            },
            qualified: {
              $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] },
            },
            converted: {
              $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] },
            },
            lost: {
              $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] },
            },
            overdueFollowUps: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$status', ['new', 'contacted', 'follow_up', 'qualified']] },
                      { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                      { $lt: ['$nextFollowUpDate', startOfToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            dueTodayFollowUps: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$status', ['new', 'contacted', 'follow_up', 'qualified']] },
                      { $eq: [{ $type: '$nextFollowUpDate' }, 'date'] },
                      { $gte: ['$nextFollowUpDate', startOfToday] },
                      { $lte: ['$nextFollowUpDate', endOfToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]).option({ maxTimeMS: ANALYTICS_QUERY_TIMEOUT_MS });

      const stats = execStats[0] || {
        totalAssigned: 0,
        activePipeline: 0,
        follow_up: 0,
        qualified: 0,
        converted: 0,
        lost: 0,
        overdueFollowUps: 0,
        dueTodayFollowUps: 0,
      };
      const convRate =
        stats.totalAssigned > 0
          ? Number(((stats.converted / stats.totalAssigned) * 100).toFixed(1))
          : 0.0;
      executiveBreakdown = [
        {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
          ...stats,
          conversionRate: convRate,
        },
      ];
    }

    // 8. Recent Activities Feed
    const recentActivityFilter = {};
    if (env.WINDSOR_ACCOUNT_ID) {
      recentActivityFilter.accountId = env.WINDSOR_ACCOUNT_ID;
    }
    if (req.user.role === 'sales_executive') {
      const repLeadIds = await Lead.find({
        ...(env.WINDSOR_ACCOUNT_ID ? { accountId: env.WINDSOR_ACCOUNT_ID } : {}),
        assignedTo: req.user._id,
      })
        .maxTimeMS(ANALYTICS_QUERY_TIMEOUT_MS)
        .distinct('_id');

      recentActivityFilter.$or = [
        { performedBy: req.user._id },
        { leadId: { $in: repLeadIds } },
      ];
    }

    const recentActivities = await Activity.find(recentActivityFilter)
      .sort({ performedAt: -1 })
      .limit(10)
      .maxTimeMS(ANALYTICS_QUERY_TIMEOUT_MS)
      .populate('performedBy', '_id name email role')
      .populate('leadId', '_id fullName phoneNumber email status')
      .lean();

    // 9. Document Filter Semantics (Transparent definition of every KPI)
    const filterSemantics = {
      dateRangeLabel: dateBounds.label,
      startDate: dateBounds.start ? dateBounds.start.toISOString() : null,
      endDate: dateBounds.end ? dateBounds.end.toISOString() : null,
      cohortDefinition:
        'Leads created/ingested within the selected date window (leadCreatedAt or createdAt).',
      stageDistributionDefinition:
        'Current stage status of leads born during this selected period.',
      conversionsInPeriodDefinition:
        'Verified status transitions to converted logged in Activity timeline during this date window, regardless of lead ingestion date.',
      followUpWorkloadDefinition:
        'Live operational follow-up tasks evaluated against today date (overdue: before today; dueToday: today; upcoming: future).',
      pipelineSnapshotDefinition:
        'Overall CRM status distribution across all leads currently under scope.',
    };

    const responsePayload = {
      success: true,
      filterSemantics,
      cohort: {
        total: cohortTotal,
        statusCounts: cohortStatusMap,
        conversionRate: cohortConversionRate,
        sources: (cohortResults?.sources || []).map((s) => ({ source: s._id, count: s.count })),
        trend: (cohortResults?.leadsOverTime || []).map((t) => ({ date: t._id, count: t.count })),
      },
      historicalActivity: {
        conversionsInPeriod: verifiedConversionsInPeriod,
        followUpsCompletedInPeriod,
        uniqueLeadsCompletedInPeriod,
      },
      allTimePipeline: {
        total: allTimeTotal,
        statusCounts: allTimeStatusMap,
        unassigned: unassignedCount,
        activeTotal:
          allTimeStatusMap.new +
          allTimeStatusMap.contacted +
          allTimeStatusMap.follow_up +
          allTimeStatusMap.qualified,
      },
      followUpWorkload: {
        overdue: followUpStats.overdue,
        dueToday: followUpStats.dueToday,
        upcoming: followUpStats.upcoming,
        none: followUpStats.none,
        completedInPeriod: uniqueLeadsCompletedInPeriod,
      },
      pipelineFunnel,
      executiveBreakdown,
      recentActivities,
    };

    return responsePayload;
    };

    let responsePayload;
    if (!isTest) {
      const computationPromise = computeDashboardPayload();
      inFlightRequests.set(cacheKey, computationPromise);
      try {
        responsePayload = await computationPromise;
        setBoundedAnalyticsCache(cacheKey, responsePayload, ANALYTICS_CACHE_TTL_MS);
      } finally {
        inFlightRequests.delete(cacheKey);
      }
    } else {
      responsePayload = await computeDashboardPayload();
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    const isTimeout =
      err.code === 50 ||
      err.codeName === 'MaxTimeMSExpired' ||
      err.name === 'MaxTimeMSExpired' ||
      (typeof err.message === 'string' &&
        (err.message.includes('time limit') ||
          err.message.includes('execution terminated') ||
          err.message.includes('MaxTimeMSExpired') ||
          err.message.includes('maxTimeMS') ||
          err.message.includes('timed out')));

    if (isTimeout) {
      return res.status(504).json({
        success: false,
        message: 'Analytics query timed out. Please refine your date filter or scope.',
      });
    }
    next(err);
  }
};
