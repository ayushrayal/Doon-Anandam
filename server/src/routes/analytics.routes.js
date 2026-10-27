import { Router } from 'express';
import { getDashboardAnalytics } from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { validateQuery } from '../middleware/validate.js';
import { analyticsQuerySchema } from '../schemas/analytics.schema.js';
import { getSystemPerformanceMetrics } from '../middleware/performanceMonitor.js';

const router = Router();

// Protect all analytics endpoints with authentication
router.use(authenticate);

// GET /api/analytics/dashboard
// Retrieves aggregated CRM performance metrics, funnel data, workloads, and activity feeds
router.get('/dashboard', validateQuery(analyticsQuerySchema), getDashboardAnalytics);

// GET /api/analytics/performance-metrics (Admin only)
// Retrieves operational system, process memory, route latency, cache status, and traffic metrics
router.get('/performance-metrics', authorize(['admin']), (req, res) => {
  const metrics = getSystemPerformanceMetrics();
  res.status(200).json(metrics);
});

export default router;
