import { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import RegisteredVoter from '../models/RegisteredVoter';
import Vote from '../models/Vote';
import Election from '../models/Election';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { getBallot, submitBallot } from '../services/voting.service';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS } from '../config/constants';
import { env } from '../config/env';

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
  if (voter) {
    sendSuccess(res, { confirmed: true, votedAt: voter.votedAt });
  } else {
    sendSuccess(res, { confirmed: false });
  }
});

/** SA only — recomputes SHA-256 for every vote and reports tampered records */
export const integrityCheck = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');

  const votes = await Vote.find({ electionId: election._id });
  let intact = 0;
  const tampered: Array<{ voteId: string }> = [];

  for (const vote of votes) {
    const choiceKey = vote.candidateId?.toString() ?? vote.confirmationChoice ?? '';
    const expectedHash = crypto
      .createHash('sha256')
      .update(
        `${vote.electionId.toString()}${vote.officeId.toString()}${choiceKey}${vote.createdAt.toISOString()}${env.VOTE_HASH_SECRET}`
      )
      .digest('hex');

    if (expectedHash === vote.voteHash) {
      intact++;
    } else {
      tampered.push({ voteId: vote._id.toString() });
    }
  }

  await logAction({
    action:      AUDIT_ACTIONS.INTEGRITY_CHECK_RUN,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
    metadata:    { totalVotes: votes.length, intact, tampered: tampered.length },
  });

  sendSuccess(res, { totalVotes: votes.length, intact, tampered });
});
