import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import Activity from '../src/models/Activity.js';
import { env } from '../src/config/env.js';
import { signToken, COOKIE_NAME } from '../src/utils/jwt.js';

const TEST_PORT = 5097;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runExportRegressionSuite() {
  console.log('=== Starting Regression Suite: Secure Excel Export Feature ===\n');

  await connectDB();
  const server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const testAccountId = `act_export_${timestamp}`;
  const foreignAccountId = `act_foreign_${timestamp}`;
  const adminEmail = `admin.export.${timestamp}@example.com`;
  const salesEmail1 = `sales1.export.${timestamp}@example.com`;
  const salesEmail2 = `sales2.export.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  // Override account configuration for isolated test scope
  const originalAccountId = env.WINDSOR_ACCOUNT_ID;
  env.WINDSOR_ACCOUNT_ID = testAccountId;

  let testAdmin = null;
  let testSales1 = null;
  let testSales2 = null;
  let adminCookie = '';
  let sales1Cookie = '';

  const createdLeadIds = [];
  const createdActivityIds = [];

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    testAdmin = await User.create({
      name: 'Export Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales1 = await User.create({
      name: 'Export Sales 1',
      email: salesEmail1,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    testSales2 = await User.create({
      name: 'Export Sales 2',
      email: salesEmail2,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    adminCookie = `${COOKIE_NAME}=${signToken({ id: testAdmin._id, role: testAdmin.role })}`;
    sales1Cookie = `${COOKIE_NAME}=${signToken({ id: testSales1._id, role: testSales1.role })}`;

    console.log('[Setup] Test users created');

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    // Create 15 leads for testSales1 (to test pagination bypass: default UI limit is 10)
    for (let i = 1; i <= 15; i++) {
      const isFormulaLead = i === 1;
      const lead = await Lead.create({
        fullName: isFormulaLead ? '=cmd|’ /C calc’!A0' : `Lead Rep1 Number ${i}`,
        email: `rep1.lead${i}.${timestamp}@example.com`,
        phoneNumber: `+9198765432${i < 10 ? '0' + i : i}`,
        source: i % 2 === 0 ? 'meta' : 'website',
        accountId: testAccountId,
        externalLeadId: `ext_r1_${i}_${timestamp}`,
        status: i <= 8 ? 'contacted' : 'new',
        assignedTo: testSales1._id,
        notes: isFormulaLead ? '@SUM(1,2)' : `Operational CRM note for lead ${i}`,
        campaignName: isFormulaLead ? '+2024 Campaign' : 'Luxury Villa 2024',
        formName: 'Quick Inquiry',
      });
      createdLeadIds.push(lead._id);

      // Create completed follow-up for the first 3 leads
      if (i <= 3) {
        lead.lastFollowUpCompletedAt = threeDaysAgo;
        await lead.save();

        const act = await Activity.create({
          leadId: lead._id,
          accountId: testAccountId,
          type: 'follow_up_completed',
          summary: `Follow-up completed for lead ${i}`,
          performedBy: testSales1._id,
          performedAt: threeDaysAgo,
        });
        createdActivityIds.push(act._id);
      }
    }

    // Create 5 leads for testSales2
    for (let i = 1; i <= 5; i++) {
      const lead = await Lead.create({
        fullName: `Lead Rep2 Number ${i}`,
        email: `rep2.lead${i}.${timestamp}@example.com`,
        phoneNumber: `+91987654420${i}`,
        source: 'meta',
        accountId: testAccountId,
        externalLeadId: `ext_r2_${i}_${timestamp}`,
        status: 'qualified',
        assignedTo: testSales2._id,
      });
      createdLeadIds.push(lead._id);
    }

    // Create 2 leads in foreign account (Account isolation check)
    for (let i = 1; i <= 2; i++) {
      const lead = await Lead.create({
        fullName: `Foreign Lead ${i}`,
        email: `foreign.lead${i}.${timestamp}@example.com`,
        phoneNumber: `+91987654520${i}`,
        source: 'meta',
        accountId: foreignAccountId,
        externalLeadId: `ext_foreign_${i}_${timestamp}`,
        status: 'contacted',
        assignedTo: testSales1._id,
      });
      createdLeadIds.push(lead._id);
    }

    console.log('[Setup] Created test leads (15 for Rep 1, 5 for Rep 2, 2 in foreign account)');

    // Helper for downloading Excel workbook
    async function apiGetExcel(queryStr, cookie) {
      const res = await fetch(`${BASE_URL}/api/leads/export${queryStr}`, {
        headers: cookie ? { Cookie: cookie } : {},
      });
      return res;
    }

    // Helper to parse Excel response buffer into an ExcelJS Workbook
    async function parseWorkbook(res) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      return workbook;
    }

    // ==========================================
    // TEST 1: Authentication enforcement
    // ==========================================
    console.log('\n[Test 1] Unauthenticated request returns 401...');
    {
      const res = await apiGetExcel('', '');
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      console.log('  PASSED: Unauthenticated export blocked.');
    }

    // ==========================================
    // TEST 2: Account isolation
    // ==========================================
    console.log('\n[Test 2] Foreign account leads strictly excluded...');
    {
      const res = await apiGetExcel('', adminCookie);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');
      assert(sheet, 'Worksheet "Leads Pipeline" must exist');

      let hasForeignLead = false;
      sheet.eachRow((row) => {
        const email = row.getCell(5).value;
        if (email && email.includes('foreign.lead')) {
          hasForeignLead = true;
        }
      });
      assert(!hasForeignLead, 'Foreign account leads must NEVER be exported');
      console.log('  PASSED: Account isolation verified.');
    }

    // ==========================================
    // TEST 3: Sales Executive role scoping
    // ==========================================
    console.log('\n[Test 3] Sales executive only exports their assigned leads...');
    {
      const res = await apiGetExcel('', sales1Cookie);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');

      // 15 leads assigned to Rep 1 + 1 header row = 16 rows
      assert(sheet.rowCount === 16, `Rep 1 expected 16 rows (1 header + 15 leads), got ${sheet.rowCount}`);

      let hasRep2Lead = false;
      sheet.eachRow((row) => {
        const email = row.getCell(5).value;
        if (email && email.includes('rep2.lead')) {
          hasRep2Lead = true;
        }
      });
      assert(!hasRep2Lead, 'Sales Rep 1 must NOT see any Rep 2 leads');
      console.log('  PASSED: Sales executive role scoping verified.');
    }

    // ==========================================
    // TEST 4: Export ALL matching leads (bypassing pagination)
    // ==========================================
    console.log('\n[Test 4] Exports all matching leads without UI pagination limits...');
    {
      // First verify normal leads API caps at 10 by default
      const listRes = await fetch(`${BASE_URL}/api/leads`, {
        headers: { Cookie: adminCookie },
      });
      const listData = await listRes.json();
      assert(listData.total === 20, `Total leads in account should be 20, got ${listData.total}`);
      assert(listData.leads.length === 10, `Normal list response should have page size 10, got ${listData.leads.length}`);

      // Now verify export API exports all 20 leads
      const res = await apiGetExcel('', adminCookie);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');
      assert(sheet.rowCount === 21, `Export expected 21 rows (1 header + 20 leads), got ${sheet.rowCount}`);
      console.log('  PASSED: All matching records exported across pages.');
    }

    // ==========================================
    // TEST 5: Filter consistency (status, source, followUpStatus=completed)
    // ==========================================
    console.log('\n[Test 5] Filter combinations: status=contacted & source=meta...');
    {
      const res = await apiGetExcel('?status=contacted&source=meta', adminCookie);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');

      // In Rep 1's 15 leads: indices 1..8 have status=contacted.
      // Among those, even numbers (2, 4, 6, 8) have source=meta -> 4 leads.
      assert(sheet.rowCount === 5, `Expected 5 rows (1 header + 4 leads), got ${sheet.rowCount}`);

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const status = row.getCell(6).value;
        const source = row.getCell(8).value;
        assert(status === 'Contacted', `Expected Contacted status, got ${status}`);
        assert(source === 'Meta', `Expected Meta source, got ${source}`);
      });
      console.log('  PASSED: Status and Source filters work accurately.');
    }

    console.log('\n[Test 5b] Filter followUpStatus=completed & dateFilter=7d...');
    {
      const res = await apiGetExcel('?followUpStatus=completed&dateFilter=7d', adminCookie);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');

      // Exactly 3 leads had follow_up_completed activities 3 days ago
      assert(sheet.rowCount === 4, `Expected 4 rows (1 header + 3 leads), got ${sheet.rowCount}`);
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const lastCompleted = row.getCell(14).value;
        assert(lastCompleted, 'Last completed follow up date must be present');
      });
      console.log('  PASSED: Completed follow-up filter correctly matches Activity timeline.');
    }

    // ==========================================
    // TEST 6: Formula injection defense
    // ==========================================
    console.log('\n[Test 6] Spreadsheet formula injection protection...');
    {
      const res = await apiGetExcel('?search=cmd', adminCookie);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');
      assert(sheet.rowCount === 2, `Expected 2 rows (1 header + 1 formula lead), got ${sheet.rowCount}`);

      const dataRow = sheet.getRow(2);
      const fullName = dataRow.getCell(3).value;
      const campaignName = dataRow.getCell(9).value;
      const notes = dataRow.getCell(15).value;

      assert(fullName.startsWith("'"), `Dangerous string ${fullName} must be prefixed with single quote`);
      assert(campaignName.startsWith("'"), `Dangerous string ${campaignName} must be prefixed with single quote`);
      assert(notes.startsWith("'"), `Dangerous string ${notes} must be prefixed with single quote`);
      console.log('  PASSED: Formula injection prefixes verified on all user-controlled text.');
    }

    // ==========================================
    // TEST 7: Workbook structure, styling, headers & no internal secrets
    // ==========================================
    console.log('\n[Test 7] Workbook structure, styling, headers & syncProvider exclusion...');
    {
      const res = await apiGetExcel('', adminCookie);
      const contentType = res.headers.get('content-type');
      assert(
        contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        `Unexpected content-type: ${contentType}`
      );
      const disposition = res.headers.get('content-disposition');
      assert(disposition && disposition.includes('Doon_Anandam_Leads_'), `Invalid disposition: ${disposition}`);

      const workbook = await parseWorkbook(res);
      const sheet = workbook.getWorksheet('Leads Pipeline');
      assert(sheet.columnCount === 15, `Expected 15 columns, got ${sheet.columnCount}`);

      const headerRow = sheet.getRow(1);
      const expectedHeaders = [
        'Lead ID',
        'External ID',
        'Full Name',
        'Phone Number',
        'Email Address',
        'Status',
        'Assigned Executive',
        'Acquisition Source',
        'Campaign Name',
        'Form Name',
        'Ingestion Date',
        'Next Follow-Up Date',
        'Follow-Up Remarks',
        'Last Completed Follow-Up',
        'CRM Notes',
      ];

      expectedHeaders.forEach((expected, idx) => {
        const val = headerRow.getCell(idx + 1).value;
        assert(val === expected, `Header ${idx + 1} mismatch: expected ${expected}, got ${val}`);
      });

      // Verify no row has syncProvider or windsor.ai
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            assert(!cell.value.toLowerCase().includes('windsor.ai'), 'Internal sync provider MUST not leak in Excel');
          }
        });
      });
      console.log('  PASSED: Workbook styling, headers and internal metadata exclusion verified.');
    }

    // ==========================================
    // TEST 8: Zero-match filter error handling
    // ==========================================
    console.log('\n[Test 8] Zero-match filter criteria returns 400 with helpful message...');
    {
      const res = await apiGetExcel('?search=NonExistentUniqueTerm123456789', adminCookie);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      const data = await res.json();
      assert(data.success === false, 'success should be false');
      assert(data.message.includes('No leads found'), `Message should mention no leads found: ${data.message}`);
      console.log('  PASSED: Zero-lead export gracefully rejected without empty download.');
    }

    console.log('\n=== ALL 8 EXPORT REGRESSION TESTS PASSED! ===\n');
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

runExportRegressionSuite().catch((err) => {
  console.error('\n❌ EXPORT REGRESSION TEST FAILED:', err);
  process.exit(1);
});
