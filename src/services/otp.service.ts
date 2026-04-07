import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { redis } from '../config/redis';
import {
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MAX_ATTEMPTS,
  OTP_RESEND_INTERVAL_SECONDS,
} from '../config/constants';
import { AppError } from '../utils/AppError';

const OTP_TTL_SECONDS = OTP_EXPIRY_MINUTES * 60;

interface OtpSession {
  otpHash:      string;
  passwordHash: string;
  attempts:     number;
  resendAttempts: number;
  locked:       boolean;
  expiresAt:    number;
  updatedAt:    number;
}

function sessionKey(email: string): string {
  return `otp:${email}`;
}

async function readSession(email: string): Promise<OtpSession | null> {
  const raw = await redis.get(sessionKey(email)).catch(() => null);
  if (!raw) return null;
  return JSON.parse(raw) as OtpSession;
}

async function writeSession(email: string, session: OtpSession, ttlSeconds: number): Promise<void> {
  await redis.setEx(sessionKey(email), ttlSeconds, JSON.stringify(session));
}

async function deleteSession(email: string): Promise<void> {
  await redis.del(sessionKey(email)).catch(() => null);
}

export function generateOtp(): string {
  return crypto.randomInt(100_000, 999_999).toString();
}

export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyOtp(submitted: string, hash: string): Promise<boolean> {
  return bcrypt.compare(submitted, hash);
}

/**
 * Creates or resets an OTP session stored in Redis with a 15-minute TTL.
 * Sensitive data never reaches MongoDB — the session is ephemeral by design.
 *
 * Returns { reused: true } if a valid, unlocked session already exists
 * so the caller can redirect instead of creating a duplicate.
 */
export async function createOtpRecord(
  email:        string,
  passwordHash: string
): Promise<{ otp: string; reused: false } | { otp: null; reused: true }> {
  const existing = await readSession(email);
  const now      = Date.now();

  if (existing && existing.expiresAt > now && !existing.locked) {
    return { otp: null, reused: true };
  }

  const otp     = generateOtp();
  const otpHash = await hashOtp(otp);

  const session: OtpSession = {
    otpHash,
    passwordHash,
    attempts:       0,
    resendAttempts: 0,
    locked:         false,
    expiresAt:      now + OTP_TTL_SECONDS * 1_000,
    updatedAt:      now,
  };

  await writeSession(email, session, OTP_TTL_SECONDS);

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] OTP for ${email}: ${otp}`);
  }

  return { otp, reused: false };
}

export async function resendOtp(email: string): Promise<string> {
  const session = await readSession(email);

  if (!session) {
    throw new AppError(400, 'No pending verification found for this email', 'OTP_NOT_FOUND');
  }

  const now = Date.now();

  if (session.locked) {
    throw new AppError(429, 'Too many attempts. Please register again to get a new code.', 'OTP_LOCKED');
  }

  if (session.expiresAt < now) {
    throw new AppError(400, 'Verification session has expired. Please register again.', 'OTP_EXPIRED');
  }

  if (session.resendAttempts >= OTP_RESEND_MAX_ATTEMPTS) {
    session.locked    = true;
    session.updatedAt = now;
    await writeSession(email, session, Math.ceil((session.expiresAt - now) / 1_000));
    throw new AppError(429, 'Too many resend attempts. Please register again.', 'OTP_LOCKED');
  }

  const minIntervalMs   = OTP_RESEND_INTERVAL_SECONDS * 1_000;
  const timeSinceUpdate = now - session.updatedAt;

  if (timeSinceUpdate < minIntervalMs) {
    const secondsLeft = Math.ceil((minIntervalMs - timeSinceUpdate) / 1_000);
    throw new AppError(429, `Please wait ${secondsLeft} seconds before requesting another code.`, 'RATE_LIMITED');
  }

  const newOtp    = generateOtp();
  const newHash   = await hashOtp(newOtp);
  const newExpiry = now + OTP_TTL_SECONDS * 1_000;

  const updated: OtpSession = {
    ...session,
    otpHash:        newHash,
    expiresAt:      newExpiry,
    attempts:       0,
    resendAttempts: session.resendAttempts + 1,
    updatedAt:      now,
  };
  await writeSession(email, updated, OTP_TTL_SECONDS);

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] Resent OTP for ${email}: ${newOtp}`);
  }

  return newOtp;
}

export interface OtpStatusResult {
  exists:           boolean;
  canResend:        boolean;
  secondsRemaining: number;
  locked:           boolean;
  expired:          boolean;
}

export async function getOtpStatus(email: string): Promise<OtpStatusResult> {
  const session = await readSession(email);

  if (!session) {
    return { exists: false, canResend: false, secondsRemaining: 0, locked: false, expired: false };
  }

  const now     = Date.now();
  const expired = session.expiresAt < now;
  const locked  = session.locked || session.resendAttempts >= OTP_RESEND_MAX_ATTEMPTS;

  if (expired || locked) {
    return { exists: true, canResend: false, secondsRemaining: 0, locked, expired };
  }

  const minIntervalMs   = OTP_RESEND_INTERVAL_SECONDS * 1_000;
  const timeSinceUpdate = now - session.updatedAt;
  const msRemaining     = minIntervalMs - timeSinceUpdate;

  if (msRemaining > 0) {
    return {
      exists:           true,
      canResend:        false,
      secondsRemaining: Math.ceil(msRemaining / 1_000),
      locked:           false,
      expired:          false,
    };
  }

  return { exists: true, canResend: true, secondsRemaining: 0, locked: false, expired: false };
}

export async function incrementAttempts(email: string): Promise<void> {
  const session = await readSession(email);
  if (!session) return;

  session.attempts  += 1;
  session.updatedAt  = Date.now();

  if (session.attempts >= OTP_MAX_ATTEMPTS) {
    session.locked = true;
  }

  const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1_000));
  await writeSession(email, session, ttlSeconds);
}

/**
 * Returns a partial session object for the auth controller to validate an OTP.
 * All data is read from Redis — the sole source of truth for OTP sessions.
 * `attempts` is included so the controller can compute remaining attempts accurately.
 */
export async function getOtpRecord(email: string): Promise<{
  otpHash:      string;
  passwordHash: string;
  locked:       boolean;
  expiresAt:    Date;
  attempts:     number;
} | null> {
  const session = await readSession(email);
  if (!session) return null;
  return {
    otpHash:      session.otpHash,
    passwordHash: session.passwordHash,
    locked:       session.locked,
    expiresAt:    new Date(session.expiresAt),
    attempts:     session.attempts,
  };
}

export async function deleteOtpRecord(email: string): Promise<void> {
  await deleteSession(email);
}