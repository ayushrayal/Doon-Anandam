import { env } from '../config/env.js';

/**
 * Determine if a given hostname is an authorized application host.
 * Strictly prevents arbitrary user-supplied Host or X-Forwarded-Host
 * headers from being used to authorize an untrusted origin.
 */
export function isAllowedHost(host) {
  if (!host) return false;
  const hostname = host.split(':')[0].toLowerCase();

  // 1. Explicitly configured CLIENT_URL hostname
  if (env.CLIENT_URL) {
    try {
      const clientHostname = new URL(env.CLIENT_URL).hostname.toLowerCase();
      if (hostname === clientHostname) return true;
    } catch {
      // Ignore malformed URL
    }
  }

  // 2. Render-provided environment hostnames
  if (process.env.RENDER_EXTERNAL_URL) {
    try {
      const renderHostname = new URL(process.env.RENDER_EXTERNAL_URL).hostname.toLowerCase();
      if (hostname === renderHostname) return true;
    } catch {
      // Ignore
    }
  }

  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    if (hostname === process.env.RENDER_EXTERNAL_HOSTNAME.trim().toLowerCase()) {
      return true;
    }
  }

  // 3. Known Render production service domain for this deployment
  if (hostname === 'doon-anandam.onrender.com' || hostname.endsWith('.onrender.com')) {
    return true;
  }

  // 4. Local development hostnames (strictly disabled in production)
  if (env.NODE_ENV !== 'production') {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }
  }

  return false;
}

/**
 * Extract the trusted host from the request.
 * Only trusts X-Forwarded-Host if the upstream socket connection is from
 * a trusted reverse proxy configured via Express 'trust proxy'.
 */
export function getTrustedHost(req) {
  if (!req) return null;

  const trust = req.app?.get('trust proxy fn');
  const isTrustedProxy =
    typeof trust === 'function' &&
    trust(req.connection?.remoteAddress || req.socket?.remoteAddress, 0);

  if (isTrustedProxy) {
    const forwardedHost = req.get ? req.get('X-Forwarded-Host') : req.headers?.['x-forwarded-host'];
    if (forwardedHost) {
      return forwardedHost.split(',')[0].trim();
    }
  }

  const host = req.get ? req.get('Host') : req.headers?.host;
  return host ? host.split(',')[0].trim() : null;
}

/**
 * Build the set of valid, authorized origins for the application.
 */
export function getAllowedOrigins(req = null) {
  const origins = new Set();

  // Configured CLIENT_URL
  if (env.CLIENT_URL) {
    origins.add(env.CLIENT_URL.replace(/\/+$/, ''));
  }

  // Render environment URL
  if (process.env.RENDER_EXTERNAL_URL) {
    origins.add(process.env.RENDER_EXTERNAL_URL.trim().replace(/\/+$/, ''));
  }

  // Render external hostname
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    const rHostname = process.env.RENDER_EXTERNAL_HOSTNAME.trim().replace(/\/+$/, '');
    origins.add(`https://${rHostname}`);
    origins.add(`http://${rHostname}`);
  }

  // Same-origin dynamic resolution from trusted host
  if (req) {
    const trustedHost = getTrustedHost(req);
    if (trustedHost && isAllowedHost(trustedHost)) {
      origins.add(`http://${trustedHost}`);
      origins.add(`https://${trustedHost}`);
    }
  }

  // Local development origins
  if (env.NODE_ENV !== 'production') {
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
    if (env.PORT) {
      origins.add(`http://localhost:${env.PORT}`);
      origins.add(`http://127.0.0.1:${env.PORT}`);
    }
  }

  return Array.from(origins);
}

/**
 * Helper to check if an origin is permitted for the given request.
 */
export function isOriginAllowed(origin, req = null) {
  if (!origin) return true;
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  const allowedOrigins = getAllowedOrigins(req);
  return allowedOrigins.includes(cleanOrigin);
}

/**
 * Verify request Origin on state-changing methods (POST, PUT, PATCH, DELETE)
 * to prevent Cross-Site Request Forgery (CSRF) abuse.
 */
export const verifyOrigin = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;

    if (origin && !isOriginAllowed(origin, req)) {
      return res.status(403).json({
        success: false,
        message: 'Cross-origin request forbidden.',
      });
    }
  }

  next();
};
