import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
// z is used for semesterResetSchema (confirm literal) and createOfficerSchema / resetPasswordSchema
import mongoose from 'mongoose';
import User from '../models/User';
import Avatar from '../models/Avatar';
import Vote from '../models/Vote';
import RegisteredVoter from '../models/RegisteredVoter';
import OtpVerification from '../models/OtpVerification';
import RefreshToken from '../models/RefreshToken';
import Election from '../models/Election';
import AuditLog from '../models/AuditLog';
import Association from '../models/Association';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendPaginated } from '../utils/apiResponse';
import { sanitizeUser } from '../utils/sanitize';
import { revokeAllUserTokens } from '../services/token.service';
import { deleteImage } from '../services/upload.service';
import { logAction } from '../services/audit.service';
import {
  sendEmail,
  accountSuspendedTemplate,
  accountActivatedTemplate,
  passwordResetNotificationTemplate,
} from '../services/email/email.service';
import { AUDIT_ACTIONS } from '../config/constants';

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const createOfficerSchema = z.object({
  email:    z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

// ── Officers ──────────────────────────────────────────────────────────────────

export const createOfficer = asyncHandler(async (req: Request, res: Response) => {
  const { email, fullName, password } = req.body as z.infer<typeof createOfficerSchema>;
  const normalised = email.toLowerCase();

  const existing = await User.findOne({ email: normalised });
  if (existing) throw new AppError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);
  const officer = await User.create({
    email: normalised, passwordHash, fullName,
    role: 'officer', profileCompleted: true, isActive: true, mustChangePassword: false,
  });

  await logAction({
    action:      AUDIT_ACTIONS.OFFICER_CREATED,
    performedBy: req.user._id,
    targetId:    officer._id,
    targetModel: 'User',
  });
  sendSuccess(res, sanitizeUser(officer), 'Officer created successfully', 201);
});

// ── User management ───────────────────────────────────────────────────────────

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { role, status, search } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
  const skip     = (pageNum - 1) * limitNum;

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (status === 'suspended')        { filter.isSuspended = true; }
  else if (status === 'deactivated') { filter.isActive = false; }
  else if (status === 'active')      { filter.isActive = true; filter.isSuspended = false; }
  if (search) {
    // FIX (Issue 5): Escape all special regex metacharacters before interpolating
    // into $regex. Without this, a crafted pattern like (a+)+ causes MongoDB to
    // run a catastrophically backtracking scan (ReDoS). Length cap prevents
    // excessively long patterns from consuming query-planning time.
    const escaped = search
      .slice(0, 100)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { fullName: { $regex: escaped, $options: 'i' } },
      { email:    { $regex: escaped, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-passwordHash -__v').skip(skip).limit(limitNum).sort({ createdAt: -1 }),
    User.countDocuments(filter),
  ]);
  sendPaginated(res, users, total, pageNum, limitNum);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id).select('-passwordHash -__v');
  if (!user) throw new AppError(404, 'User not found');
  sendSuccess(res, user);
});

export const suspendUser = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'User not found');
  if (user.role === 'super_admin') throw new AppError(403, 'Cannot suspend a super admin');

  await User.findByIdAndUpdate(user._id, { $set: { isSuspended: true } });
  await revokeAllUserTokens(user._id); // immediately invalidate all sessions

  await logAction({
    action:      AUDIT_ACTIONS.ACCOUNT_SUSPENDED,
    performedBy: req.user._id,
    targetId:    user._id,
    targetModel: 'User',
    metadata:    { reason },
  });

  if (user.fullName) {
    await sendEmail({ to: user.email, ...accountSuspendedTemplate(user.fullName) }).catch(() => null);
  }
  sendSuccess(res, null, 'User suspended');
});

export const activateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'User not found');

  await User.findByIdAndUpdate(user._id, { $set: { isSuspended: false, isActive: true } });

  await logAction({
    action:      AUDIT_ACTIONS.ACCOUNT_ACTIVATED,
    performedBy: req.user._id,
    targetId:    user._id,
    targetModel: 'User',
  });

  if (user.fullName) {
    await sendEmail({ to: user.email, ...accountActivatedTemplate(user.fullName) }).catch(() => null);
  }
  sendSuccess(res, null, 'User activated');
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'User not found');
  if (user.role === 'super_admin') throw new AppError(403, 'Cannot delete a super admin');

  await revokeAllUserTokens(user._id);

  const avatar = await Avatar.findOne({ userId: user._id });
  if (avatar) {
    await deleteImage(avatar.publicId).catch(() => null);
    await Avatar.deleteOne({ userId: user._id });
  }

  await User.findByIdAndDelete(user._id);
  await logAction({
    action:      AUDIT_ACTIONS.ACCOUNT_DELETED,
    performedBy: req.user._id,
    targetId:    user._id,
    targetModel: 'User',
  });
  res.status(204).send();
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { newPassword } = req.body as z.infer<typeof resetPasswordSchema>;
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'User not found');

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await User.findByIdAndUpdate(user._id, { $set: { passwordHash, mustChangePassword: true } });

  await logAction({
    action:      AUDIT_ACTIONS.PASSWORD_RESET,
    performedBy: req.user._id,
    targetId:    user._id,
    targetModel: 'User',
  });
  // Password is intentionally NOT included in the notification email
  if (user.fullName) {
    await sendEmail({ to: user.email, ...passwordResetNotificationTemplate(user.fullName) }).catch(() => null);
  }
  sendSuccess(res, null, 'Password reset. User must change it on next login.');
});

