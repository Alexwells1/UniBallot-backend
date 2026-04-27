import express, { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { parseResendWebhookBody, handleResendWebhook } from '../controllers/emails/sns.controller';

const router = Router();

/**
 * Verifies the Resend webhook signature using HMAC-SHA256.
 * Resend uses Svix for delivery — signature is in the svix-signature header.
 * Returns true if valid, or if no secret is configured in dev mode.
 */
function verifyResendSignature(req: Request, rawBody: Buffer): boolean {
  const secret = env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    if (env.NODE_ENV === 'production') {
      console.error('[resend-webhook] ❌ RESEND_WEBHOOK_SECRET not set in production — rejecting');
      return false;
    }
    console.warn('[resend-webhook] ⚠️ No RESEND_WEBHOOK_SECRET — skipping verification (dev only)');
    return true;
  }

  const svixId        = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn('[resend-webhook] Missing svix headers');
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
  const secretBytes   = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const computed      = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // svix-signature may contain multiple space-separated signatures (key rotation)
  const signatures = svixSignature.split(' ');
  return signatures.some((sig) => {
    const sigValue = sig.replace(/^v1,/, '');
    try {
      return crypto.timingSafeEqual(Buffer.from(sigValue, 'base64'), Buffer.from(computed, 'base64'));
    } catch {
      return false;
    }
  });
}

// Use express.raw() so we get the raw buffer for signature verification
// before JSON parsing alters the body
router.post(
  '/resend',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;

    if (!verifyResendSignature(req, rawBody)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid JSON body' });
    }

    try {
      const event  = parseResendWebhookBody(parsedBody);
      const result = await handleResendWebhook(event);
      return res.status(200).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[resend-webhook] Error:', message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

export default router;
