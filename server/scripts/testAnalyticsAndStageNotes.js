import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import Activity from '../src/models/Activity.js';
import { env } from '../src/config/env.js';

const TEST_PORT = 5092;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting Phase 8/9: Analytics Dashboard & Lead Stage Notes Test Suite ===\n');

  await connectDB();
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const adminEmail = `p8.admin.${timestamp}@example.com`;
  const salesEmail1 = `p8.sales1.${timestamp}@example.com`;
  const salesEmail2 = `p8.sales2.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  let testAdmin = null;
  let testSales1 = null;
  let testSales2 = null;

  let lead1 = null;
  let lead2 = null;
  let lead3 = null;
  let lead4 = null;
  let lead5 = null;
  let lead6 = null;
  let foreignLead = null;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // 1. Create fixtures
    testAdmin = await User.create({
      name: 'P8 Test Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales1 = await User.create({
      name: 'P8 Sales Rep 1',
      email: salesEmail1,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    testSales2 = await User.create({
      name: 'P8 Sales Rep 2',
      email: salesEmail2,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    const accountId = env.WINDSOR_ACCOUNT_ID || 'act_test_p8';
    const now = new Date();

    // Lead 1: Ingested today, status: new, assigned to Sales 1
    lead1 = await Lead.create({
      externalLeadId: `ext_p8_1_${timestamp}`,
      source: 'website',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Aarav Mehta',
      email: 'aarav.p8@example.com',
      phoneNumber: '+919811111111',
      status: 'new',
      assignedTo: testSales1._id,
      leadCreatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
    });

    // Lead 2: Ingested 5 days ago, status: contacted, assigned to Sales 1, overdue follow-up
    lead2 = await Lead.create({
      externalLeadId: `ext_p8_2_${timestamp}`,
      source: 'facebook_ads',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Bhavna Sen',
      email: 'bhavna.p8@example.com',
      phoneNumber: '+919822222222',
      status: 'contacted',
      assignedTo: testSales1._id,
      leadCreatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      nextFollowUpDate: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day overdue
      nextFollowUpRemarks: 'Review payment plan',
    });

    // Lead 3: Ingested 12 days ago, status: follow_up, assigned to Sales 1, follow-up due today
    lead3 = await Lead.create({
      externalLeadId: `ext_p8_3_${timestamp}`,
      source: 'walk_in',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Chetan Joshi',
      email: 'chetan.p8@example.com',
      phoneNumber: '+919833333333',
      status: 'follow_up',
      assignedTo: testSales1._id,
      leadCreatedAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
      nextFollowUpDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0), // Today at 15:00
      nextFollowUpRemarks: 'Site visit scheduled',
    });

    // Lead 4: Ingested 18 days ago, status: qualified, assigned to Sales 2, upcoming follow-up
    lead4 = await Lead.create({
      externalLeadId: `ext_p8_4_${timestamp}`,
      source: 'website',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Divya Nair',
      email: 'divya.p8@example.com',
      phoneNumber: '+919844444444',
      status: 'qualified',
      assignedTo: testSales2._id,
      leadCreatedAt: new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000),
      nextFollowUpDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days in future
      nextFollowUpRemarks: 'Agreement signing discussion',
    });

    // Lead 5: Ingested 25 days ago, status: converted, assigned to Sales 2
    lead5 = await Lead.create({
      externalLeadId: `ext_p8_5_${timestamp}`,
      source: 'referral',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Eshan Roy',
      email: 'eshan.p8@example.com',
      phoneNumber: '+919855555555',
      status: 'converted',
      assignedTo: testSales2._id,
      leadCreatedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
    });

    // Lead 6: Ingested 45 days ago (outside 30d cohort), status: lost, unassigned
    lead6 = await Lead.create({
      externalLeadId: `ext_p8_6_${timestamp}`,
      source: 'facebook_ads',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Farhan Zaidi',
      email: 'farhan.p8@example.com',
      phoneNumber: '+919866666666',
      status: 'lost',
      assignedTo: null,
      leadCreatedAt: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000),
    });

    // Foreign Lead: foreign accountId
    foreignLead = await Lead.create({
      externalLeadId: `ext_p8_foreign_${timestamp}`,
      source: 'website',
      accountId: 'foreign_account_p8',
      accountName: 'Foreign CRM Org',
      fullName: 'Girish Kumar',
      email: 'girish.foreign@example.com',
      phoneNumber: '+919877777777',
      status: 'converted',
      assignedTo: null,
      leadCreatedAt: new Date(),
    });

    console.log('[Setup] Created test fixtures (Users, Leads with varied stages, creation dates & workloads)\n');

    // Login helpers
    async function login(email, pwd) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd }),
      });
      const cookieHeader = res.headers.get('set-cookie');
      return cookieHeader;
    }

    const adminCookie = await login(adminEmail, password);
    const sales1Cookie = await login(salesEmail1, password);

    // ==========================================
    // SECTION 1: Status 'follow_up' & Stage Notes
    // ==========================================
    console.log('--- Section 1: Lead Stage Transition, Notes & History ---');

    // Test 1: Transition new -> follow_up with note
    const t1Res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        status: 'follow_up',
        note: 'Customer requested follow-up after consulting family.',
      }),
    });
    const t1Data = await t1Res.json();
    assert(t1Res.status === 200, `Expected 200, got ${t1Res.status}`);
    assert(t1Data.lead.status === 'follow_up', 'Lead status should be follow_up');
    assert(
      t1Data.lead.notes.includes('Customer requested follow-up'),
      'Lead notes should contain stage note'
    );
    console.log('✔ Test 1: Status updated to follow_up with stage note appended to lead.notes');

    // Test 2: Append-only Activity log created with metadata
    const t2Res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
      headers: { Cookie: adminCookie },
    });
    const t2Data = await t2Res.json();
    assert(t2Res.status === 200, `Expected 200, got ${t2Res.status}`);
    const stageActivity = t2Data.activities.find((a) => a.type === 'status_change');
    assert(stageActivity, 'Activity timeline must contain status_change entry');
    assert(stageActivity.metadata.previousStatus === 'new', 'Previous status should be new');
    assert(stageActivity.metadata.newStatus === 'follow_up', 'New status should be follow_up');
    assert(
      stageActivity.metadata.note === 'Customer requested follow-up after consulting family.',
      'Activity metadata must record the note'
    );
    console.log('✔ Test 2: Append-only Activity record logged with status transition metadata');

    // Test 3: Scheduled follow-up decoupling from stage
    // Transitioning stage does not schedule a follow-up date; lead1.nextFollowUpDate is still null
    assert(
      !t1Data.lead.nextFollowUpDate,
      'nextFollowUpDate must remain null when stage is changed without scheduling'
    );
    console.log('✔ Test 3: Pipeline stage change does not overwrite or force nextFollowUpDate');

    // Test 4: Transition to 'lost' with reason and note
    const t4Res = await fetch(`${BASE_URL}/api/leads/${lead2._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        status: 'lost',
        reason: 'budget_constraint',
        note: 'Out of budget for 3BHK villas.',
      }),
    });
    const t4Data = await t4Res.json();
    assert(t4Res.status === 200, `Expected 200, got ${t4Res.status}`);
    assert(t4Data.lead.status === 'lost', 'Status should be lost');

    const t4ActRes = await fetch(`${BASE_URL}/api/leads/${lead2._id}/activities`, {
      headers: { Cookie: adminCookie },
    });
    const t4ActData = await t4ActRes.json();
    const lostActivity = t4ActData.activities.find(
      (a) => a.type === 'status_change' && a.metadata.newStatus === 'lost'
    );
    assert(lostActivity, 'Lost activity entry must exist');
    assert(lostActivity.metadata.reason === 'budget_constraint', 'Lost reason should be recorded');
    console.log('✔ Test 4: Marking lead lost logs append-only reason and operational note');

    // ==========================================
    // SECTION 2: Analytics Auth & Validation
    // ==========================================
    console.log('\n--- Section 2: Analytics Authentication & Query Validation ---');

    // Test 5: Unauthenticated access returns 401
    const t5Res = await fetch(`${BASE_URL}/api/analytics/dashboard`);
    assert(t5Res.status === 401, `Expected 401, got ${t5Res.status}`);
    console.log('✔ Test 5: Unauthenticated GET /api/analytics/dashboard returns 401');

    // Test 6: Invalid preset rejected with 400
    const t6Res = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=invalid_preset`, {
      headers: { Cookie: adminCookie },
    });
    assert(t6Res.status === 400, `Expected 400, got ${t6Res.status}`);
    console.log('✔ Test 6: Invalid preset rejected with 400 Validation Error');

    // Test 7: Invalid date format rejected with 400
    const t7Res = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=custom&startDate=not-a-date`, {
      headers: { Cookie: adminCookie },
    });
    assert(t7Res.status === 400, `Expected 400, got ${t7Res.status}`);
    console.log('✔ Test 7: Malformed date string rejected with 400 Validation Error');

    // ==========================================
    // SECTION 3: Date Semantics & Cohorts
    // ==========================================
    console.log('\n--- Section 3: Date Semantics & Cohort Calculations ---');

    // Test 8: Admin 30-day dashboard
    const t8Res = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=30d`, {
      headers: { Cookie: adminCookie },
    });
    const t8Data = await t8Res.json();
    assert(t8Res.status === 200, `Expected 200, got ${t8Res.status}`);
    assert(t8Data.filterSemantics, 'Response must include filterSemantics documentation');
    assert(t8Data.filterSemantics.cohortDefinition, 'cohortDefinition must be present');
    assert(t8Data.filterSemantics.stageDistributionDefinition, 'stageDistributionDefinition must be present');
    assert(t8Data.filterSemantics.conversionsInPeriodDefinition, 'conversionsInPeriodDefinition must be present');

    // Admin 30d query includes preexisting leads + newly created test leads
    assert(t8Data.cohort.total >= 5, `Expected at least 5 leads in 30d cohort, got ${t8Data.cohort.total}`);
    assert(t8Data.cohort.statusCounts.follow_up >= 2, `Expected at least 2 follow_up leads in 30d`);
    assert(typeof t8Data.cohort.conversionRate === 'number', 'conversionRate must be a number');
    console.log('✔ Test 8: 30-day cohort metrics successfully computed with valid status distribution');

    // Test 8b: Deterministic exact metric check using newly created user assignment filter
    const t8bRes = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=30d&assignedTo=${testSales2._id}`, {
      headers: { Cookie: adminCookie },
    });
    const t8bData = await t8bRes.json();
    assert(t8bRes.status === 200, `Expected 200, got ${t8bRes.status}`);
    // Sales 2 has exactly 2 leads: lead4 (qualified) and lead5 (converted)
    assert(t8bData.cohort.total === 2, `Expected exactly 2 leads for Sales 2, got ${t8bData.cohort.total}`);
    assert(t8bData.cohort.statusCounts.qualified === 1, `Expected 1 qualified lead`);
    assert(t8bData.cohort.statusCounts.converted === 1, `Expected 1 converted lead`);
    assert(t8bData.cohort.conversionRate === 50.0, `Expected 50.0% conversion rate (1/2), got ${t8bData.cohort.conversionRate}`);
    console.log('✔ Test 8b: Isolated sales rep assignment filter yields exact deterministic cohort metrics');

    // Test 9: All-time pipeline includes all leads in account
    assert(t8Data.allTimePipeline.total >= 6, `Expected at least 6 all-time leads in account, got ${t8Data.allTimePipeline.total}`);
    assert(t8Data.allTimePipeline.statusCounts.lost >= 2, `Expected at least 2 lost leads`);
    console.log('✔ Test 9: All-time pipeline snapshot captures entire organizational portfolio');

    // Test 10: Zero-denominator safety (Future date range with 0 leads)
    const t10Res = await fetch(
      `${BASE_URL}/api/analytics/dashboard?preset=custom&startDate=2099-01-01&endDate=2099-01-31`,
      { headers: { Cookie: adminCookie } }
    );
    const t10Data = await t10Res.json();
    assert(t10Res.status === 200, `Expected 200, got ${t10Res.status}`);
    assert(t10Data.cohort.total === 0, 'Cohort total should be 0');
    assert(t10Data.cohort.conversionRate === 0.0, 'Conversion rate must be 0.0 without NaN/div-by-zero');
    console.log('✔ Test 10: Zero-lead date range safely returns 0 count and 0.0% conversion rate');

    // ==========================================
    // SECTION 4: Follow-up Workload
    // ==========================================
    console.log('\n--- Section 4: Operational Follow-up Workload Metrics ---');

    // lead2 was marked lost (so it drops out of active follow-ups)
    // lead3 has follow-up due today
    // lead4 has follow-up upcoming
    assert(t8Data.followUpWorkload.dueToday >= 1, 'Expected at least 1 follow-up due today');
    assert(t8Data.followUpWorkload.upcoming >= 1, 'Expected at least 1 upcoming follow-up');
    console.log('✔ Test 11: Operational follow-up workload correctly categorized (dueToday, upcoming)');

    // ==========================================
    // SECTION 5: Account Isolation & Role Scoping
    // ==========================================
    console.log('\n--- Section 5: Account Isolation & Sales Executive Role Scoping ---');

    // Test 12: Sales Executive 1 accesses dashboard
    const t12Res = await fetch(`${BASE_URL}/api/analytics/dashboard?preset=all`, {
      headers: { Cookie: sales1Cookie },
    });
    const t12Data = await t12Res.json();
    assert(t12Res.status === 200, `Expected 200, got ${t12Res.status}`);

    // Sales 1 only owns lead1, lead2, lead3 (total 3 leads)
    // lead4 and lead5 are assigned to Sales 2; lead6 is unassigned
    assert(
      t12Data.allTimePipeline.total === 3,
      `Expected Sales 1 to see exactly 3 assigned leads, got ${t12Data.allTimePipeline.total}`
    );
    assert(
      t12Data.executiveBreakdown.length === 1,
      `Sales executive should receive 1 executive breakdown row (themselves), got ${t12Data.executiveBreakdown.length}`
    );
    assert(
      String(t12Data.executiveBreakdown[0].id) === String(testSales1._id),
      'Executive row should match authenticated sales representative'
    );
    console.log('✔ Test 12: Sales Executive strictly scoped to their assigned leads and personal metrics');

    // Test 13: Admin sees complete executive matrix
    assert(t8Data.executiveBreakdown.length >= 2, 'Admin receives matrix of all sales representatives');
    const sales1Matrix = t8Data.executiveBreakdown.find((e) => String(e.id) === String(testSales1._id));
    assert(sales1Matrix, 'Sales 1 must exist in admin matrix');
    assert(sales1Matrix.totalAssigned === 3, `Expected 3 assigned leads for Sales 1, got ${sales1Matrix.totalAssigned}`);
    console.log('✔ Test 13: Admin executive performance matrix accurately aggregates team distribution');

    console.log('\n=============================================================');
    console.log('🎉 ALL 13 ANALYTICS & STAGE-NOTES TESTS PASSED SUCCESSFULLY!');
    console.log('=============================================================\n');
  } finally {
    console.log('[Teardown] Cleaning up test fixtures...');
    try {
      if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
      if (testSales1) await User.deleteOne({ _id: testSales1._id });
      if (testSales2) await User.deleteOne({ _id: testSales2._id });
      const testLeadIds = [
        lead1?._id,
        lead2?._id,
        lead3?._id,
        lead4?._id,
        lead5?._id,
        lead6?._id,
        foreignLead?._id,
      ].filter(Boolean);
      if (testLeadIds.length > 0) {
        await Lead.deleteMany({ _id: { $in: testLeadIds } });
        await Activity.deleteMany({ leadId: { $in: testLeadIds } });
      }
    } catch (cleanupErr) {
      console.error('[Teardown Error]', cleanupErr);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Test Server] Stopped.');
    }
    await disconnectDB();
    console.log('[Database] MongoDB connection closed.');
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
