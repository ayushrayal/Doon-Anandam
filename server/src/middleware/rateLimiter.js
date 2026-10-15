import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

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
 * Default: 600 requests per 15 minutes per IP (~40 req/min).
 * Skips non-mutating CORS OPTIONS preflights and automated test runs.
 */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || env.NODE_ENV === 'test',
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});
