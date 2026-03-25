import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import User from '../models/User';
import OtpVerification from '../models/OtpVerification';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import * as tokenService from '../services/token.service';
import * as otpService from '../services/otp.service';
import * as emailService from '../services/email/email.service';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS } from '../config/constants';

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp:   z.string().length(6, 'OTP must be 6 digits'),
});

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

// Issue #4 — Zod schema for resendOtp (was missing)
export const resendOtpSchema = z.object({
  email: z.string().email(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// Issue #8 — Zod schema for otp-status endpoint
export const otpStatusSchema = z.object({
  email: z.string().email(),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * Stage 1 – Accept email + password, send OTP.
 *
 * Issue #5 fix: if a valid unexpired record already exists for this email,
 * we do NOT generate a new OTP. We return a 409 telling the client to use
 * the resend endpoint instead.
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as z.infer<typeof registerSchema>;
  const normalised = email.toLowerCase();

  const existing = await User.findOne({ email: normalised });
  if (existing) throw new AppError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await otpService.createOtpRecord(normalised, passwordHash);

  // Existing valid record — do not spam a second email
  if (result.reused) {
    throw new AppError(
      409,
      'A verification code was already sent to this email. Use the resend option if you need a new one.',
      'OTP_ALREADY_SENT'
    );
  }

  const template = emailService.otpEmailTemplate(result.otp);
  await emailService.sendEmail({ to: normalised, ...template });

  sendSuccess(res, null, 'Check your email for a verification code', 201);
});

/**
 * Resend OTP.
 *
 * Issue #4 fix: now validated with Zod.
 * Issue #6 fix: catches typed AppError codes instead of string-matching.
 */
export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as z.infer<typeof resendOtpSchema>;
  const normalised = email.toLowerCase();

  const existing = await User.findOne({ email: normalised });
  if (existing) {
    throw new AppError(
      409,
      'An account with this email already exists. Please log in instead.',
      'USER_EXISTS'
    );
  }

  // AppError is thrown directly from the service with a typed code —
  // no string matching needed here. Let it bubble to the error handler.
  const newOtp = await otpService.resendOtp(normalised);

  const template = emailService.otpEmailTemplate(newOtp);
  await emailService.sendEmail({
    to: normalised,
    ...template,
    subject: 'Your New Verification Code',
  });

  sendSuccess(res, null, 'A new verification code has been sent to your email', 200);
});

/**
 * GET /auth/otp-status — Issue #8.
 * Returns live resend eligibility and countdown for frontend timers.
 */
export const otpStatus = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.query as z.infer<typeof otpStatusSchema>;
  const normalised = email.toLowerCase();

  const status = await otpService.getOtpStatus(normalised);
  sendSuccess(res, status, 'OTP status retrieved');
});

/**
 * Stage 2 – Verify OTP → create User → return token pair.
 *
 * Issue #3/#7 fix: checks locked flag and gives a clear message before
 * attempting bcrypt — record is no longer silently deleted mid-flow.
 */
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body as z.infer<typeof verifyOtpSchema>;
  const normalised = email.toLowerCase();

  const record = await OtpVerification.findOne({ email: normalised });
  if (!record) throw new AppError(400, 'No pending verification for this email', 'OTP_NOT_FOUND');

  // Locked check before anything else — gives meaningful UX (Issue #3 & #7)
  if (record.locked) {
    throw new AppError(
      400,
      'This verification session is locked due to too many failed attempts. Please register again.',
      'OTP_LOCKED'
    );
  }

  if (record.expiresAt < new Date()) {
    throw new AppError(400, 'OTP has expired. Please register again.', 'OTP_EXPIRED');
  }

  const valid = await otpService.verifyOtp(otp, record.otpHash);
  if (!valid) {
    await otpService.incrementAttempts(normalised);

    // Re-fetch to report remaining attempts accurately
    const updated = await OtpVerification.findOne({ email: normalised });
    if (updated?.locked) {
      throw new AppError(
        400,
        'Too many failed attempts — this session is now locked. Please register again.',
        'OTP_LOCKED'
      );
    }

    const remaining = updated ? 5 - updated.attempts : 0;
    throw new AppError(
      400,
      `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      'OTP_INVALID'
    );
  }

  if (!record.passwordHash) {
    throw new AppError(500, 'Registration session corrupted — please register again', 'SESSION_CORRUPT');
  }

  await OtpVerification.deleteOne({ email: normalised });

  const user = await User.create({
    email:            normalised,
    passwordHash:     record.passwordHash,
    role:             'student',
    profileCompleted: false,
  });

  await logAction({
    action:      AUDIT_ACTIONS.USER_REGISTERED,
    performedBy: user._id,
    targetId:    user._id,
    targetModel: 'User',
  });

  const accessToken  = tokenService.signAccessToken(user._id.toString());
  const refreshToken = tokenService.signRefreshToken(user._id.toString());
  await tokenService.storeRefreshToken(user._id.toString(), refreshToken);

  sendSuccess(
    res,
    { accessToken, refreshToken, user: { id: user._id, email: user.email, profileCompleted: false } },
    'Email verified — account created',
    201
  );
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const normalised = email.toLowerCase();

  const user = await User.findOne({ email: normalised });
  if (!user)            throw new AppError(401, 'Invalid email or password');
  if (!user.isActive)   throw new AppError(403, 'Account deactivated');
  if (user.isSuspended) throw new AppError(403, 'Account suspended');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError(401, 'Invalid email or password');

  const accessToken  = tokenService.signAccessToken(user._id.toString());
  const refreshToken = tokenService.signRefreshToken(user._id.toString());
  await tokenService.storeRefreshToken(user._id.toString(), refreshToken);

  sendSuccess(res, {
    accessToken,
    refreshToken,
    user: {
      id:                 user._id,
      email:              user.email,
      role:               user.role,
      profileCompleted:   user.profileCompleted,
      mustChangePassword: user.mustChangePassword,
    },
  }, 'Login successful');
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  if (!refreshToken) throw new AppError(400, 'Refresh token required');

  // verifyRefreshToken checks the DB record exists, is not revoked, and is not expired,
  // then verifies the JWT signature. Throws 401 on any failure.
  const payload = await tokenService.verifyRefreshToken(refreshToken);
  const user    = await User.findById(payload.userId);
  if (!user)            throw new AppError(401, 'User not found');
  if (!user.isActive)   throw new AppError(403, 'Account deactivated');
  if (user.isSuspended) throw new AppError(403, 'Account suspended');

  // ── Token rotation ────────────────────────────────────────────────────────
  // Revoke the incoming refresh token BEFORE issuing a new one.
  // This means a stolen token is invalidated as soon as the legitimate user refreshes.
  // If reuse of the old token is ever detected (it will fail verifyRefreshToken because
  // it's now revoked), that is a signal of theft — the SA can review audit logs or
  // extend this to revoke all tokens for the user.
  await tokenService.revokeRefreshToken(refreshToken);

  const newRefreshToken = tokenService.signRefreshToken(user._id.toString());
  await tokenService.storeRefreshToken(user._id.toString(), newRefreshToken);

  const accessToken = tokenService.signAccessToken(user._id.toString());

  sendSuccess(res, { accessToken, refreshToken: newRefreshToken }, 'Token refreshed');
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) await tokenService.revokeRefreshToken(refreshToken);
  sendSuccess(res, null, 'Logged out successfully');
});