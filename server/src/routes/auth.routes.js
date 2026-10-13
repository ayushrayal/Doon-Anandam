import { Router } from 'express';
import { login, getMe, logout } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema } from '../schemas/auth.schema.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';

const router = Router();

router.post('/login', verifyOrigin, loginLimiter, validateBody(loginSchema), login);
router.get('/me', authenticate, getMe);
router.post('/logout', verifyOrigin, logout);

export default router;
