import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import mongoose from 'mongoose';
import User from '../models/User';
import Avatar from '../models/Avatar';
import Vote from '../models/Vote';
import RegisteredVoter from '../models/RegisteredVoter';
import OtpVerification from '../models/OtpVerification';
import RefreshToken from '../models/RefreshToken';
import Election from '../models/Election';
import Office from '../models/Office';
import Candidate from '../models/Candidate';
import AssociationMember from '../models/AssociationMember';
import AuditLog from '../models/AuditLog';
import Association from '../models/Association';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendPaginated } from '../utils/apiResponse';
import { sanitizeUser } from '../utils/sanitize';
import { revokeAllUserTokens } from '../services/token.service';
import { deleteImage } from '../services/upload.service';
import { logAction } from '../services/audit.service';
import { invalidateCachedUser } from '../services/userCache.service';
import { redis } from '../config/redis';
import {
  sendEmail,
  accountSuspendedTemplate,
  accountActivatedTemplate,
  passwordResetNotificationTemplate,
  officerWelcomeTemplate,
  officerElectionAssignedTemplate,
  resultsPublishedOfficerTemplate,
} from '../services/email/email.service';
import { AUDIT_ACTIONS } from '../config/constants';

export const createOfficerSchema = z.object({
  email:    z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

// ── Change own password (for officers forced to change temporary password) ───

export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
});

/**
 * PATCH /auth/change-password
 * Authenticated endpoint — any logged-in user can change their own password.
 * Clears the mustChangePassword flag after a successful change.
 */
export const changeOwnPassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof changeOwnPasswordSchema>;

  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user) throw new AppError(404, 'User not found');

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) throw new AppError(401, 'Current password is incorrect');

  if (currentPassword === newPassword) {
    throw new AppError(400, 'New password must be different from your current password');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(user._id, {
    $set: { passwordHash, mustChangePassword: false },
  });

  // Invalidate all existing refresh tokens so other sessions are logged out
  await revokeAllUserTokens(user._id);

  await logAction({
    action:      AUDIT_ACTIONS.PASSWORD_RESET,
    performedBy: req.user._id,
    targetId:    user._id,
    targetModel: 'User',
    metadata:    { selfChange: true },
  });

  sendSuccess(res, null, 'Password changed successfully. Please log in again.');
});

// ── Officer creation ──────────────────────────────────────────────────────────

export const createOfficer = asyncHandler(async (req: Request, res: Response) => {
  const { email, fullName, password } = req.body as z.infer<typeof createOfficerSchema>;
  const normalised = email.toLowerCase();

  const existing = await User.findOne({ email: normalised });
  if (existing) throw new AppError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  const officer = await User.create({
    email: normalised, passwordHash, fullName,
    role: 'officer', profileCompleted: true, isActive: true,
    // Flag them to change their temporary password on first login
    mustChangePassword: true,
  });

  await logAction({
    action:      AUDIT_ACTIONS.OFFICER_CREATED,
    performedBy: req.user._id,
    targetId:    officer._id,
    targetModel: 'User',
  });

  // Send welcome email with temporary credentials (fire-and-forget)
  sendEmail({
    to:      normalised,
    ...officerWelcomeTemplate(fullName, normalised, password),
  }).catch(() => null);

  sendSuccess(res, sanitizeUser(officer), 'Officer created successfully', 201);
});

// ── User listing & management ─────────────────────────────────────────────────

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { role, status, search } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
  const skip     = (pageNum - 1) * limitNum;

  const filter: Record<string, unknown> = {};
  if (role)                  { filter.role = role; }
  if (status === 'suspended')        { filter.isSuspended = true; }
  else if (status === 'deactivated') { filter.isActive = false; }
  else if (status === 'active')      { filter.isActive = true; filter.isSuspended = false; }
  if (search) {
    const escaped = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  await revokeAllUserTokens(user._id);
  await invalidateCachedUser(user._id.toString());

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
  await invalidateCachedUser(user._id.toString());

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
  await invalidateCachedUser(user._id.toString());

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

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(user._id, { $set: { passwordHash, mustChangePassword: true } });
  await invalidateCachedUser(user._id.toString());
  await revokeAllUserTokens(user._id.toString());

  await logAction({
    action:      AUDIT_ACTIONS.PASSWORD_RESET,
    performedBy: req.user._id,
    targetId:    user._id,
    targetModel: 'User',
  });
  if (user.fullName) {
    await sendEmail({ to: user.email, ...passwordResetNotificationTemplate(user.fullName) }).catch(() => null);
  }
  sendSuccess(res, null, 'Password reset. User must change it on next login.');
});

