import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '../../config/env';

export interface ProviderSendOptions {
  to:      string;
  subject: string;
  html:    string;
}

const ses = new SESClient({
  region:      env.AWS_REGION,
  credentials: {
    accessKeyId:     env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

console.log(`[ses] SES client initialized | region=${env.AWS_REGION}`);

export async function sendViaSES(opts: ProviderSendOptions): Promise<void> {
  console.log(`[ses] Sending | to=${opts.to} | subject="${opts.subject}"`);
  try {
    await ses.send(
      new SendEmailCommand({
        Source:      env.EMAIL_FROM_ADDRESS,
        Destination: { ToAddresses: [opts.to] },
        Message: {
          Subject: { Data: opts.subject, Charset: 'UTF-8' },
          Body:    { Html:  { Data: opts.html,    Charset: 'UTF-8' } },
        },
      })
    );
    console.log(`[ses] ✅ Send successful | to=${opts.to}`);
  } catch (err: any) {
    const permanent = isPermanentSESError(err);
    console.warn(
      `[ses] ❌ Send failed | to=${opts.to} | errorName=${err.name} | errorCode=${err.Code} | isPermanent=${permanent} | message=${err.message}`
    );
    err.isPermanent = permanent;
    err.provider    = 'ses';
    throw err;
  }
}

function isPermanentSESError(err: any): boolean {
  const permanentCodes = [
    // ─── Bad request / config ──────────────────────────────
    'MessageRejected',
    'InvalidParameterValue',
    'InvalidParameterValue',
    'AccountSendingPaused',
    'MailFromDomainNotVerified',
    'ConfigurationSetDoesNotExist',
    'InvalidClientTokenId',      
    'InvalidSignatureException', 
    'AuthFailure',                
    'UnauthorizedAccess',
    'AccessDeniedException',
    'SignatureDoesNotMatch',
  ];

  return permanentCodes.includes(err?.name) || permanentCodes.includes(err?.Code);
}