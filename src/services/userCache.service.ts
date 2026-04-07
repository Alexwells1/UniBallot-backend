import { redis } from '../config/redis';
import type { IUser } from '../models/User';
import { sanitizeUser } from '../utils/sanitize';

/**
 * Sanitised user shape stored in Redis.
 * passwordHash and __v are always stripped before caching.
 */
export type CachedUser = Omit<IUser, 'passwordHash'>;

const TTL_SECONDS = 300;
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
 * Serialises a user document to Redis, omitting passwordHash and __v.
 * A Redis compromise therefore cannot expose hashed passwords.
 */
export async function setCachedUser(user: IUser): Promise<void> {
  try {
    const safe = sanitizeUser(user);
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
