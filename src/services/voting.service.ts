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
import { voteLimit } from '../server';
import { redis } from '../config/redis';

export interface VoteSubmission {
  officeId:            string;
  candidateId?:        string;
  confirmationChoice?: 'approve' | 'reject';
}

function computeVoteHash(
  electionId:     string,
  officeId:       string,
  choiceKey:      string,
  submittedAtISO: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${electionId}${officeId}${choiceKey}${submittedAtISO}${env.VOTE_HASH_SECRET}`)
    .digest('hex');
}

// ── Ballot data cache ─────────────────────────────────────────────────────────
// Election, offices, and candidates are read-only during voting_open.
// Caching them eliminates 3 sequential DB reads on every vote submission,
// cutting pre-flight latency from ~150ms to ~1ms on cache hit.

interface BallotData {
  election:   { _id: string; status: string; isLocked: boolean };
  offices:    Array<{ _id: string; title: string; description?: string }>;
  candidates: Array<{ _id: string; officeId: string; fullName: string; bio?: string; photoUrl?: string }>;
}

async function getBallotData(electionId: string): Promise<BallotData> {
  const cacheKey = `ballot:${electionId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as BallotData;
  } catch {
    // Redis unavailable — fall through to DB
  }

  const [election, offices] = await Promise.all([
    Election.findById(electionId).lean(),
    Office.find({ electionId }).lean(),
  ]);

  if (!election) throw new AppError(404, 'Election not found');

  const candidates = await Candidate.find({
    officeId: { $in: offices.map((o) => o._id) },
  }).lean();

  const data: BallotData = {
    election:   { _id: election._id.toString(), status: election.status, isLocked: election.isLocked },
    offices:    offices.map((o) => ({ _id: o._id.toString(), title: o.title, description: o.description })),
    candidates: candidates.map((c) => ({
      _id:      c._id.toString(),
      officeId: c.officeId.toString(),
      fullName: c.fullName,
      bio:      c.bio,
      photoUrl: c.photoUrl,
    })),
  };

  // Cache for 5 minutes — safe because offices and candidates are locked
  // before voting_open status is set (candidatesLocked + membersLocked = true).
  await redis.setEx(cacheKey, 300, JSON.stringify(data)).catch(() => null);
  return data;
}

// ── Get Ballot ────────────────────────────────────────────────────────────────

export async function getBallot(electionId: string, userId: string) {
  const { election, offices, candidates } = await getBallotData(electionId);

  if (election.status !== 'voting_open') throw new AppError(400, 'Voting is not open');
  if (election.isLocked) throw new AppError(423, 'Election is in lockdown');

  const voter = await RegisteredVoter.findOne({ electionId, userId }).lean();
  if (!voter) throw new AppError(403, 'You are not registered for this election');
  if (voter.hasVoted) throw new AppError(409, 'You have already voted');

  const candidatesByOffice = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!candidatesByOffice.has(c.officeId)) candidatesByOffice.set(c.officeId, []);
    candidatesByOffice.get(c.officeId)!.push(c);
  }

  return {
    isLocked:        election.isLocked,
    lockdownMessage: election.isLocked ? 'Election in emergency lockdown' : undefined,
    offices: offices.map((office) => {
      const officeCandidates = candidatesByOffice.get(office._id) ?? [];
      const voteType         = officeCandidates.length === 1 ? 'confirmation' : 'competitive';
      return {
        officeId:          office._id,
        officeTitle:       office.title,
        officeDescription: office.description,
        voteType,
        candidates: officeCandidates.map((c) => ({
          candidateId: c._id,
          fullName:    c.fullName,
          bio:         c.bio,
          photoUrl:    c.photoUrl,
        })),
        options: voteType === 'confirmation' ? ['approve', 'reject'] : undefined,
      };
    }),
  };
}

// ── Submit Ballot (public wrapper — enforces p-limit concurrency cap) ─────────
// voteLimit queues calls beyond the configured concurrency instead of
// hammering MongoDB with concurrent transactions.
// The concurrencyLimit middleware in front of the route handler is the hard
// shed layer (503); this is the soft DB protection layer (queuing).

export function submitBallot(
  electionId: string,
  userId:     string,
  votes:      VoteSubmission[]
): Promise<{ receiptCode: string }> {
  return voteLimit(() => _submitBallot(electionId, userId, votes));
}

// ── Submit Ballot (internal implementation) ───────────────────────────────────

