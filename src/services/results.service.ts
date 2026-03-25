import type { Types } from 'mongoose';
import Office from '../models/Office';
import Candidate from '../models/Candidate';
import Vote from '../models/Vote';

export interface CandidateTally {
  candidateId: string;
  fullName:    string;
  voteCount:   number;
}

export interface OfficeTally {
  officeId:     string;
  officeTitle:  string;
  voteType:     'competitive' | 'confirmation';
  totalVotes:   number;
  noVotes:      boolean;   // FIX (Issue 10): explicit flag instead of silently skipping
  isTie:        boolean;
  winner?:      string | null;
  elected?:     boolean | null;
  approveCount?: number;
  rejectCount?:  number;
  candidates:   CandidateTally[];
}

export async function computeTally(
  electionId: string | Types.ObjectId
): Promise<OfficeTally[]> {
  const offices = await Office.find({ electionId });

  const tallies: OfficeTally[] = [];

  for (const office of offices) {
    const candidates = await Candidate.find({ officeId: office._id });
    const votes      = await Vote.find({ electionId, officeId: office._id });

    // FIX (Issue 10): Never silently skip an office. If there are zero votes we
    // still emit a tally row with noVotes:true so the published result set always
    // has exactly one entry per office. Skipping would make results look complete
    // when they are not — especially dangerous for single-candidate confirmation
    // offices where low turnout is common.
    if (votes.length === 0) {
      tallies.push({
        officeId:    office._id.toString(),
        officeTitle: office.title,
        voteType:    candidates.length === 1 ? 'confirmation' : 'competitive',
        totalVotes:  0,
        noVotes:     true,
        isTie:       false,
        winner:      null,
        elected:     null,
        candidates:  candidates.map((c) => ({
          candidateId: c._id.toString(),
          fullName:    c.fullName,
          voteCount:   0,
        })),
      });
      continue;
    }

    if (candidates.length === 1) {
      // ── Confirmation ballot ─────────────────────────────────────────────────
      const approveCount = votes.filter((v) => v.confirmationChoice === 'approve').length;
      const rejectCount  = votes.filter((v) => v.confirmationChoice === 'reject').length;
      const totalVotes   = approveCount + rejectCount;
      const isTie        = approveCount === rejectCount;

      tallies.push({
        officeId:    office._id.toString(),
        officeTitle: office.title,
        voteType:    'confirmation',
        totalVotes,
        noVotes:     false,
        isTie,
        elected:     isTie ? null : approveCount > rejectCount,
        approveCount,
        rejectCount,
        candidates: [
          {
            candidateId: candidates[0]._id.toString(),
            fullName:    candidates[0].fullName,
            voteCount:   totalVotes,
          },
        ],
      });
    } else {
      // ── Competitive ballot ──────────────────────────────────────────────────
      const countMap: Record<string, { fullName: string; count: number }> = {};
      for (const c of candidates) {
        countMap[c._id.toString()] = { fullName: c.fullName, count: 0 };
      }
      for (const v of votes) {
        if (v.candidateId) {
          const id = v.candidateId.toString();
          if (countMap[id]) countMap[id].count++;
        }
      }

      const sorted = Object.entries(countMap)
        .map(([id, data]) => ({
          candidateId: id,
          fullName:    data.fullName,
          voteCount:   data.count,
        }))
        .sort((a, b) => b.voteCount - a.voteCount);

      const isTie        = sorted.length >= 2 && sorted[0].voteCount === sorted[1].voteCount;
      const topCandidate = sorted[0] ?? null;

      tallies.push({
        officeId:    office._id.toString(),
        officeTitle: office.title,
        voteType:    'competitive',
        totalVotes:  votes.length,
        noVotes:     false,
        isTie,
        winner:      isTie ? null : (topCandidate?.candidateId ?? null),
        candidates:  sorted,
      });
    }
  }

  return tallies;
}