// ── Dashboard — pure aggregation, no N+1 ─────────────────────────────────────

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const [totalAssociations, electionStats, voterStats, userStats] = await Promise.all([
    Association.countDocuments(),
    Election.aggregate<{ _id: string | null; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    RegisteredVoter.aggregate<{ _id: null; total: number; voted: number }>([
      { $group: { _id: null, total: { $sum: 1 }, voted: { $sum: { $cond: ['$hasVoted', 1, 0] } } } },
    ]),
    User.aggregate<{ _id: string; count: number }>([
      { $match: { role: { $in: ['student', 'officer'] } } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
  ]);

  const electionsByStatus = Object.fromEntries(
    electionStats.map((s) => [s._id ?? 'unknown', s.count])
  );
  const totalElections = electionStats.reduce((sum, s) => sum + s.count, 0);
  const voterStat      = voterStats[0] ?? { total: 0, voted: 0 };
  const userMap        = Object.fromEntries(userStats.map((u) => [u._id, u.count]));

  sendSuccess(res, {
    totalAssociations,
    totalElections,
    electionsByStatus,
    totalRegisteredVoters: voterStat.total,
    totalVotesCast:        voterStat.voted,
    totalUsers: {
      students: userMap['student'] ?? 0,
      officers: userMap['officer'] ?? 0,
    },
  });
});

// ── SA elections list ─────────────────────────────────────────────────────────

export const listAllElections = asyncHandler(async (req: Request, res: Response) => {
  const { associationId, status, search } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
  const skip     = (pageNum - 1) * limitNum;

  const match: Record<string, unknown> = {};
  if (associationId) match.associationId = new mongoose.Types.ObjectId(associationId);
  if (status)        match.status        = status;
  if (search)        match.title         = { $regex: search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  const [elections, total] = await Promise.all([
    Election.find(match)
      .populate('associationId',     'name')
      .populate('assignedOfficerId', 'fullName email')
      .skip(skip).limit(limitNum).sort({ createdAt: -1 }),
    Election.countDocuments(match),
  ]);

  // FIX (Issue 12): Replace N+1 enrichment (up to 200 DB round-trips per page)
  // with a single aggregation that fetches all voter counts for this page of
  // elections in one query, then merges in application memory.
  const electionIds = elections.map((e) => e._id);

  const voterAgg = await RegisteredVoter.aggregate<{
    _id: string;
    total: number;
    voted: number;
  }>([
    { $match: { electionId: { $in: electionIds } } },
    {
      $group: {
        _id:   '$electionId',
        total: { $sum: 1 },
        voted: { $sum: { $cond: ['$hasVoted', 1, 0] } },
      },
    },
  ]);

  const voterMap = new Map(voterAgg.map((r) => [r._id.toString(), r]));

  const enriched = elections.map((e) => {
    const stats = voterMap.get(e._id.toString()) ?? { total: 0, voted: 0 };
    return {
      ...e.toObject(),
      registeredVoterCount: stats.total,
      votesCast:            stats.voted,
      turnoutPercent:       stats.total > 0
        ? Math.round((stats.voted / stats.total) * 100)
        : 0,
    };
  });

  sendPaginated(res, enriched, total, pageNum, limitNum);
});

// ── Audit logs ────────────────────────────────────────────────────────────────

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { action, performedBy, targetModel, dateFrom, dateTo } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '50', 10)));
  const skip     = (pageNum - 1) * limitNum;

  const filter: Record<string, unknown> = {};
  if (action) filter.action = action;
  if (performedBy && mongoose.Types.ObjectId.isValid(performedBy)) {
    filter.performedBy = new mongoose.Types.ObjectId(performedBy);
  }
  if (targetModel) filter.targetModel = targetModel;
  if (dateFrom || dateTo) {
    const d: Record<string, Date> = {};
    if (dateFrom) d['$gte'] = new Date(dateFrom);
    if (dateTo)   d['$lte'] = new Date(dateTo);
    filter.createdAt = d;
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('performedBy', 'fullName email role')
      .skip(skip).limit(limitNum).sort({ createdAt: -1 }),
    AuditLog.countDocuments(filter),
  ]);
  sendPaginated(res, logs, total, pageNum, limitNum);
});

// ── Semester reset ────────────────────────────────────────────────────────────
// KEPT:    Association, Election, Office, Candidate, AssociationMember, AuditLog,
//          all officer and SA accounts
// DELETED: Vote, RegisteredVoter, OtpVerification, student RefreshTokens,
//          student Avatars, student User accounts

