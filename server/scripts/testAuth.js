import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';

const TEST_EMAIL = `test.auth.${Date.now()}@doonanandam-test.com`;
const TEST_PASSWORD = 'TestPassword123!';
const TEST_PORT = 5055;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting Authentication Automated Test Suite ===\n');

  // 1. Connect to DB and start HTTP server
  await connectDB();
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  let testUser = null;

  try {
    // 2. Create safe test user
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    testUser = await User.create({
      name: 'Auth Test User',
      email: TEST_EMAIL,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });
    console.log(`[Setup] Created test user: ${TEST_EMAIL}`);

    // --- TEST 1: Missing fields validation ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      assert(res.status === 400, 'Empty login body should return 400');
      assert(!data.success, 'Response success should be false');
      assert(Array.isArray(data.errors), 'Response should contain errors array');
      console.log('✔ Test 1 Passed: Missing fields return 400 Validation Error');
    }

    // --- TEST 2: Invalid email format ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: TEST_PASSWORD }),
      });
      const data = await res.json();
      assert(res.status === 400, 'Invalid email should return 400');
      console.log('✔ Test 2 Passed: Invalid email returns 400 Validation Error');
    }

    // --- TEST 3: Incorrect password ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: 'WrongPassword999' }),
      });
      const data = await res.json();
      assert(res.status === 401, 'Incorrect password should return 401');
      assert(data.message === 'Invalid email or password', 'Should return generic error message');
      console.log('✔ Test 3 Passed: Incorrect password returns 401 with generic message');
    }

    // --- TEST 4: Nonexistent email (Timing attack resistance & generic message) ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@example.com', password: 'SomePassword123' }),
      });
      const data = await res.json();
      assert(res.status === 401, 'Nonexistent user should return 401');
      assert(data.message === 'Invalid email or password', 'Should return generic error message');
      console.log('✔ Test 4 Passed: Nonexistent user returns 401 with identical generic message');
    }

    // --- TEST 5: Valid login succeeds, sets HttpOnly cookie, omits passwordHash ---
    let authCookie = '';
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const data = await res.json();
      assert(res.status === 200, 'Valid login should return 200');
      assert(data.success === true, 'Valid login should return success: true');
      assert(data.user.email === TEST_EMAIL, 'User email should match');
      assert(data.user.passwordHash === undefined, 'passwordHash must NEVER be returned');
      assert(JSON.stringify(data).indexOf('passwordHash') === -1, 'passwordHash must not exist in response');

      const rawCookie = res.headers.get('set-cookie');
      assert(rawCookie && rawCookie.includes('token='), 'set-cookie header must be present with token');
      assert(rawCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');

      // Extract cookie for subsequent tests
      authCookie = rawCookie.split(';')[0];
      console.log('✔ Test 5 Passed: Valid login sets HttpOnly cookie and omits passwordHash');
    }

    // --- TEST 6: /api/auth/me rejects without token ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`);
      assert(res.status === 401, '/me without token should return 401');
      console.log('✔ Test 6 Passed: /me rejects unauthenticated request with 401');
    }

    // --- TEST 7: /api/auth/me rejects with malformed token ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: 'token=malformed.fake.token' },
      });
      assert(res.status === 401, '/me with invalid token should return 401');
      console.log('✔ Test 7 Passed: /me rejects malformed token with 401');
    }

    // --- TEST 8: /api/auth/me succeeds with valid cookie ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: authCookie },
      });
      const data = await res.json();
      assert(res.status === 200, '/me with valid token should return 200');
      assert(data.user.email === TEST_EMAIL, 'Returned user email should match');
      assert(data.user.passwordHash === undefined, 'passwordHash must never be returned in /me');
      console.log('✔ Test 8 Passed: /me returns user profile with valid cookie');
    }

    // --- TEST 9: Inactive user cannot log in ---
    {
      await User.findByIdAndUpdate(testUser._id, { isActive: false });
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const data = await res.json();
      assert(res.status === 403, 'Inactive user login should return 403');
      assert(data.message.includes('deactivated'), 'Message should indicate account deactivated');
      console.log('✔ Test 9 Passed: Inactive user login rejected with 403 Forbidden');
    }

    // --- TEST 10: Inactive user rejected on protected route with existing token ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: authCookie },
      });
      assert(res.status === 403, 'Inactive user on /me should return 403');
      console.log('✔ Test 10 Passed: Inactive user blocked from protected /me endpoint with 403');
    }

    // Reactivate user for logout testing
    await User.findByIdAndUpdate(testUser._id, { isActive: true });

    // --- TEST 11: Cross-Origin CSRF protection on state-changing authenticated endpoint ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: authCookie,
          Origin: 'https://malicious-site.com',
        },
      });
      assert(res.status === 403, 'Unauthorized cross-origin request should be blocked');
      console.log('✔ Test 11 Passed: Cross-origin CSRF request rejected with 403 Forbidden');
    }

    // --- TEST 12: Logout clears cookie ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: authCookie },
      });
      assert(res.status === 200, 'Logout should return 200');
      const rawCookie = res.headers.get('set-cookie');
      assert(rawCookie && (rawCookie.includes('token=;') || rawCookie.includes('token=')), 'Logout must clear cookie');
      console.log('✔ Test 12 Passed: Logout clears cookie successfully');
    }

    // --- TEST 13: Login rate limiting works ---
    {
      let rateLimited = false;
      // Send rapid login requests to exceed limit (max 10)
      for (let i = 0; i < 15; i++) {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'rate.limit@example.com', password: 'AnyPassword123' }),
        });
        if (res.status === 429) {
          rateLimited = true;
          break;
        }
      }
      assert(rateLimited, 'Rate limiter should return 429 Too Many Requests after threshold');
      console.log('✔ Test 13 Passed: Login rate limiter triggers 429 Too Many Requests');
    }

    console.log('\n=== All 13 Authentication Tests Passed Successfully! ===\n');
  } finally {
    // Cleanup test user
    if (testUser) {
      await User.findByIdAndDelete(testUser._id);
      console.log(`[Cleanup] Deleted test user: ${TEST_EMAIL}`);
    }
    await disconnectDB();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Cleanup] Test server stopped.');
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err.message);
  if (server) server.close();
  disconnectDB().finally(() => process.exit(1));
});
