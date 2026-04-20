import type { Request, Response, NextFunction } from 'express'; // fix: import types explicitly

let activeRequests = 0;
const MAX_CONCURRENT = 80;

// Track whether we've already decremented for this request.
// Without this guard, both 'finish' and 'close' firing on the same
// response would double-decrement activeRequests.
function decrement(decremented: { done: boolean }): void {
  if (decremented.done) return;
  decremented.done = true;
  activeRequests--;
}

export function concurrencyLimit(
  req:  Request,
  res:  Response,
  next: NextFunction        // fix: now resolvable via explicit import above
): void {
  if (activeRequests >= MAX_CONCURRENT) {
    // fix: cast to express Response so .status() is the chainable method,
    // not the numeric property on the raw http.ServerResponse
    res.status(503).json({
      success: false,
      message: 'Server busy, please retry shortly',
      code:    'CONCURRENCY_LIMIT',
    });
    return;
  }

  activeRequests++;
  const guard = { done: false };

  // fix: res.on() IS available on Express Response (it extends http.ServerResponse
  // which extends EventEmitter) — the error was caused by missing @types/express.
  // Ensure @types/express is in your devDependencies.
  res.on('finish', () => decrement(guard)); // normal response sent
  res.on('close',  () => decrement(guard)); // client disconnected early

  next();
}