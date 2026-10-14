import { Router } from 'express';
import {
  getLeads,
  getLeadById,
  updateLeadStatus,
  assignLead,
  syncLeads,
} from '../controllers/lead.controller.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  leadQuerySchema,
  updateLeadStatusSchema,
  assignLeadSchema,
} from '../schemas/lead.schema.js';

const router = Router();

// Protect all lead management routes with authentication
router.use(authenticate);

// 1. Lead listing with pagination, search, safe sorting, and filters
router.get('/', validateQuery(leadQuerySchema), getLeads);

// 2. Admin-only manual synchronization endpoint (Phase 5)
router.post('/sync', authorize(['admin']), verifyOrigin, syncLeads);

// 3. Lead details by ID
router.get('/:id', getLeadById);

// 4. Update lead status with lifecycle transition validation
router.patch(
  '/:id/status',
  verifyOrigin,
  validateBody(updateLeadStatusSchema),
  updateLeadStatus
);

// 5. Assign/unassign lead (Admin only)
router.patch(
  '/:id/assign',
  authorize(['admin']),
  verifyOrigin,
  validateBody(assignLeadSchema),
  assignLead
);

export default router;
