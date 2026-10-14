import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Lead from '../src/models/Lead.js';
import { env, validateWindsorEnv } from '../src/config/env.js';
import {
  buildWindsorRequestUrl,
  getSanitizedUrl,
  mapAndValidateLeadRecord,
  fetchFacebookLeads,
} from '../src/services/windsor.service.js';
import {
  syncFacebookLeads,
  setSyncFetchMock,
} from '../src/services/leadSync.service.js';

const TEST_PORT = 5058;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting Phase 5 Windsor.ai & Lead Ingestion Automated Test Suite ===\n');

  await connectDB();
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const testAccountId = `act_test_${timestamp}`;
  const testApiKey = `test_w_key_${timestamp}`;
  const adminEmail = `admin.windsor.${timestamp}@example.com`;
  const salesEmail = `sales.windsor.${timestamp}@example.com`;
  const password = 'SecurePassword123!';

  // Override env configuration for testing without relying on live keys
  const testEnv = {
    ...env,
    WINDSOR_API_KEY: testApiKey,
    WINDSOR_ACCOUNT_ID: testAccountId,
    WINDSOR_API_BASE_URL: 'https://connectors.windsor.ai',
    WINDSOR_DATE_PRESET: 'last_7d',
    WINDSOR_REQUEST_TIMEOUT_MS: 3000,
  };

  let testAdmin = null;
  let testSales = null;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    testAdmin = await User.create({
      name: 'Windsor Test Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    testSales = await User.create({
      name: 'Windsor Test Sales',
      email: salesEmail,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    console.log('[Setup] Created test admin and sales executive fixtures');

    // =========================================================================
    // TEST 1: Windsor URL & query parameter construction
    // =========================================================================
    {
      const constructedUrl = buildWindsorRequestUrl({
        baseUrl: 'https://connectors.windsor.ai',
        endpoint: '/facebook_leads',
        datePreset: 'last_7d',
        accountId: testAccountId,
        apiKey: testApiKey,
      });

      assert(constructedUrl.origin === 'https://connectors.windsor.ai', 'URL origin should match base URL');
      assert(constructedUrl.pathname === '/facebook_leads', 'URL path should be /facebook_leads');
      assert(constructedUrl.searchParams.get('date_preset') === 'last_7d', 'date_preset should be last_7d');
      assert(constructedUrl.searchParams.get('select_accounts') === testAccountId, 'select_accounts should match test account');
      assert(constructedUrl.searchParams.get('api_key') === testApiKey, 'api_key should match test key');
      assert(constructedUrl.searchParams.has('fields'), 'fields parameter must be explicitly present');
      assert(!constructedUrl.searchParams.has('filter'), 'malformed filter parameter must not be present');

      // Test URL sanitization
      const sanitized = getSanitizedUrl(constructedUrl);
      assert(!sanitized.includes(testApiKey), 'Sanitized URL must not contain the real API key');
      assert(sanitized.includes('REDACTED'), 'Sanitized URL must show REDACTED');

      console.log('✔ Test 1 Passed: Windsor URL and query parameter construction verified');
    }

    // =========================================================================
    // TEST 2: Missing API key or unconfirmed account configuration
    // =========================================================================
    {
      let missingKeyThrown = false;
      try {
        validateWindsorEnv({
          ...testEnv,
          WINDSOR_API_KEY: '',
        });
      } catch (err) {
        missingKeyThrown = true;
        assert(err.status === 503, 'Missing API key should produce 503 status');
        assert(err.code === 'WINDSOR_NOT_CONFIGURED', 'Missing API key code should match');
      }
      assert(missingKeyThrown, 'validateWindsorEnv must throw when API key is missing');

      let placeholderKeyThrown = false;
      try {
        validateWindsorEnv({
          ...testEnv,
          WINDSOR_API_KEY: 'replace_with_your_windsor_api_key',
        });
      } catch (err) {
        placeholderKeyThrown = true;
        assert(err.status === 503, 'Placeholder key should be rejected with 503');
      }
      assert(placeholderKeyThrown, 'validateWindsorEnv must reject placeholder API key');

      let missingAccountThrown = false;
      try {
        validateWindsorEnv({
          ...testEnv,
          WINDSOR_ACCOUNT_ID: '',
        });
      } catch (err) {
        missingAccountThrown = true;
        assert(err.status === 503, 'Missing account ID should produce 503 status');
      }
      assert(missingAccountThrown, 'validateWindsorEnv must throw when account ID is missing');

      let placeholderAccountThrown = false;
      try {
        validateWindsorEnv({
          ...testEnv,
          WINDSOR_ACCOUNT_ID: 'replace_with_your_confirmed_account_id',
        });
      } catch (err) {
        placeholderAccountThrown = true;
        assert(err.status === 503, 'Placeholder account ID should be rejected with 503');
      }
      assert(placeholderAccountThrown, 'validateWindsorEnv must reject unconfirmed account placeholder');

      console.log('✔ Test 2 Passed: Missing API key or account configuration correctly handled');
    }

    // =========================================================================
    // TEST 3: Windsor timeout and upstream network failure
    // =========================================================================
    {
      // Mock network failure
      const mockNetworkFailure = async () => {
        const err = new Error('getaddrinfo ENOTFOUND connectors.windsor.ai');
        err.name = 'FetchError';
        throw err;
      };

      let networkErrorCaught = false;
      try {
        await fetchFacebookLeads({
          overrideEnv: testEnv,
          fetchFn: mockNetworkFailure,
        });
      } catch (err) {
        networkErrorCaught = true;
        assert(err.status === 502, 'Network failure must map to HTTP 502');
        assert(err.code === 'UPSTREAM_NETWORK_ERROR', 'Network failure error code verified');
        assert(!err.message.includes(testApiKey), 'Error message must not leak API key');
      }
      assert(networkErrorCaught, 'fetchFacebookLeads must handle network failures');

      // Mock request timeout
      const mockTimeout = async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'AbortError';
        throw err;
      };

      let timeoutCaught = false;
      try {
        await fetchFacebookLeads({
          overrideEnv: testEnv,
          fetchFn: mockTimeout,
        });
      } catch (err) {
        timeoutCaught = true;
        assert(err.status === 504, 'Timeout failure must map to HTTP 504');
        assert(err.code === 'UPSTREAM_TIMEOUT', 'Timeout error code verified');
      }
      assert(timeoutCaught, 'fetchFacebookLeads must handle upstream timeouts');

      console.log('✔ Test 3 Passed: Windsor timeout and upstream network failure handled safely');
    }

    // =========================================================================
    // TEST 4: Invalid or malformed upstream response
    // =========================================================================
    {
      // Non-JSON response
      const mockNonJson = async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      });

      let nonJsonCaught = false;
      try {
        await fetchFacebookLeads({
          overrideEnv: testEnv,
          fetchFn: mockNonJson,
        });
      } catch (err) {
        nonJsonCaught = true;
        assert(err.status === 502, 'Invalid JSON must map to 502');
        assert(err.code === 'INVALID_UPSTREAM_JSON', 'Invalid JSON error code verified');
      }
      assert(nonJsonCaught, 'Non-JSON upstream response caught properly');

      // Malformed structure (object without array)
      const mockBadStructure = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpectedKey: 12345 }),
      });

      let badStructureCaught = false;
      try {
        await fetchFacebookLeads({
          overrideEnv: testEnv,
          fetchFn: mockBadStructure,
        });
      } catch (err) {
        badStructureCaught = true;
        assert(err.status === 502, 'Bad structure must map to 502');
        assert(err.code === 'INVALID_UPSTREAM_STRUCTURE', 'Bad structure code verified');
      }
      assert(badStructureCaught, 'Malformed structure caught properly');

      // Upstream HTTP 500
      const mockHttp500 = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error at connector' }),
      });

      let http500Caught = false;
      try {
        await fetchFacebookLeads({
          overrideEnv: testEnv,
          fetchFn: mockHttp500,
        });
      } catch (err) {
        http500Caught = true;
        assert(err.status === 502, 'Upstream HTTP 500 should map to 502');
      }
      assert(http500Caught, 'Upstream HTTP 500 handled safely');

      console.log('✔ Test 4 Passed: Invalid and malformed upstream responses handled safely');
    }

    // =========================================================================
    // TEST 5: Rejection or skipping of mismatched account IDs
    // =========================================================================
    {
      const recordValid = {
        id: 'fb_lead_val_1',
        account_id: testAccountId,
        full_name: 'Valid Account Customer',
        email: 'valid@example.com',
      };

      const recordWrongAccount = {
        id: 'fb_lead_wrong_1',
        account_id: 'act_other_different_business_999',
        full_name: 'Intruder Account Customer',
        email: 'intruder@example.com',
      };

      const validResult = mapAndValidateLeadRecord(recordValid, testAccountId);
      assert(validResult.valid === true, 'Matching account record must be valid');
      assert(validResult.lead.externalLeadId === 'fb_lead_val_1', 'External ID mapped');

      const mismatchResult = mapAndValidateLeadRecord(recordWrongAccount, testAccountId);
      assert(mismatchResult.valid === false, 'Mismatched account record must be rejected');
      assert(mismatchResult.skippedDueToAccountMismatch === true, 'Flagged as account mismatch');

      console.log('✔ Test 5 Passed: Mismatched account IDs rejected and flagged for safe skipping');
    }

    // =========================================================================
    // TEST 6: Correct mapping of nullable email and phone fields
    // =========================================================================
    {
      const recordWithEmailAndPhone = {
        id: 'fb_lead_both_1',
        account_id: testAccountId,
        full_name: 'Both Contacts Customer',
        email: 'Both@Example.COM  ',
        phone_number: '+919876543210',
      };

      const recordPhoneOnly = {
        id: 'fb_lead_phone_only_1',
        account_id: testAccountId,
        full_name: 'Phone Only Customer',
        email: '',
        phone_number: '+919999888877',
      };

      const recordEmailOnly = {
        id: 'fb_lead_email_only_1',
        account_id: testAccountId,
        full_name: 'Email Only Customer',
        email: 'emailonly@example.com',
        phone_number: null,
      };

      const r1 = mapAndValidateLeadRecord(recordWithEmailAndPhone, testAccountId);
      assert(r1.lead.email === 'both@example.com', 'Email trimmed and lowercased');
      assert(r1.lead.phoneNumber === '+919876543210', 'Phone number retained');

      const r2 = mapAndValidateLeadRecord(recordPhoneOnly, testAccountId);
      assert(r2.lead.email === null, 'Empty email mapped to null');
      assert(r2.lead.phoneNumber === '+919999888877', 'Phone number mapped correctly');

      const r3 = mapAndValidateLeadRecord(recordEmailOnly, testAccountId);
      assert(r3.lead.email === 'emailonly@example.com', 'Email mapped correctly');
      assert(r3.lead.phoneNumber === null, 'Null phone mapped to null');

      console.log('✔ Test 6 Passed: Nullable email and phone fields correctly mapped');
    }

    // =========================================================================
    // TEST 7: Unique external lead identity and duplicate prevention
    // =========================================================================
    {
      const mockLeadsData = [
        {
          id: `fb_sync_7_lead_A_${timestamp}`,
          account_id: testAccountId,
          account_name: 'Doon Anandam FB Ads',
          full_name: 'Lead Alpha',
          email: 'alpha@example.com',
          phone_number: '+919876500001',
          campaign: 'Luxury Villas Phase 1',
        },
        {
          id: `fb_sync_7_lead_B_${timestamp}`,
          account_id: testAccountId,
          account_name: 'Doon Anandam FB Ads',
          full_name: 'Lead Beta',
          email: 'beta@example.com',
          phone_number: '+919876500002',
          campaign: 'Luxury Villas Phase 1',
        },
      ];

      const mockFetchFirst = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: mockLeadsData }),
      });

      // First sync -> inserts 2 leads
      const summary1 = await syncFacebookLeads({
        overrideEnv: testEnv,
        fetchFn: mockFetchFirst,
      });

      assert(summary1.fetched === 2, 'Should fetch 2 leads');
      assert(summary1.inserted === 2, 'Should insert 2 new leads');
      assert(summary1.updated === 0, 'No updates on first insert');

      // Second sync with identical data -> inserts 0, updates 2 (deduplication)
      const summary2 = await syncFacebookLeads({
        overrideEnv: testEnv,
        fetchFn: mockFetchFirst,
      });

      assert(summary2.fetched === 2, 'Should fetch 2 leads on repeat');
      assert(summary2.inserted === 0, 'Repeated sync must not insert duplicate leads');
      assert(summary2.updated === 2, 'Existing leads matched and refreshed');

      // Verify DB count
      const totalInDb = await Lead.countDocuments({
        accountId: testAccountId,
        externalLeadId: { $in: mockLeadsData.map((m) => m.id) },
      });
      assert(totalInDb === 2, `Total leads in DB should strictly be 2, got ${totalInDb}`);

      console.log('✔ Test 7 Passed: Unique external lead identity and duplicate prevention verified');
    }

    // =========================================================================
    // TEST 8: Existing status, assignment, and notes preserved on repeated sync
    // =========================================================================
    {
      const leadExternalId = `fb_sync_8_lead_preserve_${timestamp}`;
      const mockInitial = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: leadExternalId,
              account_id: testAccountId,
              full_name: 'Original Lead Name',
              campaign: 'Initial Campaign',
              ad_name: 'Original Ad',
            },
          ],
        }),
      });

      // 1. Ingest initial lead
      await syncFacebookLeads({ overrideEnv: testEnv, fetchFn: mockInitial });

      // 2. Simulate internal CRM operation: Sales rep qualifies lead, assigns to user, adds internal note
      const dbLead = await Lead.findOne({ externalLeadId: leadExternalId });
      assert(dbLead, 'Lead must exist in DB');
      assert(dbLead.status === 'new', 'Initial status must be new');
      assert(dbLead.assignedTo === null, 'Initial assignment must be null');

      dbLead.status = 'qualified';
      dbLead.assignedTo = testAdmin._id;
      dbLead.notes = 'Client is interested in 4BHK plot. Follow up tomorrow.';
      await dbLead.save();

      // 3. Repeated sync arrives with refreshed upstream data (e.g. ad_name changed by marketing)
      const mockRefreshed = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: leadExternalId,
              account_id: testAccountId,
              full_name: 'Original Lead Name',
              campaign: 'Updated Campaign Header',
              ad_name: 'New Ad Creative V2',
            },
          ],
        }),
      });

      const summarySync2 = await syncFacebookLeads({
        overrideEnv: testEnv,
        fetchFn: mockRefreshed,
      });

      assert(summarySync2.inserted === 0, 'Must not insert duplicate');
      assert(summarySync2.updated === 1, 'Must match and refresh');

      // 4. Verify that CRM-owned fields remained strictly unchanged while upstream fields updated
      const recheckedLead = await Lead.findOne({ externalLeadId: leadExternalId });
      assert(recheckedLead.status === 'qualified', 'CRM status must remain "qualified" after repeated sync');
      assert(String(recheckedLead.assignedTo) === String(testAdmin._id), 'CRM assignment must remain intact');
      assert(recheckedLead.notes === 'Client is interested in 4BHK plot. Follow up tomorrow.', 'CRM notes must remain intact');
      assert(recheckedLead.adName === 'New Ad Creative V2', 'Upstream adName was refreshed');
      assert(recheckedLead.campaignName === 'Updated Campaign Header', 'Upstream campaignName was refreshed');

      console.log('✔ Test 8 Passed: Existing status, assignment, and notes preserved across syncs');
    }

    // =========================================================================
    // TEST 9: Unauthenticated sync request rejected
    // =========================================================================
    {
      const res = await fetch(`${BASE_URL}/api/leads/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      assert(res.status === 401, 'Unauthenticated /api/leads/sync should return 401');
      const data = await res.json();
      assert(data.success === false, 'success must be false');
      console.log('✔ Test 9 Passed: Unauthenticated sync request rejected with 401');
    }

    // =========================================================================
    // TEST 10: Sales executive sync request rejected
    // =========================================================================
    let salesCookie = '';
    {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: salesEmail, password }),
      });
      salesCookie = loginRes.headers.get('set-cookie').split(';')[0];

      const res = await fetch(`${BASE_URL}/api/leads/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: salesCookie,
        },
      });

      assert(res.status === 403, 'Sales Executive should receive 403 Forbidden on /api/leads/sync');
      const data = await res.json();
      assert(data.success === false, 'success must be false');
      console.log('✔ Test 10 Passed: Sales executive sync request rejected with 403 Forbidden');
    }

    // =========================================================================
    // TEST 11: Admin sync request succeeds with mocked Windsor response
    // =========================================================================
    let adminCookie = '';
    {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password }),
      });
      adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

      // Temporarily set test env variables on process.env for endpoint verification
      const origKey = process.env.WINDSOR_API_KEY;
      const origAccount = process.env.WINDSOR_ACCOUNT_ID;
      process.env.WINDSOR_API_KEY = testApiKey;
      process.env.WINDSOR_ACCOUNT_ID = testAccountId;
      env.WINDSOR_API_KEY = testApiKey;
      env.WINDSOR_ACCOUNT_ID = testAccountId;

      const endpointLeadId = `fb_lead_endpoint_${timestamp}`;
      setSyncFetchMock(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: endpointLeadId,
              account_id: testAccountId,
              full_name: 'Endpoint Sync Test Lead',
              email: 'endpoint@example.com',
              phone_number: '+919876543999',
              campaign: 'Phase 5 Launch',
            },
          ],
        }),
      }));

      const syncRes = await fetch(`${BASE_URL}/api/leads/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
      });

      // Restore
      setSyncFetchMock(null);
      process.env.WINDSOR_API_KEY = origKey;
      process.env.WINDSOR_ACCOUNT_ID = origAccount;
      env.WINDSOR_API_KEY = origKey;
      env.WINDSOR_ACCOUNT_ID = origAccount;

      assert(syncRes.status === 200, `Admin sync should succeed with 200, got ${syncRes.status}`);
      const data = await syncRes.json();
      assert(data.success === true, 'Response success must be true');
      assert(data.summary !== undefined, 'Response must include summary');
      assert(data.summary.fetched === 1, 'Summary fetched should be 1');
      assert(data.summary.inserted === 1, 'Summary inserted should be 1');
      assert(data.apiKey === undefined, 'No API key should be in response');
      assert(data.leads === undefined, 'Raw lead records should not be returned');

      console.log('✔ Test 11 Passed: Admin sync request succeeds with mocked Windsor response');
    }

    // =========================================================================
    // TEST 12: Safe behavior when Windsor returns an empty array
    // =========================================================================
    {
      const countBefore = await Lead.countDocuments({ accountId: testAccountId });

      const mockEmpty = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      const summaryEmpty = await syncFacebookLeads({
        overrideEnv: testEnv,
        fetchFn: mockEmpty,
      });

      assert(summaryEmpty.fetched === 0, 'Fetched should be 0');
      assert(summaryEmpty.inserted === 0, 'Inserted should be 0');
      assert(summaryEmpty.updated === 0, 'Updated should be 0');
      assert(summaryEmpty.skipped === 0, 'Skipped should be 0');
      assert(summaryEmpty.failed === 0, 'Failed should be 0');

      // Verify no leads deleted
      const countAfter = await Lead.countDocuments({ accountId: testAccountId });
      assert(countAfter === countBefore, `Lead count must remain identical (${countBefore}), not delete any leads`);

      console.log('✔ Test 12 Passed: Safe behavior when Windsor returns an empty array (no deletions)');
    }

    console.log('\n=== All 12 Windsor.ai Integration & Lead Ingestion Tests Passed Successfully! ===\n');
  } finally {
    // Cleanup fixtures
    if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
    if (testSales) await User.deleteOne({ _id: testSales._id });
    await Lead.deleteMany({ accountId: testAccountId });
    console.log('[Cleanup] Test fixtures removed from database.');

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Cleanup] Test server stopped.');
    }
    await disconnectDB();
    console.log('[Database] MongoDB connection closed.');
  }
}

runTests().catch((err) => {
  console.error('\n✖ Test Suite Failed:');
  console.error(err);
  if (server) server.close();
  disconnectDB().finally(() => process.exit(1));
});
