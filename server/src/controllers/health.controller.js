import { getDatabaseStatus } from '../config/db.js';

export const getHealth = (req, res) => {
  const dbStatus = getDatabaseStatus();

  let httpStatus = 200;
  let overallStatus = 'healthy';
  let indicator = 'database-connected';

  if (!dbStatus.configured) {
    // Database not configured in development
    overallStatus = 'degraded';
    httpStatus = 200;
    indicator = 'database-unconfigured';
  } else if (!dbStatus.connected) {
    // Database configured but unavailable
    overallStatus = 'unhealthy';
    httpStatus = 503;
    indicator = 'database-unavailable';
  } else {
    // Database configured and connected
    overallStatus = 'healthy';
    httpStatus = 200;
    indicator = 'database-connected';
  }

  res.status(httpStatus).json({
    success: overallStatus !== 'unhealthy',
    service: 'Doon Anandam CRM API',
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      configured: dbStatus.configured,
      connected: dbStatus.connected,
      state: dbStatus.state,
      indicator,
    },
  });
};
