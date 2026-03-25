import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  createOfficer,   createOfficerSchema,
  listUsers,
  getUser,
  suspendUser,
  activateUser,
  deleteUser,
  resetPassword,   resetPasswordSchema,
  getDashboard,
  listAllElections,
  getAuditLogs,
  semesterReset,   semesterResetSchema,
  semesterResetPreview,
} from '../controllers/superAdmin.controller';
import { assignOfficer } from '../controllers/election.controller';

const router = Router();

// All routes require Super Admin
router.use(authenticate, authorize('super_admin'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);

// ── Elections (SA view + officer assignment) ──────────────────────────────────
router.get('/elections', listAllElections);
router.post(
  '/elections/:id/assign-officer',
  validate(z.object({ officerId: z.string().min(1) })),
  assignOfficer
);

// ── Audit logs ────────────────────────────────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

// ── Semester reset ────────────────────────────────────────────────────────────
// Step 1: GET /semester-reset/preview  — dry-run, returns counts, no deletes
// Step 2: POST /semester-reset         — execute; body must contain { confirm: "SEMESTER_RESET" }
router.get('/semester-reset/preview', semesterResetPreview);
router.post('/semester-reset', validate(semesterResetSchema), semesterReset);

// ── Officers ──────────────────────────────────────────────────────────────────
router.post('/officers', validate(createOfficerSchema), createOfficer);

// ── User management ───────────────────────────────────────────────────────────
router.get('/users',                      listUsers);
router.get('/users/:id',                  getUser);
router.patch('/users/:id/suspend',        suspendUser);
router.patch('/users/:id/activate',       activateUser);
router.delete('/users/:id',               deleteUser);
router.patch('/users/:id/reset-password', validate(resetPasswordSchema), resetPassword);

export default router;
