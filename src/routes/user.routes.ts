import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { uploadAvatar } from '../middleware/upload';
import {
  getMe,
  completeProfile,   profileSchema,
  uploadAvatarHandler,
  changePassword,    passwordChangeSchema,
} from '../controllers/user.controller';

const router = Router();

router.use(authenticate);

// All authenticated roles
router.get('/me',         getMe);
router.post('/me/avatar', uploadAvatar, uploadAvatarHandler);
router.put('/me/password', validate(passwordChangeSchema), changePassword);

// Students only
router.put('/me/profile', authorize('student'), validate(profileSchema), completeProfile);

export default router;