// ── Dashboard & analytics ─────────────────────────────────────────────────────

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

  const electionsByStatus = Object.fromEntries(electionStats.map((s) => [s._id ?? 'unknown', s.count]));
  const totalElections    = electionStats.reduce((sum, s) => sum + s.count, 0);
  const voterStat         = voterStats[0] ?? { total: 0, voted: 0 };
  const userMap           = Object.fromEntries(userStats.map((u) => [u._id, u.count]));

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

export const listAllElections = asyncHandler(async (req: Request, res: Response) => {
  const { associationId, status, search } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
  const skip     = (pageNum - 1) * limitNum;

  const match: Record<string, unknown> = {};
  if (associationId) match.associationId = new mongoose.Types.ObjectId(associationId);
  if (status)        match.status        = status;
  if (search)        match.title         = { $regex: '^' + search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  const [elections, total] = await Promise.all([
    Election.find(match)
      .select('-results -integrityResult')
      .populate('associationId',     'name')
      .populate('assignedOfficerId', 'fullName email')
      .skip(skip).limit(limitNum).sort({ createdAt: -1 })
      .lean(),
    Election.countDocuments(match),
  ]);

  const electionIds = elections.map((e) => e._id);
  const voterAgg = await RegisteredVoter.aggregate<{ _id: string; total: number; voted: number }>([
    { $match: { electionId: { $in: electionIds } } },
    { $group: { _id: '$electionId', total: { $sum: 1 }, voted: { $sum: { $cond: ['$hasVoted', 1, 0] } } } },
  ]);

  const voterMap = new Map(voterAgg.map((r) => [r._id.toString(), r]));
  const enriched = elections.map((e) => {
    const stats = voterMap.get(e._id.toString()) ?? { total: 0, voted: 0 };
    return {
      ...e,
      registeredVoterCount: stats.total,
      votesCast:            stats.voted,
      turnoutPercent:       stats.total > 0 ? Math.round((stats.voted / stats.total) * 100) : 0,
    };
  });

  sendPaginated(res, enriched, total, pageNum, limitNum);
});

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

// ── Cache management ──────────────────────────────────────────────────────────

export const clearTallyCache = asyncHandler(async (req: Request, res: Response) => {
  const { electionId } = req.params;
  const [deleted, deletedPreview] = await Promise.all([
    redis.del(`tally:${electionId}`),
    redis.del(`tally:preview:${electionId}`),
  ]);
  sendSuccess(res, { deleted, deletedPreview }, 'Tally cache cleared');
});

export const clearUserCache = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  await invalidateCachedUser(userId);
  sendSuccess(res, null, 'User cache cleared');
});

export const getCacheStats = asyncHandler(async (_req: Request, res: Response) => {
  const info = await redis.info();
  const lines = info.split('\r\n');
  const stats: Record<string, string> = {};
  for (const line of lines) {
    const [key, value] = line.split(':');
    if (key && value !== undefined) stats[key.trim()] = value.trim();
  }
  const relevant = {
    used_memory_human:        stats['used_memory_human'],
    connected_clients:        stats['connected_clients'],
    keyspace_hits:            stats['keyspace_hits'],
    keyspace_misses:          stats['keyspace_misses'],
    total_commands_processed: stats['total_commands_processed'],
    uptime_in_seconds:        stats['uptime_in_seconds'],
  };
  sendSuccess(res, relevant, 'Redis cache stats');
});

// ── Cache pattern flushing ────────────────────────────────────────────────────
// Deletes keys matching known app prefixes. Never calls FLUSHALL — scoped
// to application keys only, safe on shared Redis instances.

export const flushCacheSchema = z.object({
  patterns: z.array(z.enum([
    'users',       // user:* — cached user profiles
    'voters',      // voter:* — voter registration cache
    'ballots',     // ballot:* — cached ballots
    'tallies',     // tally:* — cached tally results
    'elections',   // open-elections — public election list cache
    'sessions',    // rl:* — rate limiter counters (resets limits)
    'otp',         // otp:* — OTP verification records in Redis
    'concurrency', // concurrency:* — vote concurrency counters
  ])).min(1, 'Select at least one pattern'),
});

