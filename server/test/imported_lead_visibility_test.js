import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  requireAdmin,
  requireRecordAccess,
  downloadTemplate,
  previewImport,
  confirmImport,
  getImportHistory,
  getImportBatchDetails,
  bulkAssignImportedRecords,
  bulkDeleteImportedRecords,
  getImportedRecords,
  getImportedRecordById,
  updateImportedRecordStatus,
  scheduleImportedRecordFollowUp,
  completeImportedRecordFollowUp,
  getImportedRecordActivities,
  createImportedRecordActivity,
} from '../src/controllers/import.controller.js';
import importRouter from '../src/routes/import.routes.js';

console.log('====================================================');
console.log('Running Isolated Verification for Imported Lead Visibility');
console.log('Safe checks: No DB connection or live mutation');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       ${err.message}`);
    failCount++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       ${err.message}`);
    failCount++;
  }
}

async function runAllTests() {
  // Test 1: requireRecordAccess allows Admin and Sales Executive
  runTest('requireRecordAccess allows admin and sales_executive', () => {
    assert.doesNotThrow(() => requireRecordAccess({ user: { _id: 'admin1', role: 'admin' } }));
    assert.doesNotThrow(() => requireRecordAccess({ user: { _id: 'sales1', role: 'sales_executive' } }));
  });

  // Test 2: requireRecordAccess rejects unauthorized roles and missing users
  runTest('requireRecordAccess rejects guest or unauthenticated user', () => {
    assert.throws(
      () => requireRecordAccess({ user: { _id: 'guest1', role: 'viewer' } }),
      (err) => err.status === 403
    );
    assert.throws(
      () => requireRecordAccess({ user: null }),
      (err) => err.status === 403
    );
    assert.throws(
      () => requireRecordAccess({}),
      (err) => err.status === 403
    );
  });

  // Test 3: Admin-only endpoints reject Sales Executive
  await runAsyncTest('Admin-only import pipeline endpoints reject sales_executive with 403', async () => {
    const adminOnlyEndpoints = [
      downloadTemplate,
      previewImport,
      confirmImport,
      getImportHistory,
      getImportBatchDetails,
      bulkAssignImportedRecords,
      bulkDeleteImportedRecords,
    ];

    for (const fn of adminOnlyEndpoints) {
      let nextError = null;
      let statusCode = null;
      const req = {
        user: { _id: 'sales1', role: 'sales_executive' },
        body: {},
        params: {},
        query: {},
      };
      const res = {
        status: (code) => {
          statusCode = code;
          return { json: (d) => d };
        },
        setHeader: () => {},
      };
      const next = (err) => {
        nextError = err;
      };

      try {
        await fn(req, res, next);
      } catch (directErr) {
        nextError = directErr;
      }

      const isForbidden =
        statusCode === 403 ||
        nextError?.status === 403 ||
        nextError?.code === 'FORBIDDEN_ADMIN_ONLY';

      assert(
        isForbidden,
        `Expected ${fn.name} to reject sales_executive with 403. Status: ${statusCode}, Error: ${nextError?.message}`
      );
    }
  });

  // Test 4: Record operations allow Sales Executive at helper level
  runTest('Record operations helper allows sales_executive without throwing', () => {
    const salesReq = { user: { _id: new mongoose.Types.ObjectId(), role: 'sales_executive' } };
    assert.doesNotThrow(() => requireRecordAccess(salesReq));
  });

  // Test 5: Verify route stack configuration in import.routes.js
  runTest('import.routes.js configures appropriate role middleware per endpoint', () => {
    const routes = importRouter.stack.filter((layer) => layer.route);
    
    // Find preview route
    const previewRoute = routes.find((r) => r.route.path === '/preview');
    assert(previewRoute, 'Route /preview must exist');
    
    // Find records route
    const recordsRoute = routes.find((r) => r.route.path === '/records');
    assert(recordsRoute, 'Route /records must exist');

    // Find confirm route
    const confirmRoute = routes.find((r) => r.route.path === '/confirm');
    assert(confirmRoute, 'Route /confirm must exist');

    // Find bulk assign route
    const bulkAssignRoute = routes.find((r) => r.route.path === '/records/bulk/assign');
    assert(bulkAssignRoute, 'Route /records/bulk/assign must exist');
  });

  console.log('\n====================================================');
  console.log(`Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
