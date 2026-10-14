import { Router } from 'express';
import {
  getUsers,
  getUserStats,
  createUser,
  updateUser,
  updateUserStatus,
} from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { validateBody } from '../middleware/validate.js';
import {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
} from '../schemas/user.schema.js';

const router = Router();

// Protect all user management endpoints with authentication and Admin role authorization
router.use(authenticate, authorize(['admin']));

router.get('/', getUsers);
router.get('/stats', getUserStats);
router.post('/', verifyOrigin, validateBody(createUserSchema), createUser);
router.patch('/:id', verifyOrigin, validateBody(updateUserSchema), updateUser);
router.patch('/:id/status', verifyOrigin, validateBody(updateStatusSchema), updateUserStatus);

export default router;
