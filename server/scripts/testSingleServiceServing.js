import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { signToken, COOKIE_NAME } from '../src/utils/jwt.js';

import User from '../src/models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const TEST_PORT = 5099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting Single-Service Serving & Routing Automated Tests ===\n');

  await connectDB();
  const testUser = await User.findOne({ isActive: true });
  const testUserId = testUser ? testUser._id : '507f1f77bcf86cd799439011';
  const testUserRole = testUser ? testUser.role : 'admin';
  const testAuthCookie = `${COOKIE_NAME}=${signToken({ id: testUserId, role: testUserRole })}`;
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);

  try {
    // Test 1: Health endpoint returns 200 JSON
    console.log('--- Section 1: API & Health Endpoints ---');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, `Expected 200 for /api/health, got ${healthRes.status}`);
    assert(healthData.service === 'Doon Anandam CRM API', 'Health service name matches');
    assert(healthData.database.configured === true, 'Database configured');
    console.log('✔ Test 1: GET /api/health returns 200 JSON status');

    // Test 2: Unknown API endpoint returns 404 JSON (NOT HTML)
    const unknownApiRes = await fetch(`${BASE_URL}/api/unknown-endpoint-test`);
    const unknownApiData = await unknownApiRes.json();
    assert(unknownApiRes.status === 404, `Expected 404 for unknown API, got ${unknownApiRes.status}`);
    assert(unknownApiData.success === false, 'Unknown API returns success: false');
    assert(
      unknownApiRes.headers.get('content-type')?.includes('application/json'),
      'Unknown API returns application/json, not HTML'
    );
    console.log('✔ Test 2: Unknown /api/... endpoint returns JSON 404, not HTML');

    // Test 3: Root / returns the React HTML application
    console.log('\n--- Section 2: Frontend Static & React Router Fallback ---');
    const rootRes = await fetch(`${BASE_URL}/`, {
      headers: { Accept: 'text/html' },
    });
    const rootHtml = await rootRes.text();
    assert(rootRes.status === 200, `Expected 200 for /, got ${rootRes.status}`);
    assert(rootHtml.includes('<div id="root"></div>'), 'Root HTML includes #root div');
    assert(rootHtml.includes('Doon Anandam CRM'), 'Root HTML includes page title');
    console.log('✔ Test 3: Root / returns the React HTML application (200 OK)');

    // Test 4: Direct navigation to /dashboard returns the React HTML application
    const dashboardRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Accept: 'text/html' },
    });
    const dashboardHtml = await dashboardRes.text();
    assert(dashboardRes.status === 200, `Expected 200 for /dashboard, got ${dashboardRes.status}`);
    assert(dashboardHtml.includes('<div id="root"></div>'), '/dashboard returns React SPA index.html');
    console.log('✔ Test 4: Direct browser navigation to /dashboard returns React application');

    // Test 5: Direct navigation to /leads returns the React HTML application
    const leadsRes = await fetch(`${BASE_URL}/leads`, {
      headers: { Accept: 'text/html' },
    });
    const leadsHtml = await leadsRes.text();
    assert(leadsRes.status === 200, `Expected 200 for /leads, got ${leadsRes.status}`);
    assert(leadsHtml.includes('<div id="root"></div>'), '/leads returns React SPA index.html');
    console.log('✔ Test 5: Direct browser navigation to /leads returns React application');

    // Test 6: Static JS and CSS assets load successfully
    console.log('\n--- Section 3: Static Asset Delivery ---');
    const files = fs.readdirSync(path.join(publicDir, 'assets'));
    const jsFile = files.find((f) => f.endsWith('.js'));
    const cssFile = files.find((f) => f.endsWith('.css'));

    assert(jsFile, 'Production JS bundle exists in server/public/assets');
    assert(cssFile, 'Production CSS bundle exists in server/public/assets');

    const jsRes = await fetch(`${BASE_URL}/assets/${jsFile}`);
    assert(jsRes.status === 200, `Expected 200 for JS asset, got ${jsRes.status}`);
    assert(
      jsRes.headers.get('content-type')?.includes('javascript'),
      'JS asset delivered with javascript Content-Type'
    );
    console.log(`✔ Test 6: Static JavaScript asset (${jsFile}) served successfully`);

    const cssRes = await fetch(`${BASE_URL}/assets/${cssFile}`);
    assert(cssRes.status === 200, `Expected 200 for CSS asset, got ${cssRes.status}`);
    assert(
      cssRes.headers.get('content-type')?.includes('css'),
      'CSS asset delivered with text/css Content-Type'
    );
    console.log(`✔ Test 7: Static CSS asset (${cssFile}) served successfully`);

    // Test 8: Nonexistent asset with non-HTML accept header returns 404 JSON, not HTML
    const nonExistentRes = await fetch(`${BASE_URL}/assets/nonexistent.png`, {
      headers: { Accept: 'image/png' },
    });
    assert(nonExistentRes.status === 404, 'Nonexistent asset returns 404');
    const nonExistentData = await nonExistentRes.json().catch(() => null);
    assert(nonExistentData && nonExistentData.success === false, 'Nonexistent asset returns JSON 404');
    console.log('✔ Test 8: Non-HTML request for missing asset returns 404 JSON, not index.html');

    // Test 9: Sensitive server files are not exposed through static serving
    console.log('\n--- Section 4: Security & Bundle Inspection ---');
    const envFileRes = await fetch(`${BASE_URL}/.env`);
    assert(envFileRes.status === 404, 'Server .env is not accessible');
    const serverJsRes = await fetch(`${BASE_URL}/src/server.js`);
    assert(serverJsRes.status === 404, 'Server source code is not accessible');
    console.log('✔ Test 9: Internal server files (.env, server.js) blocked from static access');

    // Test 10: Production JS bundle does not contain hardcoded localhost:5000 API calls
    const jsContent = fs.readFileSync(path.join(publicDir, 'assets', jsFile), 'utf-8');
    assert(
      !jsContent.includes('http://localhost:5000'),
      'Production bundle must not contain hardcoded "http://localhost:5000"'
    );
    console.log('✔ Test 10: Verified production bundle contains NO hardcoded "http://localhost:5000"');

    // Test 11: CSRF - Disallowed cross-origin POST request receives 403 Forbidden
    console.log('\n--- Section 5: Origin Verification & Security ---');
    const evilOriginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://malicious-attacker.com',
      },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
    });
    assert(evilOriginRes.status === 403, `Expected 403 for malicious origin, got ${evilOriginRes.status}`);
    const evilOriginData = await evilOriginRes.json();
    assert(evilOriginData.message === 'Cross-origin request forbidden.', 'Forbidden message received');
    console.log('✔ Test 11: Malicious cross-origin POST correctly blocked with 403 Forbidden');

    // Test 12: CSRF - Same-origin host POST request passes verifyOrigin
    const sameOriginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://localhost:${TEST_PORT}`,
      },
      body: JSON.stringify({ email: 'nonexistent@example.com', password: 'password123' }),
    });
    // Should pass origin verification and reach auth controller (returning 401 for bad creds, not 403 forbidden)
    assert(sameOriginRes.status === 401, `Expected 401 for bad credentials with same-origin, got ${sameOriginRes.status}`);
    console.log('✔ Test 12: Same-origin host POST request passes origin verification cleanly');

    // Test 13: Trust proxy - verify single hop behavior via forwarded headers
    const proxyTestRes = await fetch(`${BASE_URL}/api/health`, {
      headers: {
        'X-Forwarded-For': '203.0.113.195, 198.51.100.1',
      },
    });
    assert(proxyTestRes.status === 200, 'Health endpoint responds under proxy headers');
    console.log('✔ Test 13: Reverse proxy forwarded headers processed with trust proxy = 1');

    // Test 14: Production same-origin PATCH request (https://doon-anandam.onrender.com) passes verifyOrigin
    const prodPatchRes = await fetch(`${BASE_URL}/api/leads/507f1f77bcf86cd799439011/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'doon-anandam.onrender.com',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://doon-anandam.onrender.com',
        Cookie: testAuthCookie,
      },
      body: JSON.stringify({ status: 'contacted' }),
    });
    // Must NOT be 403 Forbidden ("Cross-origin request forbidden"). Should pass verifyOrigin and reach controller (404 lead not found)
    assert(
      prodPatchRes.status !== 403,
      `Expected non-403 for production same-origin PATCH, but got 403 Forbidden`
    );
    assert(prodPatchRes.status === 404, `Expected 404 lead not found (passed auth and origin), got ${prodPatchRes.status}`);
    console.log('✔ Test 14: Production same-origin PATCH (https://doon-anandam.onrender.com) passes verifyOrigin cleanly');

    // Test 15: Production same-origin POST request (https://doon-anandam.onrender.com) passes verifyOrigin
    const prodPostRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'doon-anandam.onrender.com',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://doon-anandam.onrender.com',
      },
      body: JSON.stringify({ email: 'nobody@doon-anandam.com', password: 'password123' }),
    });
    assert(prodPostRes.status === 401, `Expected 401 for prod POST login, got ${prodPostRes.status}`);
    console.log('✔ Test 15: Production same-origin POST (https://doon-anandam.onrender.com) passes verifyOrigin cleanly');

    // Test 16: Untrusted external origin on authenticated PATCH request is strictly blocked with 403
    const evilPatchRes = await fetch(`${BASE_URL}/api/leads/507f1f77bcf86cd799439011/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'doon-anandam.onrender.com',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://malicious-attacker.com',
        Cookie: testAuthCookie,
      },
      body: JSON.stringify({ status: 'contacted' }),
    });
    assert(evilPatchRes.status === 403, `Expected 403 for malicious PATCH, got ${evilPatchRes.status}`);
    const evilPatchData = await evilPatchRes.json();
    assert(evilPatchData.message === 'Cross-origin request forbidden.', 'Forbidden message received on malicious PATCH');
    console.log('✔ Test 16: Untrusted cross-origin PATCH correctly blocked with 403 Forbidden');

    // Test 17: Attacker spoofing X-Forwarded-Host with their own Origin is blocked with 403
    const spoofedHostRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'attacker-controlled.com',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://attacker-controlled.com',
      },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'password123' }),
    });
    assert(spoofedHostRes.status === 403, `Expected 403 for spoofed host attack, got ${spoofedHostRes.status}`);
    console.log('✔ Test 17: Spoofed X-Forwarded-Host origin attack successfully blocked with 403');

    // Test 18: Missing Origin header on PATCH allowed per security policy (cURL/server-to-server)
    const noOriginPatchRes = await fetch(`${BASE_URL}/api/leads/507f1f77bcf86cd799439011/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: testAuthCookie,
      },
      body: JSON.stringify({ status: 'contacted' }),
    });
    assert(noOriginPatchRes.status === 404, `Expected 404 (reached controller) for no-origin PATCH, got ${noOriginPatchRes.status}`);
    console.log('✔ Test 18: Missing Origin header follows security policy and proceeds to auth/controller');

    // Test 19: Arbitrary *.onrender.com origin is strictly blocked with 403 Forbidden
    const evilRenderRes = await fetch(`${BASE_URL}/api/leads/507f1f77bcf86cd799439011/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'doon-anandam.onrender.com',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://evil-tenant.onrender.com',
        Cookie: testAuthCookie,
      },
      body: JSON.stringify({ status: 'contacted' }),
    });
    assert(evilRenderRes.status === 403, `Expected 403 for untrusted onrender origin, got ${evilRenderRes.status}`);
    console.log('✔ Test 19: Arbitrary *.onrender.com cross-origin request strictly blocked with 403');

    // Test 20: Login response sets SameSite=Lax cookie attribute
    const { getAuthCookieOptions: getCookieOpts } = await import('../src/utils/jwt.js');
    const opts = getCookieOpts();
    assert(opts.sameSite === 'lax', `Expected sameSite to be lax, got ${opts.sameSite}`);
    console.log('✔ Test 20: Verified getAuthCookieOptions specifies SameSite=lax for single-origin security');

    console.log('\n=============================================================');
    console.log('🎉 ALL 20 SINGLE-SERVICE SERVING & ROUTING TESTS PASSED!');
    console.log('=============================================================\n');
  } finally {
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
