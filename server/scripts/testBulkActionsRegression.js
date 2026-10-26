import assert from 'node:assert';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import ImportedLead from '../src/models/ImportedLead.js';
import Activity from '../src/models/Activity.js';
import ImportBatch from '../src/models/ImportBatch.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { signToken, COOKIE_NAME } from '../src/utils/jwt.js';

/**
 * Helper to execute HTTP requests with cookie and Origin headers using native fetch.
 */
async function request(serverPort, path, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    cookie = '',
  } = options;

  const reqHeaders = {
    Origin: 'http://localhost:5173',
    ...headers,
  };

  if (cookie) {
    reqHeaders.Cookie = `${COOKIE_NAME}=${cookie}`;
  }

  let finalBody = body;
  if (body && typeof body === 'object') {
    reqHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const res = await fetch(`http://localhost:${serverPort}${path}`, {
    method,
    headers: reqHeaders,
    body: finalBody,
  });

  const arrayBuffer = await res.arrayBuffer();
  const raw = Buffer.from(arrayBuffer);
  let json = null;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    // Not JSON
  }

  const responseHeaders = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  return {
    status: res.status,
    headers: responseHeaders,
    body: json,
    raw,
  };
}

async function runRegressionSuite() {
  console.log('=== Starting Regression Suite: Bulk Actions (Selection, Assign, Delete) ===\n');

  await connectDB();

  const serverPort = 5098;
  let testServer;
  await new Promise((resolve) => {
    testServer = app.listen(serverPort, () => {
      console.log(`[Test Server] Listening on port ${serverPort}`);
      resolve();
    });
  });

  const timestamp = Date.now();
  const targetAccountId = env.WINDSOR_ACCOUNT_ID || `act_bulk_${timestamp}`;
  const foreignAccountId = `act_foreign_${timestamp}`;

  const createdUserIds = [];
  const createdLeadIds = [];
  const createdImportedLeadIds = [];
  const createdBatchIds = [];

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Secret123!', salt);

    // 1. Admin user
    const adminUser = await User.create({
      name: 'Admin Bulk Tester',
      email: `admin_bulk_${timestamp}@crm.test`,
      passwordHash,
      role: 'admin',
      accountId: targetAccountId,
      isActive: true,
    });
    createdUserIds.push(adminUser._id);
    const adminToken = signToken({ id: adminUser._id.toString(), role: 'admin' });

    // 2. Sales Executive user (active)
    const execUser = await User.create({
      name: 'Executive Bulk Tester',
      email: `exec_bulk_${timestamp}@crm.test`,
      passwordHash,
      role: 'sales_executive',
      accountId: targetAccountId,
      isActive: true,
    });
    createdUserIds.push(execUser._id);
    const execToken = signToken({ id: execUser._id.toString(), role: 'sales_executive' });

    // 3. Inactive user (for testing rejection)
    const inactiveUser = await User.create({
      name: 'Inactive Tester',
      email: `inactive_bulk_${timestamp}@crm.test`,
      passwordHash,
      role: 'sales_executive',
      accountId: targetAccountId,
      isActive: false,
    });
    createdUserIds.push(inactiveUser._id);

    // 4. Foreign account executive
    const foreignUser = await User.create({
      name: 'Foreign Exec Tester',
      email: `foreign_bulk_${timestamp}@crm.test`,
      passwordHash,
      role: 'sales_executive',
      accountId: foreignAccountId,
      isActive: true,
    });
    createdUserIds.push(foreignUser._id);

    console.log('[Setup] Test users created successfully.');

    // -------------------------------------------------------------
    // PART 1: REGULAR LEADS BULK ACTIONS (/api/leads/bulk/*)
    // -------------------------------------------------------------
    console.log('\n--- Part 1: Regular Leads Bulk Actions ---');

    // Create 3 regular leads
    const regularLeads = await Lead.create([
      {
        externalLeadId: `ext_bulk_${timestamp}_1`,
        fullName: 'Bulk Regular Lead 1',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}1`,
        email: `bulk1_${timestamp}@example.com`,
        status: 'new',
        source: 'meta',
        accountId: targetAccountId,
      },
      {
        externalLeadId: `ext_bulk_${timestamp}_2`,
        fullName: 'Bulk Regular Lead 2',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}2`,
        email: `bulk2_${timestamp}@example.com`,
        status: 'contacted',
        source: 'meta',
        accountId: targetAccountId,
      },
      {
        externalLeadId: `ext_bulk_${timestamp}_3`,
        fullName: 'Bulk Regular Lead 3',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}3`,
        email: `bulk3_${timestamp}@example.com`,
        status: 'qualified',
        source: 'meta',
        accountId: targetAccountId,
      },
    ]);
    regularLeads.forEach((l) => createdLeadIds.push(l._id));

    // Test 1.1: Bulk assign regular leads to sales executive
    {
      const res = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: regularLeads.map((l) => l._id.toString()),
          assignedTo: execUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.requestedCount, 3);
      assert.strictEqual(res.body.data.successCount, 3);
      assert.strictEqual(res.body.data.failedCount, 0);

      // Verify DB records
      const updated = await Lead.find({ _id: { $in: regularLeads.map((l) => l._id) } });
      assert.strictEqual(updated.length, 3);
      updated.forEach((l) => {
        assert.strictEqual(l.assignedTo?.toString(), execUser._id.toString());
      });

      // Verify Activity timeline
      const activities = await Activity.find({
        leadId: { $in: regularLeads.map((l) => l._id) },
        type: 'note',
      });
      assert.strictEqual(activities.length, 3);
      activities.forEach((a) => {
        assert.strictEqual(a.leadModel, 'Lead');
        assert.ok(a.summary.includes(execUser.name));
      });

      console.log('✓ 1.1: Regular leads bulk assign succeeded and logged activities');
    }

    // Test 1.2: Bulk unassign regular leads (assignedTo: null)
    {
      const res = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [regularLeads[0]._id.toString()],
          assignedTo: null,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.successCount, 1);

      const updated = await Lead.findById(regularLeads[0]._id);
      assert.strictEqual(updated.assignedTo, null);

      console.log('✓ 1.2: Regular leads bulk unassign (assignedTo: null) succeeded');
    }

    // Test 1.3: Rejection of inactive user assignment
    {
      const res = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [regularLeads[1]._id.toString()],
          assignedTo: inactiveUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.message.includes('deactivated'));
      console.log('✓ 1.3: Assignment to inactive user correctly rejected with 400');
    }

    // Test 1.4: Non-admin authorization rejection (403)
    {
      const res = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: execToken,
        body: {
          leadIds: [regularLeads[1]._id.toString()],
          assignedTo: execUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 403);
      console.log('✓ 1.4: Non-admin (Sales Executive) blocked from bulk assign with 403');
    }

    // Test 1.5: Account isolation and foreign IDs in bulk assign
    {
      const foreignLead = await Lead.create({
        externalLeadId: `ext_bulk_foreign_${timestamp}`,
        fullName: 'Foreign Lead',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}9`,
        status: 'new',
        source: 'meta',
        accountId: foreignAccountId,
      });
      createdLeadIds.push(foreignLead._id);

      const res = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [regularLeads[1]._id.toString(), foreignLead._id.toString()],
          assignedTo: execUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.requestedCount, 2);
      assert.strictEqual(res.body.data.successCount, 1);
      assert.strictEqual(res.body.data.failedCount, 1);
      assert.ok(res.body.data.failedIds.includes(foreignLead._id.toString()));

      // Foreign lead was NOT updated
      const checkForeign = await Lead.findById(foreignLead._id);
      assert.strictEqual(checkForeign.assignedTo, null);

      console.log('✓ 1.5: Foreign account lead safely rejected in failedIds without mutation');
    }

    // Test 1.6: Payload validation (duplicate IDs, empty array, oversized > 100)
    {
      // Duplicate IDs handled cleanly
      const resDup = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [regularLeads[2]._id.toString(), regularLeads[2]._id.toString()],
          assignedTo: execUser._id.toString(),
        },
      });
      assert.strictEqual(resDup.status, 200);
      assert.strictEqual(resDup.body.data.requestedCount, 1); // Deduplicated to 1

      // Oversized > 100
      const largeArray = Array.from({ length: 101 }, () => new mongoose.Types.ObjectId().toString());
      const resLarge = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: largeArray,
          assignedTo: execUser._id.toString(),
        },
      });
      assert.strictEqual(resLarge.status, 400);

      // Empty array
      const resEmpty = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [],
          assignedTo: execUser._id.toString(),
        },
      });
      assert.strictEqual(resEmpty.status, 400);

      console.log('✓ 1.6: Payload validations (deduplication, max 100, min 1) verified');
    }

    // Test 1.7: Bulk soft delete regular leads
    {
      const deleteIds = [regularLeads[0]._id.toString(), regularLeads[1]._id.toString()];
      const res = await request(serverPort, '/api/leads/bulk/delete', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: deleteIds,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.requestedCount, 2);
      assert.strictEqual(res.body.data.successCount, 2);
      assert.strictEqual(res.body.data.failedCount, 0);

      // Verify soft deletion fields in DB
      const deletedLeads = await Lead.find({ _id: { $in: deleteIds } });
      assert.strictEqual(deletedLeads.length, 2);
      deletedLeads.forEach((l) => {
        assert.strictEqual(l.isDeleted, true);
        assert.ok(l.deletedAt instanceof Date);
        assert.strictEqual(l.deletedBy?.toString(), adminUser._id.toString());
      });

      // Verify leads listing excludes soft-deleted leads
      const listRes = await request(serverPort, '/api/leads?limit=50', {
        cookie: adminToken,
      });
      assert.strictEqual(listRes.status, 200);
      const returnedIds = (listRes.body.data?.leads || []).map((l) => l._id);
      deleteIds.forEach((id) => {
        assert.ok(!returnedIds.includes(id), `Soft-deleted lead ${id} must not appear in GET /api/leads`);
      });

      // Verify single lead GET returns 404
      const singleRes = await request(serverPort, `/api/leads/${deleteIds[0]}`, {
        cookie: adminToken,
      });
      assert.strictEqual(singleRes.status, 404);

      console.log('✓ 1.7: Regular leads bulk soft delete verified; excluded from listings and single GET');
    }

    // -------------------------------------------------------------
    // PART 2: IMPORTED LEADS BULK ACTIONS (/api/leads/import/records/bulk/*)
    // -------------------------------------------------------------
    console.log('\n--- Part 2: Imported Leads Bulk Actions ---');

    // Create an import batch fixture
    const testBatch = await ImportBatch.create({
      accountId: targetAccountId,
      uploadedBy: adminUser._id,
      originalFilename: 'test_bulk_import.xlsx',
      fileSizeBytes: 2048,
      status: 'completed',
    });
    createdBatchIds.push(testBatch._id);

    // Create 3 imported leads
    const importedLeads = await ImportedLead.create([
      {
        importBatchId: testBatch._id,
        uploadedBy: adminUser._id,
        fullName: 'Bulk Imported Lead 1',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}4`,
        email: `imp1_${timestamp}@example.com`,
        status: 'new',
        source: 'excel_import',
        accountId: targetAccountId,
      },
      {
        importBatchId: testBatch._id,
        uploadedBy: adminUser._id,
        fullName: 'Bulk Imported Lead 2',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}5`,
        email: `imp2_${timestamp}@example.com`,
        status: 'contacted',
        source: 'excel_import',
        accountId: targetAccountId,
      },
      {
        importBatchId: testBatch._id,
        uploadedBy: adminUser._id,
        fullName: 'Bulk Imported Lead 3',
        phoneNumber: `+9198765${String(timestamp).slice(-5)}6`,
        email: `imp3_${timestamp}@example.com`,
        status: 'qualified',
        source: 'excel_import',
        accountId: targetAccountId,
      },
    ]);
    importedLeads.forEach((l) => createdImportedLeadIds.push(l._id));

    // Test 2.1: Bulk assign imported leads to sales executive
    {
      const res = await request(serverPort, '/api/leads/import/records/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: importedLeads.map((l) => l._id.toString()),
          assignedTo: execUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.requestedCount, 3);
      assert.strictEqual(res.body.data.successCount, 3);
      assert.strictEqual(res.body.data.failedCount, 0);

      // Verify DB records
      const updated = await ImportedLead.find({ _id: { $in: importedLeads.map((l) => l._id) } });
      assert.strictEqual(updated.length, 3);
      updated.forEach((l) => {
        assert.strictEqual(l.assignedTo?.toString(), execUser._id.toString());
      });

      // Verify Activity timeline
      const activities = await Activity.find({
        leadId: { $in: importedLeads.map((l) => l._id) },
        type: 'note',
      });
      assert.strictEqual(activities.length, 3);
      activities.forEach((a) => {
        assert.strictEqual(a.leadModel, 'ImportedLead');
        assert.ok(a.summary.includes(execUser.name));
      });

      console.log('✓ 2.1: Imported leads bulk assign succeeded and logged activities with leadModel: ImportedLead');
    }

    // Test 2.2: Bulk unassign imported leads
    {
      const res = await request(serverPort, '/api/leads/import/records/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [importedLeads[0]._id.toString()],
          assignedTo: null,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.successCount, 1);

      const updated = await ImportedLead.findById(importedLeads[0]._id);
      assert.strictEqual(updated.assignedTo, null);

      console.log('✓ 2.2: Imported leads bulk unassign (assignedTo: null) succeeded');
    }

    // Test 2.3: Rejection of inactive user on imported leads
    {
      const res = await request(serverPort, '/api/leads/import/records/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [importedLeads[1]._id.toString()],
          assignedTo: inactiveUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.message.includes('deactivated'));
      console.log('✓ 2.3: Imported lead assignment to inactive user rejected with 400');
    }

    // Test 2.4: Non-admin authorization on imported leads
    {
      const res = await request(serverPort, '/api/leads/import/records/bulk/assign', {
        method: 'POST',
        cookie: execToken,
        body: {
          leadIds: [importedLeads[1]._id.toString()],
          assignedTo: execUser._id.toString(),
        },
      });

      assert.strictEqual(res.status, 403);
      console.log('✓ 2.4: Non-admin blocked from imported leads bulk assign with 403');
    }

    // Test 2.5: Bulk soft delete imported leads
    {
      const deleteIds = [importedLeads[0]._id.toString(), importedLeads[1]._id.toString()];
      const res = await request(serverPort, '/api/leads/import/records/bulk/delete', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: deleteIds,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.requestedCount, 2);
      assert.strictEqual(res.body.data.successCount, 2);
      assert.strictEqual(res.body.data.failedCount, 0);

      // Verify soft deletion fields in DB
      const deletedRecords = await ImportedLead.find({ _id: { $in: deleteIds } });
      assert.strictEqual(deletedRecords.length, 2);
      deletedRecords.forEach((l) => {
        assert.strictEqual(l.isDeleted, true);
        assert.ok(l.deletedAt instanceof Date);
        assert.strictEqual(l.deletedBy?.toString(), adminUser._id.toString());
      });

      // Verify imported leads listing excludes soft-deleted records
      const listRes = await request(serverPort, '/api/leads/import/records?limit=50', {
        cookie: adminToken,
      });
      assert.strictEqual(listRes.status, 200);
      const returnedIds = (listRes.body.data?.records || []).map((l) => l._id);
      deleteIds.forEach((id) => {
        assert.ok(!returnedIds.includes(id), `Soft-deleted record ${id} must not appear in GET /api/leads/import/records`);
      });

      // Verify single record GET returns 404
      const singleRes = await request(serverPort, `/api/leads/import/records/${deleteIds[0]}`, {
        cookie: adminToken,
      });
      assert.strictEqual(singleRes.status, 404);

      console.log('✓ 2.5: Imported leads bulk soft delete verified; excluded from listings and single GET');
    }

    // -------------------------------------------------------------
    // PART 3: CROSS-COLLECTION SAFETY & ISOLATION
    // -------------------------------------------------------------
    console.log('\n--- Part 3: Cross-Collection Isolation Tests ---');

    // Test 3.1: Pass ImportedLead ID to regular Lead bulk assign
    {
      const importedRecord = await ImportedLead.findById(importedLeads[2]._id);
      const initialAssignedTo = importedRecord.assignedTo;

      const res = await request(serverPort, '/api/leads/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [importedRecord._id.toString()],
          assignedTo: null,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.successCount, 0);
      assert.strictEqual(res.body.data.failedCount, 1);
      assert.ok(res.body.data.failedIds.includes(importedRecord._id.toString()));

      // ImportedLead was NOT modified!
      const checkRecord = await ImportedLead.findById(importedRecord._id);
      assert.strictEqual(checkRecord.assignedTo?.toString(), initialAssignedTo?.toString());

      console.log('✓ 3.1: Regular Lead bulk assign safely ignores ImportedLead IDs without mutation');
    }

    // Test 3.2: Pass Regular Lead ID to ImportedLead bulk assign
    {
      const regLead = await Lead.findById(regularLeads[2]._id); // not deleted
      const initialAssignedTo = regLead.assignedTo;

      const res = await request(serverPort, '/api/leads/import/records/bulk/assign', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [regLead._id.toString()],
          assignedTo: null,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.successCount, 0);
      assert.strictEqual(res.body.data.failedCount, 1);
      assert.ok(res.body.data.failedIds.includes(regLead._id.toString()));

      // Regular Lead was NOT modified!
      const checkLead = await Lead.findById(regLead._id);
      assert.strictEqual(checkLead.assignedTo?.toString(), initialAssignedTo?.toString());

      console.log('✓ 3.2: ImportedLead bulk assign safely ignores regular Lead IDs without mutation');
    }

    // Test 3.3: Pass Regular Lead ID to ImportedLead bulk delete
    {
      const regLead = regularLeads[2]; // not deleted
      assert.strictEqual(regLead.isDeleted, false);

      const res = await request(serverPort, '/api/leads/import/records/bulk/delete', {
        method: 'POST',
        cookie: adminToken,
        body: {
          leadIds: [regLead._id.toString()],
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.successCount, 0);
      assert.strictEqual(res.body.data.failedCount, 1);

      // Regular lead is still NOT deleted
      const checkLead = await Lead.findById(regLead._id);
      assert.strictEqual(checkLead.isDeleted, false);

      console.log('✓ 3.3: ImportedLead bulk delete cannot delete regular Lead records');
    }

    console.log('\n=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    console.log('[Cleanup] Cleaning up test fixtures...');
    try {
      if (createdLeadIds.length > 0) {
        await Lead.deleteMany({ _id: { $in: createdLeadIds } });
        await Activity.deleteMany({ leadId: { $in: createdLeadIds } });
      }
      if (createdImportedLeadIds.length > 0) {
        await ImportedLead.deleteMany({ _id: { $in: createdImportedLeadIds } });
        await Activity.deleteMany({ leadId: { $in: createdImportedLeadIds } });
      }
      if (createdBatchIds.length > 0) {
        await ImportBatch.deleteMany({ _id: { $in: createdBatchIds } });
      }
      if (createdUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: createdUserIds } });
      }
    } catch (err) {
      console.error('[Cleanup Error]', err);
    }

    if (testServer) {
      testServer.close();
    }
    await disconnectDB();
  }
}

runRegressionSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
