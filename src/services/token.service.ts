import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import RefreshToken from '../models/RefreshToken';
import { REFRESH_TOKEN_EXPIRY_DAYS } from '../config/constants';
import { AppError } from '../utils/AppError';
import type { Types } from 'mongoose';

// FIX (Issue 8): Role is intentionally NOT included in JWT payloads.
// The authenticate middleware always loads the user from MongoDB and reads
// role from the database — the JWT is only a bearer identity credential.
// Embedding role in the token creates a window where a demoted/suspended
// user's old token still carries their elevated role until expiry.

export interface AccessTokenPayload {
  userId: string;
}

export interface RefreshTokenPayload {
  userId: string;
}

export function signAccessToken(userId: string): string {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'] };
  // Only userId in payload — role is always read live from the DB
  return jwt.sign({ userId }, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(userId: string): string {
  const options: SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'] };
  return jwt.sign({ userId }, env.JWT_REFRESH_SECRET, options);
}

export async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  await RefreshToken.create({ userId, token, revoked: false, expiresAt });
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const record = await RefreshToken.findOne({ token });
  if (!record || record.revoked || record.expiresAt < new Date()) {
    throw new AppError(401, 'Invalid or expired refresh token');
  }
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    return payload;
  } catch {
    throw new AppError(401, 'Invalid refresh token signature');
  }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await RefreshToken.findOneAndUpdate({ token }, { $set: { revoked: true } });
}

export async function revokeAllUserTokens(
  userId: string | Types.ObjectId
): Promise<void> {
  await RefreshToken.updateMany({ userId }, { $set: { revoked: true } });
}
