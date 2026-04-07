import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import User from "../models/User";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/apiResponse";
import * as tokenService from "../services/token.service";
import * as otpService from "../services/otp.service";
import * as emailService from "../services/email/email.service";
import { logAction } from "../services/audit.service";
import { AUDIT_ACTIONS, OTP_MAX_ATTEMPTS } from "../config/constants";
import { invalidateCachedUser } from "../services/userCache.service";
import { sanitizeUser } from "../utils/sanitize";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const funaabStudentEmail = z
  .string()
  .regex(
    /^[a-zA-Z0-9._%+-]+@student\.funaab\.edu\.ng$/,
    "Only FUNAAB student emails are allowed (e.g. john.doe@student.funaab.edu.ng)",
  );

export const registerSchema = z.object({
  email: funaabStudentEmail,
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const verifyOtpSchema = z.object({
  email: funaabStudentEmail,
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export const resendOtpSchema = z.object({
  email: funaabStudentEmail,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const otpStatusSchema = z.object({
  email: funaabStudentEmail,
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as z.infer<typeof registerSchema>;
  const normalised = email.toLowerCase();

  const existing = await User.findOne({ email: normalised });
  if (existing)
    throw new AppError(409, "An account with this email already exists");

  // Cost 10 — ~65ms per hash on modern hardware. Async, never blocks event loop.
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await otpService.createOtpRecord(normalised, passwordHash);

  if (result.reused) {
    throw new AppError(
      409,
      "A verification code was already sent to this email. Use the resend option if you need a new one.",
      "OTP_ALREADY_SENT",
    );
  }

  const template = emailService.otpEmailTemplate(result.otp);
  await emailService.sendEmail({ to: normalised, ...template });

  sendSuccess(res, null, "Check your email for a verification code", 201);
});

export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as z.infer<typeof resendOtpSchema>;
  const normalised = email.toLowerCase();

  const existing = await User.findOne({ email: normalised });
  if (existing) {
    throw new AppError(
      409,
      "An account with this email already exists. Please log in instead.",
      "USER_EXISTS",
    );
  }

  const newOtp = await otpService.resendOtp(normalised);

  const template = emailService.otpEmailTemplate(newOtp);
  await emailService.sendEmail({
    to: normalised,
    ...template,
    subject: "Your New Verification Code",
  });

  sendSuccess(
    res,
    null,
    "A new verification code has been sent to your email",
    200,
  );
});

export const otpStatus = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.query as z.infer<typeof otpStatusSchema>;
  const normalised = email.toLowerCase();

  const status = await otpService.getOtpStatus(normalised);
  sendSuccess(res, status, "OTP status retrieved");
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body as z.infer<typeof verifyOtpSchema>;
  const normalised = email.toLowerCase();

  // FIX: read OTP session from Redis — that is where createOtpRecord() wrote it.
  // The old code called OtpVerification.findOne() (MongoDB) which was always
  // empty because the service never writes there, causing "No pending
  // verification for this email" on every verify attempt.
  const record = await otpService.getOtpRecord(normalised);
  if (!record)
    throw new AppError(
      400,
      "No pending verification for this email",
      "OTP_NOT_FOUND",
    );

  if (record.locked) {
    throw new AppError(
      400,
      "This verification session is locked due to too many failed attempts. Please register again.",
      "OTP_LOCKED",
    );
  }

  if (record.expiresAt < new Date()) {
    throw new AppError(
      400,
      "OTP has expired. Please register again.",
      "OTP_EXPIRED",
    );
  }

  const valid = await otpService.verifyOtp(otp, record.otpHash);
  if (!valid) {
    await otpService.incrementAttempts(normalised);

    // FIX: re-read updated attempt count from Redis, not MongoDB.
    const updated = await otpService.getOtpRecord(normalised);
    if (updated?.locked) {
      throw new AppError(
        400,
        "Too many failed attempts — this session is now locked. Please register again.",
        "OTP_LOCKED",
      );
    }

    const remaining = updated
      ? Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts)
      : 0;
    throw new AppError(
      400,
      `Invalid OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      "OTP_INVALID",
    );
  }

  if (!record.passwordHash) {
    throw new AppError(
      500,
      "Registration session corrupted — please register again",
      "SESSION_CORRUPT",
    );
  }

  // FIX: delete from Redis (source of truth), not MongoDB.
  await otpService.deleteOtpRecord(normalised);

  const user = await User.create({
    email: normalised,
    passwordHash: record.passwordHash,
    role: "student",
    profileCompleted: false,
  });

  await logAction({
    action: AUDIT_ACTIONS.USER_REGISTERED,
    performedBy: user._id,
    targetId: user._id,
    targetModel: "User",
  });

  const accessToken = tokenService.signAccessToken(user._id.toString());
  const refreshToken = tokenService.signRefreshToken(user._id.toString());
  await tokenService.storeRefreshToken(user._id.toString(), refreshToken);

  sendSuccess(
    res,
    {
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    },
    "Email verified — account created",
    201,
  );
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const normalised = email.toLowerCase();

  const user = await User.findOne({ email: normalised });
  if (!user) throw new AppError(401, "Invalid email or password");
  if (!user.isActive) throw new AppError(403, "Account deactivated");
  if (user.isSuspended) throw new AppError(403, "Account suspended");

  // Async compare — never blocks the event loop
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError(401, "Invalid email or password");

  const accessToken = tokenService.signAccessToken(user._id.toString());
  const refreshToken = tokenService.signRefreshToken(user._id.toString());
  await tokenService.storeRefreshToken(user._id.toString(), refreshToken);

  sendSuccess(
    res,
    {
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    },
    "Login successful",
  );
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  if (!refreshToken) throw new AppError(400, "Refresh token required");

  const payload = await tokenService.verifyRefreshToken(refreshToken);
  const user = await User.findById(payload.userId);
  if (!user) throw new AppError(401, "User not found");
  if (!user.isActive) throw new AppError(403, "Account deactivated");
  if (user.isSuspended) throw new AppError(403, "Account suspended");

  // Token rotation — revoke old, issue new
  await tokenService.revokeRefreshToken(refreshToken);

  const newRefreshToken = tokenService.signRefreshToken(user._id.toString());
  await tokenService.storeRefreshToken(user._id.toString(), newRefreshToken);

  const accessToken = tokenService.signAccessToken(user._id.toString());

  sendSuccess(
    res,
    { accessToken, refreshToken: newRefreshToken },
    "Token refreshed",
  );
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) await tokenService.revokeRefreshToken(refreshToken);

  // Bust cache so the next request re-reads from DB
  if (req.user) await invalidateCachedUser(req.user._id.toString());

  sendSuccess(res, null, "Logged out successfully");
});