import Lead from '../models/Lead.js';
import {
  fetchFacebookLeads,
  mapAndValidateLeadRecord,
} from './windsor.service.js';
import { invalidateAnalyticsCache } from '../controllers/analytics.controller.js';

/**
 * Concurrency lock for lead synchronization within a running server process.
 */
let isSyncInProgress = false;
let customFetchFn = null;

export function getSyncStatus() {
  return isSyncInProgress;
}

/**
 * Injects a mock fetch implementation for automated testing.
 */
export function setSyncFetchMock(mockFn) {
  customFetchFn = mockFn;
}

/**
 * Synchronizes Facebook Lead Ads from Windsor.ai to MongoDB.
 *
 * Guarantees:
 * 1. Single configured account verification.
 * 2. Deduplication through compound unique key upserts.
 * 3. CRM-owned fields (status, assignedTo, notes) are NEVER overwritten.
 * 4. Safe bulk writes and sanitized summary counts.
 */
export async function syncFacebookLeads({
  overrideEnv = null,
  fetchFn = null,
} = {}) {
  const activeFetch = fetchFn || customFetchFn || fetch;

  if (isSyncInProgress) {
    const error = new Error('A lead synchronization job is currently in progress.');
    error.status = 409;
    error.code = 'SYNC_IN_PROGRESS';
    throw error;
  }

  isSyncInProgress = true;
  try {
    const { rawRecords, accountId } = await fetchFacebookLeads({
      overrideEnv,
      fetchFn: activeFetch,
    });

    const summary = {
      fetched: rawRecords.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    if (rawRecords.length === 0) {
      return summary;
    }

    const bulkOperations = [];

    // Pre-fetch existing leads to detect existing acquisition sources and avoid overwriting with unknown/windsor
    const externalIds = [];
    for (const raw of rawRecords) {
      if (raw && raw.id) {
        externalIds.push(String(raw.id).trim());
      }
    }

    const existingLeadsMap = new Map();
    if (externalIds.length > 0) {
      const existingDocs = await Lead.find({
        accountId,
        externalLeadId: { $in: externalIds },
      })
        .select('_id externalLeadId source syncProvider')
        .lean();
      for (const doc of existingDocs) {
        existingLeadsMap.set(doc.externalLeadId, doc);
      }
    }

    const isKnownChannel = (src) =>
      Boolean(
        src &&
          src !== 'unknown' &&
          src !== 'windsor' &&
          src !== 'windsor.ai' &&
          src !== 'unspecified'
      );

    for (const raw of rawRecords) {
      const validation = mapAndValidateLeadRecord(raw, accountId);

      if (!validation.valid) {
        summary.skipped += 1;
        continue;
      }

      const { lead } = validation;
      const existing = existingLeadsMap.get(lead.externalLeadId);

      let finalSource = lead.source;

      if (existing) {
        if (isKnownChannel(existing.source) && !isKnownChannel(lead.source)) {
          // Do not overwrite a valid existing source with unknown or windsor
          finalSource = existing.source;
        } else if (isKnownChannel(lead.source)) {
          finalSource = lead.source;
        } else {
          finalSource = existing.source || 'unknown';
        }
      } else {
        if (!isKnownChannel(finalSource)) {
          finalSource = 'unknown';
        }
      }

      const updateSet = {
        accountName: lead.accountName,
        fullName: lead.fullName,
        email: lead.email,
        phoneNumber: lead.phoneNumber,
        formId: lead.formId,
        formName: lead.formName,
        campaignName: lead.campaignName,
        campaignId: lead.campaignId,
        adsetName: lead.adsetName,
        adName: lead.adName,
        leadCreatedAt: lead.leadCreatedAt,
        syncProvider: 'windsor.ai',
      };

      if (existing) {
        // For existing leads, update upstream details; update source only if incoming source is valid
        if (isKnownChannel(finalSource)) {
          updateSet.source = finalSource;
        }

        bulkOperations.push({
          updateOne: {
            filter: { _id: existing._id },
            update: {
              $set: updateSet,
            },
          },
        });
      } else {
        // For new leads, use $setOnInsert for source to avoid $set/$setOnInsert conflict
        bulkOperations.push({
          updateOne: {
            filter: {
              source: finalSource,
              accountId: lead.accountId,
              externalLeadId: lead.externalLeadId,
            },
            update: {
              $set: updateSet,
              $setOnInsert: {
                source: finalSource,
                accountId: lead.accountId,
                externalLeadId: lead.externalLeadId,
                status: 'new',
                assignedTo: null,
                notes: '',
                nextFollowUpDate: null,
                nextFollowUpRemarks: '',
                lastFollowUpCompletedAt: null,
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (bulkOperations.length > 0) {
      try {
        const bulkResult = await Lead.bulkWrite(bulkOperations, { ordered: false });
        summary.inserted = bulkResult.upsertedCount || 0;
        summary.updated = bulkResult.matchedCount || 0;
      } catch (err) {
        // Handle partial bulk write failures
        if (err.result) {
          summary.inserted = err.result.nUpserted || 0;
          summary.updated = err.result.nModified || 0;
          summary.failed = err.writeErrors ? err.writeErrors.length : 1;
        } else {
          throw err;
        }
      } finally {
        invalidateAnalyticsCache(accountId);
      }
    }

    return summary;
  } finally {
    isSyncInProgress = false;
  }
}
