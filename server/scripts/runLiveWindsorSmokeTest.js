import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import { env, validateWindsorEnv } from '../src/config/env.js';
import { signToken, COOKIE_NAME } from '../src/utils/jwt.js';

const SMOKE_PORT = 5059;
const BASE_URL = `http://localhost:${SMOKE_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runLiveSmokeTest() {
  console.log('=== Starting Phase 5 Live Windsor.ai Smoke Test ===\n');

  // 1. Verify environment configuration without logging secrets
  console.log('[Step 1] Verifying environment configuration...');
  validateWindsorEnv();
  console.log('  ✔ WINDSOR_API_KEY is configured (Length: ' + env.WINDSOR_API_KEY.length + ' chars)');
  console.log('  ✔ WINDSOR_ACCOUNT_ID is configured: ' + env.WINDSOR_ACCOUNT_ID);
  console.log('  ✔ WINDSOR_API_BASE_URL: ' + env.WINDSOR_API_BASE_URL);
  console.log('  ✔ WINDSOR_DATE_PRESET: ' + env.WINDSOR_DATE_PRESET);
  console.log('  ✔ WINDSOR_REQUEST_TIMEOUT_MS: ' + env.WINDSOR_REQUEST_TIMEOUT_MS);

  // 2. Connect to database and start server
  console.log('\n[Step 2] Connecting to database and starting test server...');
  await connectDB();
  const server = await new Promise((resolve) => {
    const s = app.listen(SMOKE_PORT, () => resolve(s));
  });
  console.log(`  ✔ Server listening on port ${SMOKE_PORT}`);

  let modifiedLeadExternalId = null;

  try {
    // 3. Find existing active admin account
    console.log('\n[Step 3] Locating existing admin account...');
    const admin = await User.findOne({ role: 'admin', isActive: true });
    assert(admin, 'An active administrator account must exist in the database');
    console.log(`  ✔ Found active admin: ${admin.name} (${admin.email})`);

    // 4. Generate authenticated admin session cookie
    console.log('\n[Step 4] Establishing authenticated admin session...');
    const token = signToken({ id: admin._id, role: admin.role });
    const adminCookie = `${COOKIE_NAME}=${token}`;

    // Verify session against /api/auth/me
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: adminCookie },
    });
    assert(meRes.status === 200, 'Session verification /api/auth/me must return 200');
    const meData = await meRes.json();
    assert(meData.user.role === 'admin', 'Authenticated session must have admin role');
    console.log(`  ✔ Session verified for admin: ${meData.user.email}`);

    // 5. First Sync: Call POST /api/leads/sync
    console.log('\n[Step 5] Calling POST /api/leads/sync (First Live Run)...');
    const sync1Res = await fetch(`${BASE_URL}/api/leads/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
    });

    const sync1Data = await sync1Res.json();
    assert(sync1Res.status === 200, `First sync must return 200, got ${sync1Res.status}: ${JSON.stringify(sync1Data)}`);
    assert(sync1Data.success === true, 'Response success must be true');
    assert(sync1Data.summary, 'Response must include summary');

    const s1 = sync1Data.summary;
    console.log('  ✔ First Sync Succeeded!');
    console.log('  --- Sanitized Summary (Run 1) ---');
    console.log(`  - Fetched:  ${s1.fetched}`);
    console.log(`  - Inserted: ${s1.inserted}`);
    console.log(`  - Updated:  ${s1.updated}`);
    console.log(`  - Skipped:  ${s1.skipped}`);
    console.log(`  - Failed:   ${s1.failed}`);

    // 6. Verify MongoDB persistence and single account compliance
    console.log('\n[Step 6] Verifying MongoDB records compliance...');
    const dbLeads = await Lead.find({ accountId: env.WINDSOR_ACCOUNT_ID });
    console.log(`  ✔ Found ${dbLeads.length} leads in MongoDB for account ${env.WINDSOR_ACCOUNT_ID}`);
    assert(dbLeads.length > 0, 'At least one lead should be persisted');

    // Confirm all saved leads belong strictly to configured account
    const wrongAccountLeads = await Lead.find({ accountId: { $ne: env.WINDSOR_ACCOUNT_ID } });
    console.log(`  ✔ Foreign account leads count in DB: ${wrongAccountLeads.length}`);
    assert(wrongAccountLeads.length === 0, 'No leads from foreign accounts should exist');

    // 7. Test CRM preservation: Modify status, assignedTo, notes on one lead
    console.log('\n[Step 7] Setting CRM-owned fields on a lead to test preservation...');
    const leadToModify = dbLeads[0];
    modifiedLeadExternalId = leadToModify.externalLeadId;

    leadToModify.status = 'qualified';
    leadToModify.assignedTo = admin._id;
    leadToModify.notes = 'Verified live smoke test note';
    await leadToModify.save();
    console.log(`  ✔ Modified lead (${modifiedLeadExternalId.slice(0, 6)}...): set status=qualified, assignedTo=${admin.name}, notes set.`);

    // 8. Second Sync: Call POST /api/leads/sync again
    console.log('\n[Step 8] Calling POST /api/leads/sync (Second Live Run - Deduplication Test)...');
    const sync2Res = await fetch(`${BASE_URL}/api/leads/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
    });

    const sync2Data = await sync2Res.json();
    assert(sync2Res.status === 200, `Second sync must return 200, got ${sync2Res.status}`);
    const s2 = sync2Data.summary;

    console.log('  ✔ Second Sync Succeeded!');
    console.log('  --- Sanitized Summary (Run 2) ---');
    console.log(`  - Fetched:  ${s2.fetched}`);
    console.log(`  - Inserted: ${s2.inserted}`);
    console.log(`  - Updated:  ${s2.updated}`);
    console.log(`  - Skipped:  ${s2.skipped}`);
    console.log(`  - Failed:   ${s2.failed}`);

    assert(s2.inserted === 0, `Second sync must not insert duplicate leads! Got inserted=${s2.inserted}`);
    assert(s2.updated === s1.fetched, `Second sync should update existing leads (expected ${s1.fetched}, got ${s2.updated})`);

    // Verify DB count has not increased
    const dbLeadsCountAfter = await Lead.countDocuments({ accountId: env.WINDSOR_ACCOUNT_ID });
    assert(dbLeadsCountAfter === dbLeads.length, `DB lead count must remain identical (${dbLeads.length}), got ${dbLeadsCountAfter}`);
    console.log(`  ✔ DB count after second sync: ${dbLeadsCountAfter} (0 duplicates created)`);

    // 9. Verify CRM-owned fields were preserved
    console.log('\n[Step 9] Verifying CRM-owned fields remained unchanged after repeated sync...');
    const recheckedLead = await Lead.findOne({ externalLeadId: modifiedLeadExternalId });
    assert(recheckedLead, 'Lead must exist in DB');
    assert(recheckedLead.status === 'qualified', `Lead status must remain 'qualified', got '${recheckedLead.status}'`);
    assert(String(recheckedLead.assignedTo) === String(admin._id), 'Lead assignment must remain intact');
    assert(recheckedLead.notes === 'Verified live smoke test note', 'Lead notes must remain intact');
    console.log('  ✔ CRM status, assignment, and internal notes preserved intact!');

    console.log('\n=== Live Windsor.ai Smoke Test Passed with 100% Success! ===\n');
  } finally {
    // Reset modified lead notes if needed or leave clean
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Cleanup] Test server stopped.');
    }
    await disconnectDB();
    console.log('[Database] MongoDB connection closed.');
  }
}

runLiveSmokeTest().catch((err) => {
  console.error('\n✖ Live Smoke Test Failed:');
  console.error(err);
  disconnectDB().finally(() => process.exit(1));
});
