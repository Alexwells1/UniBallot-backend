import crypto from 'crypto';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import Election from '../models/Election';
import Office from '../models/Office';
import Candidate from '../models/Candidate';
import RegisteredVoter from '../models/RegisteredVoter';
import Vote from '../models/Vote';
import { logAction } from './audit.service';
import { AUDIT_ACTIONS } from '../config/constants';

export interface VoteSubmission {
  officeId:           string;
  candidateId?:       string;
  confirmationChoice?: 'approve' | 'reject';
}

function computeVoteHash(
  electionId:      string,
  officeId:        string,
  choiceKey:       string,
  submittedAtISO:  string
): string {
  return crypto
    .createHash('sha256')
    .update(`${electionId}${officeId}${choiceKey}${submittedAtISO}${env.VOTE_HASH_SECRET}`)
    .digest('hex');
}

// ── Get Ballot ────────────────────────────────────────────────────────────────

export async function getBallot(electionId: string, userId: string) {
  const election = await Election.findById(electionId);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'voting_open') throw new AppError(400, 'Voting is not open');
  if (election.isLocked) throw new AppError(423, 'Election is in lockdown');

  const voter = await RegisteredVoter.findOne({ electionId, userId });
  if (!voter) throw new AppError(403, 'You are not registered for this election');
  if (voter.hasVoted) throw new AppError(409, 'You have already voted');

  const offices = await Office.find({ electionId }).sort({ createdAt: 1 });

  const ballot = await Promise.all(
    offices.map(async (office) => {
      const candidates = await Candidate.find({ officeId: office._id });
      const voteType   = candidates.length === 1 ? 'confirmation' : 'competitive';
      return {
        officeId:          office._id,
        officeTitle:       office.title,
        officeDescription: office.description,
        voteType,
        candidates: candidates.map((c) => ({
          candidateId: c._id,
          fullName:    c.fullName,
          bio:         c.bio,
          photoUrl:    c.photoUrl,
        })),
        options: voteType === 'confirmation' ? ['approve', 'reject'] : undefined,
      };
    })
  );

  return ballot;
}

// ── Submit Ballot ─────────────────────────────────────────────────────────────

