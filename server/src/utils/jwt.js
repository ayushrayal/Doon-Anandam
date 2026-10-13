import jwt from 'jsonwebtoken';
import { env, validateAuthEnv } from '../config/env.js';

export const COOKIE_NAME = 'token';

/**
 * Sign JWT token for authenticated session.
 */
export const signToken = (payload) => {
  validateAuthEnv();
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * Verify JWT token. Throws if invalid or expired.
 */
export const verifyToken = (token) => {
  validateAuthEnv();
  return jwt.verify(token, env.JWT_SECRET);
};

/**
 * Cookie configuration options.
 * In production: Secure=true, SameSite=none (required for cross-site Render deployments).
 * In development: Secure=false, SameSite=lax (for localhost HTTP requests).
 */
export const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path: '/',
});

/**
 * Cookie clearing options (must match creation attributes).
 */
export const getClearAuthCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
});
