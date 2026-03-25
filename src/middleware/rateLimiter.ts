import rateLimit from 'express-rate-limit';

const json = (message: string) => ({ success: false, message });

export const registrationLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            10,
  message:        json('Too many registration attempts, please try again later'),
  standardHeaders: true,
  legacyHeaders:  false,
});

export const loginLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            10,
  message:        json('Too many login attempts, please try again later'),
  standardHeaders: true,
  legacyHeaders:  false,
});

export const otpLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            5,
  message:        json('Too many OTP attempts, please try again later'),
  standardHeaders: true,
  legacyHeaders:  false,
});

export const votingLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            5,
  message:        json('Too many voting requests, please try again later'),
  standardHeaders: true,
  legacyHeaders:  false,
});

export const refreshLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            20,
  message:        json('Too many token refresh attempts'),
  standardHeaders: true,
  legacyHeaders:  false,
});

export const generalLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            100,
  message:        json('Too many requests, please slow down'),
  standardHeaders: true,
  legacyHeaders:  false,
});

// FIX (Issue 17): The public receipt-verification endpoint had no rate limiting.
// An attacker could enumerate valid receipt codes by probing the boolean response.
// Receipt codes are 8 hex chars (4 billion combinations) — not brute-forceable
// in practice, but the endpoint should still be defended in depth.
// 10 checks per minute per IP is generous for legitimate use.
export const receiptLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  message:         json('Too many receipt verification attempts, please try again later'),
  standardHeaders: true,
  legacyHeaders:   false,
});
