/**
 * Integrity check worker — runs off the HTTP request path.
 *
 * Processes one job at a time (concurrency: 1) so it never competes
 * with itself during large elections. Streams Vote documents with a
 * cursor so memory usage is O(1) regardless of vote count.
 *
 * On completion the result is:
 *   1. Stored on the Election document (integrityResult field)
 *   2. Written to AuditLog
 *   3. Returned as the BullMQ job return value (readable via job.returnvalue)
 */
import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import mongoose from 'mongoose';
import { env } from '../config/env';
import Vote from '../models/Vote';
import Election from '../models/Election';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS } from '../config/constants';
import type { IntegrityCheckJobData, IntegrityCheckJobResult } from './integrityCheck.queue';

const connection = {
  host:     env.REDIS_HOST,
  port:     parseInt(env.REDIS_PORT, 10),
  password: env.REDIS_PASSWORD,
};

async function processIntegrityCheck(
  job: Job<IntegrityCheckJobData, IntegrityCheckJobResult>
): Promise<IntegrityCheckJobResult> {
  const { electionId, requestedBy } = job.data;

  const election = await Election.findById(electionId);
  if (!election) throw new Error(`Election ${electionId} not found`);

  let intact = 0;
  const tamperedIds: string[] = [];

  // Stream documents one at a time — O(1) heap regardless of collection size
  const cursor = Vote
    .find({ electionId: election._id })
    .select('electionId officeId candidateId confirmationChoice voteHash createdAt')
    .lean()
    .cursor();

  let processed = 0;
  for await (const vote of cursor) {
    const choiceKey    = vote.candidateId?.toString() ?? vote.confirmationChoice ?? '';
    const expectedHash = crypto
      .createHash('sha256')
      .update(
        `${vote.electionId.toString()}${vote.officeId.toString()}` +
        `${choiceKey}${vote.createdAt.toISOString()}${env.VOTE_HASH_SECRET}`
      )
      .digest('hex');

    if (expectedHash === vote.voteHash) {
      intact++;
    } else {
      tamperedIds.push(vote._id.toString());
    }

    // Report progress every 500 votes so BullMQ dashboard shows activity
    processed++;
    if (processed % 500 === 0) {
      await job.updateProgress(processed);
    }
  }

  const result: IntegrityCheckJobResult = {
    totalVotes:  intact + tamperedIds.length,
    intact,
    tampered:    tamperedIds.length,
    tamperedIds,
  };

  // Persist result on the Election document for fast retrieval
  await Election.findByIdAndUpdate(electionId, {
    $set: { integrityResult: result, integrityCheckedAt: new Date() },
  });

  // Audit log — never logs the actual tampered vote IDs to avoid leaking
  // information; the SA can retrieve them via the job result if needed.
  await logAction({
    action:      AUDIT_ACTIONS.INTEGRITY_CHECK_RUN,
    performedBy: new mongoose.Types.ObjectId(requestedBy),
    targetId:    election._id,
    targetModel: 'Election',
    metadata: {
      totalVotes: result.totalVotes,
      intact:     result.intact,
      tampered:   result.tampered,
    },
  });

  return result;
}

// Export factory so server.ts can start/stop the worker during bootstrap/shutdown
export function createIntegrityCheckWorker() {
  const worker = new Worker<IntegrityCheckJobData, IntegrityCheckJobResult>(
    'integrity-check',
    processIntegrityCheck,
    {
      connection,
      concurrency: 1, // one integrity job at a time — CPU-bound hash loop
    }
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[integrity-worker] job ${job.id} done — ` +
      `${result.intact}/${result.totalVotes} intact, ${result.tampered} tampered`
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`[integrity-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}
