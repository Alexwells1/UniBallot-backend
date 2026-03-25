import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize }    from '../middleware/authorize';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendPaginated } from '../utils/apiResponse';
import {
  getDashboardStats,
  getEmailLogs,
  getSuppressedList,
  removeSuppressedAddress,
} from '../controllers/emails/emailDashboard.controller';

const router = Router();

// ─── Auth guard ───────────────────────────────────────────────────────────────
// FIX (Issue 1): All email-dashboard routes require a Super Admin session.
// Without this guard the email log, suppression list, and queue stats are
// publicly readable and the suppression list is publicly writable.
router.use(authenticate, authorize('super_admin'));

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/stats', asyncHandler(async (_req, res) => {
  const stats = await getDashboardStats();
  sendSuccess(res, stats, 'Email dashboard stats retrieved');
}));

router.get('/logs', asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page   as string) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit as string) || 20);
  const status = (req.query.status as string | undefined)?.trim() || undefined;
  const to     = (req.query.to     as string | undefined)?.trim() || undefined;

  const { logs, total } = await getEmailLogs(page, limit, status, to);
  sendPaginated(res, logs, total, page, limit);
}));

router.get('/suppressed', asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page   as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);

  const { list, total } = await getSuppressedList(page, limit);
  sendPaginated(res, list, total, page, limit);
}));

router.delete('/suppressed/:email', asyncHandler(async (req, res) => {
  const email  = decodeURIComponent(req.params.email).toLowerCase().trim();
  const result = await removeSuppressedAddress(email);
  sendSuccess(res, result, 'Address removed from suppression list');
}));

export default router;
