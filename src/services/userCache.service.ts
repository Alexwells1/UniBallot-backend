import { redis } from '../config/redis';
import type { IUser } from '../models/User';
import type { Types } from 'mongoose';
import { sanitizeUser } from '../utils/sanitize';

/**
 * Sanitised user shape stored in Redis.
 * passwordHash and __v are always stripped before caching.
 */
export type CachedUser = Omit<IUser, 'passwordHash'>;

/**
 * A lean Mongoose result — plain JS object, no Document methods.
 * This is what .lean() returns: all IUser data fields but none of the
 * Mongoose Document internals (save, populate, collection, etc.).
 */
export type LeanUser = {
  [K in keyof Omit<IUser, keyof import('mongoose').Document>]: IUser[K];
} & { _id: Types.ObjectId; __v?: number };

/**
 * Union type accepted by setCachedUser.
 * Both full Mongoose documents and lean query results are valid inputs.
 */
type UserInput = IUser | LeanUser;

const TTL_SECONDS = 3600;
const prefix      = (id: string) => `user:${id}`;

export async function getCachedUser(userId: string): Promise<CachedUser | null> {
  try {
    const raw = await redis.get(prefix(userId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedUser;
  } catch {
    return null;
  }
}

/**
 * Serialises a user document (or lean object) to Redis, omitting
 * passwordHash and __v. A Redis compromise therefore cannot expose hashed passwords.
 */
export async function setCachedUser(user: UserInput): Promise<void> {
  try {
    const safe = sanitizeUser(user as IUser);
    await redis.setEx(prefix(user._id.toString()), TTL_SECONDS, JSON.stringify(safe));
  } catch {
    // Non-fatal — DB will serve the next request
  }
}

export async function invalidateCachedUser(userId: string): Promise<void> {
  try {
    await redis.del(prefix(userId));
  } catch {
    // Non-fatal
  }
}