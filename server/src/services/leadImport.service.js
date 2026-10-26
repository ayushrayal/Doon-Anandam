import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import ImportedLead from '../models/ImportedLead.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import ImportBatch from '../models/ImportBatch.js';
import { env } from '../config/env.js';
import { LEAD_STATUSES } from '../schemas/lead.schema.js';
import { sanitizeForExcel } from '../controllers/lead.controller.js';
import { invalidateAnalyticsCache } from '../controllers/analytics.controller.js';

export const MAX_IMPORT_ROWS = 2000;
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const PREVIEW_TTL_MINUTES = 30;

/**
 * Explicit dictionary of column header aliases for flexible spreadsheet mapping.
 */
export const HEADER_ALIASES = {
  fullName: [
    'full name',
    'name',
    'customer name',
    'lead name',
    'client name',
    'prospect name',
    'contact name',
  ],
  phoneNumber: [
    'phone number',
    'phone',
    'mobile number',
    'mobile',
    'contact number',
    'contact',
    'telephone',
    'cell',
  ],
  email: ['email address', 'email', 'e-mail', 'mail'],
  status: ['status', 'stage', 'lead status', 'pipeline status'],
  assignedTo: [
    'assigned executive',
    'assigned to',
    'executive',
    'sales executive',
    'agent',
    'representative',
    'rep',
    'owner',
  ],
  source: ['source', 'lead source', 'acquisition source', 'channel', 'medium'],
  campaignName: ['campaign name', 'campaign', 'ad campaign', 'project'],
  notes: ['notes', 'note', 'crm notes', 'comments', 'comment', 'description'],
  nextFollowUpDate: [
    'next follow up date',
    'next follow-up date',
    'follow up date',
    'follow-up date',
    'followup date',
    'reminder date',
    'next call date',
  ],
  nextFollowUpRemarks: [
    'follow up remarks',
    'follow-up remarks',
    'next follow up remarks',
    'followup remarks',
    'remarks',
    'call remarks',
  ],
  leadCreatedAt: [
    'created date',
    'date',
    'inquiry date',
    'lead date',
    'creation date',
    'timestamp',
    'created at',
  ],
  externalLeadId: ['external id', 'external lead id', 'lead id', 'id', 'reference id'],
};

/**
 * Normalizes phone numbers to standard digit strings for reliable duplicate detection.
 */
