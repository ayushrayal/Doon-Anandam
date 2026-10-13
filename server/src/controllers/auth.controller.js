import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import {
  signToken,
  COOKIE_NAME,
  getAuthCookieOptions,
  getClearAuthCookieOptions,
} from '../utils/jwt.js';

// Pre-computed dummy hash to mitigate timing attacks on nonexistent accounts
const DUMMY_HASH = '$2a$12$e8F087P9fV8q7N0h.F62IuvN.3z0n.5LhO8x4XQ5V3WjJc.vN1d1K';

/**
 * POST /api/auth/login
 * Authenticates user credentials, verifies active status, and sets HttpOnly cookie.
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      // Execute dummy comparison to mitigate timing attacks
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact an administrator.',
      });
    }

    // Generate JWT token
    const token = signToken({
      id: user._id,
      role: user.role,
    });

    // Set secure HttpOnly cookie
    res.cookie(COOKIE_NAME, token, getAuthCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile.
 */
export const getMe = (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      isActive: req.user.isActive,
    },
  });
};

/**
 * POST /api/auth/logout
 * Clears authentication session cookie.
 */
export const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, getClearAuthCookieOptions());

  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};
