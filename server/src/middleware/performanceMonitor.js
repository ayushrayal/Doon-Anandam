import os from 'node:os';
import { getDatabaseStatus } from '../config/db.js';
import { getAnalyticsCacheSize, getAnalyticsCacheCapacity, getInFlightRequestsCount } from '../controllers/analytics.controller.js';

// Configuration: Threshold in ms above which a request is counted as slow
export const SLOW_REQUEST_THRESHOLD_MS =
  parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS, 10) || 1000;

// Maximum distinct normalized route keys to retain in memory (prevents unbounded memory growth)
const MAX_ROUTE_METRICS = 100;

// Bounded route-level aggregations
const routeStats = new Map();

// Global request and error counters
const globalStats = {
  totalRequests: 0,
  totalErrors: 0,
  slowRequests: 0,
  statusCodes: {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
  },
  startedAt: new Date().toISOString(),
};

/**
 * Normalizes an Express request path into a generalized pattern to prevent
 * query strings, sensitive tokens, or arbitrary IDs (like MongoDB ObjectIds) from polluting keys.
 */
export function normalizePath(originalPath = '') {
  if (typeof originalPath !== 'string') return '/unknown';

  // Strip query string if present
  const [cleanPath] = originalPath.split('?');

  if (!cleanPath || cleanPath === '/') return '/';

  return cleanPath
    // Replace standard 24-character hexadecimal MongoDB ObjectIds
    .replace(/\b[0-9a-fA-F]{24}\b/g, ':id')
    // Replace UUIDs
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, ':id')
    // Replace standalone integer IDs
    .replace(/\/(\d+)(?=\/|$)/g, '/:id')
    // Collapse multiple consecutive slashes
    .replace(/\/+/g, '/');
}

/**
 * Records finished request execution safely.
 * Never throws or alters response flow.
 */
export function recordRequestMetrics(method, path, statusCode, durationMs) {
  try {
    globalStats.totalRequests++;

    const statusGroup = `${Math.floor(statusCode / 100)}xx`;
    if (globalStats.statusCodes[statusGroup] !== undefined) {
      globalStats.statusCodes[statusGroup]++;
    }

    if (statusCode >= 400) {
      globalStats.totalErrors++;
    }

    const isSlow = durationMs >= SLOW_REQUEST_THRESHOLD_MS;
    if (isSlow) {
      globalStats.slowRequests++;
      // Log slow request warning with sanitized, normalized route
      console.warn(
        `[Performance Warning] Slow request detected: ${method} ${path} returned ${statusCode} in ${Math.round(durationMs)}ms (threshold: ${SLOW_REQUEST_THRESHOLD_MS}ms)`
      );
    }

    // Update bounded route-level metrics
    const routeKey = `${method} ${path}`;
    let entry = routeStats.get(routeKey);

    if (!entry) {
      // If capacity is reached, avoid inserting new keys to guarantee bounded memory
      if (routeStats.size >= MAX_ROUTE_METRICS) {
        return;
      }
      entry = {
        count: 0,
        errors: 0,
        slowCount: 0,
        totalDurationMs: 0,
        minDurationMs: durationMs,
        maxDurationMs: durationMs,
      };
      routeStats.set(routeKey, entry);
    }

    entry.count++;
    entry.totalDurationMs += durationMs;
    if (durationMs < entry.minDurationMs) entry.minDurationMs = durationMs;
    if (durationMs > entry.maxDurationMs) entry.maxDurationMs = durationMs;
    if (statusCode >= 400) entry.errors++;
    if (isSlow) entry.slowCount++;
  } catch (err) {
    // Fail silently: monitoring should never impact request handling
  }
}

/**
 * Express middleware to record request duration, status code, and sanitized path.
 */
export function requestPerformanceMonitoring(req, res, next) {
  // Ignore static assets to focus monitoring on API traffic
  if (!req.path.startsWith('/api')) {
    return next();
  }

  const startTime = process.hrtime.bigint();
  const method = req.method;

  // Listen to the response 'finish' event
  res.on('finish', () => {
    try {
      const endTime = process.hrtime.bigint();
      // Calculate elapsed milliseconds with decimal precision
      const durationMs = Number(endTime - startTime) / 1e6;

      // Normalize path using Express route path if available, or regex-normalized URL
      const routePath = req.baseUrl
        ? `${req.baseUrl}${req.route?.path || req.path}`
        : req.path;
      const normalized = normalizePath(routePath);

      recordRequestMetrics(method, normalized, res.statusCode, durationMs);
    } catch {
      // Never allow monitoring callback to throw
    }
  });

  next();
}

/**
 * Returns safe system, process, and performance metrics.
 * Redacts any personal data, headers, or query strings.
 */
export function getSystemPerformanceMetrics() {
  const memoryUsage = process.memoryUsage();
  const dbStatus = getDatabaseStatus();

  // Format top routes safely
  const routes = [];
  for (const [key, stats] of routeStats) {
    const avgDurationMs = stats.count > 0 ? Math.round((stats.totalDurationMs / stats.count) * 10) / 10 : 0;
    routes.push({
      route: key,
      requests: stats.count,
      errors: stats.errors,
      slowRequests: stats.slowCount,
      avgDurationMs,
      minDurationMs: Math.round(stats.minDurationMs * 10) / 10,
      maxDurationMs: Math.round(stats.maxDurationMs * 10) / 10,
    });
  }

  // Sort routes by total requests descending
  routes.sort((a, b) => b.requests - a.requests);

  return {
    success: true,
    service: 'Doon Anandam CRM API',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
        externalMb: Math.round((memoryUsage.external / 1024 / 1024) * 10) / 10,
      },
      system: {
        totalMemMb: Math.round((os.totalmem() / 1024 / 1024) * 10) / 10,
        freeMemMb: Math.round((os.freemem() / 1024 / 1024) * 10) / 10,
        loadAvg: os.loadavg().map((val) => Math.round(val * 100) / 100),
      },
    },
    database: {
      configured: dbStatus.configured,
      connected: dbStatus.connected,
      state: dbStatus.state,
    },
    analyticsCache: {
      activeEntries: getAnalyticsCacheSize(),
      capacity: getAnalyticsCacheCapacity(),
      inFlightDeduplications: getInFlightRequestsCount(),
    },
    traffic: {
      totalRequests: globalStats.totalRequests,
      totalErrors: globalStats.totalErrors,
      slowRequests: globalStats.slowRequests,
      slowRequestThresholdMs: SLOW_REQUEST_THRESHOLD_MS,
      statusCodes: globalStats.statusCodes,
      startedAt: globalStats.startedAt,
    },
    routes,
  };
}

/**
 * Resets metrics counters for testing purposes.
 */
export function resetPerformanceMetricsForTest() {
  globalStats.totalRequests = 0;
  globalStats.totalErrors = 0;
  globalStats.slowRequests = 0;
  globalStats.statusCodes['2xx'] = 0;
  globalStats.statusCodes['3xx'] = 0;
  globalStats.statusCodes['4xx'] = 0;
  globalStats.statusCodes['5xx'] = 0;
  routeStats.clear();
}
