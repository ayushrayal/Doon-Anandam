import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import Activity from '../src/models/Activity.js';
import { env } from '../src/config/env.js';
import { signToken, COOKIE_NAME } from '../src/utils/jwt.js';

const TEST_PORT = 5098;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runRegressionSuite() {
  console.log('=== Starting Regression Suite: Completed in Period Drill-Down ===\n');

  await connectDB();
  const server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const testAccountId = `act_drilldown_${timestamp}`;
  const otherAccountId = `act_other_${timestamp}`;
  const adminEmail = `admin.drilldown.${timestamp}@example.com`;
  const salesEmail1 = `sales1.drilldown.${timestamp}@example.com`;
  const salesEmail2 = `sales2.drilldown.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  // Override account configuration for isolated test scope
  const originalAccountId = env.WINDSOR_ACCOUNT_ID;
  env.WINDSOR_ACCOUNT_ID = testAccountId;

  let testAdmin = null;
  let testSales1 = null;
  let testSales2 = null;
  let adminCookie = '';
  let sales1Cookie = '';
  let sales2Cookie = '';

  const createdLeadIds = [];
  const createdActivityIds = [];

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    testAdmin = await User.create({
      name: 'Drilldown Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales1 = await User.create({
      name: 'Drilldown Sales 1',
      email: salesEmail1,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    testSales2 = await User.create({
      name: 'Drilldown Sales 2',
      email: salesEmail2,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    const adminToken = signToken({
      id: testAdmin._id,
      role: testAdmin.role,
    });
    const sales1Token = signToken({
      id: testSales1._id,
      role: testSales1.role,
    });
    const sales2Token = signToken({
      id: testSales2._id,
      role: testSales2.role,
    });

    adminCookie = `${COOKIE_NAME}=${adminToken}`;
    sales1Cookie = `${COOKIE_NAME}=${sales1Token}`;
    sales2Cookie = `${COOKIE_NAME}=${sales2Token}`;

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

    // 1. Lead 1: Follow-up completed 3 days ago (inside 7d and 30d, outside today)
    const lead1 = await Lead.create({
      fullName: 'Lead One Completed Inside 7d',
      email: `lead1.${timestamp}@example.com`,
      phoneNumber: '+919876543201',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_1_${timestamp}`,
      status: 'contacted',
      assignedTo: testSales1._id,
      lastFollowUpCompletedAt: threeDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead1._id);

    const act1 = await Activity.create({
      leadId: lead1._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'Follow-up completed 3 days ago',
      performedBy: testSales1._id,
      performedAt: threeDaysAgo,
    });
    createdActivityIds.push(act1._id);

    // 2. Lead 2: Follow-up completed 15 days ago (inside 30d, outside 7d)
    const lead2 = await Lead.create({
      fullName: 'Lead Two Completed Inside 30d',
      email: `lead2.${timestamp}@example.com`,
      phoneNumber: '+919876543202',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_2_${timestamp}`,
      status: 'follow_up',
      assignedTo: testSales1._id,
      lastFollowUpCompletedAt: fifteenDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead2._id);

    const act2 = await Activity.create({
      leadId: lead2._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'Follow-up completed 15 days ago',
      performedBy: testSales1._id,
      performedAt: fifteenDaysAgo,
    });
    createdActivityIds.push(act2._id);

    // 3. Lead 3: Follow-up completed 45 days ago (outside 30d, inside all-time)
    const lead3 = await Lead.create({
      fullName: 'Lead Three Completed Outside Range',
      email: `lead3.${timestamp}@example.com`,
      phoneNumber: '+919876543203',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_3_${timestamp}`,
      status: 'qualified',
      assignedTo: testSales1._id,
      lastFollowUpCompletedAt: fortyFiveDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead3._id);

    const act3 = await Activity.create({
      leadId: lead3._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'Follow-up completed 45 days ago',
      performedBy: testSales1._id,
      performedAt: fortyFiveDaysAgo,
    });
    createdActivityIds.push(act3._id);

    // 4. Lead 4: Never completed any follow-up
    const lead4 = await Lead.create({
      fullName: 'Lead Four No Completion',
      email: `lead4.${timestamp}@example.com`,
      phoneNumber: '+919876543204',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_4_${timestamp}`,
      status: 'new',
      assignedTo: testSales1._id,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead4._id);

    // 5. Lead 5: Multiple completed follow-ups in the period (2 completions within 7d)
    const lead5 = await Lead.create({
      fullName: 'Lead Five Multiple Completions',
      email: `lead5.${timestamp}@example.com`,
      phoneNumber: '+919876543205',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_5_${timestamp}`,
      status: 'contacted',
      assignedTo: testSales1._id,
      lastFollowUpCompletedAt: threeDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead5._id);

    const act5a = await Activity.create({
      leadId: lead5._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'First follow-up completed 4 days ago',
      performedBy: testSales1._id,
      performedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
    });
    createdActivityIds.push(act5a._id);

    const act5b = await Activity.create({
      leadId: lead5._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'Second follow-up completed 2 days ago',
      performedBy: testSales1._id,
      performedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    });
    createdActivityIds.push(act5b._id);

    // 6. Lead 6: Completed follow-up for Sales Rep 2 (role scoping check)
    const lead6 = await Lead.create({
      fullName: 'Lead Six Sales Rep Two',
      email: `lead6.${timestamp}@example.com`,
      phoneNumber: '+919876543206',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_6_${timestamp}`,
      status: 'contacted',
      assignedTo: testSales2._id,
      lastFollowUpCompletedAt: threeDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead6._id);

    const act6 = await Activity.create({
      leadId: lead6._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'Completed by Rep 2',
      performedBy: testSales2._id,
      performedAt: threeDaysAgo,
    });
    createdActivityIds.push(act6._id);

    // 7. Lead 7: Completed follow-up in different account (account scoping check)
    const lead7 = await Lead.create({
      fullName: 'Lead Seven Other Account',
      email: `lead7.${timestamp}@example.com`,
      phoneNumber: '+919876543207',
      source: 'meta',
      accountId: otherAccountId,
      externalLeadId: `ext_7_${timestamp}`,
      status: 'contacted',
      assignedTo: testSales1._id,
      lastFollowUpCompletedAt: threeDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead7._id);

    const act7 = await Activity.create({
      leadId: lead7._id,
      accountId: otherAccountId,
      type: 'follow_up_completed',
      summary: 'Completed in other account',
      performedBy: testSales1._id,
      performedAt: threeDaysAgo,
    });
    createdActivityIds.push(act7._id);

    // 8. Lead 8: Converted lead with completed follow-up (lifecycle distinction check)
    const lead8 = await Lead.create({
      fullName: 'Lead Eight Converted With Completed FollowUp',
      email: `lead8.${timestamp}@example.com`,
      phoneNumber: '+919876543208',
      source: 'meta',
      accountId: testAccountId,
      externalLeadId: `ext_8_${timestamp}`,
      status: 'converted',
      assignedTo: testSales1._id,
      lastFollowUpCompletedAt: threeDaysAgo,
      nextFollowUpDate: null,
    });
    createdLeadIds.push(lead8._id);

    const act8 = await Activity.create({
      leadId: lead8._id,
      accountId: testAccountId,
      type: 'follow_up_completed',
      summary: 'Follow-up before conversion',
      performedBy: testSales1._id,
      performedAt: threeDaysAgo,
    });
    createdActivityIds.push(act8._id);

    // Helper for authenticated requests
    async function apiGet(endpoint, cookie) {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        headers: { Cookie: cookie },
      });
      const data = await res.json();
      return { status: res.status, data };
    }

    // ==========================================
    // TEST 1: Follow-up completed inside range
    // ==========================================
    console.log('[Test 1] Follow-up completed inside selected range...');
    {
      const res7d = await apiGet('/api/leads?followUpStatus=completed&dateFilter=7d', adminCookie);
      assert(res7d.status === 200, `Expected 200, got ${res7d.status}`);
      const lead1InList = res7d.data.leads.find((l) => l._id === lead1._id.toString());
      assert(lead1InList, 'Lead 1 (completed 3d ago) must be returned in 7d filter');
      assert(lead1InList.lastFollowUpCompletedAt, 'Lead 1 must have lastFollowUpCompletedAt date');

      const resToday = await apiGet('/api/leads?followUpStatus=completed&dateFilter=today', adminCookie);
      const lead1InToday = resToday.data.leads.find((l) => l._id === lead1._id.toString());
      assert(!lead1InToday, 'Lead 1 (completed 3d ago) must NOT be returned in today filter');
      console.log('  PASSED: Inside range matching verified.');
    }

    // ==========================================
    // TEST 2: Follow-up completed outside range
    // ==========================================
    console.log('[Test 2] Follow-up completed outside selected range...');
    {
      const res30d = await apiGet('/api/leads?followUpStatus=completed&dateFilter=30d', adminCookie);
      const lead3In30d = res30d.data.leads.find((l) => l._id === lead3._id.toString());
      assert(!lead3In30d, 'Lead 3 (completed 45d ago) must NOT be returned in 30d filter');

      const resAll = await apiGet('/api/leads?followUpStatus=completed&dateFilter=all', adminCookie);
      const lead3InAll = resAll.data.leads.find((l) => l._id === lead3._id.toString());
      assert(lead3InAll, 'Lead 3 (completed 45d ago) MUST be returned in all-time filter');
      console.log('  PASSED: Outside range exclusion and all-time inclusion verified.');
    }

    // ==========================================
    // TEST 3: Lead with no completed follow-up
    // ==========================================
    console.log('[Test 3] Lead with no completed follow-up...');
    {
      const resAll = await apiGet('/api/leads?followUpStatus=completed&dateFilter=all', adminCookie);
      const lead4InList = resAll.data.leads.find((l) => l._id === lead4._id.toString());
      assert(!lead4InList, 'Lead 4 (no completed follow-up) must never appear in completed filter');
      console.log('  PASSED: Lead with no completed follow-up is excluded.');
    }

    // ==========================================
    // TEST 4: Multiple completed follow-ups on the same lead
    // ==========================================
    console.log('[Test 4] Multiple completed follow-ups on single lead (unique leads vs events)...');
    {
      const res7d = await apiGet('/api/leads?followUpStatus=completed&dateFilter=7d', adminCookie);
      const lead5Matches = res7d.data.leads.filter((l) => l._id === lead5._id.toString());
      assert(lead5Matches.length === 1, `Lead 5 with 2 completed activities must appear exactly once in table, got ${lead5Matches.length}`);

      const dashRes = await apiGet('/api/analytics/dashboard?preset=7d', adminCookie);
      assert(dashRes.status === 200, 'Dashboard request must succeed');

      // Lead 1, Lead 5, Lead 6, Lead 8 are all within 7d in testAccountId
      // Total activities: lead1(1) + lead5(2) + lead6(1) + lead8(1) = 5
      // Total unique leads: lead1, lead5, lead6, lead8 = 4
      assert(
        dashRes.data.historicalActivity.followUpsCompletedInPeriod === 5,
        `Expected 5 completed follow-up actions, got ${dashRes.data.historicalActivity.followUpsCompletedInPeriod}`
      );
      assert(
        dashRes.data.historicalActivity.uniqueLeadsCompletedInPeriod === 4,
        `Expected 4 unique leads with completed follow-ups, got ${dashRes.data.historicalActivity.uniqueLeadsCompletedInPeriod}`
      );
      assert(
        dashRes.data.followUpWorkload.completedInPeriod === 4,
        `Expected followUpWorkload.completedInPeriod to match unique leads (4), got ${dashRes.data.followUpWorkload.completedInPeriod}`
      );
      console.log('  PASSED: Multiple completions correctly yield unique leads count matching table.');
    }

    // ==========================================
    // TEST 5: Account and sales-representative isolation
    // ==========================================
    console.log('[Test 5] Account and sales-representative isolation...');
    {
      // Other account lead (Lead 7) must not appear for admin or reps
      const adminAll = await apiGet('/api/leads?followUpStatus=completed&dateFilter=all', adminCookie);
      const lead7InAdmin = adminAll.data.leads.find((l) => l._id === lead7._id.toString());
      assert(!lead7InAdmin, 'Lead 7 from other account must NEVER appear under test account scope');

      // Sales Rep 1 must only see leads assigned to/completed by Sales Rep 1
      const sales1Res = await apiGet('/api/leads?followUpStatus=completed&dateFilter=7d', sales1Cookie);
      const lead6InSales1 = sales1Res.data.leads.find((l) => l._id === lead6._id.toString());
      assert(!lead6InSales1, 'Sales Rep 1 must NOT see Lead 6 (assigned to Sales Rep 2)');

      const lead1InSales1 = sales1Res.data.leads.find((l) => l._id === lead1._id.toString());
      assert(lead1InSales1, 'Sales Rep 1 MUST see Lead 1');

      // Admin filtering by assignedTo=Sales Rep 2 must only see Lead 6
      const adminScopedRep2 = await apiGet(
        `/api/leads?followUpStatus=completed&dateFilter=7d&assignedTo=${testSales2._id}`,
        adminCookie
      );
      assert(adminScopedRep2.data.total === 1, `Expected 1 lead for Sales Rep 2, got ${adminScopedRep2.data.total}`);
      assert(adminScopedRep2.data.leads[0]._id === lead6._id.toString(), 'Expected Lead 6 for Sales Rep 2');
      console.log('  PASSED: Account and representative scoping verified.');
    }

    // ==========================================
    // TEST 6: Completed follow-ups across lead lifecycle statuses
    // ==========================================
    console.log('[Test 6] Completed follow-ups on converted/non-converted leads...');
    {
      const res7d = await apiGet('/api/leads?followUpStatus=completed&dateFilter=7d', adminCookie);
      const lead8InList = res7d.data.leads.find((l) => l._id === lead8._id.toString());
      assert(lead8InList, 'Lead 8 (status=converted) must be included in completed follow-ups');
      assert(lead8InList.status === 'converted', 'Lead 8 preserves its converted stage status');
      console.log('  PASSED: Follow-up completion is not confused with lead lifecycle stages.');
    }

    // ==========================================
    // TEST 7: Dashboard count strictly matches drill-down total
    // ==========================================
    console.log('[Test 7] Dashboard count matches drill-down total across presets...');
    {
      for (const preset of ['today', '7d', '30d', 'all']) {
        const dashRes = await apiGet(`/api/analytics/dashboard?preset=${preset}`, adminCookie);
        const leadsRes = await apiGet(`/api/leads?followUpStatus=completed&dateFilter=${preset}`, adminCookie);

        const dashUniqueCount = dashRes.data.historicalActivity.uniqueLeadsCompletedInPeriod;
        const leadsTotal = leadsRes.data.total;
        assert(
          dashUniqueCount === leadsTotal,
          `Preset ${preset}: Dashboard unique leads (${dashUniqueCount}) does not match Leads page total (${leadsTotal})`
        );
      }
      console.log('  PASSED: 1:1 parity between Dashboard metric and Leads page count.');
    }

    // ==========================================
    // TEST 8: Pagination and limit
    // ==========================================
    console.log('[Test 8] Pagination consistency...');
    {
      const page1Res = await apiGet('/api/leads?followUpStatus=completed&dateFilter=7d&limit=2&page=1', adminCookie);
      const page2Res = await apiGet('/api/leads?followUpStatus=completed&dateFilter=7d&limit=2&page=2', adminCookie);

      assert(page1Res.data.total === 4, `Expected total 4, got ${page1Res.data.total}`);
      assert(page1Res.data.totalPages === 2, `Expected totalPages 2, got ${page1Res.data.totalPages}`);
      assert(page1Res.data.leads.length === 2, `Expected 2 leads on page 1, got ${page1Res.data.leads.length}`);
      assert(page2Res.data.leads.length === 2, `Expected 2 leads on page 2, got ${page2Res.data.leads.length}`);

      const page1Ids = page1Res.data.leads.map((l) => l._id);
      const page2Ids = page2Res.data.leads.map((l) => l._id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      assert(overlap.length === 0, `Page 1 and Page 2 must have distinct items, overlap: ${overlap}`);
      console.log('  PASSED: Pagination works accurately with drill-down filter.');
    }

    // ==========================================
    // TEST 9: Schema validation and error handling
    // ==========================================
    console.log('[Test 9] Schema validation...');
    {
      const validRes = await apiGet('/api/leads?followUpStatus=completed&dateFilter=30d', adminCookie);
      assert(validRes.status === 200, `Expected 200 for valid followUpStatus=completed, got ${validRes.status}`);

      const invalidRes = await apiGet('/api/leads?followUpStatus=invalid_status', adminCookie);
      assert(invalidRes.status === 400, `Expected 400 for invalid followUpStatus, got ${invalidRes.status}`);
      console.log('  PASSED: Zod schema validates followUpStatus strictly.');
    }

    console.log('\n=== ALL 9 REGRESSION TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    console.log('[Cleanup] Cleaning up test data...');
    try {
      if (createdActivityIds.length > 0) {
        await Activity.deleteMany({ _id: { $in: createdActivityIds } });
      }
      if (createdLeadIds.length > 0) {
        await Lead.deleteMany({ _id: { $in: createdLeadIds } });
      }
      if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
      if (testSales1) await User.deleteOne({ _id: testSales1._id });
      if (testSales2) await User.deleteOne({ _id: testSales2._id });
    } catch (cleanupErr) {
      console.error('[Cleanup Error]', cleanupErr);
    }
    env.WINDSOR_ACCOUNT_ID = originalAccountId;
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
    console.log('[Cleanup] Complete. Server and DB disconnected.');
  }
}

runRegressionSuite().catch((err) => {
  console.error('\n❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
