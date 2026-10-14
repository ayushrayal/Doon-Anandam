import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import { env } from '../src/config/env.js';

const TEST_PORT = 5088;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting Phase 6: Lead Management API Automated Test Suite ===\n');

  await connectDB();
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const adminEmail = `p6.admin.${timestamp}@example.com`;
  const salesEmail1 = `p6.sales1.${timestamp}@example.com`;
  const salesEmail2 = `p6.sales2.${timestamp}@example.com`;
  const deactEmail = `p6.deact.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  let testAdmin = null;
  let testSales1 = null;
  let testSales2 = null;
  let deactivatedUser = null;

  // Test leads fixtures
  let lead1 = null; // assigned to sales1
  let lead2 = null; // assigned to sales2
  let lead3 = null; // unassigned
  let foreignLead = null; // different accountId

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Create test users
    testAdmin = await User.create({
      name: 'P6 Test Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales1 = await User.create({
      name: 'P6 Sales Rep 1',
      email: salesEmail1,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    testSales2 = await User.create({
      name: 'P6 Sales Rep 2',
      email: salesEmail2,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    deactivatedUser = await User.create({
      name: 'P6 Deactivated User',
      email: deactEmail,
      passwordHash,
      role: 'sales_executive',
      isActive: false,
    });

    console.log('[Setup] Created test users: Admin, Sales 1, Sales 2, Deactivated User');

    const accountId = env.WINDSOR_ACCOUNT_ID || '754258214430492';

    // Create test leads
    lead1 = await Lead.create({
      externalLeadId: `test_lead_1_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      accountName: 'OFFICESPAZE.com',
      fullName: 'Aarav Sharma',
      email: `aarav.${timestamp}@example.com`,
      phoneNumber: '+919876543210',
      formId: 'form_123',
      formName: 'Test Contact Form',
      campaignName: 'Luxury Villas Launch',
      campaignId: 'camp_101',
      status: 'new',
      assignedTo: testSales1._id,
      notes: 'Initial enquiry from Facebook',
      leadCreatedAt: new Date('2026-03-01T10:00:00Z'),
    });

    lead2 = await Lead.create({
      externalLeadId: `test_lead_2_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      accountName: 'OFFICESPAZE.com',
      fullName: 'Diya Patel',
      email: `diya.${timestamp}@example.com`,
      phoneNumber: '+919876543211',
      formId: 'form_123',
      formName: 'Test Contact Form',
      campaignName: 'Hilltop Retreats',
      campaignId: 'camp_102',
      status: 'contacted',
      assignedTo: testSales2._id,
      notes: 'Followed up via call',
      leadCreatedAt: new Date('2026-03-10T12:00:00Z'),
    });

    lead3 = await Lead.create({
      externalLeadId: `test_lead_3_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      accountName: 'OFFICESPAZE.com',
      fullName: 'Rohan Verma',
      email: `rohan.${timestamp}@example.com`,
      phoneNumber: '+919876543212',
      formId: 'form_456',
      formName: 'Brochure Download',
      campaignName: 'Luxury Villas Launch',
      campaignId: 'camp_101',
      status: 'new',
      assignedTo: null,
      notes: 'Awaiting assignment',
      leadCreatedAt: new Date('2026-03-15T15:00:00Z'),
    });

    // Lead belonging to a foreign account (for account isolation testing)
    foreignLead = await Lead.create({
      externalLeadId: `foreign_lead_${timestamp}`,
      source: 'facebook_leads',
      accountId: 'foreign_account_999999999',
      accountName: 'Other Company Inc',
      fullName: 'Foreign Customer',
      email: `foreign.${timestamp}@example.com`,
      phoneNumber: '+15551234567',
      campaignName: 'Foreign Campaign',
      status: 'new',
      assignedTo: testSales1._id,
      leadCreatedAt: new Date('2026-03-01T10:00:00Z'),
    });

    console.log('[Setup] Created test leads fixtures');

    // Helper to log in and get auth cookie
    async function login(email) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert(res.status === 200, `Login failed for ${email}`);
      return res.headers.get('set-cookie').split(';')[0];
    }

    const adminCookie = await login(adminEmail);
    const sales1Cookie = await login(salesEmail1);
    const sales2Cookie = await login(salesEmail2);

    // ==========================================
    // 1. AUTHENTICATION & CSRF CHECKS
    // ==========================================
    console.log('\n--- Section 1: Authentication & Protection ---');

    {
      const res = await fetch(`${BASE_URL}/api/leads`);
      assert(res.status === 401, 'Unauthenticated GET /api/leads should return 401');
      console.log('✔ Test 1: Unauthenticated GET /api/leads returns 401');
    }

    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}`);
      assert(res.status === 401, 'Unauthenticated GET /api/leads/:id should return 401');
      console.log('✔ Test 2: Unauthenticated GET /api/leads/:id returns 401');
    }

    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      });
      assert(res.status === 401, 'Unauthenticated PATCH /api/leads/:id/status should return 401');
      console.log('✔ Test 3: Unauthenticated PATCH /api/leads/:id/status returns 401');
    }

    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: testSales1._id.toString() }),
      });
      assert(res.status === 401, 'Unauthenticated PATCH /api/leads/:id/assign should return 401');
      console.log('✔ Test 4: Unauthenticated PATCH /api/leads/:id/assign returns 401');
    }

    {
      // CSRF origin rejection check on PATCH
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          Origin: 'https://malicious-attacker-site.com',
        },
        body: JSON.stringify({ status: 'contacted' }),
      });
      assert(res.status === 403, 'Cross-origin request from unauthorized origin should return 403');
      console.log('✔ Test 5: Cross-origin PATCH rejected with 403');
    }

    // ==========================================
    // 2. ACCOUNT ISOLATION
    // ==========================================
    console.log('\n--- Section 2: Account Isolation ---');

    {
      // Foreign lead should NOT appear in admin lead listing
      const res = await fetch(`${BASE_URL}/api/leads?search=Foreign+Customer`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'GET /api/leads should return 200');
      assert(data.leads.length === 0, 'Foreign account lead must NOT appear in listing');
      console.log('✔ Test 6: Foreign account lead is omitted from GET /api/leads');
    }

    {
      // Direct GET on foreign lead ID must return 404
      const res = await fetch(`${BASE_URL}/api/leads/${foreignLead._id}`, {
        headers: { Cookie: adminCookie },
      });
      assert(res.status === 404, 'Direct access to foreign lead ID must return 404');
      console.log('✔ Test 7: Direct GET /api/leads/:id on foreign lead returns 404');
    }

    // ==========================================
    // 3. SALES EXECUTIVE ROLE SCOPING
    // ==========================================
    console.log('\n--- Section 3: Role Scoping (Sales Executive Visibility) ---');

    {
      // Sales 1 can only see their own assigned lead
      const res = await fetch(`${BASE_URL}/api/leads`, {
        headers: { Cookie: sales1Cookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Sales 1 listing should return 200');
      assert(data.leads.length >= 1, 'Sales 1 should see at least lead1');
      const allOwned = data.leads.every(
        (l) => l.assignedTo && l.assignedTo._id.toString() === testSales1._id.toString()
      );
      assert(allOwned, 'Sales 1 must strictly see only leads assigned to Sales 1');
      console.log('✔ Test 8: Sales executive listing returns strictly assigned leads only');
    }

    {
      // Sales 1 trying to directly access Sales 2's lead should receive 404
      const res = await fetch(`${BASE_URL}/api/leads/${lead2._id}`, {
        headers: { Cookie: sales1Cookie },
      });
      assert(res.status === 404, 'Sales 1 accessing Sales 2 lead must return 404');
      console.log('✔ Test 9: Sales executive cannot access another rep lead (returns 404)');
    }

    {
      // Sales 1 trying to access unassigned lead should receive 404
      const res = await fetch(`${BASE_URL}/api/leads/${lead3._id}`, {
        headers: { Cookie: sales1Cookie },
      });
      assert(res.status === 404, 'Sales 1 accessing unassigned lead must return 404');
      console.log('✔ Test 10: Sales executive cannot access unassigned lead (returns 404)');
    }

    {
      // Sales 1 can access their own assigned lead
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}`, {
        headers: { Cookie: sales1Cookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Sales 1 should access lead1');
      assert(data.lead._id.toString() === lead1._id.toString(), 'Should return lead1 data');
      assert(data.lead.assignedTo._id.toString() === testSales1._id.toString(), 'Assigned to Sales 1');
      console.log('✔ Test 11: Sales executive successfully views their assigned lead details');
    }

    {
      // Sales 1 CANNOT assign or reassign leads (Admin only)
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sales1Cookie,
        },
        body: JSON.stringify({ assignedTo: testSales2._id.toString() }),
      });
      assert(res.status === 403, 'Sales executive calling /assign must receive 403 Forbidden');
      console.log('✔ Test 12: Sales executive is forbidden from assigning leads (returns 403)');
    }

    // ==========================================
    // 4. PAGINATION, SEARCH, FILTERING & SORTING
    // ==========================================
    console.log('\n--- Section 4: Pagination, Search, Filtering & Safe Sorting ---');

    {
      // Admin listing with pagination
      const res = await fetch(`${BASE_URL}/api/leads?page=1&limit=2`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin lead listing should return 200');
      assert(data.leads.length <= 2, 'Limit 2 respected');
      assert(data.pagination.page === 1, 'Pagination page matches');
      assert(data.pagination.limit === 2, 'Pagination limit matches');
      assert(typeof data.pagination.total === 'number', 'Total is a number');
      assert(typeof data.pagination.totalPages === 'number', 'Total pages is a number');
      console.log('✔ Test 13: Admin lead listing with validated pagination metadata');
    }

    {
      // Max limit cap (limit > 50 rejected by schema validation)
      const res = await fetch(`${BASE_URL}/api/leads?limit=100`, {
        headers: { Cookie: adminCookie },
      });
      assert(res.status === 400, 'Limit > 50 should return 400 validation error');
      console.log('✔ Test 14: Pagination limit exceeding 50 is rejected with 400');
    }

    {
      // Filter by status=new
      const res = await fetch(`${BASE_URL}/api/leads?status=new`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Filter status=new should return 200');
      const allNew = data.leads.every((l) => l.status === 'new');
      assert(allNew, 'All returned leads should have status=new');
      console.log('✔ Test 15: Filter by status=new returns only new leads');
    }

    {
      // Filter by assignedTo=unassigned
      const res = await fetch(`${BASE_URL}/api/leads?assignedTo=unassigned`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Filter assignedTo=unassigned should return 200');
      const allUnassigned = data.leads.every((l) => l.assignedTo === null);
      assert(allUnassigned, 'All returned leads should be unassigned');
      console.log('✔ Test 16: Filter by assignedTo=unassigned returns only unassigned leads');
    }

    {
      // Filter by specific assignedTo ID
      const res = await fetch(`${BASE_URL}/api/leads?assignedTo=${testSales2._id}`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Filter by assignedTo ID should return 200');
      const allSales2 = data.leads.every(
        (l) => l.assignedTo && l.assignedTo._id.toString() === testSales2._id.toString()
      );
      assert(allSales2, 'All returned leads should belong to Sales 2');
      console.log('✔ Test 17: Filter by assigned user ID returns assigned leads');
    }

    {
      // Search by lead name
      const res = await fetch(`${BASE_URL}/api/leads?search=Aarav`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Search should return 200');
      assert(data.leads.some((l) => l.fullName === 'Aarav Sharma'), 'Found Aarav Sharma');
      console.log('✔ Test 18: Search by customer name finds matching leads');
    }

    {
      // Search by phone number
      const res = await fetch(`${BASE_URL}/api/leads?search=9876543211`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Search by phone should return 200');
      assert(data.leads.some((l) => l.phoneNumber === '+919876543211'), 'Found Diya Patel by phone');
      console.log('✔ Test 19: Search by phone number finds matching leads');
    }

    {
      // Safe sorting by fullName asc
      const res = await fetch(`${BASE_URL}/api/leads?sortBy=fullName&sortOrder=asc&limit=50`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Sorting by fullName should return 200');
      const names = data.leads.map((l) => (l.fullName || '').trim()).filter(Boolean);
      for (let i = 0; i < names.length - 1; i++) {
        const cmp = names[i].localeCompare(names[i + 1], 'en', { sensitivity: 'base' });
        assert(cmp <= 0, `Names must be sorted asc: '${names[i]}' <= '${names[i + 1]}'`);
      }
      console.log('✔ Test 20: Safe sorting by fullName ascending works as expected');
    }

    // ==========================================
    // 5. LEAD DETAILS & ERROR HANDLING
    // ==========================================
    console.log('\n--- Section 5: Lead Details & ID Validation ---');

    {
      // Invalid MongoDB ObjectId
      const res = await fetch(`${BASE_URL}/api/leads/not-a-valid-id`, {
        headers: { Cookie: adminCookie },
      });
      assert(res.status === 400, 'Malformed ObjectId should return 400');
      console.log('✔ Test 21: Malformed ObjectId in /api/leads/:id returns 400');
    }

    {
      // Non-existent valid ObjectId
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await fetch(`${BASE_URL}/api/leads/${nonExistentId}`, {
        headers: { Cookie: adminCookie },
      });
      assert(res.status === 404, 'Non-existent lead ID should return 404');
      console.log('✔ Test 22: Non-existent lead ID returns 404');
    }

    {
      // Approved CRM fields check (No sensitive fields or password hashes)
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'GET lead details returns 200');
      assert(!data.lead.passwordHash, 'Must not leak passwordHash');
      assert(!data.lead.assignedTo?.passwordHash, 'Must not leak assigned user passwordHash');
      assert(data.lead.__v === undefined, '__v should be omitted');
      assert(data.lead.fullName === 'Aarav Sharma', 'Approved field fullName present');
      assert(data.lead.assignedTo.name === 'P6 Sales Rep 1', 'Populated assigned user name');
      console.log('✔ Test 23: Approved CRM fields returned without sensitive leaks');
    }

    // ==========================================
    // 6. STATUS TRANSITION LIFECYCLE
    // ==========================================
    console.log('\n--- Section 6: Status Lifecycle Transitions ---');

    {
      // Invalid status value (not in enum)
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ status: 'invalid_status_value' }),
      });
      assert(res.status === 400, 'Invalid status enum value should return 400');
      console.log('✔ Test 24: Unrecognized status enum value rejected with 400');
    }

    {
      // Invalid transition: lead1 is 'new', jump directly to 'converted' (Forbidden transition)
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ status: 'converted' }),
      });
      assert(res.status === 400, 'Transition from new to converted must return 400');
      const data = await res.json();
      assert(data.message.includes('Invalid status transition'), 'Error message specifies invalid transition');
      console.log('✔ Test 25: Invalid transition (new -> converted) rejected with 400');
    }

    {
      // Valid transition: 'new' -> 'contacted'
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: sales1Cookie },
        body: JSON.stringify({ status: 'contacted' }),
      });
      assert(res.status === 200, 'Transition new -> contacted should return 200');
      const data = await res.json();
      assert(data.lead.status === 'contacted', 'Lead status updated to contacted');
      console.log('✔ Test 26: Valid transition (new -> contacted) executed by assigned sales rep');
    }

    {
      // Same status transition (no-op)
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: sales1Cookie },
        body: JSON.stringify({ status: 'contacted' }),
      });
      assert(res.status === 200, 'Same status no-op should return 200');
      console.log('✔ Test 27: Same status no-op transition returns 200');
    }

    {
      // Valid step 2: 'contacted' -> 'qualified'
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ status: 'qualified' }),
      });
      assert(res.status === 200, 'Transition contacted -> qualified should return 200');
      const data = await res.json();
      assert(data.lead.status === 'qualified', 'Lead status updated to qualified');
      console.log('✔ Test 28: Valid transition (contacted -> qualified) succeeded');
    }

    {
      // Valid step 3: 'qualified' -> 'converted'
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ status: 'converted' }),
      });
      assert(res.status === 200, 'Transition qualified -> converted should return 200');
      const data = await res.json();
      assert(data.lead.status === 'converted', 'Lead status updated to converted');
      console.log('✔ Test 29: Valid transition (qualified -> converted) succeeded');
    }

    // ==========================================
    // 7. LEAD ASSIGNMENT & VALIDATION
    // ==========================================
    console.log('\n--- Section 7: Lead Assignment ---');

    {
      // Assign lead3 to Sales 1
      const res = await fetch(`${BASE_URL}/api/leads/${lead3._id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ assignedTo: testSales1._id.toString() }),
      });
      assert(res.status === 200, 'Admin assigning lead to Sales 1 should return 200');
      const data = await res.json();
      assert(data.lead.assignedTo._id.toString() === testSales1._id.toString(), 'Assigned to Sales 1');
      console.log('✔ Test 30: Admin successfully assigned lead to active sales rep');
    }

    {
      // Assignment to non-existent user ID
      const fakeUserId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${BASE_URL}/api/leads/${lead3._id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ assignedTo: fakeUserId }),
      });
      assert(res.status === 400, 'Assignment to non-existent user should return 400');
      console.log('✔ Test 31: Assignment to non-existent user ID rejected with 400');
    }

    {
      // Assignment to deactivated user
      const res = await fetch(`${BASE_URL}/api/leads/${lead3._id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ assignedTo: deactivatedUser._id.toString() }),
      });
      assert(res.status === 400, 'Assignment to deactivated user should return 400');
      const data = await res.json();
      assert(data.message.includes('deactivated'), 'Message notes deactivated user');
      console.log('✔ Test 32: Assignment to deactivated user rejected with 400');
    }

    {
      // Unassignment (assignedTo: null)
      const res = await fetch(`${BASE_URL}/api/leads/${lead3._id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ assignedTo: null }),
      });
      assert(res.status === 200, 'Unassignment should return 200');
      const data = await res.json();
      assert(data.lead.assignedTo === null, 'Lead is now unassigned');
      console.log('✔ Test 33: Unassignment (assignedTo: null) succeeded');
    }

    console.log('\n=============================================================');
    console.log('🎉 ALL 33 PHASE 6 LEAD MANAGEMENT TESTS PASSED SUCCESSFULLY!');
    console.log('=============================================================\n');
  } finally {
    // Cleanup test fixtures
    console.log('[Teardown] Cleaning up test fixtures...');
    try {
      if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
      if (testSales1) await User.deleteOne({ _id: testSales1._id });
      if (testSales2) await User.deleteOne({ _id: testSales2._id });
      if (deactivatedUser) await User.deleteOne({ _id: deactivatedUser._id });

      if (lead1) await Lead.deleteOne({ _id: lead1._id });
      if (lead2) await Lead.deleteOne({ _id: lead2._id });
      if (lead3) await Lead.deleteOne({ _id: lead3._id });
      if (foreignLead) await Lead.deleteOne({ _id: foreignLead._id });
    } catch (cleanupErr) {
      console.error('[Teardown Error]', cleanupErr);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Test Server] Stopped.');
    }
    await disconnectDB();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite execution failed:');
  console.error(err);
  process.exit(1);
});
