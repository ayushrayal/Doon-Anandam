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
import { MAX_FILE_SIZE_BYTES } from '../services/leadImport.service.js';

const router = Router();

// Configure Multer for in-memory Excel file uploads with strict size and format validation (25 MB)
const upload = multer({
  storage: multer.memoryStorage(),
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

// Protect all Import module routes: Authenticated & Admin-Only
router.use(authenticate);
router.use(authorize(['admin']));

// 1. Download formatted Excel template
router.get('/template', downloadTemplate);

// 2. Upload workbook and generate validation/duplicate preview
router.post(
  '/preview',
  verifyOrigin,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
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

// 3. Confirm previewed import batch (idempotent write)
router.post('/confirm', verifyOrigin, confirmImport);

// 4. Retrieve historical import batches
router.get('/history', getImportHistory);

// 5. Retrieve single batch details and error log
router.get('/history/:batchId', getImportBatchDetails);

// 6. Manage imported leads (completely isolated from Meta/Windsor Leads pipeline)
router.get('/records', getImportedRecords);
router.post(
  '/records/bulk/assign',
  verifyOrigin,
  validateBody(bulkAssignSchema),
  bulkAssignImportedRecords
);
router.post(
  '/records/bulk/delete',
  verifyOrigin,
  validateBody(bulkDeleteSchema),
  bulkDeleteImportedRecords
);
router.get('/records/:id', getImportedRecordById);
router.patch('/records/:id/status', verifyOrigin, updateImportedRecordStatus);
router.post('/records/:id/follow-up', verifyOrigin, scheduleImportedRecordFollowUp);
router.patch('/records/:id/follow-up/complete', verifyOrigin, completeImportedRecordFollowUp);
router.post('/records/:id/follow-up/complete', verifyOrigin, completeImportedRecordFollowUp);
router.get('/records/:id/activities', getImportedRecordActivities);
router.post('/records/:id/activities', verifyOrigin, createImportedRecordActivity);

export default router;
