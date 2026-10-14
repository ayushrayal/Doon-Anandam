import Lead from '../models/Lead.js';
import {
  fetchFacebookLeads,
  mapAndValidateLeadRecord,
} from './windsor.service.js';

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

    for (const raw of rawRecords) {
      const validation = mapAndValidateLeadRecord(raw, accountId);

      if (!validation.valid) {
        summary.skipped += 1;
        continue;
      }

      const { lead } = validation;

      bulkOperations.push({
        updateOne: {
          filter: {
            source: 'facebook_leads',
            accountId: lead.accountId,
            externalLeadId: lead.externalLeadId,
          },
          update: {
            // Upstream data refreshed from connector
            $set: {
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
            },
            // CRM-owned fields ONLY set on initial insert, NEVER overwritten on sync refresh
            $setOnInsert: {
              source: 'facebook_leads',
              accountId: lead.accountId,
              externalLeadId: lead.externalLeadId,
              status: 'new',
              assignedTo: null,
              notes: '',
            },
          },
          upsert: true,
        },
      });
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
      }
    }

    return summary;
  } finally {
    isSyncInProgress = false;
  }
}
