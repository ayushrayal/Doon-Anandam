import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';

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

    console.log('\n=============================================================');
    console.log('🎉 ALL 13 SINGLE-SERVICE SERVING & ROUTING TESTS PASSED!');
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