export function normalizePhoneForLookup(rawPhone) {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  // If 12 digits starting with 91 (India country code), retain national 10 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  // If 11 digits starting with 0, retain national 10 digits
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Maps spreadsheet cell values to canonical CRM lead status enums.
 */
export function mapStatusEnum(rawStatus) {
  if (!rawStatus || !String(rawStatus).trim()) {
    return 'new';
  }
  const s = String(rawStatus).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (s === 'new') return 'new';
  if (s === 'contacted') return 'contacted';
  if (s === 'followup' || s === 'follow_up') return 'follow_up';
  if (s === 'qualified') return 'qualified';
  if (s === 'lost') return 'lost';
  if (s === 'converted') return 'converted';
  return null; // Unrecognized status
}

/**
 * Parses raw cell value from ExcelJS (handles RichText, formula results, and dates).
 */
export function extractCellValue(cell) {
  if (cell === null || cell === undefined) return null;
  const val = cell.value;
  if (val === null || val === undefined) return null;

  if (val instanceof Date) {
    return val;
  }
  if (typeof val === 'object') {
    // ExcelJS RichText or Hyperlink or Formula
    if (val.result !== undefined) return String(val.result).trim();
    if (Array.isArray(val.richText)) {
      return val.richText.map((t) => t.text).join('').trim();
    }
    if (val.text !== undefined) return String(val.text).trim();
  }
  return String(val).trim();
}

/**
 * Parses an uploaded Excel buffer into a structured preview batch with validation & deduplication.
 */
export async function parseAndPreviewWorkbook({
  buffer,
  originalFilename,
  fileSizeBytes,
  user,
}) {
  const accountId = env.WINDSOR_ACCOUNT_ID;
  if (!accountId) {
    throw new Error('System account ID is not configured.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    const error = new Error('Invalid or corrupted Excel file. Please upload a valid .xlsx workbook.');
    error.status = 400;
    throw error;
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    const error = new Error('The uploaded spreadsheet is empty or missing data rows.');
    error.status = 400;
    throw error;
  }

  // 1. Analyze Header Row (Row 1)
  const headerRow = worksheet.getRow(1);
  const columnMapping = {}; // colNumber -> canonicalField
  const ignoredColumns = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const rawHeader = String(cell.value || '').trim().toLowerCase();
    let mappedField = null;

    for (const [canonicalField, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(rawHeader)) {
        mappedField = canonicalField;
        break;
      }
    }

    if (mappedField) {
      columnMapping[colNumber] = mappedField;
    } else if (rawHeader) {
      ignoredColumns.push(String(cell.value).trim());
    }
  });

  // Verify mandatory mapped columns: Full Name and Phone Number
  const mappedFields = Object.values(columnMapping);
  const missingRequired = [];
  if (!mappedFields.includes('fullName')) missingRequired.push('Full Name');
  if (!mappedFields.includes('phoneNumber')) missingRequired.push('Phone Number');

  if (missingRequired.length > 0) {
    const error = new Error(
      `Spreadsheet is missing required column(s): ${missingRequired.join(
        ', '
      )}. Please verify that your header row contains 'Full Name' and 'Phone Number'.`
    );
    error.status = 400;
    error.missingRequired = missingRequired;
    error.ignoredColumns = ignoredColumns;
    throw error;
  }

  // 2. Load active CRM users for assigned executive matching
  const activeUsers = await User.find({ isActive: true })
    .select('_id name email role')
    .lean();
  const userMapByName = new Map();
  const userMapByEmail = new Map();

  for (const u of activeUsers) {
    if (u.name) userMapByName.set(u.name.toLowerCase().trim(), u);
    if (u.email) userMapByEmail.set(u.email.toLowerCase().trim(), u);
  }

  // 3. First pass over rows to extract raw data and collect phones/emails for database duplicate queries
  const parsedRows = [];
  const phonesForDbCheck = new Set();
  const emailsForDbCheck = new Set();
  const seenPhonesInFile = new Map(); // normalizedPhone -> firstRowNumber

  let rowCount = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    // Skip entirely blank rows
    let hasData = false;
    row.eachCell({ includeEmpty: false }, () => {
      hasData = true;
    });
    if (!hasData) continue;

    rowCount++;
    if (rowCount > MAX_IMPORT_ROWS) {
      const error = new Error(
        `Import limit exceeded: Workbook has more than ${MAX_IMPORT_ROWS.toLocaleString()} data rows. Please divide the file into smaller batches.`
      );
      error.status = 400;
      throw error;
    }

    const rowData = {};
    for (const [colNumber, field] of Object.entries(columnMapping)) {
      const cell = row.getCell(Number(colNumber));
      rowData[field] = extractCellValue(cell);
    }

    parsedRows.push({
      rowNumber,
      rawData: rowData,
    });

    if (rowData.phoneNumber) {
      const normalized = normalizePhoneForLookup(rowData.phoneNumber);
      if (normalized) {
        phonesForDbCheck.add(normalized);
        phonesForDbCheck.add(String(rowData.phoneNumber).trim());
        if (normalized.length === 10) {
          phonesForDbCheck.add(`+91${normalized}`);
          phonesForDbCheck.add(`91${normalized}`);
          phonesForDbCheck.add(`0${normalized}`);
        }
      }
    }
    if (rowData.email && typeof rowData.email === 'string') {
      const em = rowData.email.trim().toLowerCase();
      if (em) emailsForDbCheck.add(em);
    }
  }

  if (parsedRows.length === 0) {
    const error = new Error('No valid data rows found in the spreadsheet.');
    error.status = 400;
    throw error;
  }

  // 4. Pre-fetch existing leads from database for duplicate verification
  const existingLeadsQuery = {
    accountId,
    $or: [],
  };
  if (phonesForDbCheck.size > 0) {
    existingLeadsQuery.$or.push({ phoneNumber: { $in: Array.from(phonesForDbCheck) } });
  }
  if (emailsForDbCheck.size > 0) {
    existingLeadsQuery.$or.push({ email: { $in: Array.from(emailsForDbCheck) } });
  }

  const existingLeadsMapByPhone = new Map();
  const existingLeadsMapByEmail = new Map();

  if (existingLeadsQuery.$or.length > 0) {
    const [existingLeadDocs, existingImportedDocs] = await Promise.all([
      Lead.find(existingLeadsQuery).select('_id fullName phoneNumber email').lean(),
      ImportedLead.find(existingLeadsQuery).select('_id fullName phoneNumber email').lean(),
    ]);

    const existingDocs = [...existingLeadDocs, ...existingImportedDocs];

    for (const doc of existingDocs) {
      if (doc.phoneNumber) {
        existingLeadsMapByPhone.set(doc.phoneNumber.trim(), doc);
        const norm = normalizePhoneForLookup(doc.phoneNumber);
        if (norm) existingLeadsMapByPhone.set(norm, doc);
      }
      if (doc.email) {
        existingLeadsMapByEmail.set(doc.email.toLowerCase().trim(), doc);
      }
    }
  }

  // 5. Generate Preview Batch ID
  const batchId = new mongoose.Types.ObjectId();
  const rows = [];
  let validCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  for (const { rowNumber, rawData } of parsedRows) {
    const rowErrors = [];
    let isDuplicate = false;
    let duplicateReason = '';

    // Field 1: Full Name (Required)
    const rawName = rawData.fullName ? String(rawData.fullName).trim() : '';
    if (!rawName) {
      rowErrors.push('Full Name is required.');
    } else if (rawName.length > 200) {
      rowErrors.push('Full Name cannot exceed 200 characters.');
    }

    // Field 2: Phone Number (Required & Validated)
    const rawPhone = rawData.phoneNumber ? String(rawData.phoneNumber).trim() : '';
    const normPhone = normalizePhoneForLookup(rawPhone);

    if (!rawPhone) {
      rowErrors.push('Phone Number is required.');
    } else if (normPhone.length < 10 || normPhone.length > 15) {
      rowErrors.push('Valid 10-15 digit phone number is required.');
    }

    // Field 3: Email Address (Optional)
    let email = null;
    if (rawData.email) {
      const em = String(rawData.email).trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(em)) {
        rowErrors.push('Invalid email address format.');
      } else if (em.length > 200) {
        rowErrors.push('Email address cannot exceed 200 characters.');
      } else {
        email = em;
      }
    }

    // Field 4: Status (Optional, Enum)
    let status = 'new';
    if (rawData.status) {
      const mapped = mapStatusEnum(rawData.status);
      if (!mapped) {
        rowErrors.push(
          `'${rawData.status}' is not a valid status. Allowed values: ${LEAD_STATUSES.join(', ')}.`
        );
      } else {
        status = mapped;
      }
    }

    // Field 5: Assigned Executive (Optional, Active User)
    let assignedTo = null;
    let assignedName = 'Unassigned';
    if (rawData.assignedTo !== undefined && rawData.assignedTo !== null) {
      const execStr = String(rawData.assignedTo).trim();
      const lowerExec = execStr.toLowerCase();

      // Blank, empty, or explicit unassigned aliases
      if (
        !execStr ||
        lowerExec === 'unassigned' ||
        lowerExec === 'none' ||
        lowerExec === '-' ||
        lowerExec === '--' ||
        lowerExec === 'n/a' ||
        lowerExec === 'na'
      ) {
        assignedTo = null;
        assignedName = 'Unassigned';
      } else {
        const matchedUser =
          userMapByEmail.get(lowerExec) ||
          userMapByName.get(lowerExec);

        if (!matchedUser) {
          rowErrors.push(`Assigned Executive '${execStr}' not found or inactive.`);
        } else {
          assignedTo = matchedUser._id;
          assignedName = matchedUser.name;
        }
      }
    }

    // Field 6: Source (Optional)
    let source = 'manual';
    if (rawData.source) {
      const src = String(rawData.source).trim().toLowerCase().replace(/\s+/g, '_');
      if (src) {
        source = src.slice(0, 60);
      }
    }

    // Field 7: Campaign Name (Optional)
    const campaignName = rawData.campaignName
      ? String(rawData.campaignName).trim().slice(0, 250)
      : '';

    // Field 8: Notes (Optional)
    const notes = rawData.notes
      ? String(rawData.notes).trim().slice(0, 2000)
      : '';

    // Field 9: Next Follow-Up Date & Remarks (Optional)
    let nextFollowUpDate = null;
    if (rawData.nextFollowUpDate) {
      const parsedDate = new Date(rawData.nextFollowUpDate);
      if (isNaN(parsedDate.getTime())) {
        rowErrors.push('Invalid next follow-up date.');
      } else {
        nextFollowUpDate = parsedDate;
      }
    }
    const nextFollowUpRemarks = rawData.nextFollowUpRemarks
      ? String(rawData.nextFollowUpRemarks).trim().slice(0, 500)
      : '';

    // Field 10: Created Date (Optional Historical Date)
    let leadCreatedAt = new Date();
    if (rawData.leadCreatedAt) {
      const parsedCreated = new Date(rawData.leadCreatedAt);
      if (!isNaN(parsedCreated.getTime())) {
        leadCreatedAt = parsedCreated;
      }
    }

    // Field 11: External Lead ID (Optional or Generated)
    let externalLeadId = rawData.externalLeadId
      ? String(rawData.externalLeadId).trim().slice(0, 120)
      : `imp_${batchId.toString().slice(-6)}_${rowNumber}`;

    // --- Deduplication Checks ---
    if (rowErrors.length === 0 && normPhone) {
      // 1. Check duplicate within file
      if (seenPhonesInFile.has(normPhone)) {
        isDuplicate = true;
        const priorRow = seenPhonesInFile.get(normPhone);
        duplicateReason = `Duplicate phone number within spreadsheet (matches row ${priorRow}).`;
      } else {
        seenPhonesInFile.set(normPhone, rowNumber);

        // 2. Check duplicate in database by phone
        const existingByPhone =
          existingLeadsMapByPhone.get(normPhone) ||
          existingLeadsMapByPhone.get(rawPhone);
        if (existingByPhone) {
          isDuplicate = true;
          duplicateReason = `Lead with phone number '${rawPhone}' already exists in CRM (Name: ${existingByPhone.fullName}).`;
        } else if (email && existingLeadsMapByEmail.has(email)) {
          // 3. Check duplicate in database by email
          const existingByEmail = existingLeadsMapByEmail.get(email);
          isDuplicate = true;
          duplicateReason = `Lead with email '${email}' already exists in CRM (Name: ${existingByEmail.fullName}).`;
        }
      }
    }

    const rowDoc = {
      rowNumber,
      data: {
        fullName: rawName,
        phoneNumber: rawPhone,
        email,
        status,
        assignedTo,
        assignedName,
        source,
        campaignName,
        notes,
        nextFollowUpDate,
        nextFollowUpRemarks,
        leadCreatedAt,
        externalLeadId,
      },
      status: rowErrors.length > 0 ? 'error' : isDuplicate ? 'duplicate' : 'valid',
      reason: isDuplicate ? duplicateReason : '',
      validationErrors: rowErrors,
      errors: rowErrors,
    };

    if (rowDoc.status === 'valid') validCount++;
    else if (rowDoc.status === 'duplicate') duplicateCount++;
    else errorCount++;

    rows.push(rowDoc);
  }

  // 6. Save batch in MongoDB with 30-minute expiry TTL
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60 * 1000);

  const importBatch = await ImportBatch.create({
    _id: batchId,
    accountId,
    uploadedBy: user._id,
    originalFilename,
    fileSizeBytes,
    status: 'preview',
    totalRows: parsedRows.length,
    validCount,
    duplicateCount,
    errorCount,
    ignoredColumns,
    summary: {
      totalRows: parsedRows.length,
      validCount,
      duplicateCount,
      errorCount,
    },
    rows,
    expiresAt,
  });

  return {
    batchId: importBatch._id.toString(),
    originalFilename,
    totalRows: parsedRows.length,
    validCount,
    duplicateCount,
    errorCount,
    ignoredColumns,
    expiresAt,
    // Return sample rows for UI preview (first 25 rows)
    previewRows: rows.slice(0, 25),
  };
}

