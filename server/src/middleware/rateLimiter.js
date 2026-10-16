import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { COOKIE_NAME } from '../utils/jwt.js';

/**
 * Derives a secure rate limit key:
 * - For authenticated sessions: SHA-256 hash of the verified user ID (user:hash).
 *   Ensures 50 sales reps sharing an office NAT/VPN IP do NOT exhaust each other's quota.
 *   Guarantees raw JWT tokens and user IDs are NEVER stored as keys.
 * - For unauthenticated requests: IP-based key (ip:req.ip).
 */
export function getRateLimitKey(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token && env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      if (decoded && decoded.id) {
        const userHash = crypto
          .createHash('sha256')
          .update(String(decoded.id))
          .digest('hex')
          .substring(0, 16);
        return `user:${userHash}`;
      }
    } catch {
      // Malformed or expired token falls through to IP-based rate limiting
    }
  }
  return `ip:${req.ip}`;
}

/**
 * Login rate limiter: Max 10 attempts per 15 minutes per IP.
 * Strict brute-force protection for authentication endpoints.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  },
});

/**
 * General API rate limiter for DoS and volumetric abuse protection.
 * Default: 600 requests per 15 minutes per user/IP (~40 req/min).
 * Uses getRateLimitKey for office NAT isolation without exposing raw tokens.
 * Skips non-mutating CORS OPTIONS preflights and automated test runs.
 */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || env.NODE_ENV === 'test',
  message: {
    success: false,
    message: 'Too many requests, please try again after 15 minutes.',
  },
});
