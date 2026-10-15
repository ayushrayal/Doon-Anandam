import { env } from '../config/env.js';

/**
 * Verify request Origin on state-changing methods (POST, PUT, PATCH, DELETE)
 * to prevent Cross-Site Request Forgery (CSRF) abuse.
 */
export const verifyOrigin = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;

    // Requests without origin header (e.g., cURL, Postman, native apps) are permitted
    if (!origin) {
      return next();
    }

    // Exact match on configured client URL
    if (origin === env.CLIENT_URL) {
      return next();
    }

    // Same-origin verification using host header (supports single-service deployment)
    const host = req.get('host');
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) {
      return next();
    }

    // Local development allow-list for localhost variants
    if (
      env.NODE_ENV !== 'production' &&
      (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173')
    ) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Cross-origin request forbidden.',
    });
  }

  next();
};
