import app from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';

let server = null;
let isShuttingDown = false;

/**
 * Idempotent graceful shutdown handler.
 * Closes HTTP listener, safely disconnects Mongoose, and terminates process.
 */
async function gracefulShutdown(exitCode = 0, trigger = 'signal') {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`\n[Doon Anandam CRM API] Initiating graceful shutdown (${trigger})...`);

  // Stop accepting incoming HTTP connections
  if (server && server.listening) {
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error('[Doon Anandam CRM API] Error closing HTTP server:', err.message);
        } else {
          console.log('[Doon Anandam CRM API] HTTP server stopped accepting connections.');
        }
        resolve();
      });
    });
  }

  // Safely disconnect Mongoose
  try {
    await disconnectDB();
  } catch (dbErr) {
    console.error('[Doon Anandam CRM API] Error during database disconnection:', dbErr.message);
  }

  console.log('[Doon Anandam CRM API] Graceful shutdown completed. Exiting.');
  process.exit(exitCode);
}

// Signal and process failure listeners
process.on('SIGINT', () => gracefulShutdown(0, 'SIGINT'));
process.on('SIGTERM', () => gracefulShutdown(0, 'SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[Doon Anandam CRM API] Unhandled Promise Rejection:', reason);
  gracefulShutdown(1, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('[Doon Anandam CRM API] Uncaught Exception:', err.message);
  gracefulShutdown(1, 'uncaughtException');
});

/**
 * Bootstrap server
 */
async function startServer() {
  if (env.isDbConfigured) {
    try {
      await connectDB();
    } catch (err) {
      console.error('[Doon Anandam CRM API] Database startup connection failed.');
      console.error('[Doon Anandam CRM API] Reason:', err.message);
      process.exit(1);
    }
  } else {
    console.warn('[Doon Anandam CRM API] Running in development mode without MongoDB connection configured.');
  }

  server = app.listen(env.PORT, () => {
    console.log(`[Doon Anandam CRM API] Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    console.log(`[Doon Anandam CRM API] Health check endpoint: http://localhost:${env.PORT}/api/health`);
  });

  server.on('error', (err) => {
    console.error('[Doon Anandam CRM API] HTTP server error:', err.message);
    gracefulShutdown(1, 'server-error');
  });
}

startServer();