const PATTERN_MAP: Record<string, string[]> = {
  users:       ['user:*'],
  voters:      ['voter:*'],
  ballots:     ['ballot:*'],
  tallies:     ['tally:*'],
  elections:   ['open-elections'],
  sessions:    ['rl:*'],
  otp:         ['otp:*'],
  concurrency: ['concurrency:*'],
};

async function deleteByPattern(pattern: string): Promise<number> {
  // KEYS is fine on free-tier single-instance Redis with small keyspace.
  // For large keyspaces, replace with SCAN cursor iteration.
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return 0;
  return redis.del(keys);
}

export const flushCache = asyncHandler(async (req: Request, res: Response) => {
  const { patterns } = req.body as z.infer<typeof flushCacheSchema>;

  const results: Record<string, number> = {};
  for (const p of patterns) {
    const globs = PATTERN_MAP[p] ?? [];
    let total = 0;
    for (const glob of globs) {
      total += await deleteByPattern(glob);
    }
    results[p] = total;
  }

  const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);

  await logAction({
    action:      AUDIT_ACTIONS.CACHE_FLUSHED ?? 'cache_flushed',
    performedBy: req.user._id,
    metadata:    { patterns, results, totalDeleted },
  });

  sendSuccess(res, { results, totalDeleted }, `Flushed ${totalDeleted} key(s) across ${patterns.length} pattern(s)`);
});

// ── Semester reset ────────────────────────────────────────────────────────────

// ── Semester reset options schemas ────────────────────────────────────────────
// Body version: real JSON booleans from POST body
export const semesterResetOptionsSchema = z.object({
  votes:        z.boolean().default(true),
  students:     z.boolean().default(true),
  officers:     z.boolean().default(false),
  elections:    z.boolean().default(false),
  associations: z.boolean().default(false),
}).default({});

// Query version: parse "true"/"false" strings from GET query params.
// z.coerce.boolean() would convert ANY non-empty string to true (including "false"),
// so we use a transform that explicitly maps the string values.
const booleanQueryParam = (defaultVal: boolean) =>
  z.union([z.boolean(), z.string()])
    .transform(v => {
      if (typeof v === 'boolean') return v;
      if (v === 'false' || v === '0') return false;
      if (v === 'true'  || v === '1') return true;
      return defaultVal;
    })
    .default(defaultVal);

const semesterResetOptionsQuerySchema = z.object({
  votes:        booleanQueryParam(true),
  students:     booleanQueryParam(true),
  officers:     booleanQueryParam(false),
  elections:    booleanQueryParam(false),
  associations: booleanQueryParam(false),
}).default({});

