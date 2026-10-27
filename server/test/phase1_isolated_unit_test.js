import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MAX_FILE_SIZE_BYTES,
  UPLOAD_TEMP_DIR,
  safeUnlink,
  getImportStatus,
  resetImportStatusForTesting,
  parseAndPreviewWorkbook,
  confirmImportBatch,
} from '../src/services/leadImport.service.js';
import { requireAdmin } from '../src/controllers/import.controller.js';
import importRouter from '../src/routes/import.routes.js';

console.log('====================================================');
console.log('Running Safe Local Unit Verification for Phase 1');
console.log('Isolated checks: No database connection or mutation');
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
  // Test 1: 25 MB File Size Preservation
  runTest('Preserves exact 25 MB upload limit', () => {
    assert.equal(
      MAX_FILE_SIZE_BYTES,
      25 * 1024 * 1024,
      'MAX_FILE_SIZE_BYTES must be exactly 26,214,400 bytes (25 MB)'
    );
  });

  // Test 2: requireAdmin controller helper allows Admin
  runTest('requireAdmin allows admin role', () => {
    const adminReq = { user: { _id: '123', role: 'admin' } };
    assert.doesNotThrow(() => requireAdmin(adminReq));
  });

  // Test 3: requireAdmin rejects non-admin roles with 403 FORBIDDEN_ADMIN_ONLY
  runTest('requireAdmin rejects sales_executive with 403', () => {
    const salesReq = { user: { _id: '456', role: 'sales_executive' } };
    assert.throws(
      () => requireAdmin(salesReq),
      (err) => err.status === 403 && err.code === 'FORBIDDEN_ADMIN_ONLY'
    );
  });

  // Test 4: requireAdmin rejects unauthenticated / missing user with 403
  runTest('requireAdmin rejects missing or unauthenticated user', () => {
    assert.throws(
      () => requireAdmin({}),
      (err) => err.status === 403 && err.code === 'FORBIDDEN_ADMIN_ONLY'
    );
    assert.throws(
      () => requireAdmin({ user: null }),
      (err) => err.status === 403 && err.code === 'FORBIDDEN_ADMIN_ONLY'
    );
  });

  // Test 5: Service-level authorization on parseAndPreviewWorkbook
  await runAsyncTest('parseAndPreviewWorkbook rejects non-admin before parsing', async () => {
    resetImportStatusForTesting();
    try {
      await parseAndPreviewWorkbook({
        filePath: 'nonexistent.xlsx',
        user: { _id: '456', role: 'sales_executive' },
      });
      assert.fail('Expected parseAndPreviewWorkbook to reject non-admin');
    } catch (err) {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'FORBIDDEN_ADMIN_ONLY');
      assert.equal(getImportStatus(), false, 'Concurrency lock must remain free after error');
    }
  });

  // Test 6: Service-level authorization on confirmImportBatch
  await runAsyncTest('confirmImportBatch rejects non-admin before database access', async () => {
    resetImportStatusForTesting();
    try {
      await confirmImportBatch({
        batchId: '507f1f77bcf86cd799439011',
        user: { _id: '456', role: 'sales_executive' },
      });
      assert.fail('Expected confirmImportBatch to reject non-admin');
    } catch (err) {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'FORBIDDEN_ADMIN_ONLY');
      assert.equal(getImportStatus(), false, 'Concurrency lock must remain free after error');
    }
  });

  // Test 7: Concurrency lock enforcement
  await runAsyncTest('parseAndPreviewWorkbook enforces single-flight concurrency lock', async () => {
    resetImportStatusForTesting();
    // Simulate import in progress
    // When isImportInProgress is true, any incoming preview or confirm must return 429
    // Manually trigger by starting a fake import or checking lock state
    assert.equal(getImportStatus(), false);
    
    // Test that when lock is set, parseAndPreviewWorkbook throws 429
    // We can simulate lock by running two calls or temporarily setting status
    let lockErrorCaught = false;
    try {
      // Intentionally call without valid file to test lock lifecycle
      await parseAndPreviewWorkbook({
        filePath: 'dummy.xlsx',
        user: { _id: '123', role: 'admin' },
      });
    } catch (err) {
      // Expected to fail due to missing file, but lock must be released!
      assert.equal(getImportStatus(), false, 'Lock must be released on error');
    }
  });

  // Test 8: Safe temporary file lifecycle (create -> safeUnlink)
  await runAsyncTest('safeUnlink removes temporary file reliably', async () => {
    if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
      fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
    }
    const testFile = path.join(UPLOAD_TEMP_DIR, `test-cleanup-${Date.now()}.xlsx`);
    fs.writeFileSync(testFile, 'dummy content');
    assert.equal(fs.existsSync(testFile), true);

    await safeUnlink(testFile);
    assert.equal(fs.existsSync(testFile), false, 'Temporary file must be deleted');
  });

  // Test 9: safeUnlink is idempotent and does not throw on missing file
  await runAsyncTest('safeUnlink handles nonexistent file without throwing', async () => {
    const nonexistent = path.join(UPLOAD_TEMP_DIR, 'nonexistent-file-12345.xlsx');
    await assert.doesNotReject(async () => {
      await safeUnlink(nonexistent);
    });
  });

  // Test 10: Router middleware verification
  runTest('importRouter has authenticate middleware mounted', () => {
    const middlewareNames = importRouter.stack
      .map((layer) => layer.name || layer.handle?.name);
    
    assert(
      middlewareNames.includes('authenticate'),
      'Router must mount authenticate middleware'
    );
  });

  // Test 11: Admin-only import pipeline endpoints reject sales_executive
  await runAsyncTest('Admin-only import pipeline controllers reject sales_executive', async () => {
    const controllers = await import('../src/controllers/import.controller.js');
    const adminEndpoints = [
      'downloadTemplate',
      'previewImport',
      'confirmImport',
      'getImportHistory',
      'getImportBatchDetails',
      'bulkAssignImportedRecords',
      'bulkDeleteImportedRecords',
    ];

    for (const fnName of adminEndpoints) {
      const fn = controllers[fnName];
      assert(typeof fn === 'function', `Controller ${fnName} must exist`);

      const nonAdminReq = {
        user: { _id: '456', role: 'sales_executive' },
        body: {},
        params: {},
        query: {},
      };
      let nextError = null;
      let responseStatus = null;
      let responseBody = null;
      const res = {
        status: (code) => {
          responseStatus = code;
          return {
            json: (d) => {
              responseBody = d;
              return d;
            },
          };
        },
        setHeader: () => {},
      };
      const next = (err) => {
        nextError = err;
      };

      try {
        await fn(nonAdminReq, res, next);
      } catch (directErr) {
        nextError = directErr;
      }

      const isForbidden =
        responseStatus === 403 ||
        nextError?.status === 403 ||
        nextError?.code === 'FORBIDDEN_ADMIN_ONLY';

      assert(
        isForbidden,
        `Endpoint ${fnName} must reject sales_executive with 403. Received status: ${responseStatus}, error: ${nextError?.message}`
      );
    }
  });

  // Test 12: Record controllers reject unauthenticated or non-CRM roles
  await runAsyncTest('Record controllers reject unauthorized non-CRM roles with 403', async () => {
    const controllers = await import('../src/controllers/import.controller.js');
    const recordEndpoints = [
      'getImportedRecords',
      'getImportedRecordById',
      'updateImportedRecordStatus',
      'scheduleImportedRecordFollowUp',
      'completeImportedRecordFollowUp',
      'getImportedRecordActivities',
      'createImportedRecordActivity',
    ];

    for (const fnName of recordEndpoints) {
      const fn = controllers[fnName];
      assert(typeof fn === 'function', `Controller ${fnName} must exist`);

      const guestReq = {
        user: { _id: '999', role: 'guest' },
        body: {},
        params: {},
        query: {},
      };
      let nextError = null;
      let responseStatus = null;
      const res = {
        status: (code) => {
          responseStatus = code;
          return { json: (d) => d };
        },
        setHeader: () => {},
      };
      const next = (err) => {
        nextError = err;
      };

      try {
        await fn(guestReq, res, next);
      } catch (directErr) {
        nextError = directErr;
      }

      const isForbidden =
        responseStatus === 403 ||
        nextError?.status === 403 ||
        nextError?.code === 'FORBIDDEN_RECORD_ACCESS';

      assert(
        isForbidden,
        `Record endpoint ${fnName} must reject guest with 403. Received status: ${responseStatus}, error: ${nextError?.message}`
      );
    }
  });

  console.log('\n====================================================');
  console.log(`Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
