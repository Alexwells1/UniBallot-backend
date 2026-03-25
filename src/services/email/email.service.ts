import { v4 as uuidv4 } from 'uuid';
import { emailQueue } from './Emailqueue.service';
import { EmailLog } from '../../models/Emaillog';

export interface SendEmailOptions {
  to:      string;
  subject: string;
  html:    string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<string> {
  const jobId = uuidv4();
  console.log(`[sendEmail] ▶ Enqueuing email | jobId=${jobId} | to=${opts.to} | subject="${opts.subject}"`);

  try {
    await EmailLog.create({
      jobId,
      to:      opts.to,
      subject: opts.subject,
      status:  'queued',
    });
    console.log(`[sendEmail] EmailLog created | jobId=${jobId}`);
  } catch (dbErr: any) {
    console.error(`[sendEmail] ❌ Failed to create EmailLog | jobId=${jobId} | error=${dbErr.message}`);
    throw dbErr;
  }

  try {
    await emailQueue.add('send-email', { ...opts, jobId }, { jobId });
    console.log(`[sendEmail] ✅ Job added to email-main queue | jobId=${jobId}`);
  } catch (queueErr: any) {
    // Job failed to enqueue — update log so it doesn't stay stuck on 'queued'
    console.error(`[sendEmail] ❌ Failed to add job to queue | jobId=${jobId} | error=${queueErr.message}`);
    await EmailLog.findOneAndUpdate(
      { jobId },
      {
        status:        'permanently_failed',
        failureType:   'temporary',
        failureReason: `Failed to enqueue: ${queueErr.message}`,
      }
    ).catch((e) => console.error(`[sendEmail] Also failed to update EmailLog after queue error | ${e.message}`));
    throw queueErr;
  }

  return jobId;
}

export {
  otpEmailTemplate,
  passwordResetNotificationTemplate,
  accountSuspendedTemplate,
  accountActivatedTemplate,
} from './Emailtemplates';