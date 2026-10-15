import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import Activity from '../models/Activity.js';
import User from '../models/User.js';
import { env } from '../config/env.js';

/**
 * Computes calendar date boundaries based on preset or explicit ISO dates.
 * Ensures strict date isolation with start of day (00:00:00.000) and end of day (23:59:59.999).
 */
function computeDateBounds(preset, startDate, endDate) {
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
 * GET /api/analytics/dashboard
 * Aggregates enterprise CRM metrics with rigorous date semantics, account isolation,
 * role scoping, pipeline funnels, follow-up workloads, and executive performance.
 */
export const getDashboardAnalytics = async (req, res, next) => {
  try {
    const { preset = '30d', startDate, endDate, assignedTo, source } = req.query;

    const dateBounds = computeDateBounds(preset, startDate, endDate);

    // Current date boundaries for operational follow-up workload
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // 1. Construct base match query for account isolation and role scoping
    const baseMatch = {};
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
    ]);

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
                          { $ne: ['$nextFollowUpDate', null] },
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
                          { $ne: ['$nextFollowUpDate', null] },
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
                          { $ne: ['$nextFollowUpDate', null] },
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
                          { $eq: ['$nextFollowUpDate', null] },
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
    ]);

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
    const verifiedConversionsInPeriod = await Activity.countDocuments(periodConversionFilter);

    // Completed follow-ups during selected period
    const completedFollowUpsFilter = {
      type: 'follow_up_completed',
    };
    if (env.WINDSOR_ACCOUNT_ID) {
      completedFollowUpsFilter.accountId = env.WINDSOR_ACCOUNT_ID;
    }
    if (req.user.role === 'sales_executive') {
      completedFollowUpsFilter.performedBy = req.user._id;
    }
    if (dateBounds.start || dateBounds.end) {
      completedFollowUpsFilter.performedAt = {};
      if (dateBounds.start) completedFollowUpsFilter.performedAt.$gte = dateBounds.start;
      if (dateBounds.end) completedFollowUpsFilter.performedAt.$lte = dateBounds.end;
    }
    const followUpsCompletedInPeriod = await Activity.countDocuments(completedFollowUpsFilter);

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
        .lean();

      const execAggregation = await Lead.aggregate([
        {
          $match: {
            ...(env.WINDSOR_ACCOUNT_ID ? { accountId: env.WINDSOR_ACCOUNT_ID } : {}),
            assignedTo: { $ne: null },
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
                      { $ne: ['$nextFollowUpDate', null] },
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
                      { $ne: ['$nextFollowUpDate', null] },
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
      ]);

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
                      { $ne: ['$nextFollowUpDate', null] },
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
                      { $ne: ['$nextFollowUpDate', null] },
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
      ]);

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
      }).distinct('_id');

      recentActivityFilter.$or = [
        { performedBy: req.user._id },
        { leadId: { $in: repLeadIds } },
      ];
    }

    const recentActivities = await Activity.find(recentActivityFilter)
      .sort({ performedAt: -1 })
      .limit(10)
      .populate('performedBy', '_id name email role')
      .populate('leadId', '_id fullName phone email status')
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

    return res.status(200).json({
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
      },
      pipelineFunnel,
      executiveBreakdown,
      recentActivities,
    });
  } catch (err) {
    next(err);
  }
};