/**
 * Atomically confirms an import batch, executes bulk write, records provenance, and creates activity records.
 */
export async function confirmImportBatch({ batchId, user }) {
  const accountId = env.WINDSOR_ACCOUNT_ID;
  if (!accountId) {
    throw new Error('System account ID is not configured.');
  }

  if (!mongoose.Types.ObjectId.isValid(batchId)) {
    const error = new Error('Invalid import batch ID format.');
    error.status = 400;
    throw error;
  }

  // 1. Atomic state transition: 'preview' -> 'processing' (ensures idempotency against double clicks)
  const batch = await ImportBatch.findOneAndUpdate(
    {
      _id: batchId,
      accountId,
      status: 'preview',
    },
    {
      $set: { status: 'processing' },
    },
    { new: true }
  );

  if (!batch) {
    const existing = await ImportBatch.findOne({ _id: batchId, accountId });
    if (existing && existing.status === 'completed') {
      const error = new Error('This import batch has already been processed and completed.');
      error.status = 409;
      error.code = 'BATCH_ALREADY_COMPLETED';
      throw error;
    }
    const error = new Error(
      'Import batch not found or preview session has expired. Please upload the file again.'
    );
    error.status = 404;
    throw error;
  }

  // 2. Filter valid rows
  const validRows = batch.rows.filter((r) => r.status === 'valid');

  if (validRows.length === 0) {
    await ImportBatch.updateOne(
      { _id: batch._id },
      { $set: { status: 'completed', expiresAt: null } }
    );
    return {
      batchId: batch._id.toString(),
      status: 'completed',
      insertedCount: 0,
      skippedCount: batch.duplicateCount,
      errorCount: batch.errorCount,
      message: 'No valid leads to import. All rows were either duplicates or had errors.',
    };
  }

  const leadsToInsert = [];
  const now = new Date();

  for (const row of validRows) {
    const d = row.data;
    leadsToInsert.push({
      accountId,
      importBatchId: batch._id,
      uploadedBy: user._id,
      fullName: d.fullName,
      phoneNumber: d.phoneNumber,
      email: d.email || null,
      status: d.status || 'new',
      assignedTo: d.assignedTo || null,
      source: d.source || 'manual',
      campaignName: d.campaignName || '',
      notes: d.notes || '',
      nextFollowUpDate: d.nextFollowUpDate || null,
      nextFollowUpRemarks: d.nextFollowUpRemarks || '',
      leadCreatedAt: d.leadCreatedAt || now,
      externalLeadId: d.externalLeadId || '',
    });
  }

  let insertedCount = 0;
  let failedCount = 0;
  const insertedLeads = [];

  try {
    // Unordered insert into dedicated ImportedLead collection (isolated from Meta/Windsor Leads)
    const insertResult = await ImportedLead.insertMany(leadsToInsert, {
      ordered: false,
      rawResult: true,
    });
    insertedCount = insertResult.insertedCount || Object.keys(insertResult.insertedIds || {}).length;

    // Collect inserted lead IDs for activity logs
    if (insertResult.insertedIds) {
      for (const idx of Object.keys(insertResult.insertedIds)) {
        insertedLeads.push({
          _id: insertResult.insertedIds[idx],
          assignedTo: leadsToInsert[Number(idx)]?.assignedTo,
        });
      }
    }
  } catch (bulkError) {
    if (bulkError.insertedDocs) {
      insertedCount = bulkError.insertedDocs.length;
      insertedLeads.push(...bulkError.insertedDocs);
    } else if (bulkError.result?.nInserted) {
      insertedCount = bulkError.result.nInserted;
    }
    failedCount = (bulkError.writeErrors?.length || 1);
  }

  // 3. Create initial Activity record for imported leads (Auditable Timeline)
  if (insertedLeads.length > 0) {
    const activityBatch = insertedLeads.map((lead) => ({
      leadId: lead._id,
      leadModel: 'ImportedLead',
      accountId,
      type: 'note',
      summary: `Lead imported via Excel file "${batch.originalFilename}" (Batch #${batch._id
        .toString()
        .slice(-6)})`,
      performedBy: user._id,
      performedAt: now,
      metadata: {
        importBatchId: batch._id,
        filename: batch.originalFilename,
      },
    }));

    try {
      await Activity.insertMany(activityBatch, { ordered: false });
    } catch (actErr) {
      console.error('[Activity Log Error during import]', actErr);
    }
  }

  // 4. Update batch record to 'completed' and clear expiresAt so history is permanent
  await ImportBatch.updateOne(
    { _id: batch._id },
    {
      $set: {
        status: 'completed',
        expiresAt: null, // History is permanent
        'summary.insertedCount': insertedCount,
        'summary.failedWriteCount': failedCount,
        'summary.completedAt': now,
      },
    }
  );

  // 5. Invalidate dashboard analytics cache for the account
  invalidateAnalyticsCache(accountId);

  return {
    batchId: batch._id.toString(),
    status: 'completed',
    insertedCount,
    skippedCount: batch.duplicateCount,
    errorCount: batch.errorCount + failedCount,
    totalRows: batch.totalRows,
    message: `Successfully imported ${insertedCount.toLocaleString()} lead${
      insertedCount === 1 ? '' : 's'
    }.`,
  };
}

