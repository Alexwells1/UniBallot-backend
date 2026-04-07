/**
 * Integrity check queue — BullMQ Queue + typed job data.
 *
 * Shared by:
 *   • voting.controller.ts  (enqueues the job)
 *   • integrityCheck.worker.ts (processes it)
 *
 * One queue, one job type. Keeping it separate from the email queue so
 * email throughput and integrity jobs never compete for the same concurrency slot.
 */
import { Queue } from 'bullmq';
import { env } from '../config/env';

export interface IntegrityCheckJobData {
  electionId:  string;
  requestedBy: string; // userId of the SA who triggered it
}

export interface IntegrityCheckJobResult {
  totalVotes: number;
  intact:     number;
  tampered:   number;
  tamperedIds: string[];
}

// BullMQ connection — reuses the same Redis credentials as the email queue
const connection = {
  host:     env.REDIS_HOST,
  port:     parseInt(env.REDIS_PORT, 10),
  password: env.REDIS_PASSWORD,
};

export const integrityCheckQueue = new Queue<
  IntegrityCheckJobData,
  IntegrityCheckJobResult
>('integrity-check', {
  connection,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 50 },   // keep last 50 completed jobs for audit
    removeOnFail:     { count: 50 },
  },
});
