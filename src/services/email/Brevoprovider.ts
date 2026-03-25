import { env } from '../../config/env';
import type { ProviderSendOptions } from './Sesprovider';

const BREVO_API_URL      = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

console.log('[brevo] Brevo client initialized');

export async function sendViaBrevo(opts: ProviderSendOptions): Promise<void> {
  console.log(`[brevo] Sending | to=${opts.to} | subject="${opts.subject}"`);

  let response: Response;

  try {
    response = await fetch(BREVO_API_URL, {
      method:  'POST',
      headers: {
        'api-key':      env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify({
        sender:      { email: env.EMAIL_FROM_ADDRESS },
        to:          [{ email: opts.to }],
        subject:     opts.subject,
        htmlContent: opts.html,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr: any) {
    // Network failure, DNS error, or timeout — always temporary
    const isTimeout = fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError';
    const message   = isTimeout
      ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : `Network error: ${fetchErr.message}`;

    console.warn(`[brevo] ❌ Fetch failed | to=${opts.to} | isTimeout=${isTimeout} | message=${message}`);

    const err: any  = new Error(message);
    err.isPermanent = false; // network/timeout failures are always temporary
    err.provider    = 'brevo';
    throw err;
  }

  // ─── Success path ───────────────────────────────────────────────────────────

  if (response.ok) {
    const successBody = await response.json().catch(() => ({})) as { messageId?: string };
    const messageId   = successBody.messageId ?? 'unknown';
    console.log(`[brevo] ✅ Send successful | to=${opts.to} | status=${response.status} | messageId=${messageId}`);
    return;
  }

  // ─── Error path ─────────────────────────────────────────────────────────────

  // Parse and validate error body — Brevo returns { code, message } on failures
  const rawBody   = await response.json().catch(() => ({}));
  const body      = parseBrevoErrorBody(rawBody, response.status);
  const permanent = isPermanentBrevoError(response.status, body.message, body.code);

  console.warn(
    `[brevo] ❌ Send failed | to=${opts.to} | status=${response.status} | code=${body.code} | isPermanent=${permanent} | message=${body.message}`
  );

  const err: any  = new Error(body.message);
  err.isPermanent = permanent;
  err.statusCode  = response.status;
  err.code        = body.code;
  err.provider    = 'brevo';
  throw err;
}

// ─── Response body parser ─────────────────────────────────────────────────────

interface BrevoErrorBody {
  message: string;
  code:    string;
}

function parseBrevoErrorBody(raw: unknown, status: number): BrevoErrorBody {
  // Validate that the body is an object with the expected shape.
  // If the API changes or returns unexpected data, fall back to safe defaults
  // rather than letting downstream code silently work with undefined values.
  if (raw !== null && typeof raw === 'object' && ('message' in raw || 'code' in raw)) {
    const body = raw as Record<string, unknown>;
    return {
      message: typeof body.message === 'string' ? body.message : `HTTP ${status}`,
      code:    typeof body.code    === 'string' ? body.code    : '',
    };
  }

  console.warn(`[brevo] ⚠️ Unexpected error body shape | status=${status} | raw=${JSON.stringify(raw)}`);
  return { message: `HTTP ${status}`, code: '' };
}

// ─── Error classification ─────────────────────────────────────────────────────

function isPermanentBrevoError(status: number, message: string, code: string): boolean {
  // 429 rate-limit and all 5xx server errors are temporary
  if (status === 429 || status >= 500) return false;

  // All other 4xx are permanent (bad request, unauthorized, forbidden, not found, etc.)
  if (status >= 400 && status < 500) return true;

  // Catch any edge cases via Brevo error codes
  const permanentCodes = [
    'invalid_parameter',
    'unauthorized',
    'forbidden',
    'not_enough_credits',
  ];
  if (permanentCodes.includes(code.toLowerCase())) return true;

  // Catch permanent states via message content
  const permanentPhrases = [
    'invalid email',
    'not a valid email',
    'unsubscribed',
    'blacklisted',
    'blocked',
    'invalid_parameter',
  ];
  return permanentPhrases.some((p) => message.toLowerCase().includes(p));
}