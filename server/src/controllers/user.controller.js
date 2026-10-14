import bcrypt from 'bcryptjs';
import User from '../models/User.js';

/**
 * GET /api/users
 * Lists users with pagination, text search, and role/status filtering.
 */
export const getUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const filter = {};

    // Filter by role
    if (req.query.role && req.query.role !== 'all') {
      filter.role = req.query.role;
    }

    // Filter by active status
    if (req.query.isActive !== undefined && req.query.isActive !== 'all') {
      filter.isActive = req.query.isActive === 'true';
    }

    // Search by name or email
    if (req.query.search && req.query.search.trim()) {
      const searchRegex = new RegExp(req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: searchRegex }, { email: searchRegex }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.status(200).json({
      success: true,
      users: users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })),
      total,
      page,
      totalPages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/stats
 * Aggregates user counts for the Admin Dashboard.
 */
export const getUserStats = async (req, res, next) => {
  try {
    const [total, active, inactive, admins, salesExecutives] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: false }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'sales_executive' }),
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        active,
        inactive,
        admins,
        salesExecutives,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/users
 * Creates a new user (Admin only).
 */
export const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check for duplicate email
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email address already exists.',
      });
    }

    // Hash password with bcrypt cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: role || 'sales_executive',
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully.',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/users/:id
 * Updates permitted user details (name, role).
 */
export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    // Guard: Prevent demoting the last active Admin
    if (user.role === 'admin' && role && role !== 'admin') {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1 && user.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the last active Administrator.',
        });
      }
    }

    if (name) user.name = name.trim();
    if (role) user.role = role;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/users/:id/status
 * Activates or deactivates a user account.
 */
export const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Guard 1: Prevent self-deactivation
    if (req.user._id.toString() === id && !isActive) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account.',
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    // Guard 2: Prevent deactivating the last active Admin
    if (user.role === 'admin' && !isActive) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate the last active Administrator.',
        });
      }
    }

    user.isActive = isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: isActive ? 'User account activated successfully.' : 'User account deactivated successfully.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