export const semesterResetPreview = asyncHandler(async (req: Request, res: Response) => {
  const optionsParsed = semesterResetOptionsQuerySchema.safeParse(req.query);
  const options = optionsParsed.success ? optionsParsed.data : semesterResetOptionsQuerySchema.parse({});

  const studentIds = await User.find({ role: 'student' }).distinct('_id');
  const officerIds = await User.find({ role: 'officer' }).distinct('_id');

  // Counts for each selectable category
  const [
    votes, voters, otps, studentTokens, studentAvatars, studentCount,
    officerCount, officerAvatars, officerTokens,
    electionCount, officeCount, candidateCount, memberCount,
    associationCount,
    auditLogs,
  ] = await Promise.all([
    Vote.countDocuments({}),
    RegisteredVoter.countDocuments({}),
    OtpVerification.countDocuments({}),
    RefreshToken.countDocuments({ userId: { $in: studentIds } }),
    Avatar.countDocuments({ userId: { $in: studentIds } }),
    User.countDocuments({ role: 'student' }),

    User.countDocuments({ role: 'officer' }),
    Avatar.countDocuments({ userId: { $in: officerIds } }),
    RefreshToken.countDocuments({ userId: { $in: officerIds } }),

    Election.countDocuments({}),
    Office.countDocuments({}),
    Candidate.countDocuments({}),
    AssociationMember.countDocuments({}),

    Association.countDocuments({}),

    AuditLog.countDocuments({}),
  ]);

  // Warn if associations are selected but elections are not — that would leave
  // orphaned election documents referencing deleted associations.
  const warnings: string[] = [];
  if (options.associations && !options.elections && electionCount > 0) {
    warnings.push('Deleting associations without deleting elections will leave orphaned election records. Enable "Elections" as well.');
  }
  if (options.elections && !options.associations && associationCount > 0) {
    warnings.push('Elections will be deleted but their parent associations will be kept. This is safe.');
  }

  // ── Build willDelete: only categories that are selected ───────────────────
  const willDelete: Array<{ label: string; items: Array<{ label: string; count: number }> }> = [];

  if (options.votes) {
    willDelete.push({
      label: 'Votes & Voter Records',
      items: [
        { label: 'Votes cast',             count: votes   },
        { label: 'Registered voter records', count: voters },
      ],
    });
  }
  if (options.students) {
    willDelete.push({
      label: 'Student Accounts',
      items: [
        { label: 'Student accounts', count: studentCount   },
        { label: 'Pending OTPs',     count: otps           },
        { label: 'Refresh tokens',   count: studentTokens  },
        { label: 'Avatars',          count: studentAvatars },
      ],
    });
  }
  if (options.officers) {
    willDelete.push({
      label: 'Officer Accounts',
      items: [
        { label: 'Officer accounts', count: officerCount   },
        { label: 'Refresh tokens',   count: officerTokens  },
        { label: 'Avatars',          count: officerAvatars },
      ],
    });
  }
  if (options.elections) {
    willDelete.push({
      label: 'Elections, Offices & Candidates',
      items: [
        { label: 'Elections',      count: electionCount  },
        { label: 'Offices',        count: officeCount    },
        { label: 'Candidates',     count: candidateCount },
        { label: 'Member records', count: memberCount    },
      ],
    });
  }
  if (options.associations) {
    willDelete.push({
      label: 'Associations',
      items: [
        { label: 'Associations', count: associationCount },
      ],
    });
  }

  // ── Build willKeep: categories not selected + always-kept items ────────────
  const willKeep: Array<{ label: string; count: number }> = [
    { label: 'Audit log entries', count: auditLogs },
  ];

  if (!options.votes) {
    willKeep.push(
      { label: 'Votes cast',               count: votes   },
      { label: 'Registered voter records', count: voters  },
    );
  }
  if (!options.students) {
    willKeep.push({ label: 'Student accounts', count: studentCount });
  }
  if (!options.officers) {
    willKeep.push({ label: 'Officer accounts', count: officerCount });
  }
  if (!options.elections) {
    willKeep.push({ label: 'Elections', count: electionCount });
  }
  if (!options.associations) {
    willKeep.push({ label: 'Associations', count: associationCount });
  }

  sendSuccess(res, {
    preview: true,
    options,
    warnings,
    willDelete,
    willKeep,
    instructions: 'POST to /semester-reset with { "confirm": "SEMESTER_RESET", "options": {...} } to execute.',
  }, 'Semester reset preview — no data has been changed');
});

export const semesterResetSchema = z.object({
  confirm: z.literal('SEMESTER_RESET', {
    errorMap: () => ({ message: 'Body must contain { "confirm": "SEMESTER_RESET" }' }),
  }),
  options: semesterResetOptionsSchema,
});