async function _submitBallot(
  electionId: string,
  userId:     string,
  votes:      VoteSubmission[]
): Promise<{ receiptCode: string }> {

  // ── Step 1: Fast exit — check voter status BEFORE any other DB work ───────
  // During spike tests many accounts have already voted. This check exits
  // in ~5ms without touching election, offices, candidates, or a session.
  const voterCheck = await RegisteredVoter.findOne(
    { electionId, userId },
    { hasVoted: 1 }
  ).lean();

  if (!voterCheck) throw new AppError(403, 'You are not registered for this election');
  if (voterCheck.hasVoted) throw new AppError(409, 'You have already voted');

  // ── Step 2: Load election + offices + candidates from Redis cache ─────────
  // Cache hit = ~1ms. Cache miss = ~150ms (3 DB reads). Safe to cache because
  // candidatesLocked and membersLocked are set true before voting_open.
  const { election, offices, candidates } = await getBallotData(electionId);

  if (election.status !== 'voting_open') throw new AppError(400, 'Voting is not open');
  if (election.isLocked) throw new AppError(423, 'Election is in lockdown');

  // ── Step 3: Validate ballot completeness ─────────────────────────────────
  const officeIds    = offices.map((o) => o._id);
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

  // ── Step 4: Validate individual vote choices ──────────────────────────────
  const candidatesByOffice = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!candidatesByOffice.has(c.officeId)) candidatesByOffice.set(c.officeId, []);
    candidatesByOffice.get(c.officeId)!.push(c);
  }

  for (const vote of votes) {
    const office = offices.find((o) => o._id === vote.officeId);
    if (!office) throw new AppError(400, `Unknown officeId: ${vote.officeId}`);

    const officeCandidates = candidatesByOffice.get(office._id) ?? [];
    const voteType         = officeCandidates.length === 1 ? 'confirmation' : 'competitive';

    if (voteType === 'competitive') {
      if (!vote.candidateId) {
        throw new AppError(400, `candidateId required for competitive office "${office.title}"`);
      }
      if (!officeCandidates.some((c) => c._id === vote.candidateId)) {
        throw new AppError(400, `Invalid candidateId for office "${office.title}"`);
      }
    } else {
      if (!vote.confirmationChoice || !['approve', 'reject'].includes(vote.confirmationChoice)) {
        throw new AppError(400, `confirmationChoice must be 'approve' or 'reject' for office "${office.title}"`);
      }
    }
  }

  // ── Step 5: Build vote documents ─────────────────────────────────────────
  const ballotToken = crypto.randomUUID();
  const submittedAt = new Date();
  const receiptCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const electionOid = new mongoose.Types.ObjectId(electionId);

  const voteDocs = votes.map((vote) => {
    const choiceKey = vote.candidateId ?? vote.confirmationChoice ?? '';
    return {
      electionId:         electionOid,
      officeId:           new mongoose.Types.ObjectId(vote.officeId),
      candidateId:        vote.candidateId ? new mongoose.Types.ObjectId(vote.candidateId) : undefined,
      confirmationChoice: vote.confirmationChoice,
      ballotToken,
      voteHash:  computeVoteHash(electionId, vote.officeId, choiceKey, submittedAt.toISOString()),
      createdAt: submittedAt,
    };
  });

  // ── Step 6: Atomic double-vote guard — NO session/transaction needed ──────
  // findOneAndUpdate is atomic at the document level. A session wrapping this
  // single-document update adds oplog coordination overhead (~6–8s on Atlas
  // free tier) with no correctness benefit. The unique index on votes
  // (electionId + officeId + ballotToken) is the safety net against any
  // race-condition duplicate inserts.
  const voter = await RegisteredVoter.findOneAndUpdate(
    { electionId, userId, hasVoted: false },
    { $set: { hasVoted: true, ballotToken, receiptCode, votedAt: submittedAt } },
    { new: false }
  );

  if (!voter) {
    // Re-read to distinguish "not registered" from "already voted" race
    const existing = await RegisteredVoter.findOne({ electionId, userId }).lean();
    if (!existing) throw new AppError(403, 'You are not registered for this election');
    throw new AppError(409, 'You have already voted');
  }

  // ── Step 7: Insert vote documents ────────────────────────────────────────
  // ordered: false — insert all documents in parallel; if any duplicate key
  // error fires (ballotToken collision), catch it as VOTE_ALREADY_RECORDED.
  try {
    await Vote.insertMany(voteDocs, { ordered: false });
  } catch (err) {
    const isDupKey = (e: unknown): boolean => {
      if (typeof e !== 'object' || e === null) return false;
      const code        = (e as { code?: number }).code;
      const writeErrors = (e as { writeErrors?: Array<{ code?: number }> }).writeErrors;
      if (code === 11000) return true;
      if (Array.isArray(writeErrors) && writeErrors.some((w) => w.code === 11000)) return true;
      return false;
    };
    if (isDupKey(err)) throw new AppError(409, 'Your vote was already recorded', 'VOTE_ALREADY_RECORDED');
    throw err;
  }

  // ── Step 8: Audit log (fire-and-forget — non-critical) ───────────────────
  logAction({
    action:      AUDIT_ACTIONS.VOTE_SUBMITTED,
    performedBy: userId,
    targetId:    electionOid,
    targetModel: 'Vote',
    metadata:    { electionId, votedAt: submittedAt.toISOString() },
  }).catch((e) => console.error('[audit] failed to write vote audit log:', e));

  return { receiptCode };
}