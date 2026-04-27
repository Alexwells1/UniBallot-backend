import type { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';

const MAX_CONCURRENT = 30;
const COUNTER_KEY    = 'concurrency:votes';
const COUNTER_TTL    = 30; // seconds — safety expiry so a crashed node never permanently blocks

export async function concurrencyLimit(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  let acquired = false;

  try {
    // Atomic increment — returns the new value
    const current = await redis.incr(COUNTER_KEY);

    // Set a TTL on first increment so a crashed process never leaves the key stuck
    if (current === 1) {
      await redis.expire(COUNTER_KEY, COUNTER_TTL);
    }

    if (current > MAX_CONCURRENT) {
      // Over limit — decrement immediately and reject
      await redis.decr(COUNTER_KEY);
      res.status(503).json({
        success: false,
        message: 'Server busy, please retry shortly',
        code:    'CONCURRENCY_LIMIT',
      });
      return;
    }

    acquired = true;

    const guard = { done: false };
    const release = async () => {
      if (guard.done) return;
      guard.done = true;
      await redis.decr(COUNTER_KEY).catch(() => null);
    };

    res.on('finish', release);
    res.on('close',  release);

    next();
  } catch {
    // Redis unavailable — fail open (don't block the request, just skip the limit)
    if (!acquired) next();
  }
}