export const semesterReset = asyncHandler(async (req: Request, res: Response) => {
  const parsed = semesterResetSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.errors[0].message, 'CONFIRM_REQUIRED');
  }

  const { options } = parsed.data;

  // Safety guard: associations cannot be deleted without also deleting elections
  if (options.associations && !options.elections) {
    const electionCount = await Election.countDocuments({});
    if (electionCount > 0) {
      throw new AppError(400, 'Cannot delete associations while elections exist. Enable the "Elections" option as well.', 'DEPENDENCY_ERROR');
    }
  }

  const lockKey = 'lock:semester-reset';
  const lockTtl = 300;
  const lockAcquired = await redis.set(lockKey, '1', { NX: true, EX: lockTtl });
  if (!lockAcquired) {
    throw new AppError(409, 'A semester reset is already in progress. Please try again later.');
  }

  try {
    await logAction({
      action:      AUDIT_ACTIONS.SEMESTER_RESET_INITIATED,
      performedBy: req.user._id,
      metadata:    { initiatedAt: new Date().toISOString(), options },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const session = await mongoose.startSession();
    const counts: Record<string, number> = {};
    let avatarFailures = 0;
    const avatarsToDelete: Array<{ publicId: string }> = [];

    try {
      session.startTransaction({
        readConcern:    { level: 'snapshot' },
        writeConcern:   { w: 'majority' },
        maxCommitTimeMS: 60_000,
      });

      // ── Votes + voter records ───────────────────────────────────────────
      if (options.votes) {
        const votesToArchive = await Vote.find({}).lean().session(session);
        if (votesToArchive.length > 0) {
          const col = mongoose.connection.collection(`archive_votes_${timestamp}`);
          await col.insertMany(votesToArchive);
        }
        const votersToArchive = await RegisteredVoter.find({}).lean().session(session);
        if (votersToArchive.length > 0) {
          const col = mongoose.connection.collection(`archive_registeredvoters_${timestamp}`);
          await col.insertMany(votersToArchive);
        }
        counts.deletedVotes  = (await Vote.deleteMany({}, { session })).deletedCount;
        counts.deletedVoters = (await RegisteredVoter.deleteMany({}, { session })).deletedCount;
      }

      // ── Student accounts (OTPs, tokens, avatars, users) ────────────────
      if (options.students) {
        counts.deletedOtps = (await OtpVerification.deleteMany({}, { session })).deletedCount;
        const studentIds = await User.find({ role: 'student' }).distinct('_id').session(session);
        counts.deletedStudentTokens = (await RefreshToken.deleteMany({ userId: { $in: studentIds } }, { session })).deletedCount;
        const studentAvatars = await Avatar.find({ userId: { $in: studentIds } }).lean().session(session);
        avatarsToDelete.push(...studentAvatars);
        await Avatar.deleteMany({ userId: { $in: studentIds } }, { session });
        counts.deletedStudents = (await User.deleteMany({ role: 'student' }, { session })).deletedCount;
      }

      // ── Officer accounts ────────────────────────────────────────────────
      if (options.officers) {
        const officerIds = await User.find({ role: 'officer' }).distinct('_id').session(session);
        counts.deletedOfficerTokens = (await RefreshToken.deleteMany({ userId: { $in: officerIds } }, { session })).deletedCount;
        const officerAvatars = await Avatar.find({ userId: { $in: officerIds } }).lean().session(session);
        avatarsToDelete.push(...officerAvatars);
        await Avatar.deleteMany({ userId: { $in: officerIds } }, { session });
        counts.deletedOfficers = (await User.deleteMany({ role: 'officer' }, { session })).deletedCount;
      }

      // ── Elections + offices + candidates + member lists ─────────────────
      if (options.elections) {
        const electionIds = await Election.find({}).distinct('_id').session(session);
        counts.deletedMemberLists = (await AssociationMember.deleteMany({ electionId: { $in: electionIds } }, { session })).deletedCount;
        counts.deletedCandidates  = (await Candidate.deleteMany({ electionId: { $in: electionIds } }, { session })).deletedCount;
        counts.deletedOffices     = (await Office.deleteMany({ electionId: { $in: electionIds } }, { session })).deletedCount;
        counts.deletedElections   = (await Election.deleteMany({}, { session })).deletedCount;
      } else if (options.votes) {
        // If votes were cleared but elections kept, reset election status to draft
        await Election.updateMany({}, {
          $set: {
            status:            'draft',
            candidatesLocked:  false,
            membersLocked:     false,
            isLocked:          false,
            results:           null,
            integrityResult:   null,
            assignedOfficerId: null,
          },
        }, { session });
      }

      // ── Associations ────────────────────────────────────────────────────
      if (options.associations) {
        counts.deletedAssociations = (await Association.deleteMany({}, { session })).deletedCount;
      }

      await session.commitTransaction();

      // Delete Cloudinary assets after commit (best-effort, non-fatal)
      for (const avatar of avatarsToDelete) {
        try {
          await deleteImage(avatar.publicId);
        } catch (e) {
          avatarFailures++;
          console.error('Avatar Cloudinary delete failed:', e);
        }
      }
      counts.avatarFailures = avatarFailures;

    } catch (err) {
      await session.abortTransaction().catch(() => null);
      throw err;
    } finally {
      session.endSession();
    }

    await logAction({
      action:      AUDIT_ACTIONS.SEMESTER_RESET_COMPLETED,
      performedBy: req.user._id,
      metadata:    { ...counts, options },
    });

    sendSuccess(res, { counts, options }, 'Semester reset completed');
  } finally {
    await redis.del(lockKey).catch(() => null);
  }
});