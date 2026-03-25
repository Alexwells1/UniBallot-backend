import { Queue } from 'bullmq';
import { env } from '../../config/env';

export interface EmailJobData {
  to:      string;
  subject: string;
  html:    string;
  jobId:   string;
}

const connection = {
  host: env.REDIS_HOST,
  port: Number(env.REDIS_PORT),
  password: env.REDIS_PASSWORD || undefined,
};

console.log(`[email-queue] Initializing queues | redis=${env.REDIS_HOST}:${env.REDIS_PORT}`);

export const emailQueue = new Queue<EmailJobData>('email-main', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail:     200,
  },
});

export const emailRetryQueue = new Queue<EmailJobData>('email-retry', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail:     200,
  },
});

emailQueue.on('error', (err) =>
  console.error('[email-main queue] ❌ Queue error:', err.message)
);
emailRetryQueue.on('error', (err) =>
  console.error('[email-retry queue] ❌ Queue error:', err.message)
);

console.log('[email-queue] ✅ email-main and email-retry queues initialized');