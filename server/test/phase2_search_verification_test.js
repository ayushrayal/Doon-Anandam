import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildLeadQueryFilter } from '../src/controllers/lead.controller.js';
import { getImportedRecords } from '../src/controllers/import.controller.js';

console.log('====================================================');
console.log('Running Isolated Verification for Phase 2: Simplified Search');
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
  const mockAdmin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
  const mockSalesExec = { _id: new mongoose.Types.ObjectId(), role: 'sales_executive' };

  // ---------------------------------------------------------
  // 1. Regular Leads Pipeline: buildLeadQueryFilter Search Query
  // ---------------------------------------------------------

  await runAsyncTest('Regular Leads: search query matches ONLY fullName and phoneNumber', async () => {
    const { filter } = await buildLeadQueryFilter({ search: 'Ayush' }, mockAdmin);
    assert(filter.$or, 'filter.$or must exist when search is supplied');
    assert.equal(filter.$or.length, 2, 'filter.$or must contain exactly 2 criteria (fullName, phoneNumber)');

    const matchedKeys = filter.$or.map((clause) => Object.keys(clause)[0]);
    assert(matchedKeys.includes('fullName'), 'Must match fullName');
    assert(matchedKeys.includes('phoneNumber'), 'Must match phoneNumber');
    assert(!matchedKeys.includes('email'), 'Must NOT match email');
    assert(!matchedKeys.includes('campaignName'), 'Must NOT match campaignName');
  });

  await runAsyncTest('Regular Leads: case-insensitive name matching and partial phone matching regex', async () => {
    const { filter } = await buildLeadQueryFilter({ search: 'RaYaL' }, mockAdmin);
    const nameClause = filter.$or.find((c) => c.fullName);
    const phoneClause = filter.$or.find((c) => c.phoneNumber);

    assert(nameClause.fullName instanceof RegExp, 'fullName must be a RegExp');
    assert(phoneClause.phoneNumber instanceof RegExp, 'phoneNumber must be a RegExp');

    // Case-insensitivity
    assert(nameClause.fullName.flags.includes('i'), 'RegExp must have case-insensitive flag');

    // Test matching against realistic values
    assert.equal(nameClause.fullName.test('Ayush Rayal'), true, 'Matches full name with mixed case');
    assert.equal(nameClause.fullName.test('rayal'), true, 'Matches partial lowercase');
    assert.equal(nameClause.fullName.test('Sanjay Sharma'), false, 'Does not match unrelated name');

    // Partial phone matching
    const { filter: phoneFilter } = await buildLeadQueryFilter({ search: '98765' }, mockAdmin);
    const phoneRegex = phoneFilter.$or.find((c) => c.phoneNumber).phoneNumber;
    assert.equal(phoneRegex.test('+91 9876543210'), true, 'Matches partial phone');
    assert.equal(phoneRegex.test('011-98765-000'), true, 'Matches formatted phone');
    assert.equal(phoneRegex.test('1234567890'), false, 'Does not match unrelated phone');
  });

  await runAsyncTest('Regular Leads: email and campaign terms do not match via email or campaign fields', async () => {
    const { filter } = await buildLeadQueryFilter({ search: 'user@example.com' }, mockAdmin);
    const queryFields = filter.$or.flatMap((clause) => Object.keys(clause));
    assert.deepEqual(queryFields.sort(), ['fullName', 'phoneNumber'].sort());
  });

  await runAsyncTest('Regular Leads: regex special characters safely escaped without throwing', async () => {
    const specialChars = '+91 (987) [654]*.*$^?{}|\\';
    assert.doesNotThrow(async () => {
      const { filter } = await buildLeadQueryFilter({ search: specialChars }, mockAdmin);
      const nameRegex = filter.$or.find((c) => c.fullName).fullName;
      assert(nameRegex instanceof RegExp);
      // Literal character match check
      assert.equal(nameRegex.test('+91 (987) [654]*.*$^?{}|\\'), true);
      assert.equal(nameRegex.test('Unrelated string'), false);
    });
  });

  await runAsyncTest('Regular Leads: preserves role scoping, account isolation, and existing filters', async () => {
    const { filter: salesFilter } = await buildLeadQueryFilter(
      { search: 'John', status: 'new', sortBy: 'fullName' },
      mockSalesExec
    );
    assert.equal(salesFilter.assignedTo, mockSalesExec._id, 'Sales executive must remain scoped to assignedTo');
    assert.equal(salesFilter.status, 'new', 'Status filter must be preserved');
    assert.equal(salesFilter.isDeleted.$ne, true, 'Soft deletion filter must be preserved');
    assert(salesFilter.$or, 'Search filter must coexist with role scoping');
  });

  // ---------------------------------------------------------
  // 2. Excel Imported Leads: getImportedRecords Search Query
  // ---------------------------------------------------------

  await runAsyncTest('Imported Leads: query filter contains ONLY fullName and phoneNumber', async () => {
    // Intercept Mongoose query by wrapping ImportedLead.countDocuments / find
    let capturedFilter = null;
    const mockReq = {
      user: mockAdmin,
      query: { search: 'Vijay', page: '1', limit: '10' },
    };
    const mockRes = {
      status: () => ({
        json: (data) => data,
      }),
    };
    const mockNext = (err) => {
      if (err) throw err;
    };

    // We can inspect the filter generated in getImportedRecords by importing ImportedLead model or mocking
    // Or inspect the function logic via a test harness
    const { default: ImportedLead } = await import('../src/models/ImportedLead.js');
    const origCount = ImportedLead.countDocuments;
    const origFind = ImportedLead.find;

    try {
      ImportedLead.countDocuments = (f) => {
        capturedFilter = f;
        return { maxTimeMS: () => Promise.resolve(0), then: (fn) => Promise.resolve(0).then(fn) };
      };
      ImportedLead.find = (f) => ({
        populate: () => ({
          populate: () => ({
            sort: () => ({
              skip: () => ({
                limit: () => ({
                  lean: () => Promise.resolve([]),
                }),
              }),
            }),
          }),
        }),
      });

      await getImportedRecords(mockReq, mockRes, mockNext);

      assert(capturedFilter, 'Must capture query filter');
      assert(capturedFilter.$or, 'capturedFilter.$or must exist');
      assert.equal(capturedFilter.$or.length, 2, 'filter.$or must contain exactly 2 criteria (fullName, phoneNumber)');

      const keys = capturedFilter.$or.map((c) => Object.keys(c)[0]);
      assert(keys.includes('fullName'), 'Must match fullName');
      assert(keys.includes('phoneNumber'), 'Must match phoneNumber');
      assert(!keys.includes('email'), 'Must NOT match email');
      assert(!keys.includes('campaignName'), 'Must NOT match campaignName');

      // Test case insensitivity and partial matching
      const nameRegex = capturedFilter.$or.find((c) => c.fullName).fullName;
      assert.equal(nameRegex.test('Vijay Kumar'), true);
      assert.equal(nameRegex.test('vijay'), true);
      assert.equal(nameRegex.test('Deepak'), false);
    } finally {
      ImportedLead.countDocuments = origCount;
      ImportedLead.find = origFind;
    }
  });

  await runAsyncTest('Imported Leads: Sales Executive search is strictly scoped to assigned records', async () => {
    let capturedFilter = null;
    const mockReq = {
      user: mockSalesExec,
      query: { search: 'Ramesh', assignedTo: 'malicious_override_id' },
    };
    const mockRes = {
      status: () => ({ json: (d) => d }),
    };
    const mockNext = (err) => { if (err) throw err; };

    const { default: ImportedLead } = await import('../src/models/ImportedLead.js');
    const origCount = ImportedLead.countDocuments;
    const origFind = ImportedLead.find;

    try {
      ImportedLead.countDocuments = (f) => {
        capturedFilter = f;
        return Promise.resolve(0);
      };
      ImportedLead.find = () => ({
        populate: () => ({
          populate: () => ({
            sort: () => ({
              skip: () => ({
                limit: () => ({
                  lean: () => Promise.resolve([]),
                }),
              }),
            }),
          }),
        }),
      });

      await getImportedRecords(mockReq, mockRes, mockNext);

      assert(capturedFilter, 'Must capture filter');
      assert.equal(
        String(capturedFilter.assignedTo),
        String(mockSalesExec._id),
        'Sales Executive must be strictly scoped to their own _id, overriding any client query param'
      );
      assert.equal(capturedFilter.$or.length, 2);
    } finally {
      ImportedLead.countDocuments = origCount;
      ImportedLead.find = origFind;
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
  console.error('Fatal test error:', err);
  process.exit(1);
});
