import { Router } from 'express';
import { getDashboardAnalytics } from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { analyticsQuerySchema } from '../schemas/analytics.schema.js';

const router = Router();

// Protect all analytics endpoints with authentication
router.use(authenticate);

// GET /api/analytics/dashboard
// Retrieves aggregated CRM performance metrics, funnel data, workloads, and activity feeds
router.get('/dashboard', validateQuery(analyticsQuerySchema), getDashboardAnalytics);

export default router;
