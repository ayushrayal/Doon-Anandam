import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';

const TEST_PORT = 5057;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Starting User Management Automated Test Suite ===\n');

  await connectDB();
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });
  console.log(`[Test Server] Listening on port ${TEST_PORT}`);

  const timestamp = Date.now();
  const adminEmail = `test.admin.${timestamp}@example.com`;
  const salesEmail = `test.sales.${timestamp}@example.com`;
  const newSalesEmail = `test.created.${timestamp}@example.com`;
  const password = 'TestPassword123!';

  let testAdmin = null;
  let testSales = null;
  let createdUser = null;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Create test admin
    testAdmin = await User.create({
      name: 'Test Admin RBAC',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    // Create test sales executive
    testSales = await User.create({
      name: 'Test Sales Rep',
      email: salesEmail,
      passwordHash,
      role: 'sales_executive',
      isActive: true,
    });

    console.log('[Setup] Created test admin & sales executive fixtures');

    // --- TEST 1: Unauthenticated request rejected with 401 ---
    {
      const res = await fetch(`${BASE_URL}/api/users`);
      assert(res.status === 401, 'Unauthenticated /api/users should return 401');
      console.log('✔ Test 1 Passed: Unauthenticated request rejected with 401');
    }

    // --- TEST 2: Non-admin (Sales Executive) blocked with 403 ---
    let salesCookie = '';
    {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: salesEmail, password }),
      });
      salesCookie = loginRes.headers.get('set-cookie').split(';')[0];

      const res = await fetch(`${BASE_URL}/api/users`, {
        headers: { Cookie: salesCookie },
      });
      assert(res.status === 403, 'Non-admin should receive 403 Forbidden on /api/users');
      console.log('✔ Test 2 Passed: Non-admin receives 403 Forbidden on /api/users');
    }

    // --- Login as Admin for remaining tests ---
    let adminCookie = '';
    {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password }),
      });
      adminCookie = loginRes.headers.get('set-cookie').split(';')[0];
    }

    // --- TEST 3: Admin can list users with pagination ---
    {
      const res = await fetch(`${BASE_URL}/api/users?page=1&limit=5`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin should receive 200 on /api/users');
      assert(Array.isArray(data.users), 'Response should contain users array');
      assert(data.total >= 2, 'Total should be at least 2 users');
      assert(data.page === 1, 'Current page should be 1');
      assert(data.users.every((u) => u.passwordHash === undefined), 'passwordHash must never be exposed');
      console.log('✔ Test 3 Passed: Admin successfully listed users with pagination');
    }

    // --- TEST 4: Admin can fetch user stats ---
    {
      const res = await fetch(`${BASE_URL}/api/users/stats`, {
        headers: { Cookie: adminCookie },
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin should receive 200 on /api/users/stats');
      assert(typeof data.stats.total === 'number', 'Stats must include total count');
      assert(typeof data.stats.active === 'number', 'Stats must include active count');
      assert(typeof data.stats.inactive === 'number', 'Stats must include inactive count');
      console.log('✔ Test 4 Passed: Admin fetched accurate user statistics');
    }

    // --- TEST 5: Admin can create a new user ---
    {
      const res = await fetch(`${BASE_URL}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          name: 'New Executive',
          email: newSalesEmail,
          password: 'TemporaryPass123!',
          role: 'sales_executive',
        }),
      });
      const data = await res.json();
      assert(res.status === 201, 'User creation should return 201');
      assert(data.success === true, 'Success must be true');
      assert(data.user.email === newSalesEmail, 'Created user email must match');
      assert(data.user.passwordHash === undefined, 'passwordHash must not be returned');
      createdUser = data.user;
      console.log('✔ Test 5 Passed: Admin created a new user with safe response');
    }

    // --- TEST 6: Duplicate email creation is rejected with 409 ---
    {
      const res = await fetch(`${BASE_URL}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          name: 'Duplicate Executive',
          email: newSalesEmail,
          password: 'TemporaryPass123!',
          role: 'sales_executive',
        }),
      });
      assert(res.status === 409, 'Duplicate email must return 409 Conflict');
      console.log('✔ Test 6 Passed: Duplicate email creation prevented with 409 Conflict');
    }

    // --- TEST 7: Admin can edit permitted user details ---
    {
      const res = await fetch(`${BASE_URL}/api/users/${createdUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          name: 'Updated Executive Name',
        }),
      });
      const data = await res.json();
      assert(res.status === 200, 'User update should return 200');
      assert(data.user.name === 'Updated Executive Name', 'Name should be updated');
      console.log('✔ Test 7 Passed: Admin updated user details successfully');
    }

    // --- TEST 8: Self-deactivation guard blocks Admin from deactivating own account ---
    {
      const res = await fetch(`${BASE_URL}/api/users/${testAdmin._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ isActive: false }),
      });
      const data = await res.json();
      assert(res.status === 400, 'Self-deactivation must return 400 Bad Request');
      assert(data.message.includes('cannot deactivate your own'), 'Message should indicate self-deactivation guard');
      console.log('✔ Test 8 Passed: Self-deactivation guard prevented Admin from locking themselves out');
    }

    // --- TEST 9: Admin can deactivate a user ---
    {
      const res = await fetch(`${BASE_URL}/api/users/${createdUser.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ isActive: false }),
      });
      const data = await res.json();
      assert(res.status === 200, 'Status update should return 200');
      assert(data.user.isActive === false, 'User status should be inactive');
      console.log('✔ Test 9 Passed: Admin deactivated user account');
    }

    // --- TEST 10: Deactivated user cannot log in ---
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newSalesEmail, password: 'TemporaryPass123!' }),
      });
      assert(res.status === 403, 'Deactivated user login must return 403');
      console.log('✔ Test 10 Passed: Deactivated user blocked from authenticating');
    }

    // --- TEST 11: Admin can reactivate the user ---
    {
      const res = await fetch(`${BASE_URL}/api/users/${createdUser.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ isActive: true }),
      });
      const data = await res.json();
      assert(res.status === 200, 'Reactivation should return 200');
      assert(data.user.isActive === true, 'User status should be active');
      console.log('✔ Test 11 Passed: Admin reactivated user account');
    }

    console.log('\n=== All 11 User Management Tests Passed Successfully! ===\n');
  } finally {
    // Cleanup test fixtures safely
    if (testAdmin) await User.findByIdAndDelete(testAdmin._id);
    if (testSales) await User.findByIdAndDelete(testSales._id);
    if (createdUser) await User.findByIdAndDelete(createdUser.id);
    console.log('[Cleanup] Test fixtures removed from database.');

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
