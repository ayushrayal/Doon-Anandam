import { verifyToken, COOKIE_NAME } from '../utils/jwt.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { isOriginAllowed } from './verifyOrigin.js';

/**
 * Authentication middleware.
 * Verifies HttpOnly JWT cookie, checks user status, and attaches user to request.
 */
export const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No session token provided.',
      });
    }

    // Protect cookie-authenticated state-changing requests against cross-origin abuse
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !isOriginAllowed(origin, req)) {
        return res.status(403).json({
          success: false,
          message: 'Cross-origin request forbidden.',
        });
      }
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session token.',
      });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Malformed session token.',
      });
    }

    const user = await User.findById(decoded.id).select('-passwordHash');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this session no longer exists.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact an administrator.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
