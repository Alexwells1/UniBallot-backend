import { Request, Response } from 'express';
import { z } from 'zod';
import RegisteredVoter from '../models/RegisteredVoter';
import Election from '../models/Election';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { getBallot, submitBallot } from '../services/voting.service';
import { integrityCheckQueue } from '../jobs/integrityCheck.queue';

// ── Zod schema ────────────────────────────────────────────────────────────────

export const voteSubmissionSchema = z.object({
  votes: z
    .array(
      z.object({
        officeId:           z.string().min(1),
        candidateId:        z.string().optional(),
        confirmationChoice: z.enum(['approve', 'reject']).optional(),
      })
    )
    .min(1),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export const getBallotHandler = asyncHandler(async (req: Request, res: Response) => {
  const ballot = await getBallot(req.params.id, req.user._id.toString());
  sendSuccess(res, ballot, 'Ballot retrieved');
});

export const submitBallotHandler = asyncHandler(async (req: Request, res: Response) => {
  const { votes } = req.body as z.infer<typeof voteSubmissionSchema>;
  const { receiptCode } = await submitBallot(req.params.id, req.user._id.toString(), votes);
  sendSuccess(res, { receiptCode }, 'Vote submitted successfully', 201);
});

/** Public — no auth required */
export const verifyReceipt = asyncHandler(async (req: Request, res: Response) => {
  const voter = await RegisteredVoter.findOne({
    electionId:  req.params.id,
    receiptCode: req.params.code.toUpperCase(),
  });
  sendSuccess(res, voter
    ? { confirmed: true,  votedAt: voter.votedAt }
    : { confirmed: false }
  );
});

/**
 * SA only — enqueues an integrity check job and returns immediately (202).
 *
 * The actual cursor-streaming hash loop runs in integrityCheck.worker.ts.
 * Response includes a jobId the client uses to poll getIntegrityResult.
 */
export const integrityCheck = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');

  // Deduplicate — don't stack multiple jobs for the same election
  const active = await integrityCheckQueue.getJobs(['waiting', 'active']);
  const existing = active.find((j) => j.data.electionId === req.params.id);
  if (existing) {
    return sendSuccess(res, {
      jobId:   existing.id,
      status:  'already_queued',
      message: 'An integrity check for this election is already running',
    });
  }

  const job = await integrityCheckQueue.add('check', {
    electionId:  req.params.id,
    requestedBy: req.user._id.toString(),
  });

  sendSuccess(res, {
    jobId:   job.id,
    status:  'queued',
    message: 'Poll GET /:id/integrity-result/:jobId for the result.',
  }, 'Integrity check queued', 202);
});

/**
 * SA only — poll for the result of a previously queued integrity check.
 * Returns: waiting | active | completed (with result) | failed (with reason)
 */
export const getIntegrityResult = asyncHandler(async (req: Request, res: Response) => {
  const job = await integrityCheckQueue.getJob(req.params.jobId);
  if (!job) throw new AppError(404, 'Integrity check job not found');

  const state = await job.getState();

  if (state === 'completed') {
    return sendSuccess(res, { status: 'completed', result: job.returnvalue });
  }
  if (state === 'failed') {
    return sendSuccess(res, { status: 'failed', message: job.failedReason ?? 'Unknown error' });
  }

  const progress = job.progress;
  sendSuccess(res, {
    status:   state,
    progress: typeof progress === 'number' ? progress : null,
    message:  'Still running — try again in a few seconds.',
  });
});
