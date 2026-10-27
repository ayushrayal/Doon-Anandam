import { Router } from 'express';
import multer from 'multer';
import {
  downloadTemplate,
  previewImport,
  confirmImport,
  getImportHistory,
  getImportBatchDetails,
  getImportedRecords,
  bulkAssignImportedRecords,
  bulkDeleteImportedRecords,
  getImportedRecordById,
  updateImportedRecordStatus,
  scheduleImportedRecordFollowUp,
  completeImportedRecordFollowUp,
  getImportedRecordActivities,
  createImportedRecordActivity,
} from '../controllers/import.controller.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { validateBody } from '../middleware/validate.js';
import { bulkAssignSchema, bulkDeleteSchema } from '../schemas/lead.schema.js';
import {
  MAX_FILE_SIZE_BYTES,
  uploadDiskStorage,
  safeUnlink,
} from '../services/leadImport.service.js';

const router = Router();

// Configure Multer for streaming disk-based Excel file uploads with strict size and format validation (25 MB preserved)
const upload = multer({
  storage: uploadDiskStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    const isXlsxExt = file.originalname.toLowerCase().endsWith('.xlsx');
    const isXlsxMime =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/octet-stream';

    if (isXlsxExt || isXlsxMime) {
      cb(null, true);
    } else {
      const error = new Error('Invalid file type. Only Excel (.xlsx) files are supported.');
      error.status = 400;
      cb(error);
    }
  },
});

// Protect all Import module routes with authentication
router.use(authenticate);

// Role authorization middlewares
const requireAdminRole = authorize(['admin']);
const requireRecordAccessRole = authorize(['admin', 'sales_executive']);

// 1. Download formatted Excel template (Admin-Only)
router.get('/template', requireAdminRole, downloadTemplate);

// 2. Upload workbook and generate validation/duplicate preview (Admin-Only)
router.post(
  '/preview',
  requireAdminRole,
  verifyOrigin,
  (req, res, next) => {
    req.on('aborted', async () => {
      if (req.file?.path) {
        await safeUnlink(req.file.path);
      }
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (req.file?.path) {
          await safeUnlink(req.file.path);
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File size limit exceeded. Maximum allowed file size is 25 MB.',
          });
        }
        return res.status(err.status || 400).json({
          success: false,
          message: err.message || 'File upload error.',
        });
      }
      next();
    });
  },
  previewImport
);

// 3. Confirm previewed import batch (idempotent write, Admin-Only)
router.post('/confirm', requireAdminRole, verifyOrigin, confirmImport);

// 4. Retrieve historical import batches (Admin-Only)
router.get('/history', requireAdminRole, getImportHistory);

// 5. Retrieve single batch details and error log (Admin-Only)
router.get('/history/:batchId', requireAdminRole, getImportBatchDetails);

// 6. Bulk administration of imported leads (Admin-Only)
router.post(
  '/records/bulk/assign',
  requireAdminRole,
  verifyOrigin,
  validateBody(bulkAssignSchema),
  bulkAssignImportedRecords
);
router.post(
  '/records/bulk/delete',
  requireAdminRole,
  verifyOrigin,
  validateBody(bulkDeleteSchema),
  bulkDeleteImportedRecords
);

// 7. Manage imported leads (Accessible to Admin & assigned Sales Executive)
router.get('/records', requireRecordAccessRole, getImportedRecords);
router.get('/records/:id', requireRecordAccessRole, getImportedRecordById);
router.patch('/records/:id/status', requireRecordAccessRole, verifyOrigin, updateImportedRecordStatus);
router.post('/records/:id/follow-up', requireRecordAccessRole, verifyOrigin, scheduleImportedRecordFollowUp);
router.patch('/records/:id/follow-up/complete', requireRecordAccessRole, verifyOrigin, completeImportedRecordFollowUp);
router.post('/records/:id/follow-up/complete', requireRecordAccessRole, verifyOrigin, completeImportedRecordFollowUp);
router.get('/records/:id/activities', requireRecordAccessRole, getImportedRecordActivities);
router.post('/records/:id/activities', requireRecordAccessRole, verifyOrigin, createImportedRecordActivity);

export default router;
