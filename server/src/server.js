import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`[Doon Anandam CRM API] Running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  console.log(`[Doon Anandam CRM API] Health check available at: http://localhost:${env.PORT}/api/health`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err);
  server.close(() => process.exit(1));
});