export async function submitBallot(
  electionId: string,
  userId:     string,
  votes:      VoteSubmission[]
): Promise<{ receiptCode: string }> {

  // Step 1: Election state guard
  const election = await Election.findById(electionId);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'voting_open') throw new AppError(400, 'Voting is not open');
  if (election.isLocked) throw new AppError(423, 'Election is in lockdown');

  // Step 2: Atomic double-vote guard
  // findOneAndUpdate with hasVoted:false condition is the race-condition-safe lock.
  // Returns the OLD doc (new:false). null means not registered OR already voted.
  const voter = await RegisteredVoter.findOneAndUpdate(
    { electionId, userId, hasVoted: false },
    { $set: { hasVoted: true } },
    { new: false }
  );

  if (!voter) {
    const existing = await RegisteredVoter.findOne({ electionId, userId });
    if (!existing) throw new AppError(403, 'You are not registered for this election');
    throw new AppError(409, 'You have already voted');
  }

  // From here hasVoted=true in the DB. Wrap everything in try/catch — roll back on any error.
  try {
    // Step 3: Validate ballot completeness
    const offices     = await Office.find({ electionId });
    const officeIds   = offices.map((o) => o._id.toString());
    const submittedIds = votes.map((v) => v.officeId);

    const missing = officeIds.filter((id) => !submittedIds.includes(id));
    const extra   = submittedIds.filter((id) => !officeIds.includes(id));
    const dupes   = submittedIds.filter((id, i) => submittedIds.indexOf(id) !== i);

    if (missing.length || extra.length || dupes.length) {
      throw new AppError(
        400,
        `Ballot mismatch. Missing: [${missing.join(', ')}] Extra: [${extra.join(', ')}] Duplicates: [${dupes.join(', ')}]`
      );
    }

    // FIX (Issue 16): Pre-load ALL candidates for every office in one query,
    // then group by officeId in memory. The old code fired one Candidate.find()
    // per office inside the loop — O(N) round-trips during a time-critical
    // ballot submission. One query + in-memory grouping is strictly faster.
    const allCandidates = await Candidate.find({
      officeId: { $in: offices.map((o) => o._id) },
    });

    // Group by officeId string for O(1) lookup inside the validation loop
    const candidatesByOffice = new Map<string, typeof allCandidates>();
    for (const c of allCandidates) {
      const key = c.officeId.toString();
      if (!candidatesByOffice.has(key)) candidatesByOffice.set(key, []);
      candidatesByOffice.get(key)!.push(c);
    }

    // Step 4: Validate each individual vote choice
    for (const vote of votes) {
      const office = offices.find((o) => o._id.toString() === vote.officeId);
      if (!office) throw new AppError(400, `Unknown officeId: ${vote.officeId}`);

      const candidates = candidatesByOffice.get(office._id.toString()) ?? [];
      const voteType   = candidates.length === 1 ? 'confirmation' : 'competitive';

      if (voteType === 'competitive') {
        if (!vote.candidateId) {
          throw new AppError(400, `candidateId required for competitive office "${office.title}"`);
        }
        const valid = candidates.some((c) => c._id.toString() === vote.candidateId);
        if (!valid) throw new AppError(400, `Invalid candidateId for office "${office.title}"`);
      } else {
        if (!vote.confirmationChoice || !['approve', 'reject'].includes(vote.confirmationChoice)) {
          throw new AppError(400, `confirmationChoice must be 'approve' or 'reject' for office "${office.title}"`);
        }
      }
    }

    // Step 5: Build vote documents
    const ballotToken  = crypto.randomUUID();
    const submittedAt  = new Date();
    const receiptCode  = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars, e.g. A3F7C912

    const electionOid = new mongoose.Types.ObjectId(electionId);

    const voteDocs = votes.map((vote) => {
      const choiceKey = vote.candidateId ?? vote.confirmationChoice ?? '';
      const voteHash  = computeVoteHash(
        electionId,
        vote.officeId,
        choiceKey,
        submittedAt.toISOString()
      );
      return {
        electionId:         electionOid,
        officeId:           new mongoose.Types.ObjectId(vote.officeId),
        candidateId:        vote.candidateId ? new mongoose.Types.ObjectId(vote.candidateId) : undefined,
        confirmationChoice: vote.confirmationChoice,
        ballotToken,
        voteHash,
        createdAt:          submittedAt, // set explicitly — field is immutable
      };
    });

    // Step 6: Bulk insert
    await Vote.insertMany(voteDocs);

    // Step 7: Finalise voter record with token + receipt
    await RegisteredVoter.findOneAndUpdate(
      { electionId, userId },
      { $set: { ballotToken, receiptCode, votedAt: submittedAt } }
    );

    // Step 8: Minimal audit log — never log candidateId, choice, or ballotToken
    await logAction({
      action:      AUDIT_ACTIONS.VOTE_SUBMITTED,
      performedBy: userId,
      targetId:    electionOid,
      targetModel: 'Vote',
      metadata:    { electionId, votedAt: submittedAt.toISOString() },
    });

    return { receiptCode };

  } catch (err) {
    // ── Smart rollback ────────────────────────────────────────────────────────
    // Only reset hasVoted=false for application-level errors (AppError or unexpected
    // runtime failures). DB constraint violations (code 11000) mean Vote documents
    // were already inserted — resetting the flag would let the voter bypass the
    // double-vote guard by replaying the request with a new ballot.
    //
    // Classification:
    //   AppError              → application logic failure before/during insert → rollback OK
    //   code 11000            → duplicate-key constraint → votes exist, do NOT rollback
    //   BulkWriteError        → partial insert from insertMany (ordered:false) → treat as
    //                           constraint violation, do NOT rollback
    //   anything else         → unexpected (network, schema, etc.) → rollback OK so
    //                           voter can retry; the integrity check will catch orphaned docs

    const isDuplicateKeyError = (e: unknown): boolean => {
      if (typeof e !== 'object' || e === null) return false;
      const code = (e as { code?: number }).code;
      // Mongoose BulkWriteError wraps individual write errors in .writeErrors[]
      const writeErrors = (e as { writeErrors?: Array<{ code?: number }> }).writeErrors;
      if (code === 11000) return true;
      if (Array.isArray(writeErrors) && writeErrors.some((we) => we.code === 11000)) return true;
      return false;
    };

    if (isDuplicateKeyError(err)) {
      // Votes are already persisted (or partially persisted) — do not reset the flag.
      // Surface a clear 409 so the client knows this is a confirmed duplicate, not a
      // retriable error.
      throw new AppError(409, 'Your vote was already recorded', 'VOTE_ALREADY_RECORDED');
    }

    // Safe to rollback — no vote documents were committed.
    await RegisteredVoter.findOneAndUpdate(
      { electionId, userId },
      { $set: { hasVoted: false } }
    ).catch(() => null);

    throw err;
  }
}
