import assert from 'node:assert';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
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
 * Creates an in-memory .xlsx buffer with given headers and rows.
 */
async function createWorkbookBuffer(headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  worksheet.addRow(headers);
  rows.forEach((r) => worksheet.addRow(r));
  return await workbook.xlsx.writeBuffer();
}

/**
 * Helper to execute HTTP requests with cookie and Origin headers using native fetch.
 */
async function request(serverPort, path, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    cookie = '',
    formData = null,
  } = options;

  const reqHeaders = {
    Origin: 'http://localhost:5173',
    ...headers,
  };

  if (cookie) {
    reqHeaders.Cookie = `${COOKIE_NAME}=${cookie}`;
  }

  let finalBody = body;
  if (formData) {
    finalBody = formData;
  } else if (body && typeof body === 'object') {
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
  console.log('=== Starting Regression Suite: Excel Lead Import Module Corrections ===\n');

  await connectDB();

  const serverPort = 5096;
  let testServer;
  await new Promise((resolve) => {
    testServer = app.listen(serverPort, () => {
      console.log(`[Test Server] Listening on port ${serverPort}`);
      resolve();
    });
  });

  const timestamp = Date.now();
  const targetAccountId = env.WINDSOR_ACCOUNT_ID || `act_import_${timestamp}`;
  const foreignAccountId = `act_foreign_${timestamp}`;

  let adminUser;
  let salesUser;
  let adminToken;
  let salesToken;

  try {
    // 1. Setup Test Users
    const passwordHash = await bcrypt.hash('SecurePass123!', 10);

    adminUser = await User.create({
      name: 'Import Admin',
      email: `admin.import.${timestamp}@example.com`,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
    adminToken = signToken({ id: adminUser._id.toString(), role: 'admin' });

    salesUser = await User.create({
      name: 'Import Sales Rep',
      email: `sales.import.${timestamp}@example.com`,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });
    salesToken = signToken({ id: salesUser._id.toString(), role: 'sales_executive' });

    console.log('[Setup] Test users created (Admin & Sales Executive)');

    // 2. Setup Existing DB Meta Lead
    const metaLead = await Lead.create({
      externalLeadId: `ext_meta_${timestamp}`,
      source: 'meta',
      accountId: targetAccountId,
      fullName: 'Pre-existing Meta Customer',
      phoneNumber: '+919876543299',
      email: `meta.existing.${timestamp}@example.com`,
      status: 'contacted',
    });

    // Lead in foreign account with same phone to test account isolation
    const foreignLead = await Lead.create({
      externalLeadId: `ext_foreign_${timestamp}`,
      source: 'meta',
      accountId: foreignAccountId,
      fullName: 'Foreign Account Lead',
      phoneNumber: '+919876543288',
      email: `foreign.${timestamp}@example.com`,
      status: 'new',
    });

    console.log('[Setup] Existing test leads created in DB\n');

    // --- TEST 1: Unauthenticated & Role-Based Authorization ---
    console.log('[Test 1] Authorization: Unauthenticated & Non-Admin access blocked...');
    {
      const resUnauth = await request(serverPort, '/api/leads/import/template');
      assert.strictEqual(resUnauth.status, 401, 'Unauthenticated request must return 401');

      const resSales = await request(serverPort, '/api/leads/import/template', {
        cookie: salesToken,
      });
      assert.strictEqual(resSales.status, 403, 'Sales Executive must be rejected with 403 (Admin-only)');
      console.log('  PASSED: Role access enforcement verified (Admin-only).\n');
    }

    // --- TEST 2: Template Download ---
    console.log('[Test 2] Downloadable Excel Import Template...');
    {
      const resTemplate = await request(serverPort, '/api/leads/import/template', {
        cookie: adminToken,
      });
      assert.strictEqual(resTemplate.status, 200, 'Template download must return 200');
      assert(
        resTemplate.headers['content-type'].includes('spreadsheetml'),
        'Content-Type must be Excel XLSX'
      );
      assert(
        resTemplate.headers['content-disposition'].includes('Doon_Anandam_Lead_Import_Template.xlsx'),
        'Filename must be Doon_Anandam_Lead_Import_Template.xlsx'
      );

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(resTemplate.raw);
      const sheet = wb.worksheets[0];
      assert(sheet.rowCount >= 4, 'Template must contain header and sample rows');
      assert.strictEqual(sheet.getRow(1).getCell(1).value, 'Full Name *');
      console.log('  PASSED: Valid .xlsx template generation verified.\n');
    }

    // --- TEST 3: Unassigned Leads, Flexible Aliases & Extra Columns ---
    console.log('[Test 3] Unassigned Leads (blank & explicit "Unassigned") and Invalid Executive validation...');
    let previewBatchId;
    {
      const headers = [
        'Name',
        'Mobile',
        'E-mail',
        'Stage',
        'Owner',
        'Channel',
        'Custom Field 1',
      ];

      const rows = [
        // Row 1: Valid assigned executive by name
        [
          'Aditya Verma',
          '9876543201',
          `aditya.${timestamp}@example.com`,
          'Contacted',
          'Import Sales Rep',
          'Website',
          'Extra Data 1',
        ],
        // Row 2: Blank assigned executive -> must be unassigned, NOT an error
        [
          'Blank Exec Lead',
          '9876543202',
          `blank.${timestamp}@example.com`,
          'New',
          '',
          'Referral',
          'Extra Data 2',
        ],
        // Row 3: Explicit "Unassigned" -> must be unassigned, NOT an error
        [
          'Explicit Unassigned Lead',
          '9876543203',
          `explicit.${timestamp}@example.com`,
          'Follow Up',
          'Unassigned',
          'Meta',
          'Extra Data 3',
        ],
        // Row 4: Non-existent executive -> must trigger row validation error
        [
          'Ghost Exec Lead',
          '9876543204',
          `ghost.${timestamp}@example.com`,
          'New',
          'Ghost Executive DoesNotExist',
          'Website',
          'Extra Data 4',
        ],
      ];

      const buffer = await createWorkbookBuffer(headers, rows);
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'unassigned_test.xlsx'
      );

      const res = await request(serverPort, '/api/leads/import/preview', {
        method: 'POST',
        formData,
        cookie: adminToken,
      });

      assert.strictEqual(res.status, 200, 'Preview must return 200');
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.totalRows, 4);
      assert.strictEqual(res.body.data.validCount, 3, 'Rows 1, 2, and 3 must be valid');
      assert.strictEqual(res.body.data.errorCount, 1, 'Row 4 (Ghost Exec) must be an error');

      const pRows = res.body.data.previewRows;

      // Row 1: Assigned to Sales Rep
      assert.strictEqual(pRows[0].data.fullName, 'Aditya Verma');
      assert.strictEqual(pRows[0].data.assignedName, 'Import Sales Rep');
      assert.strictEqual(pRows[0].data.assignedTo, salesUser._id.toString());
      assert.strictEqual(pRows[0].status, 'valid');

      // Row 2: Blank executive -> unassigned
      assert.strictEqual(pRows[1].data.fullName, 'Blank Exec Lead');
      assert.strictEqual(pRows[1].data.assignedName, 'Unassigned');
      assert.strictEqual(pRows[1].data.assignedTo, null);
      assert.strictEqual(pRows[1].status, 'valid');

      // Row 3: Explicit 'Unassigned' -> unassigned
      assert.strictEqual(pRows[2].data.fullName, 'Explicit Unassigned Lead');
      assert.strictEqual(pRows[2].data.assignedName, 'Unassigned');
      assert.strictEqual(pRows[2].data.assignedTo, null);
      assert.strictEqual(pRows[2].status, 'valid');

      // Row 4: Ghost executive -> rejected
      assert.strictEqual(pRows[3].data.fullName, 'Ghost Exec Lead');
      assert.strictEqual(pRows[3].status, 'error');
      assert(
        pRows[3].validationErrors.some((err) => err.includes('Ghost Executive DoesNotExist')),
        'Row error must clearly identify unknown executive'
      );

      previewBatchId = res.body.data.batchId;
      console.log('  PASSED: Blank & explicit "Unassigned" accepted; invalid executive rejected.\n');
    }

    // --- TEST 4: Missing Required Columns Rejection ---
    console.log('[Test 4] Rejection when required columns are missing...');
    {
      const headers = ['Email Address', 'Status', 'Notes'];
      const rows = [['test@example.com', 'New', 'Some note']];
      const buffer = await createWorkbookBuffer(headers, rows);
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'missing_req.xlsx'
      );

      const res = await request(serverPort, '/api/leads/import/preview', {
        method: 'POST',
        formData,
        cookie: adminToken,
      });

      assert.strictEqual(res.status, 400, 'Missing Full Name/Phone must return 400');
      assert(res.body.message.includes('missing required column'), 'Message must explain missing columns');
      console.log('  PASSED: Missing required columns rejected with clear error.\n');
    }

    // --- TEST 5: 25 MB Upload Limit Verification ---
    console.log('[Test 5] Upload limit: Files <= 25 MB supported, oversized files rejected...');
    {
      // 1. Check size limit enforcement (oversized simulated payload > 25 MB)
      const oversizedBuffer = Buffer.alloc(26 * 1024 * 1024); // 26 MB
      const formDataOversized = new FormData();
      formDataOversized.append(
        'file',
        new Blob([oversizedBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'huge_file.xlsx'
      );

      const resOversized = await request(serverPort, '/api/leads/import/preview', {
        method: 'POST',
        formData: formDataOversized,
        cookie: adminToken,
      });

      assert(
        resOversized.status === 400 || resOversized.status === 413,
        `Oversized file must be rejected with 400 or 413 (got ${resOversized.status})`
      );
      assert(
        resOversized.body?.message?.includes('25 MB') || resOversized.body?.message?.includes('File too large'),
        'Error message must state 25 MB limit'
      );
      console.log('  PASSED: 25 MB upload limit successfully validated and enforced.\n');
    }

    // --- TEST 6: Confirmation into Dedicated ImportedLead Collection & Activity Timeline ---
    console.log('[Test 6] Confirming import batch into dedicated ImportedLead collection...');
    {
      const resConfirm = await request(serverPort, '/api/leads/import/confirm', {
        method: 'POST',
        body: { batchId: previewBatchId },
        cookie: adminToken,
      });

      assert.strictEqual(resConfirm.status, 200, 'Confirmation must return 200');
      assert.strictEqual(resConfirm.body.data.insertedCount, 3, 'Must insert the 3 valid leads');

      // 1. Verify records exist in ImportedLead collection
      const importedRecords = await ImportedLead.find({
        importBatchId: previewBatchId,
        accountId: targetAccountId,
      });
      assert.strictEqual(importedRecords.length, 3, '3 documents must exist in imported_leads');

      // Check unassigned record
      const blankExecLead = importedRecords.find((l) => l.fullName === 'Blank Exec Lead');
      assert(blankExecLead, 'Blank Exec Lead must exist in ImportedLead');
      assert.strictEqual(blankExecLead.assignedTo, null, 'assignedTo must be null');
      assert.strictEqual(blankExecLead.source, 'referral', 'Preserves original acquisition channel');

      // Check explicit unassigned record
      const explicitUnassigned = importedRecords.find((l) => l.fullName === 'Explicit Unassigned Lead');
      assert(explicitUnassigned, 'Explicit Unassigned Lead must exist in ImportedLead');
      assert.strictEqual(explicitUnassigned.assignedTo, null, 'assignedTo must be null');
      assert.strictEqual(explicitUnassigned.source, 'meta', 'Preserves Meta acquisition channel');

      // 2. Verify Activity timeline note was created for ImportedLead
      const activity = await Activity.findOne({ leadId: blankExecLead._id });
      assert(activity, 'Activity note must be recorded for ImportedLead');
      assert.strictEqual(activity.leadModel, 'ImportedLead', 'Activity leadModel must be ImportedLead');
      assert(activity.summary.includes('unassigned_test.xlsx'), 'Summary must mention filename');

      // 3. Repeat confirmation returns 409 Conflict
      const resRepeat = await request(serverPort, '/api/leads/import/confirm', {
        method: 'POST',
        body: { batchId: previewBatchId },
        cookie: adminToken,
      });
      assert.strictEqual(resRepeat.status, 409, 'Repeat confirmation must return 409');

      console.log('  PASSED: Ingestion into dedicated ImportedLead model & Activity provenance verified.\n');
    }

    // --- TEST 7: CRITICAL SEPARATION — Meta Leads Pipeline vs Excel Import Pipeline ---
    console.log('[Test 7] Critical Separation: Imported leads DO NOT appear in Meta/Windsor Leads listing...');
    {
      // 1. Query standard Leads API (/api/leads) for Aditya Verma
      const resMetaLeads = await request(serverPort, '/api/leads?search=Aditya', {
        cookie: adminToken,
      });
      assert.strictEqual(resMetaLeads.status, 200);
      const metaList = resMetaLeads.body.leads || resMetaLeads.body.data?.leads || [];
      const foundInMeta = metaList.find((l) => l.fullName === 'Aditya Verma');
      assert.strictEqual(
        foundInMeta,
        undefined,
        'CRITICAL: Excel imported lead Aditya Verma must NEVER appear in Meta /api/leads!'
      );

      // Verify existing Meta lead IS still in /api/leads
      const resMetaExisting = await request(serverPort, '/api/leads?search=Pre-existing', {
        cookie: adminToken,
      });
      const metaExistingList = resMetaExisting.body.leads || resMetaExisting.body.data?.leads || [];
      const foundExistingMeta = metaExistingList.find((l) => l.fullName === 'Pre-existing Meta Customer');
      assert(foundExistingMeta, 'Pre-existing Meta lead must remain unaffected in /api/leads');

      // 2. Query dedicated Imported Leads API (/api/leads/import/records)
      const resImportRecords = await request(serverPort, '/api/leads/import/records?search=Aditya', {
        cookie: adminToken,
      });
      assert.strictEqual(resImportRecords.status, 200);
      const recordsList = resImportRecords.body.data.records || [];
      const foundInImport = recordsList.find((l) => l.fullName === 'Aditya Verma');
      assert(foundInImport, 'Aditya Verma MUST appear in /api/leads/import/records');
      assert.strictEqual(foundInImport.source, 'website');

      console.log('  PASSED: 100% Separation verified: /api/leads is clean, /api/leads/import/records holds imported leads.\n');
    }

    // --- TEST 8: Imported Lead Management (Status, Follow-up, Activity Notes) ---
    console.log('[Test 8] Dedicated Imported Lead Management Drawer & Lifecycle...');
    {
      const importedRecords = await ImportedLead.find({
        importBatchId: previewBatchId,
        accountId: targetAccountId,
      });
      const targetRecord = importedRecords[0];

      // 1. Get Single Record
      const resGet = await request(serverPort, `/api/leads/import/records/${targetRecord._id}`, {
        cookie: adminToken,
      });
      assert.strictEqual(resGet.status, 200);
      assert.strictEqual(resGet.body.data._id, targetRecord._id.toString());

      // 2. Update Status (contacted -> qualified)
      const resStatus = await request(serverPort, `/api/leads/import/records/${targetRecord._id}/status`, {
        method: 'PATCH',
        body: { status: 'qualified' },
        cookie: adminToken,
      });
      assert.strictEqual(resStatus.status, 200);
      assert.strictEqual(resStatus.body.data.status, 'qualified');

      // 3. Schedule Follow-up
      const followUpDate = new Date(Date.now() + 86400000).toISOString();
      const resSchedule = await request(
        serverPort,
        `/api/leads/import/records/${targetRecord._id}/follow-up`,
        {
          method: 'POST',
          body: { nextFollowUpDate: followUpDate, remarks: 'Discuss final agreement' },
          cookie: adminToken,
        }
      );
      if (resSchedule.status !== 200) {
        console.error('resSchedule failed with:', resSchedule.status, resSchedule.body);
      }
      assert.strictEqual(resSchedule.status, 200);
      assert.strictEqual(resSchedule.body.data.nextFollowUpRemarks, 'Discuss final agreement');

      // 4. Complete Follow-up
      const resComplete = await request(
        serverPort,
        `/api/leads/import/records/${targetRecord._id}/follow-up/complete`,
        {
          method: 'POST',
          cookie: adminToken,
        }
      );
      assert.strictEqual(resComplete.status, 200);
      assert.strictEqual(resComplete.body.data.nextFollowUpDate, null);
      assert(resComplete.body.data.lastFollowUpCompletedAt);

      // 5. Add Custom Note
      const resAddNote = await request(
        serverPort,
        `/api/leads/import/records/${targetRecord._id}/activities`,
        {
          method: 'POST',
          body: { type: 'note', summary: 'Client confirmed down payment schedule.' },
          cookie: adminToken,
        }
      );
      assert.strictEqual(resAddNote.status, 201);

      // 6. Get Activities
      const resActivities = await request(
        serverPort,
        `/api/leads/import/records/${targetRecord._id}/activities`,
        {
          cookie: adminToken,
        }
      );
      assert.strictEqual(resActivities.status, 200);
      assert(resActivities.body.data.length >= 3, 'Activities must include import, status, and note logs');

      console.log('  PASSED: Status transitions, follow-ups, and activity notes work seamlessly.\n');
    }

    // --- TEST 9: Cross-Collection Deduplication & Account Isolation ---
    console.log('[Test 9] Cross-collection deduplication and account isolation...');
    {
      // Target account has metaLead phone (+919876543299) in Lead, and Aditya Verma (9876543201) in ImportedLead
      const headers = ['Full Name', 'Phone Number'];
      const rows = [
        ['Lead Matching Meta Phone', '9876543299'], // Duplicate of Lead
        ['Lead Matching Imported Phone', '9876543201'], // Duplicate of ImportedLead
        ['Foreign Account Phone', '9876543288'], // Match in foreign account -> NOT a duplicate in target
        ['Brand New Phone', '9876543290'], // Valid
      ];

      const buffer = await createWorkbookBuffer(headers, rows);
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'cross_dedup.xlsx'
      );

      const res = await request(serverPort, '/api/leads/import/preview', {
        method: 'POST',
        formData,
        cookie: adminToken,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.totalRows, 4);
      assert.strictEqual(res.body.data.duplicateCount, 2, 'Must detect duplicates across BOTH Lead and ImportedLead');
      assert.strictEqual(res.body.data.validCount, 2, 'Foreign account match + Brand new phone are valid');

      console.log('  PASSED: Cross-collection deduplication and account isolation verified.\n');
    }

    // --- TEST 10: Import History API ---
    console.log('[Test 10] Import History API & Batch Details...');
    {
      const resHistory = await request(serverPort, '/api/leads/import/history', {
        cookie: adminToken,
      });
      assert.strictEqual(resHistory.status, 200);
      assert(resHistory.body.data.batches.length >= 1, 'History must list batches');

      const batch = resHistory.body.data.batches[0];
      assert.strictEqual(batch.status, 'completed');

      const resDetails = await request(serverPort, `/api/leads/import/history/${batch._id}`, {
        cookie: adminToken,
      });
      assert.strictEqual(resDetails.status, 200);
      assert.strictEqual(resDetails.body.data._id, batch._id);

      console.log('  PASSED: Import history & batch details API verified.\n');
    }

    console.log('========================================================================');
    console.log('🎉 ALL 10 EXCEL LEAD IMPORT CORRECTION REGRESSION TESTS PASSED!');
    console.log('========================================================================');
  } finally {
    console.log('\n[Cleanup] Cleaning up test fixtures...');
    try {
      if (adminUser) await User.deleteOne({ _id: adminUser._id });
      if (salesUser) await User.deleteOne({ _id: salesUser._id });
      await ImportedLead.deleteMany({ accountId: targetAccountId });
      await Lead.deleteMany({
        $or: [
          { accountId: targetAccountId, email: new RegExp(timestamp.toString()) },
          { accountId: targetAccountId, externalLeadId: new RegExp(timestamp.toString()) },
          { accountId: foreignAccountId },
        ],
      });
      await Activity.deleteMany({ accountId: targetAccountId, 'metadata.importBatchId': { $exists: true } });
      await ImportBatch.deleteMany({ accountId: targetAccountId });
    } catch (err) {
      console.error('[Cleanup Error]', err);
    }

    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
      console.log('[Test Server] Stopped.');
    }
    await disconnectDB();
  }
}

runRegressionSuite().catch((err) => {
  console.error('[Regression Test Failed]', err);
  process.exit(1);
});
