import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  createOfficer,        createOfficerSchema,
  listUsers,
  getUser,
  suspendUser,
  activateUser,
  deleteUser,
  resetPassword,        resetPasswordSchema,
  getDashboard,
  listAllElections,
  getAuditLogs,
  semesterReset,        semesterResetSchema,
  semesterResetPreview,
  clearTallyCache,
  clearUserCache,
  getCacheStats,
  flushCache,           flushCacheSchema,
} from '../controllers/superAdmin.controller';
import { assignOfficer } from '../controllers/election.controller';

const router = Router();

router.use(authenticate, authorize('super_admin'));

router.get('/dashboard', getDashboard);

router.get('/elections', listAllElections);
router.post(
  '/elections/:id/assign-officer',
  validate(z.object({ officerId: z.string().min(1) })),
  assignOfficer
);

router.get('/audit-logs', getAuditLogs);

router.get('/semester-reset/preview', semesterResetPreview);
router.post('/semester-reset', validate(semesterResetSchema), semesterReset);

router.post('/officers', validate(createOfficerSchema), createOfficer);

router.get('/users',                      listUsers);
router.get('/users/:id',                  getUser);
router.patch('/users/:id/suspend',        suspendUser);
router.patch('/users/:id/activate',       activateUser);
router.delete('/users/:id',               deleteUser);
router.patch('/users/:id/reset-password', validate(resetPasswordSchema), resetPassword);

// Cache management
router.post('/cache/clear-tally/:electionId', clearTallyCache);
router.post('/cache/clear-user/:userId',      clearUserCache);
router.get('/cache/stats',                    getCacheStats);
router.post('/cache/flush',                   validate(flushCacheSchema), flushCache);

export default router;