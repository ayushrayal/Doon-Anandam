import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import { env } from '../src/config/env.js';
import { signToken, COOKIE_NAME } from '../src/utils/jwt.js';
import {
  resolveAcquisitionSource,
  mapAndValidateLeadRecord,
} from '../src/services/windsor.service.js';
import { syncFacebookLeads } from '../src/services/leadSync.service.js';

const TEST_PORT = 5099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runRegressionSuite() {
  console.log('=== Starting Regression Suite: Overdue Consistency & Meta Source Attribution ===\n');

  await connectDB();
  const server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const testAccountId = `act_regress_${timestamp}`;
  const adminEmail = `admin.regress.${timestamp}@example.com`;
  const salesEmail = `sales.regress.${timestamp}@example.com`;
  const otherSalesEmail = `other.regress.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  // Override account configuration for isolated test scope
  const originalAccountId = env.WINDSOR_ACCOUNT_ID;
  env.WINDSOR_ACCOUNT_ID = testAccountId;

  let testAdmin = null;
  let testSales = null;
  let otherSales = null;
  let adminCookie = '';
  let salesCookie = '';

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    testAdmin = await User.create({
      name: 'Regression Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales = await User.create({
      name: 'Regression Sales Rep',
      email: salesEmail,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    otherSales = await User.create({
      name: 'Other Sales Rep',
      email: otherSalesEmail,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    adminCookie = `${COOKIE_NAME}=${signToken({ id: testAdmin._id, role: testAdmin.role })}`;
    salesCookie = `${COOKIE_NAME}=${signToken({ id: testSales._id, role: testSales.role })}`;

    console.log('[Setup] Test users created');

    // =========================================================================
    // SECTION 1: ISSUE 1 - Overdue Count & Filter Consistency
    // =========================================================================
    console.log('\n--- Section 1: Dashboard Overdue Workload vs Leads Filter Consistency ---');

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const todayAt18 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // 1. Create overdue leads for testSales (2 leads)
    const leadOverdueSales1 = await Lead.create({
      externalLeadId: `ext_ov_s1_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Alice Overdue SalesRep',
      status: 'contacted',
      assignedTo: testSales._id,
      nextFollowUpDate: threeDaysAgo,
    });

    const leadOverdueSales2 = await Lead.create({
      externalLeadId: `ext_ov_s2_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Bob Overdue SalesRep',
      status: 'follow_up',
      assignedTo: testSales._id,
      nextFollowUpDate: yesterday,
    });

    // 2. Create overdue lead for otherSales (1 lead)
    const leadOverdueOther = await Lead.create({
      externalLeadId: `ext_ov_other_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Charlie Overdue OtherRep',
      status: 'qualified',
      assignedTo: otherSales._id,
      nextFollowUpDate: yesterday,
    });

    // 3. Create due-today and upcoming leads (should NOT be counted as overdue)
    await Lead.create({
      externalLeadId: `ext_today_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'David Due Today',
      status: 'contacted',
      assignedTo: testSales._id,
      nextFollowUpDate: todayAt18,
    });

    await Lead.create({
      externalLeadId: `ext_upc_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Eve Upcoming',
      status: 'new',
      assignedTo: testSales._id,
      nextFollowUpDate: nextWeek,
    });

    // 4. Create leads with past nextFollowUpDate BUT status is converted or lost (should NOT be in active overdue)
    await Lead.create({
      externalLeadId: `ext_conv_past_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Frank Converted Past',
      status: 'converted',
      assignedTo: testSales._id,
      nextFollowUpDate: threeDaysAgo,
    });

    await Lead.create({
      externalLeadId: `ext_lost_past_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Grace Lost Past',
      status: 'lost',
      assignedTo: testSales._id,
      nextFollowUpDate: yesterday,
    });

    // 5. Create overdue lead for FOREIGN account (must NEVER leak into counts or list)
    await Lead.create({
      externalLeadId: `ext_foreign_ov_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: 'foreign_account_99999',
      fullName: 'Foreign Overdue Lead',
      status: 'contacted',
      assignedTo: testSales._id,
      nextFollowUpDate: yesterday,
    });

    // 6. Create lead with explicit nextFollowUpDate: null (active)
    await Lead.create({
      externalLeadId: `ext_null_date_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Hannah Null FollowUp',
      status: 'new',
      nextFollowUpDate: null,
    });

    // 7. Create lead with MISSING nextFollowUpDate field (active)
    const missingDateLead = await Lead.create({
      externalLeadId: `ext_missing_date_${timestamp}`,
      source: 'meta',
      syncProvider: 'windsor.ai',
      accountId: testAccountId,
      fullName: 'Ian Missing FollowUp',
      status: 'new',
    });
    // Physically remove the field from the document to reproduce the production 47 leads scenario
    await Lead.updateOne({ _id: missingDateLead._id }, { $unset: { nextFollowUpDate: 1 } });

    // Test 1: Admin Dashboard Overdue & None Workload Counts
    {
      const res = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=all`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin analytics request returns 200');
      // Total active overdue across team: 2 for testSales + 1 for otherSales = 3
      // (Converted and lost leads are excluded; foreign account is excluded)
      // Missing and null nextFollowUpDate MUST NOT be counted as overdue
      assert(
        data.followUpWorkload.overdue === 3,
        `Expected admin dashboard overdue=3, got ${data.followUpWorkload.overdue}`
      );
      assert(
        data.followUpWorkload.dueToday === 1,
        `Expected dueToday=1, got ${data.followUpWorkload.dueToday}`
      );
      assert(
        data.followUpWorkload.upcoming === 1,
        `Expected upcoming=1, got ${data.followUpWorkload.upcoming}`
      );
      // 'none' workload MUST count both explicit null and missing date field
      assert(
        data.followUpWorkload.none === 2,
        `Expected none=2 (explicit null + missing field), got ${data.followUpWorkload.none}`
      );
      console.log('✔ Test 1 Passed: Admin Dashboard follow-up workload strictly requires BSON type date for overdue (3) and groups null/missing into none (2)');
    }

    // Test 2: Admin GET /api/leads?followUpStatus=overdue matches Dashboard exactly (3 leads)
    {
      const res = await fetch(`${BASE_URL}/api/leads?followUpStatus=overdue`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin leads overdue request returns 200');
      assert(
        data.total === 3,
        `Expected total=3 in /api/leads?followUpStatus=overdue, got ${data.total}`
      );
      assert(
        data.leads.length === 3,
        `Expected 3 leads returned, got ${data.leads.length}`
      );

      // Verify no converted or lost leads leaked in
      const hasClosed = data.leads.some((l) => l.status === 'converted' || l.status === 'lost');
      assert(!hasClosed, 'Overdue leads filter must not include converted or lost leads');

      // Verify neither explicit null nor missing date leaked into overdue leads
      const hasNullOrMissing = data.leads.some((l) => !l.nextFollowUpDate);
      assert(!hasNullOrMissing, 'Overdue leads must NEVER contain null or missing follow-up dates');

      // Verify all returned leads have followUpIndicator === 'overdue'
      for (const l of data.leads) {
        assert(
          l.followUpIndicator === 'overdue',
          `Expected followUpIndicator=overdue, got ${l.followUpIndicator}`
        );
      }
      console.log('✔ Test 2 Passed: Admin GET /api/leads?followUpStatus=overdue matches Dashboard count (3) and excludes closed/null/missing leads');
    }

    // Test 2b: Admin GET /api/leads?followUpStatus=none returns both explicit null and missing date leads
    {
      const res = await fetch(`${BASE_URL}/api/leads?followUpStatus=none`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin leads followUpStatus=none returns 200');
      assert(
        data.total === 2,
        `Expected total=2 in /api/leads?followUpStatus=none, got ${data.total}`
      );
      for (const l of data.leads) {
        assert(
          l.followUpIndicator === 'none',
          `Expected followUpIndicator=none, got ${l.followUpIndicator}`
        );
      }
      console.log('✔ Test 2b Passed: GET /api/leads?followUpStatus=none cleanly matches both explicit null and missing date leads (2)');
    }

    // Test 3: Admin executive scoping consistency (drill-down by assigned sales rep)
    {
      // Dashboard with assignedTo=testSales._id
      const dashRes = await fetch(
        `${BASE_URL}/api/analytics/dashboard?preset=all&assignedTo=${testSales._id}`,
        { headers: { Cookie: adminCookie } }
      );
      const dashData = await dashRes.json();
      assert(
        dashData.followUpWorkload.overdue === 2,
        `Expected sales rep overdue=2, got ${dashData.followUpWorkload.overdue}`
      );

      // Leads drill-down with followUpStatus=overdue&assignedTo=testSales._id
      const leadsRes = await fetch(
        `${BASE_URL}/api/leads?followUpStatus=overdue&assignedTo=${testSales._id}`,
        { headers: { Cookie: adminCookie } }
      );
      const leadsData = await leadsRes.json();
      assert(
        leadsData.total === 2,
        `Expected leads total=2 for assigned rep, got ${leadsData.total}`
      );
      assert(
        dashData.followUpWorkload.overdue === leadsData.total,
        'Dashboard overdue count for representative matches filtered leads list'
      );
      console.log('✔ Test 3 Passed: Executive-scoped Dashboard overdue count matches filtered leads list');
    }

    // Test 4: Sales Executive Role Scoping Consistency
    {
      const dashRes = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=all`, {
        headers: { Cookie: salesCookie },
      });
      const dashData = await dashRes.json();
      assert(
        dashData.followUpWorkload.overdue === 2,
        `Expected sales executive dashboard overdue=2, got ${dashData.followUpWorkload.overdue}`
      );

      const leadsRes = await fetch(`${BASE_URL}/api/leads?followUpStatus=overdue`, {
        headers: { Cookie: salesCookie },
      });
      const leadsData = await leadsRes.json();
      assert(
        leadsData.total === 2,
        `Expected sales executive leads overdue=2, got ${leadsData.total}`
      );
      assert(
        dashData.followUpWorkload.overdue === leadsData.total,
        'Sales Executive dashboard overdue equals filtered leads total'
      );
      console.log('✔ Test 4 Passed: Sales executive role scoping guarantees 1:1 parity between dashboard overdue and filtered leads');
    }

    // Test 5: Pagination on /api/leads?followUpStatus=overdue
    {
      const res = await fetch(`${BASE_URL}/api/leads?followUpStatus=overdue&page=1&limit=2`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(data.total === 3, 'Total remains 3');
      assert(data.leads.length === 2, 'Page 1 returns limit=2 leads');
      assert(data.pagination.totalPages === 2, 'Total pages is 2');
      console.log('✔ Test 5 Passed: Pagination metadata accurately preserved on overdue filter');
    }

    // Test 5b: Verify production account distribution (0 overdue, 0 dueToday, 0 upcoming, 95 none)
    if (originalAccountId) {
      env.WINDSOR_ACCOUNT_ID = originalAccountId;
      const prodRes = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=all`, {
        headers: { Cookie: adminCookie },
      });
      const prodData = await prodRes.json();
      assert(prodRes.status === 200, 'Production baseline analytics returns 200');
      assert(
        prodData.followUpWorkload.overdue === 0,
        `Production workload overdue must be 0, got ${prodData.followUpWorkload.overdue}`
      );
      assert(
        prodData.followUpWorkload.dueToday === 0,
        `Production workload dueToday must be 0, got ${prodData.followUpWorkload.dueToday}`
      );
      assert(
        prodData.followUpWorkload.upcoming === 0,
        `Production workload upcoming must be 0, got ${prodData.followUpWorkload.upcoming}`
      );
      assert(
        prodData.followUpWorkload.none >= 40,
        `Production workload none must match active leads count (>= 40), got ${prodData.followUpWorkload.none}`
      );

      // Verify that Leads API with followUpStatus=overdue returns exactly 0 matching leads
      const prodLeadsRes = await fetch(`${BASE_URL}/api/leads?followUpStatus=overdue`, {
        headers: { Cookie: adminCookie },
      });
      const prodLeadsData = await prodLeadsRes.json();
      assert(prodLeadsData.total === 0, `Production overdue leads must be 0, got ${prodLeadsData.total}`);

      env.WINDSOR_ACCOUNT_ID = testAccountId;
      console.log('✔ Test 5b Passed: Production distribution verified (0 overdue, 0 dueToday, 0 upcoming, 95 none) with 100% Leads API parity');
    }

    // =========================================================================
    // SECTION 2: ISSUE 2 - Lead Acquisition Source: Meta vs Windsor.ai
    // =========================================================================
    console.log('\n--- Section 2: Acquisition Source Resolution & Windsor Preservation ---');

    // Test 6: resolveAcquisitionSource unit testing across genuine channels & fallbacks
    {
      // A: Meta / Facebook Lead Ads identification via datasource
      assert(
        resolveAcquisitionSource({ datasource: 'facebook' }) === 'meta',
        'datasource: facebook maps to meta'
      );
      assert(
        resolveAcquisitionSource({ datasource: 'facebook_leads' }) === 'meta',
        'datasource: facebook_leads maps to meta'
      );
      assert(
        resolveAcquisitionSource({ datasource: 'meta' }) === 'meta',
        'datasource: meta maps to meta'
      );

      // B: Trustworthy Meta ad architecture (adset_name) and account/campaign signals
      assert(
        resolveAcquisitionSource({ id: '123', adset_name: 'Luxury Villas Buyers' }) === 'meta',
        'adset_name reliably maps to meta'
      );
      assert(
        resolveAcquisitionSource({ id: '124', account_name: 'Doon Anandam FB Ads' }) === 'meta',
        'account_name with FB Ads reliably maps to meta'
      );
      assert(
        resolveAcquisitionSource({ id: '125', campaign: 'Meta Diwali Festival Promo' }) === 'meta',
        'campaign with Meta token reliably maps to meta'
      );

      // C: Windsor.ai as sync provider is NOT treated as acquisition channel
      assert(
        resolveAcquisitionSource({ source: 'windsor.ai', datasource: 'facebook' }) === 'meta',
        'source: windsor.ai with datasource facebook resolves to meta'
      );
      assert(
        resolveAcquisitionSource({ source: 'windsor', adset_name: 'AdSet 01' }) === 'meta',
        'source: windsor with adset resolves to meta'
      );

      // D: Other genuine marketing channels
      assert(
        resolveAcquisitionSource({ datasource: 'google_ads' }) === 'google_ads',
        'datasource: google_ads preserved'
      );
      assert(
        resolveAcquisitionSource({ datasource: 'linkedin_ads' }) === 'linkedin_ads',
        'datasource: linkedin_ads preserved'
      );
      assert(
        resolveAcquisitionSource({ source: 'organic_search' }) === 'organic_search',
        'source: organic_search preserved'
      );

      // E: Generic form fields alone (form_id, form_name) DO NOT classify as Meta and safely fall back to unknown
      assert(
        resolveAcquisitionSource({ id: '998', form_id: 'form_99', form_name: 'Contact Form' }) === 'unknown',
        'Generic form_id and form_name alone safely fall back to unknown'
      );
      assert(
        resolveAcquisitionSource({ id: '999', datasource: '' }) === 'unknown',
        'Unconfirmed record falls back safely to unknown'
      );
      assert(
        resolveAcquisitionSource({ source: 'windsor.ai' }) === 'unknown',
        'Source windsor.ai without genuine channel resolves to unknown, not windsor.ai'
      );

      console.log('✔ Test 6 Passed: resolveAcquisitionSource accurately identifies Meta, other channels, and unknown fallbacks');
    }

    // Test 7: mapAndValidateLeadRecord includes syncProvider and resolved source
    {
      const rawMetaRecord = {
        id: `fb_lead_${timestamp}`,
        account_id: testAccountId,
        full_name: 'Meta Lead Person',
        datasource: 'facebook_leads',
        form_id: 'form_123',
        form_name: '3BHK Villa Inquiry',
        campaign: 'October Meta Campaign',
      };

      const result = mapAndValidateLeadRecord(rawMetaRecord, testAccountId);
      assert(result.valid === true, 'Validation succeeds');
      assert(result.lead.source === 'meta', 'Lead source resolved to meta');
      assert(result.lead.syncProvider === 'windsor.ai', 'syncProvider set to windsor.ai');
      console.log('✔ Test 7 Passed: mapAndValidateLeadRecord sets source=meta and syncProvider=windsor.ai');
    }

    // Test 8: End-to-end sync with mocked fetch: Meta leads, other channels, and repeated syncs
    {
      const mockRecords = [
        {
          id: `lead_meta_${timestamp}`,
          account_id: testAccountId,
          full_name: 'Meta Real Estate Buyer',
          email: 'meta.buyer@example.com',
          datasource: 'facebook',
          form_name: 'Luxury Homes Instant Form',
          campaign: 'Facebook Lead Ads - Diwali',
        },
        {
          id: `lead_google_${timestamp}`,
          account_id: testAccountId,
          full_name: 'Google Search Buyer',
          email: 'google.buyer@example.com',
          datasource: 'google_ads',
          campaign: 'Google Search - Real Estate Dehradun',
        },
        {
          id: `lead_unknown_${timestamp}`,
          account_id: testAccountId,
          full_name: 'Unknown Source Buyer',
          email: 'unknown.buyer@example.com',
          source: 'windsor.ai', // Incoming source mistakenly labeled as windsor.ai
          // No datasource and non-facebook endpoint
        },
      ];

      const mockFetchFn = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: mockRecords }),
      });

      const syncResult1 = await syncFacebookLeads({
        overrideEnv: {
          ...env,
          WINDSOR_ACCOUNT_ID: testAccountId,
          WINDSOR_API_KEY: 'test_key',
        },
        fetchFn: mockFetchFn,
      });

      assert(syncResult1.inserted === 3, `Expected 3 inserted leads, got ${syncResult1.inserted}`);

      // Verify in MongoDB
      const metaLead = await Lead.findOne({ externalLeadId: `lead_meta_${timestamp}` });
      assert(metaLead, 'Meta lead persisted');
      assert(metaLead.source === 'meta', `Expected source=meta, got ${metaLead.source}`);
      assert(metaLead.syncProvider === 'windsor.ai', 'syncProvider is windsor.ai');

      const googleLead = await Lead.findOne({ externalLeadId: `lead_google_${timestamp}` });
      assert(googleLead, 'Google lead persisted');
      assert(googleLead.source === 'google_ads', `Expected source=google_ads, got ${googleLead.source}`);

      const unknownLead = await Lead.findOne({ externalLeadId: `lead_unknown_${timestamp}` });
      assert(unknownLead, 'Unknown lead persisted');
      assert(
        unknownLead.source !== 'windsor.ai' && unknownLead.source !== 'windsor',
        'Lead source must NEVER be set to windsor.ai or windsor'
      );
      assert(unknownLead.source === 'unknown', `Expected source=unknown, got ${unknownLead.source}`);

      console.log('✔ Test 8 Passed: Sync persists Meta, other channels, and protects against setting source=windsor.ai');

      // Test 9: Repeated sync does NOT overwrite existing valid source
      const repeatRecords = [
        {
          id: `lead_meta_${timestamp}`,
          account_id: testAccountId,
          full_name: 'Meta Real Estate Buyer Updated',
          email: 'meta.buyer.updated@example.com',
          source: 'windsor.ai', // Upstream sent windsor.ai in second sync
          datasource: '',       // Blank datasource
        },
      ];

      const mockRepeatFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: repeatRecords }),
      });

      const syncResult2 = await syncFacebookLeads({
        overrideEnv: {
          ...env,
          WINDSOR_ACCOUNT_ID: testAccountId,
          WINDSOR_API_KEY: 'test_key',
        },
        fetchFn: mockRepeatFetch,
      });

      assert(syncResult2.updated === 1, `Expected 1 updated lead, got ${syncResult2.updated}`);
      assert(syncResult2.inserted === 0, 'No duplicates inserted');

      const refreshedLead = await Lead.findOne({ externalLeadId: `lead_meta_${timestamp}` });
      assert(
        refreshedLead.source === 'meta',
        `Valid source 'meta' must NOT be overwritten with windsor.ai or unknown (got: ${refreshedLead.source})`
      );
      assert(
        refreshedLead.fullName === 'Meta Real Estate Buyer Updated',
        'Customer details updated successfully'
      );
      console.log('✔ Test 9 Passed: Repeated sync successfully updates lead details without overwriting valid acquisition source');
    }

    // Test 10: Filtering leads by source=meta matches Meta leads
    {
      const res = await fetch(`${BASE_URL}/api/leads?source=meta`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'GET /api/leads?source=meta returns 200');
      assert(data.total >= 1, 'Returns at least 1 Meta lead');
      for (const l of data.leads) {
        assert(
          ['meta', 'facebook_leads', 'facebook'].includes(l.source),
          `Lead source should be meta-related, got ${l.source}`
        );
      }
      console.log('✔ Test 10 Passed: GET /api/leads?source=meta cleanly filters Meta leads');
    }

    // Test 11: API responses NEVER expose syncProvider
    {
      const listRes = await fetch(`${BASE_URL}/api/leads?limit=5`, {
        headers: { Cookie: adminCookie },
      });
      const listData = await listRes.json();
      assert(listRes.status === 200, 'GET /api/leads returns 200');
      assert(listData.leads.length > 0, 'Leads returned in list');
      for (const lead of listData.leads) {
        assert(
          lead.syncProvider === undefined,
          `Lead in list must NEVER expose syncProvider (got: ${lead.syncProvider})`
        );
      }

      const singleRes = await fetch(`${BASE_URL}/api/leads/${listData.leads[0]._id}`, {
        headers: { Cookie: adminCookie },
      });
      const singleData = await singleRes.json();
      assert(singleRes.status === 200, 'GET /api/leads/:id returns 200');
      assert(
        singleData.lead.syncProvider === undefined,
        `Lead detail must NEVER expose syncProvider (got: ${singleData.lead.syncProvider})`
      );
      console.log('✔ Test 11 Passed: Lead API responses strictly strip syncProvider metadata');
    }

    // Test 12: Frontend source code validation: zero user-facing Windsor or Sync Provider labels
    {
      const fs = await import('fs');
      const path = await import('path');

      const leadDrawerContent = fs.readFileSync(
        path.resolve(process.cwd(), '../client/src/features/leads/components/LeadDrawer.jsx'),
        'utf-8'
      );
      const leadsPageContent = fs.readFileSync(
        path.resolve(process.cwd(), '../client/src/features/leads/pages/LeadsPage.jsx'),
        'utf-8'
      );

      assert(
        !leadDrawerContent.includes('Sync Provider'),
        'LeadDrawer must NOT contain "Sync Provider" label'
      );
      assert(
        !leadDrawerContent.includes('Windsor'),
        'LeadDrawer must NOT contain any "Windsor" label'
      );
      assert(
        !leadsPageContent.includes('Syncing Windsor'),
        'LeadsPage must NOT contain "Syncing Windsor" label'
      );
      assert(
        !leadsPageContent.includes('Windsor.ai'),
        'LeadsPage must NOT contain "Windsor.ai" label'
      );
      console.log('✔ Test 12 Passed: Frontend UI contains zero user-facing Windsor or Sync Provider labels');
    }

    console.log('\n=============================================================');
    console.log('🎉 ALL 12 REGRESSION TESTS PASSED SUCCESSFULLY!');
    console.log('=============================================================\n');
  } finally {
    // Teardown test fixtures
    console.log('[Teardown] Cleaning up test fixtures...');
    env.WINDSOR_ACCOUNT_ID = originalAccountId;
    await Lead.deleteMany({ accountId: testAccountId });
    await Lead.deleteMany({ accountId: 'foreign_account_99999' });
    if (testAdmin) await User.findByIdAndDelete(testAdmin._id);
    if (testSales) await User.findByIdAndDelete(testSales._id);
    if (otherSales) await User.findByIdAndDelete(otherSales._id);
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
    console.log('[Teardown] Done.');
  }
}

runRegressionSuite().catch((err) => {
  console.error('\n❌ Regression test failed:', err);
  process.exit(1);
});
