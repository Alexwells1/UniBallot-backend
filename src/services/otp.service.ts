import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import OtpVerification from '../models/OtpVerification';
import {
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MAX_ATTEMPTS,
  OTP_RESEND_INTERVAL_SECONDS,
} from '../config/constants';
import { AppError } from '../utils/AppError';

// -- Helpers ------------------------------------------------------------------

export function generateOtp(): string {
  return crypto.randomInt(100_000, 999_999).toString();
}

export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyOtp(submitted: string, hash: string): Promise<boolean> {
  return bcrypt.compare(submitted, hash);
}

// -- Core OTP record operations -----------------------------------------------

/**
 * Creates or resets an OTP record for the given email.
 *
 * Decision table:
 *   - No record exists                -> create fresh, return { reused: false }
 *   - Record exists, locked           -> replaceOne atomically, return { reused: false }
 *   - Record exists, expired          -> replaceOne atomically, return { reused: false }
 *   - Record exists, valid + unlocked -> return { reused: true } (caller throws OTP_ALREADY_SENT)
 *
 * The previous implementation used deleteOne + findOneAndUpdate (two round trips).
 * fetchOtpStatus could fire in the gap and still read the old locked document.
 * replaceOne with upsert:true is a single atomic operation that eliminates the gap.
 */
export async function createOtpRecord(
  email: string,
  passwordHash: string
): Promise<{ otp: string; reused: false } | { otp: null; reused: true }> {
  const now      = new Date();
  const existing = await OtpVerification.findOne({ email });

  // Valid, unlocked, unexpired -- do not overwrite, tell caller to redirect
  if (existing && existing.expiresAt > now && !existing.locked) {
    return { otp: null, reused: true };
  }

  // Locked, expired, or absent -- single atomic replaceOne + upsert.
  // No two-step delete then insert, so there is no window where the old
  // locked document is still readable.
  const otp       = generateOtp();
  const otpHash   = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1_000);

  await OtpVerification.replaceOne(
    { email },
    {
      email,
      otpHash,
      passwordHash,
      attempts:       0,
      resendAttempts: 0,
      locked:         false,
      expiresAt,
      createdAt:      now,
      updatedAt:      now,
    },
    { upsert: true }
  );

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] OTP for ${email}: ${otp}`);
  }

  return { otp, reused: false };
}

// -- Resend -------------------------------------------------------------------

export async function resendOtp(email: string): Promise<string> {
  const record = await OtpVerification.findOne({ email });

  if (!record) {
    throw new AppError(400, 'No pending verification found for this email', 'OTP_NOT_FOUND');
  }

  if (record.locked) {
    throw new AppError(
      429,
      'Too many attempts. Please register again to get a new code.',
      'OTP_LOCKED'
    );
  }

  if (record.expiresAt < new Date()) {
    throw new AppError(400, 'Verification session has expired. Please register again.', 'OTP_EXPIRED');
  }

  const now             = new Date();

  // Check max resend attempts FIRST -- before rate limiting -- so the locked
  // flag is always written regardless of whether the interval check fires.
  // Previously this ran after the interval check, leaving records in a state
  // where resendAttempts == max but locked == false when the rate limit hit first.
  if (record.resendAttempts >= OTP_RESEND_MAX_ATTEMPTS) {
    await OtpVerification.updateOne({ email }, { $set: { locked: true, updatedAt: now } });
    throw new AppError(
      429,
      'Too many resend attempts. Please register again to get a new code.',
      'OTP_LOCKED'
    );
  }

  const minIntervalMs   = OTP_RESEND_INTERVAL_SECONDS * 1_000;
  const timeSinceUpdate = now.getTime() - record.updatedAt.getTime();

  if (timeSinceUpdate < minIntervalMs) {
    const secondsLeft = Math.ceil((minIntervalMs - timeSinceUpdate) / 1_000);
    throw new AppError(
      429,
      `Please wait ${secondsLeft} seconds before requesting another code.`,
      'RATE_LIMITED'
    );
  }

  const newOtp       = generateOtp();
  const newOtpHash   = await hashOtp(newOtp);
  const newExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1_000);

  await OtpVerification.updateOne(
    { email },
    {
      $set: { otpHash: newOtpHash, expiresAt: newExpiresAt, attempts: 0, updatedAt: now },
      $inc: { resendAttempts: 1 },
    }
  );

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] Resent OTP for ${email}: ${newOtp}`);
  }

  return newOtp;
}

// -- OTP status ---------------------------------------------------------------

export interface OtpStatusResult {
  exists:           boolean;
  canResend:        boolean;
  secondsRemaining: number;
  locked:           boolean;
  expired:          boolean;
}

export async function getOtpStatus(email: string): Promise<OtpStatusResult> {
  const record = await OtpVerification.findOne({ email });

  if (!record) {
    return { exists: false, canResend: false, secondsRemaining: 0, locked: false, expired: false };
  }

  const now     = new Date();
  const expired = record.expiresAt < now;
  const locked  = record.locked || record.resendAttempts >= OTP_RESEND_MAX_ATTEMPTS;

  if (expired || locked) {
    return { exists: true, canResend: false, secondsRemaining: 0, locked, expired };
  }

  const minIntervalMs   = OTP_RESEND_INTERVAL_SECONDS * 1_000;
  const timeSinceUpdate = now.getTime() - record.updatedAt.getTime();
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

// -- Misc helpers -------------------------------------------------------------

export async function incrementAttempts(email: string): Promise<void> {
  const record = await OtpVerification.findOneAndUpdate(
    { email },
    {
      $inc: { attempts: 1 },
      $set: { updatedAt: new Date() },
    },
    { new: true }
  );

  if (record && record.attempts >= OTP_MAX_ATTEMPTS) {
    await OtpVerification.updateOne(
      { email },
      { $set: { locked: true, updatedAt: new Date() } }
    );
  }
}

export async function getOtpRecord(email: string) {
  return OtpVerification.findOne({ email });
}

export async function deleteOtpRecord(email: string): Promise<void> {
  await OtpVerification.deleteOne({ email });
}