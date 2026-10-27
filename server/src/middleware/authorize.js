/**
 * Role-Based Access Control (RBAC) middleware.
 * Enforces that the authenticated user has one of the required roles.
 */
export const authorize = (allowedRoles = ['admin']) => {
  return function authorizeRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No authenticated user found.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to access this resource.',
      });
    }

    next();
  };
};
