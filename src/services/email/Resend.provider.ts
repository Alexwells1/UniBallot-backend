import { Resend } from 'resend';
import { env } from '../../config/env';
import type { ProviderSendOptions } from './Sesprovider';

const resend = new Resend(env.EMAIL_API_KEY);

console.log('[resend] Resend client initialized');

export async function sendViaResend(opts: ProviderSendOptions): Promise<void> {
  console.log(`[resend] Sending | to=${opts.to} | subject="${opts.subject}"`);

  const { data, error } = await resend.emails.send({
    from:    env.EMAIL_FROM_ADDRESS,
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
  });

  if (error) {
    const permanent = isPermanentResendError(error);
    console.warn(
      `[resend] ❌ Send failed | to=${opts.to} | errorName=${error.name} | isPermanent=${permanent} | message=${error.message}`
    );
    const err: any = new Error(error.message);
    err.isPermanent = permanent;
    throw err;
  }

  if (!data) {
    console.warn(`[resend] ⚠️ No data and no error returned | to=${opts.to}`);
    throw new Error('Resend returned no data and no error');
  }

  console.log(`[resend] ✅ Send successful | to=${opts.to} | messageId=${data.id}`);
}

function isPermanentResendError(error: { message: string; name?: string }): boolean {
  const permanentPhrases = [
    'invalid_to',
    'invalid email',
    'not a valid email',
    'domain is not verified',
  ];
  const msg = error.message.toLowerCase();
  return permanentPhrases.some((p) => msg.includes(p));
}
