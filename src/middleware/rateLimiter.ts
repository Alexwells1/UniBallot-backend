import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis';
import type { Request, Response, NextFunction } from 'express';

const json = (message: string) => ({ success: false, message });

interface LimiterConfig {
  prefix:   string;
  max:      number;
  message:  string;
  windowMs: number;
}

const pendingConfigs: LimiterConfig[] = [];
const redisLimiters = new Map<string, RateLimitRequestHandler>();

/**
 * Must be called once in server.ts after connectRedis() resolves.
 * Builds all Redis-backed rate limiter instances so they share state
 * across horizontally-scaled backend nodes.
 */
export function initRedisLimiters(): void {
  for (const cfg of pendingConfigs) {
    const limiter = rateLimit({
      windowMs:        cfg.windowMs,
      max:             cfg.max,
      standardHeaders: true,
      legacyHeaders:   false,
      message:         json(cfg.message),
      store: new RedisStore({
        prefix:      cfg.prefix,
        sendCommand: (...args: string[]) => redis.sendCommand(args),
      }),
    });
    redisLimiters.set(cfg.prefix, limiter);
  }
  console.log('[rateLimiter] ✅ Redis-backed limiters initialized');
}

function makeLimiter(
  prefix:   string,
  max:      number,
  message:  string,
  windowMs = 60_000,
): (req: Request, res: Response, next: NextFunction) => void {
  pendingConfigs.push({ prefix, max, message, windowMs });

  const memLimiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         json(message),
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    const redisLimiter = redisLimiters.get(prefix);
    if (redis.isOpen && redisLimiter) {
      return redisLimiter(req, res, next);
    }
    console.warn(`[rateLimiter] Redis unavailable — memory fallback active for ${prefix}`);
    return memLimiter(req, res, next);
  };
}

// 10 registrations per IP per 15 min
export const registrationLimiter = makeLimiter('rl:reg:',     10,  'Too many registration attempts, please try again later', 15 * 60_000);
// 20 logins per IP per 15 min
export const loginLimiter         = makeLimiter('rl:login:',   20,  'Too many login attempts, please try again later', 15 * 60_000);
// 10 OTP attempts per IP per 10 min
export const otpLimiter           = makeLimiter('rl:otp:',     10,  'Too many OTP attempts, please try again later', 10 * 60_000);
// 30 vote requests per IP per minute
export const votingLimiter        = makeLimiter('rl:vote:',    30,  'Too many voting requests, please try again later');
// 60 token refreshes per IP per 15 min
export const refreshLimiter       = makeLimiter('rl:refresh:', 60,  'Too many token refresh attempts', 15 * 60_000);
// 200 general requests per IP per minute
export const generalLimiter       = makeLimiter('rl:general:', 200, 'Too many requests, please slow down');
// 30 receipt verifications per IP per minute
export const receiptLimiter       = makeLimiter('rl:receipt:', 30,  'Too many receipt verification attempts, please try again later');

/**
 * Election code lookups are unauthenticated and short-code brute-forceable.
 * 10 requests per minute per IP limits enumeration to a crawl.
 */
export const codeLookupLimiter = makeLimiter('rl:code:', 10, 'Too many election code lookups, please try again later');

// 5 uploads per user per minute
export const uploadLimiter = makeLimiter('rl:upload:', 5, 'Too many upload attempts, please wait before uploading again');

// 30 public election lookups per IP per minute
export const publicElectionLimiter = makeLimiter('rl:pubElection:', 30, 'Too many requests, please slow down');
