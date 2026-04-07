import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { uploadAvatar } from '../middleware/upload';
import {
  getMe,
  completeProfile,     profileSchema,
  updateProfile,       updateProfileSchema,
  uploadAvatarHandler,
  changePassword,      passwordChangeSchema,
} from '../controllers/user.controller';

const router = Router();

router.use(authenticate);

router.get('/me',          getMe);
router.post('/me/avatar',  uploadAvatar, uploadAvatarHandler);
router.put('/me/password', validate(passwordChangeSchema), changePassword);

router.put(   '/me/profile', authorize('student'), validate(profileSchema),       completeProfile);
router.patch( '/me/profile', authorize('student'), validate(updateProfileSchema),  updateProfile);

export default router;
