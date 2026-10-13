import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env.js';

const connectionStates = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Configure custom DNS servers for local development if enabled.
 *
 * IMPORTANT NETWORK & TROUBLESHOOTING NOTES:
 * 1. Google Public DNS (8.8.8.8, 8.8.4.4) must be reachable via UDP/TCP port 53 from your network.
 * 2. Enabling custom DNS only resolves Node.js c-ares DNS SRV lookup errors (e.g. querySrv ECONNREFUSED)
 *    often caused by Windows local loopback or local router/ISP DNS behavior.
 * 3. Custom DNS will NOT fix:
 *    - Incorrect cluster hostnames in MONGODB_URI.
 *    - MongoDB Atlas Network Access IP whitelist restrictions (ensure your current public IP is allowed in Atlas).
 *    - Invalid database usernames, passwords, or authentication database settings.
 */
function applyCustomDnsIfEnabled() {
  if (!env.USE_CUSTOM_DNS) {
    return;
  }

  try {
    const dnsServers = ['8.8.8.8', '8.8.4.4'];
    dns.setServers(dnsServers);
    console.log(`[Database] Custom DNS configured for development: ${dnsServers.join(', ')}`);
  } catch (err) {
    console.warn(
      '[Database] Failed to set custom DNS servers. Continuing with default system resolver:',
      err.message
    );
  }
}

/**
 * Safely redact credentials from error messages.
 */
function sanitizeErrorMessage(message) {
  if (!message) return 'Unknown database error';
  return message.replace(/mongodb(\+srv)?:\/\/[^@]+@/gi, 'mongodb$1://<credentials-hidden>@');
}

// Listen to connection lifecycle events once
mongoose.connection.on('connected', () => {
  console.log('[Database] MongoDB connection established successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error('[Database] Connection error:', sanitizeErrorMessage(err.message));
});

mongoose.connection.on('disconnected', () => {
  console.log('[Database] MongoDB disconnected.');
});

/**
 * Connect to MongoDB with timeout bounds.
 * Does not retry indefinitely; propagates error to caller for clean exit.
 */
export const connectDB = async () => {
  if (!env.isDbConfigured) {
    if (env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI is required in production mode');
    }
    console.warn('[Database] MONGODB_URI is not configured. Running without database connection.');
    return false;
  }

  // Apply custom DNS servers if enabled in development
  applyCustomDnsIfEnabled();

  try {
    console.log('[Database] Attempting connection to MongoDB...');
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds instead of hanging
    });
    return true;
  } catch (error) {
    const safeError = sanitizeErrorMessage(error.message);
    console.error('[Database] Initial connection failed:', safeError);
    throw new Error(safeError);
  }
};

/**
 * Safely disconnect from MongoDB.
 */
export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    console.log('[Database] Closing MongoDB connection...');
    await mongoose.connection.close(false);
    console.log('[Database] MongoDB connection closed.');
  }
};

/**
 * Get current database status summary.
 */
export const getDatabaseStatus = () => {
  const readyState = mongoose.connection.readyState;
  return {
    configured: env.isDbConfigured,
    connected: readyState === 1,
    state: connectionStates[readyState] || 'unknown',
  };
};