/**
 * Generates an Excel workbook template with sample data, column explanations, and styling.
 */
export async function generateImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Lead Import Template', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  worksheet.columns = [
    { header: 'Full Name *', key: 'fullName', width: 24 },
    { header: 'Phone Number *', key: 'phoneNumber', width: 20 },
    { header: 'Email Address', key: 'email', width: 28 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Assigned Executive', key: 'assignedTo', width: 24 },
    { header: 'Source', key: 'source', width: 18 },
    { header: 'Campaign Name', key: 'campaignName', width: 26 },
    { header: 'Notes', key: 'notes', width: 34 },
    { header: 'Next Follow-Up Date', key: 'nextFollowUpDate', width: 22 },
    { header: 'Follow-Up Remarks', key: 'nextFollowUpRemarks', width: 30 },
    { header: 'Created Date', key: 'leadCreatedAt', width: 20 },
  ];

  // Header row formatting (Navy Blue #1A2C50 with white text)
  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A2C50' },
    };
    cell.font = {
      name: 'Segoe UI',
      bold: true,
      color: { argb: 'FFFFFFFF' },
      size: 11,
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF007EFF' } },
    };
  });
  headerRow.commit();

  // Add 3 sample demonstration rows
  const sampleRows = [
    {
      fullName: 'Vikram Malhotra',
      phoneNumber: '9876543210',
      email: 'vikram.malhotra@example.com',
      status: 'New',
      assignedTo: '',
      source: 'Walk-in',
      campaignName: 'Luxury Villas Launch',
      notes: 'Interested in 4BHK East-facing plot.',
      nextFollowUpDate: '2026-11-01',
      nextFollowUpRemarks: 'Call after 2 PM to schedule site visit',
      leadCreatedAt: '2026-10-25',
    },
    {
      fullName: 'Ananya Deshmukh',
      phoneNumber: '+919988776655',
      email: 'ananya.d@example.com',
      status: 'Contacted',
      assignedTo: '',
      source: 'Exhibition',
      campaignName: 'Property Expo 2026',
      notes: 'Visited stall; requested brochure on WhatsApp.',
      nextFollowUpDate: '2026-10-28',
      nextFollowUpRemarks: 'Send master brochure and rate list',
      leadCreatedAt: '2026-10-26',
    },
    {
      fullName: 'Rajesh K. Singhania',
      phoneNumber: '9812345678',
      email: '',
      status: 'Follow Up',
      assignedTo: '',
      source: 'Referral',
      campaignName: '',
      notes: 'Referred by Mr. Gupta.',
      nextFollowUpDate: '2026-10-30',
      nextFollowUpRemarks: 'Discuss payment plan options',
      leadCreatedAt: '2026-10-26',
    },
  ];

  sampleRows.forEach((r, idx) => {
    const row = worksheet.addRow(r);
    row.height = 20;
    const isEven = idx % 2 === 0;
    row.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 10 };
      cell.alignment = { vertical: 'middle' };
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8F9FA' },
        };
      }
    });
    row.commit();
  });

  return workbook;
}