/**
 * GET  /api/super-admin/semester-reset/preview  — dry-run, returns counts only, no deletes
 * POST /api/super-admin/semester-reset           — execute; requires { confirm: "SEMESTER_RESET" }
 *
 * Design: always run the preview first so the SA can see exactly what will be deleted.
 * The execute step enforces a literal confirmation string as an extra safety gate.
 *
 * KEPT:    Association, Election, Office, Candidate, AssociationMember, AuditLog,
 *          all officer and SA accounts
 * DELETED: Vote, RegisteredVoter, OtpVerification, student RefreshTokens,
 *          student Avatars, student User accounts
 */

// ── Dry-run preview (GET) ──────────────────────────────────────────────────────

export const semesterResetPreview = asyncHandler(async (_req: Request, res: Response) => {
  const studentIds = await User.find({ role: 'student' }).distinct('_id');

  const [votes, voters, otps, tokens, avatars, students] = await Promise.all([
    Vote.countDocuments({}),
    RegisteredVoter.countDocuments({}),
    OtpVerification.countDocuments({}),
    RefreshToken.countDocuments({ userId: { $in: studentIds } }),
    Avatar.countDocuments({ userId: { $in: studentIds } }),
    User.countDocuments({ role: 'student' }),
  ]);

  sendSuccess(res, {
    preview: true,
    willDelete: { votes, voters, otps, tokens, avatars, students },
    willKeep:   {
      associations:        await Association.countDocuments(),
      elections:           await Election.countDocuments(),
      officersAndAdmins:   await User.countDocuments({ role: { $in: ['officer', 'super_admin'] } }),
      auditLogs:           await AuditLog.countDocuments(),
    },
    instructions: 'POST to /semester-reset with { "confirm": "SEMESTER_RESET" } to execute.',
  }, 'Semester reset preview — no data has been changed');
});

// ── Execute (POST) ─────────────────────────────────────────────────────────────

export const semesterResetSchema = z.object({
  confirm: z.literal('SEMESTER_RESET', {
    errorMap: () => ({ message: 'Body must contain { "confirm": "SEMESTER_RESET" }' }),
  }),
});

export const semesterReset = asyncHandler(async (req: Request, res: Response) => {
  // Zod validation enforces the confirmation string — if it is missing or wrong, Zod
  // rejects the request before we reach this handler (validate() middleware applied in route).
  // We re-parse here as an extra safeguard in case the route is called without the middleware.
  const parsed = semesterResetSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.errors[0].message, 'CONFIRM_REQUIRED');
  }

  // ── Step 0: Write initiation log BEFORE any destructive operation ─────────
  await logAction({
    action:      AUDIT_ACTIONS.SEMESTER_RESET_INITIATED,
    performedBy: req.user._id,
    metadata:    { initiatedAt: new Date().toISOString() },
  });

  // ── Step 1: Votes ─────────────────────────────────────────────────────────
  const deletedVotes = (await Vote.deleteMany({})).deletedCount;
  await logAction({
    action:      AUDIT_ACTIONS.SEMESTER_RESET_INITIATED,   // reuse existing action as step-log
    performedBy: req.user._id,
    metadata:    { step: 'votes_deleted', deletedVotes },
  });

  // ── Step 2: Registered voters ─────────────────────────────────────────────
  const deletedVoters = (await RegisteredVoter.deleteMany({})).deletedCount;

  // ── Step 3: Pending OTPs ──────────────────────────────────────────────────
  const deletedOtps = (await OtpVerification.deleteMany({})).deletedCount;

  // ── Step 4: Student refresh tokens ───────────────────────────────────────
  const studentIds    = await User.find({ role: 'student' }).distinct('_id');
  const deletedTokens = (await RefreshToken.deleteMany({ userId: { $in: studentIds } })).deletedCount;

  // ── Step 5: Cloudinary avatars — best-effort; failures logged, not fatal ─
  const avatars = await Avatar.find({ userId: { $in: studentIds } });
  let avatarFailures = 0;
  for (const avatar of avatars) {
    try {
      await deleteImage(avatar.publicId);
    } catch (e) {
      avatarFailures++;
      console.error('Avatar Cloudinary delete failed:', e);
    }
  }
  await Avatar.deleteMany({ userId: { $in: studentIds } });

  // ── Step 6: Student accounts ──────────────────────────────────────────────
  const deletedStudents = (await User.deleteMany({ role: 'student' })).deletedCount;

  // ── Step 7: Reset elections to draft for the next semester ────────────────
  await Election.updateMany({}, {
    $set: {
      status:            'draft',
      candidatesLocked:  false,
      membersLocked:     false,
      isLocked:          false,
      results:           null,
      assignedOfficerId: null,
    },
  });

  // ── Step 8: Completion log ────────────────────────────────────────────────
  const counts = { deletedVotes, deletedVoters, deletedStudents, deletedOtps, deletedTokens, avatarFailures };
  await logAction({
    action:      AUDIT_ACTIONS.SEMESTER_RESET_COMPLETED,
    performedBy: req.user._id,
    metadata:    counts,
  });

  sendSuccess(res, counts, 'Semester reset completed');
});
