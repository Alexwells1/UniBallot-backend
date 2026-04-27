import { EmailLog } from "../../models/Emaillog";
import { SuppressedAddress } from "../../models/Suppressedaddress";
import { z } from 'zod';
import { AppError } from '../../utils/AppError';

/**
 * Resend sends webhook events as JSON POST bodies.
 * Relevant event types: email.bounced, email.complained
 * Docs: https://resend.com/docs/dashboard/webhooks/event-types
 */
const ResendWebhookEventSchema = z.object({
  type: z.string(),
  data: z.object({
    to: z.array(z.string().email()).optional().default([]),
  }).optional().default({ to: [] }),
});

export type ResendWebhookEvent = z.infer<typeof ResendWebhookEventSchema>;

export const parseResendWebhookBody = (body: unknown): ResendWebhookEvent | null => {
  const parsed = ResendWebhookEventSchema.safeParse(
    typeof body === 'string' ? JSON.parse(body) : body
  );
  return parsed.success ? parsed.data : null;
};

export const handleResendWebhook = async (event: ResendWebhookEvent | null) => {
  if (!event) throw new AppError(400, 'Invalid Resend webhook payload');

  const type: string = event.type;

  if (type === 'email.bounced') {
    await handleBounce(event);
    return { type: 'bounce', message: 'Processed' };
  }

  if (type === 'email.complained') {
    await handleComplaint(event);
    return { type: 'complaint', message: 'Processed' };
  }

  // Other event types (delivered, opened, clicked) — no action needed
  return { type: 'ignored', message: `Ignored event type: ${type}` };
};

const handleBounce = async (event: ResendWebhookEvent) => {
  // Resend bounce payload: event.data.to is an array of recipient emails
  const recipients: string[] = event.data?.to ?? [];
  for (const email of recipients) {
    const normalised = email.toLowerCase();
    await SuppressedAddress.findOneAndUpdate(
      { email: normalised },
      { email: normalised, reason: 'bounce' },
      { upsert: true, new: true }
    );
    await EmailLog.updateMany(
      { to: normalised },
      { $set: { bouncedAt: new Date() } }
    );
    console.log(`[resend-webhook] Bounce recorded for ${normalised}`);
  }
};

const handleComplaint = async (event: ResendWebhookEvent) => {
  // Resend complaint payload: event.data.to is an array of recipient emails
  const recipients: string[] = event.data?.to ?? [];
  for (const email of recipients) {
    const normalised = email.toLowerCase();
    await SuppressedAddress.findOneAndUpdate(
      { email: normalised },
      { email: normalised, reason: 'complaint' },
      { upsert: true, new: true }
    );
    await EmailLog.updateMany(
      { to: normalised },
      { $set: { complaintAt: new Date() } }
    );
    console.log(`[resend-webhook] Complaint recorded for ${normalised}`);
  }
};
