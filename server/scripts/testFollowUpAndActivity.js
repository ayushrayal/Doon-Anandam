import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import Activity from '../src/models/Activity.js';
import { env } from '../src/config/env.js';

const TEST_PORT = 5089;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting Phase 2: Sales Follow-ups & Activity Management Test Suite ===\n');

  await connectDB();
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const adminEmail = `p2.admin.${timestamp}@example.com`;
  const salesEmail1 = `p2.sales1.${timestamp}@example.com`;
  const salesEmail2 = `p2.sales2.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  let testAdmin = null;
  let testSales1 = null;
  let testSales2 = null;

  let lead1 = null; // Assigned to sales1
  let lead2 = null; // Assigned to sales2
  let lead3 = null; // Unassigned
  let foreignLead = null; // Foreign account

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // 1. Create fixtures
    testAdmin = await User.create({
      name: 'P2 Test Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales1 = await User.create({
      name: 'P2 Sales Rep 1',
      email: salesEmail1,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    testSales2 = await User.create({
      name: 'P2 Sales Rep 2',
      email: salesEmail2,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    const accountId = env.WINDSOR_ACCOUNT_ID || 'act_test_p2';

    lead1 = await Lead.create({
      externalLeadId: `ext_p2_1_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Vikram Sharma',
      email: 'vikram.p2@example.com',
      phoneNumber: '+919876543210',
      status: 'new',
      assignedTo: testSales1._id,
      notes: 'Interested in luxury 3BHK villa.',
    });

    lead2 = await Lead.create({
      externalLeadId: `ext_p2_2_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Pooja Verma',
      email: 'pooja.p2@example.com',
      phoneNumber: '+919876543211',
      status: 'contacted',
      assignedTo: testSales2._id,
    });

    lead3 = await Lead.create({
      externalLeadId: `ext_p2_3_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      accountName: 'Doon Anandam Test',
      fullName: 'Sunil Rawat',
      status: 'new',
      assignedTo: null,
    });

    foreignLead = await Lead.create({
      externalLeadId: `ext_p2_foreign_${timestamp}`,
      source: 'facebook_leads',
      accountId: 'act_different_foreign_tenant',
      fullName: 'Foreign Lead User',
      status: 'new',
      assignedTo: null,
    });

    console.log('[Setup] Created test fixtures (Admin, Sales 1, Sales 2, Leads)');

    // Helper to log in and get cookie
    async function loginUser(email, pwd) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd }),
      });
      const cookie = res.headers.get('set-cookie');
      return cookie ? cookie.split(';')[0] : '';
    }

    const adminCookie = await loginUser(adminEmail, password);
    const sales1Cookie = await loginUser(salesEmail1, password);
    const sales2Cookie = await loginUser(salesEmail2, password);

    const originHeaders = {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    };

    // --- Section 1: Scheduling a Follow-up ---
    console.log('\n--- Section 1: Scheduling Follow-ups ---');

    // Test 1: Unauthenticated follow-up rejected
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: originHeaders,
        body: JSON.stringify({
          followUpDate: new Date(Date.now() + 86400000).toISOString(),
          remarks: 'Discuss floor plans',
        }),
      });
      assert(res.status === 401, `Expected 401 unauthenticated, got ${res.status}`);
      console.log('✔ Test 1: Unauthenticated POST /api/leads/:id/follow-up returns 401');
    }

    // Test 2: Cross-origin CSRF mutation rejected
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          Origin: 'http://malicious-site.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          followUpDate: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
      assert(res.status === 403, `Expected 403 CSRF rejection, got ${res.status}`);
      console.log('✔ Test 2: Cross-origin follow-up request rejected with 403');
    }

    // Test 3: Invalid follow-up date (past date) returns 400
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          remarks: 'Past date',
        }),
      });
      assert(res.status === 400, `Expected 400 for past date, got ${res.status}`);
      console.log('✔ Test 3: Past date rejected with 400 Validation Error');
    }

    // Test 4: Invalid date string returns 400
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: 'not-a-valid-date',
          remarks: 'Invalid date string',
        }),
      });
      assert(res.status === 400, `Expected 400 for invalid date, got ${res.status}`);
      console.log('✔ Test 4: Malformed date string rejected with 400');
    }

    // Test 5: Successfully schedule follow-up as Admin
    const futureDate = new Date(Date.now() + 2 * 86400000); // 2 days ahead
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: futureDate.toISOString(),
          remarks: 'Client requested price breakdown call',
        }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.success === true, 'Response success should be true');
      assert(data.lead.nextFollowUpRemarks === 'Client requested price breakdown call', 'Remarks saved');
      assert(data.lead.followUpIndicator === 'upcoming', 'Indicator should be upcoming');
      console.log('✔ Test 5: Admin successfully scheduled follow-up');
    }

    // Test 6: Verify follow_up_scheduled activity was logged
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.activities.length === 1, `Expected 1 activity, got ${data.activities.length}`);
      assert(data.activities[0].type === 'follow_up_scheduled', 'Activity type matches');
      assert(data.activities[0].performedBy.name === 'P2 Test Admin', 'PerformedBy populated');
      console.log('✔ Test 6: Automated follow_up_scheduled activity logged in timeline');
    }

    // --- Section 2: Rescheduling and Completing Follow-ups ---
    console.log('\n--- Section 2: Rescheduling & Completing Follow-ups ---');

    // Test 7: Reschedule follow-up
    const rescheduledDate = new Date(Date.now() + 4 * 86400000); // 4 days ahead
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: rescheduledDate.toISOString(),
          remarks: 'Client postponed to weekend',
        }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.lead.nextFollowUpRemarks === 'Client postponed to weekend', 'Rescheduled remarks updated');
      console.log('✔ Test 7: Rescheduled follow-up successfully');
    }

    // Test 8: Verify follow_up_rescheduled activity was logged (append semantics)
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(data.activities.length === 2, `Expected 2 activities, got ${data.activities.length}`);
      assert(data.activities[0].type === 'follow_up_rescheduled', 'Latest activity is follow_up_rescheduled');
      console.log('✔ Test 8: Append-only follow_up_rescheduled activity logged');
    }

    // Test 9: Complete follow-up
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up/complete`, {
        method: 'PATCH',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({
          notes: 'Client confirmed budget and booked site visit for Sunday.',
        }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.lead.nextFollowUpDate === null, 'nextFollowUpDate should be cleared');
      assert(data.lead.nextFollowUpRemarks === '', 'Remarks cleared');
      assert(data.lead.followUpIndicator === 'none', 'Indicator reset to none');
      console.log('✔ Test 9: Follow-up completed successfully with outcome notes');
    }

    // Test 10: Attempt to complete follow-up when none is pending returns 400
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up/complete`, {
        method: 'PATCH',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({ notes: 'Extra completion' }),
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      console.log('✔ Test 10: Completing non-existent pending follow-up rejected with 400');
    }

    // --- Section 3: Role Scoping & Account Isolation ---
    console.log('\n--- Section 3: Role Scoping & Account Isolation ---');

    // Test 11: Sales Rep 1 can schedule follow-up on assigned lead
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: new Date(Date.now() + 86400000).toISOString(),
          remarks: 'Rep 1 follow-up',
        }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      console.log('✔ Test 11: Sales Rep 1 scheduled follow-up on assigned lead');
    }

    // Test 12: Sales Rep 1 is blocked from accessing Rep 2 lead (returns 404)
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead2._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
      assert(res.status === 404, `Expected 404 for another reps lead, got ${res.status}`);
      console.log('✔ Test 12: Sales Rep cannot schedule follow-up on unassigned rep lead (returns 404)');
    }

    // Test 13: Sales Rep 1 is blocked from viewing Rep 2 activities (returns 404)
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead2._id}/activities`, {
        headers: { Cookie: sales1Cookie },
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      console.log('✔ Test 13: Sales Rep cannot view another reps lead activities (returns 404)');
    }

    // Test 14: Account isolation: Accessing lead in foreign account returns 404
    {
      const res = await fetch(`${BASE_URL}/api/leads/${foreignLead._id}/follow-up`, {
        method: 'POST',
        headers: { Cookie: adminCookie, ...originHeaders },
        body: JSON.stringify({
          followUpDate: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
      assert(res.status === 404, `Expected 404 for foreign account lead, got ${res.status}`);
      console.log('✔ Test 14: Foreign account lead access rejected with 404');
    }

    // --- Section 4: Activity Creation & Append-Only Timeline ---
    console.log('\n--- Section 4: Activity Logging & Timeline ---');

    // Test 15: Create Call activity
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'call',
          summary: 'Inbound phone call: discussed 3BHK pricing and possession dates.',
        }),
      });
      const data = await res.json();
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(data.activity.type === 'call', 'Type is call');
      assert(data.activity.performedBy.name === 'P2 Sales Rep 1', 'Acting user captured');
      console.log('✔ Test 15: Successfully logged Phone Call activity');
    }

    // Test 16: Create WhatsApp activity
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'whatsapp',
          summary: 'Shared brochure and payment plan PDF via WhatsApp.',
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      console.log('✔ Test 16: Successfully logged WhatsApp activity');
    }

    // Test 17: Create In-Person Meeting activity
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'meeting',
          summary: 'Site visit completed: customer toured sample villa.',
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      console.log('✔ Test 17: Successfully logged Meeting activity');
    }

    // Test 18: Create Email activity
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'email',
          summary: 'Sent official cost estimation quotation.',
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      console.log('✔ Test 18: Successfully logged Email activity');
    }

    // Test 19: Create General Note activity
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'note',
          summary: 'Customer prefers north-facing corner unit.',
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      console.log('✔ Test 19: Successfully logged Note activity');
    }

    // Test 20: Invalid activity type returns 400
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'invalid_type',
          summary: 'Invalid activity type test',
        }),
      });
      assert(res.status === 400, `Expected 400 for invalid type, got ${res.status}`);
      console.log('✔ Test 20: Invalid activity type rejected with 400');
    }

    // Test 21: Empty summary returns 400
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        method: 'POST',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({
          type: 'note',
          summary: '',
        }),
      });
      assert(res.status === 400, `Expected 400 for empty summary, got ${res.status}`);
      console.log('✔ Test 21: Empty activity summary rejected with 400');
    }

    // Test 22: Status change automatically generates activity record
    {
      const res = await fetch(`${BASE_URL}/api/leads/${lead1._id}/status`, {
        method: 'PATCH',
        headers: { Cookie: sales1Cookie, ...originHeaders },
        body: JSON.stringify({ status: 'contacted' }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);

      // Verify activity was created
      const actRes = await fetch(`${BASE_URL}/api/leads/${lead1._id}/activities`, {
        headers: { Cookie: sales1Cookie },
      });
      const actData = await actRes.json();
      const statusAct = actData.activities.find((a) => a.type === 'status_change');
      assert(statusAct !== undefined, 'status_change activity should exist');
      assert(statusAct.summary.includes('new'), 'Includes previous status');
      assert(statusAct.summary.includes('contacted'), 'Includes new status');
      console.log('✔ Test 22: Lead status change automatically generates status_change activity');
    }

    // --- Section 5: Follow-Up Indicators & Query Filtering ---
    console.log('\n--- Section 5: Follow-Up Indicators & Filters ---');

    // Create overdue lead fixture
    const overdueLead = await Lead.create({
      externalLeadId: `ext_p2_overdue_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      fullName: 'Overdue Lead Person',
      status: 'contacted',
      assignedTo: testSales1._id,
      nextFollowUpDate: new Date(Date.now() - 2 * 86400000), // 2 days in past
      nextFollowUpRemarks: 'Overdue call',
    });

    // Create due-today lead fixture
    const todayDate = new Date();
    todayDate.setHours(18, 0, 0, 0); // 6 PM today
    const todayLead = await Lead.create({
      externalLeadId: `ext_p2_today_${timestamp}`,
      source: 'facebook_leads',
      accountId,
      fullName: 'Today Lead Person',
      status: 'new',
      assignedTo: testSales1._id,
      nextFollowUpDate: todayDate,
      nextFollowUpRemarks: 'Call today afternoon',
    });

    // Test 23: Indicator calculation on single lead fetch
    {
      const res = await fetch(`${BASE_URL}/api/leads/${overdueLead._id}`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(data.lead.followUpIndicator === 'overdue', `Expected overdue, got ${data.lead.followUpIndicator}`);
      console.log('✔ Test 23: Overdue follow-up correctly labeled "overdue"');
    }

    {
      const res = await fetch(`${BASE_URL}/api/leads/${todayLead._id}`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(data.lead.followUpIndicator === 'today', `Expected today, got ${data.lead.followUpIndicator}`);
      console.log('✔ Test 24: Due today follow-up correctly labeled "today"');
    }

    // Test 25: Query filter followUpStatus=overdue
    {
      const res = await fetch(`${BASE_URL}/api/leads?followUpStatus=overdue`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const found = data.leads.some((l) => l._id.toString() === overdueLead._id.toString());
      assert(found, 'Overdue lead returned in overdue filter');
      console.log('✔ Test 25: Query filter followUpStatus=overdue works as expected');
    }

    // Test 26: Query filter followUpStatus=today
    {
      const res = await fetch(`${BASE_URL}/api/leads?followUpStatus=today`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const found = data.leads.some((l) => l._id.toString() === todayLead._id.toString());
      assert(found, 'Today lead returned in today filter');
      console.log('✔ Test 26: Query filter followUpStatus=today works as expected');
    }

    console.log('\n=============================================================');
    console.log('🎉 ALL 26 PHASE 2 SALES FOLLOW-UP & ACTIVITY TESTS PASSED!');
    console.log('=============================================================\n');
  } finally {
    // Teardown
    console.log('[Teardown] Cleaning up test fixtures...');
    await Activity.deleteMany({
      leadId: { $in: [lead1?._id, lead2?._id, lead3?._id, foreignLead?._id] },
    });
    await Lead.deleteMany({
      _id: { $in: [lead1?._id, lead2?._id, lead3?._id, foreignLead?._id] },
    });
    await Lead.deleteMany({ externalLeadId: { $regex: `ext_p2_.*_${timestamp}` } });
    if (testAdmin) await User.findByIdAndDelete(testAdmin._id);
    if (testSales1) await User.findByIdAndDelete(testSales1._id);
    if (testSales2) await User.findByIdAndDelete(testSales2._id);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Test Server] Stopped.');
    }
    await disconnectDB();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err.message);
  if (server) server.close();
  disconnectDB().finally(() => process.exit(1));
});
