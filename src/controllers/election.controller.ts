import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import Election from '../models/Election';
import Association from '../models/Association';
import AssociationMember from '../models/AssociationMember';
import Office from '../models/Office';
import Candidate from '../models/Candidate';
import RegisteredVoter from '../models/RegisteredVoter';
import Vote from '../models/Vote';
import User from '../models/User';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendPaginated } from '../utils/apiResponse';
import { generateElectionCode } from '../utils/generateCode';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS, ELECTION_STATUS_ORDER, ElectionStatus } from '../config/constants';
import { computeTally } from '../services/results.service';

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const createElectionSchema = z.object({
  associationId: z.string().min(1, 'associationId is required'),
  title:         z.string().min(2),
  description:   z.string().optional(),
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const createElection = asyncHandler(async (req: Request, res: Response) => {
  const { associationId, title, description } = req.body as z.infer<typeof createElectionSchema>;

  const association = await Association.findById(associationId);
  if (!association) throw new AppError(404, 'Association not found');

  const electionCode = await generateElectionCode();
  const election = await Election.create({ associationId, title, description, electionCode, status: 'draft' });

  await logAction({
    action:      AUDIT_ACTIONS.ELECTION_CREATED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
  });

  sendSuccess(res, election, 'Election created', 201);
});

export const listElections = asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '20', associationId, status, search } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip     = (pageNum - 1) * limitNum;

  const filter: Record<string, unknown> = {};
  if (req.user.role === 'officer') filter.assignedOfficerId = req.user._id;
  if (associationId) filter.associationId = new mongoose.Types.ObjectId(associationId);
  if (status) filter.status = status;
  if (search) filter.title  = { $regex: search, $options: 'i' };

  const [elections, total] = await Promise.all([
    Election.find(filter)
      .populate('associationId',     'name')
      .populate('assignedOfficerId', 'fullName email')
      .skip(skip).limit(limitNum).sort({ createdAt: -1 }),
    Election.countDocuments(filter),
  ]);

  sendPaginated(res, elections, total, pageNum, limitNum);
});

export const getElection = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id)
    .populate('associationId',     'name')
    .populate('assignedOfficerId', 'fullName email');
  if (!election) throw new AppError(404, 'Election not found');
  sendSuccess(res, election);
});

/** Public — returns only safe fields; no officer/results/sensitive data */
export const getElectionByCode = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findOne({ electionCode: req.params.code.toUpperCase() })
    .populate<{ associationId: { name: string } }>('associationId', 'name');
  if (!election) throw new AppError(404, 'Election not found');

  sendSuccess(res, {
    title:           election.title,
    associationName: election.associationId.name,
    status:          election.status,
    electionCode:    election.electionCode,
  });
});


export const getOpenElections = asyncHandler(async (_req: Request, res: Response) => {
  const elections = await Election.find({
    status:   'registration_open',
    isLocked: false,
  })
    .populate<{ associationId: { name: string } }>('associationId', 'name')
    .sort({ createdAt: -1 })
    .lean();
 
  const safe = elections.map((e) => ({
    title:           e.title,
    associationName: (e.associationId as unknown as { name: string }).name,
    electionCode:    e.electionCode,
    status:          e.status,
  }));
 
  sendSuccess(res, safe);
});


export const updateElection = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (!['draft', 'setup'].includes(election.status)) {
    throw new AppError(400, 'Election can only be updated in draft or setup status');
  }

  const { title, description } = req.body as { title?: string; description?: string };
  const updateFields: Record<string, string> = {};
  if (title !== undefined)       updateFields.title       = title;
  if (description !== undefined) updateFields.description = description;

  const updated = await Election.findByIdAndUpdate(
    req.params.id,
    { $set: updateFields },
    { new: true, runValidators: true }
  );
  sendSuccess(res, updated, 'Election updated');
});

// ── Officer assignment (SA only — route: /api/super-admin/elections/:id/assign-officer) ─────

export const assignOfficer = asyncHandler(async (req: Request, res: Response) => {
  const { officerId } = req.body as { officerId: string };

  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');

  const officer = await User.findById(officerId);
  if (!officer || officer.role !== 'officer') throw new AppError(400, 'User is not an officer');
  if (!officer.isActive || officer.isSuspended) throw new AppError(400, 'Officer account is not active');

  // One officer per active (non-results_published) election
  const alreadyAssigned = await Election.findOne({
    assignedOfficerId: officerId,
    _id:    { $ne: election._id },
    status: { $ne: 'results_published' },
  });
  if (alreadyAssigned) throw new AppError(409, 'Officer is already assigned to another active election');

  await Election.findByIdAndUpdate(election._id, { $set: { assignedOfficerId: officerId } });
  await logAction({
    action:      AUDIT_ACTIONS.OFFICER_ASSIGNED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
    metadata:    { officerId },
  });

  sendSuccess(res, null, 'Officer assigned');
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export const transitionStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status: newStatus } = req.body as { status: string };

  if (!ELECTION_STATUS_ORDER.includes(newStatus as ElectionStatus)) {
    throw new AppError(400, `Invalid status value: ${newStatus}`);
  }
  const typedStatus = newStatus as ElectionStatus;

  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.isLocked) throw new AppError(423, 'Election is in lockdown — deactivate lockdown first');

  const currentIdx = ELECTION_STATUS_ORDER.indexOf(election.status);
  const newIdx     = ELECTION_STATUS_ORDER.indexOf(typedStatus);

  if (req.user.role !== 'super_admin' && newIdx !== currentIdx + 1) {
    throw new AppError(400, 'Officers may only advance to the immediate next status');
  }

  // Pre-transition business rules
  if (typedStatus === 'registration_open') {
    const memberCount = await AssociationMember.countDocuments({ electionId: election._id });
    if (memberCount === 0) throw new AppError(400, 'Upload at least one member before opening registration');
  }

  if (typedStatus === 'voting_open') {
    const offices = await Office.find({ electionId: election._id });
    if (offices.length === 0) throw new AppError(400, 'At least one office is required');
    for (const office of offices) {
      const count = await Candidate.countDocuments({ officeId: office._id });
      if (count === 0) throw new AppError(400, `Office "${office.title}" has no candidates`);
    }
  }

  const updateFields: Record<string, unknown> = { status: typedStatus };
  if (typedStatus === 'voting_open') {
    updateFields.candidatesLocked = true;
    updateFields.membersLocked    = true;
  }

  await Election.findByIdAndUpdate(election._id, { $set: updateFields });
  await logAction({
    action:      AUDIT_ACTIONS.STATUS_CHANGED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
    metadata:    { from: election.status, to: typedStatus },
  });

  sendSuccess(res, null, `Election status changed to ${typedStatus}`);
});

export const toggleLockdown = asyncHandler(async (req: Request, res: Response) => {
  const { active } = req.body as { active: boolean };
  const election = await Election.findByIdAndUpdate(
    req.params.id,
    { $set: { isLocked: active } },
    { new: true }
  );
  if (!election) throw new AppError(404, 'Election not found');

  const action = active ? AUDIT_ACTIONS.LOCKDOWN_ACTIVATED : AUDIT_ACTIONS.LOCKDOWN_DEACTIVATED;
  await logAction({ action, performedBy: req.user._id, targetId: election._id, targetModel: 'Election' });
  sendSuccess(res, null, `Lockdown ${active ? 'activated' : 'deactivated'}`);
});

// ── Student election registration ─────────────────────────────────────────────

export const registerForElection = asyncHandler(async (req: Request, res: Response) => {
  const { electionCode } = req.body as { electionCode: string };

  if (!req.user.profileCompleted) {
    throw new AppError(400, 'Complete your profile before registering for elections');
  }

  const election = await Election.findOne({ electionCode: electionCode.toUpperCase() });
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'registration_open') throw new AppError(400, 'Registration is not open for this election');
  if (election.isLocked) throw new AppError(423, 'Election is in lockdown');

  // Check eligibility first (separate from the registration write — eligibility
  // data is read-only during registration so there is no race condition here).
  const orConditions: Array<Record<string, unknown>> = [{ email: req.user.email }];
  if (req.user.matricNumber) {
    orConditions.push({ matricNumber: req.user.matricNumber });
  }
  const eligible = await AssociationMember.findOne({
    electionId: election._id,
    $or:        orConditions,
  });
  if (!eligible) throw new AppError(403, 'You are not on the eligibility list for this election');

  // FIX (Issue 4): Replace the non-atomic findOne → create pattern with a single
  // findOneAndUpdate upsert. The old code had a TOCTOU window: two concurrent
  // requests could both pass the findOne check before either create completed,
  // resulting in two RegisteredVoter documents for the same voter.
  //
  // $setOnInsert only writes when the document is newly created (upsert), so
  // an existing document is never modified. new:false returns the document that
  // existed BEFORE the operation — null means it was just inserted (success),
  // a non-null value means the document already existed (duplicate).
  const existingVoter = await RegisteredVoter.findOneAndUpdate(
    { electionId: election._id, userId: req.user._id },
    {
      $setOnInsert: {
        electionId: election._id,
        userId:     req.user._id,
        hasVoted:   false,
      },
    },
    { upsert: true, new: false }
  );

  if (existingVoter !== null) {
    throw new AppError(409, 'You are already registered for this election');
  }

  await logAction({
    action:      AUDIT_ACTIONS.VOTER_REGISTERED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'RegisteredVoter',
    metadata:    { electionId: election._id.toString() },
  });

  sendSuccess(res, null, 'Successfully registered for election', 201);
});

// ── Results ───────────────────────────────────────────────────────────────────

export const publishResults = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'voting_closed') throw new AppError(400, 'Election must be in voting_closed status to publish results');

  const tally = await computeTally(election._id.toString());
  if (!tally || tally.length === 0) {
    throw new AppError(400, 'No votes found for this election');
  }

  await Election.findByIdAndUpdate(election._id, { $set: { results: tally, status: 'results_published' } });

  await logAction({
    action: AUDIT_ACTIONS.RESULTS_PUBLISHED,
    performedBy: req.user._id,
    targetId: election._id,
    targetModel: 'Election',
  });

  const hasTies = tally.some((t) => t.isTie);
  const tiedOffices = tally.filter((t) => t.isTie).map((t) => t.officeTitle);
  sendSuccess(res, { hasTies, tiedOffices }, 'Results published');
});

/** Published results — students (registered voters only) or SA */
export const getResults = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'results_published') throw new AppError(403, 'Results are not yet published');

  if (req.user.role === 'student') {
    const isRegistered = await RegisteredVoter.findOne({
      electionId: election._id,
      userId:     req.user._id,
    });
    if (!isRegistered) throw new AppError(403, 'Only registered voters can view results');
  }

  sendSuccess(res, election.results || []);
});

/** Same as getResults but accessed via election code — student-facing UX */
export const getResultsByCode = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findOne({ electionCode: req.params.code.toUpperCase() });
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'results_published') throw new AppError(403, 'Results are not yet published');

  if (req.user.role === 'student') {
    const isRegistered = await RegisteredVoter.findOne({
      electionId: election._id,
      userId:     req.user._id,
    });
    if (!isRegistered) throw new AppError(403, 'Only registered voters can view results');
  }

  sendSuccess(res, election.results || []);
});

/** Live preview — officer (own election) or SA; available after voting_closed */
export const previewResults = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (!['voting_closed', 'results_published'].includes(election.status)) {
    throw new AppError(400, 'Results preview is only available after voting has closed');
  }
  const tally = await computeTally(election._id.toString());
  sendSuccess(res, tally, 'Live preview (not yet published)');
});

// ── Analytics ─────────────────────────────────────────────────────────────────

export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');

  // Available from registration_open onwards
  const validStatuses: ElectionStatus[] = [
    'registration_open', 'registration_closed',
    'voting_open', 'voting_closed', 'results_published',
  ];
  if (!validStatuses.includes(election.status)) {
    throw new AppError(400, 'Analytics are only available from registration_open onwards');
  }

  const [totalMembers, registeredVoters, votesCast, offices, voteCountsRaw] = await Promise.all([
    AssociationMember.countDocuments({ electionId: election._id }),
    RegisteredVoter.countDocuments({ electionId: election._id }),
    RegisteredVoter.countDocuments({ electionId: election._id, hasVoted: true }),
    Office.find({ electionId: election._id }),
    // FIX (Issue 11): Single aggregation replaces O(N) countDocuments per office.
    // Previously a separate Vote.countDocuments was fired for every office inside
    // Promise.all — e.g. 10 offices = 11 DB round-trips. Now it is 1.
    Vote.aggregate<{ _id: string; count: number }>([
      { $match: { electionId: election._id } },
      { $group: { _id: '$officeId', count: { $sum: 1 } } },
    ]),
  ]);

  // Build O(1) lookup map from aggregation result
  const voteCountMap = new Map(voteCountsRaw.map((r) => [r._id.toString(), r.count]));

  const turnoutPercent = registeredVoters > 0
    ? Math.round((votesCast / registeredVoters) * 100)
    : 0;

  const officeBreakdown = offices.map((o) => ({
    officeTitle: o.title,
    voteCount:   voteCountMap.get(o._id.toString()) ?? 0,
  }));

  sendSuccess(res, { totalMembers, registeredVoters, votesCast, turnoutPercent, officeBreakdown });
});


export const listMyElections = asyncHandler(async (req: Request, res: Response) => {

  const registrations = await RegisteredVoter.find({
    userId: req.user._id
  }).select("electionId");

  const electionIds = registrations.map(r => r.electionId);

  const elections = await Election.find({
    _id: { $in: electionIds }
  })
  .populate("associationId", "name")
  .sort({ createdAt: -1 });

  sendSuccess(res, elections);
});

// ── Delete election ───────────────────────────────────────────────────────────

/**
 * DELETE /api/elections/:id  (SA only)
 *
 * Safety rules:
 *   - Only `draft` elections can be deleted without a confirmation flag.
 *   - Elections in any other deletable status require { force: true } in the
 *     request body — this protects against accidental deletion of elections
 *     that already have members, candidates, or votes.
 *   - `results_published` elections are permanently blocked from deletion;
 *     they form part of the historical record.
 *
 * Cascade order (mirrors the data dependency graph):
 *   1. Votes
 *   2. Registered voters
 *   3. Candidate Cloudinary photos  (best-effort, non-fatal)
 *   4. Candidate documents
 *   5. Office documents
 *   6. Association member list
 *   7. Election document
 */
export const deleteElection = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');

  // Permanently blocked — published results are the historical record
  if (election.status === 'results_published') {
    throw new AppError(
      403,
      'Published elections cannot be deleted — they are part of the historical record'
    );
  }

  // Any status beyond draft means real data exists — require explicit confirmation
  if (election.status !== 'draft') {
    const { force } = req.body as { force?: boolean };
    if (!force) {
      throw new AppError(
        409,
        `Election is in "${election.status}" status and already has data attached. ` +
          'Send { "force": true } to confirm cascade deletion of all attached data.'
      );
    }
  }

  // ── 1. Votes ──────────────────────────────────────────────────────────────
  await Vote.deleteMany({ electionId: election._id });

  // ── 2. Registered voters ──────────────────────────────────────────────────
  await RegisteredVoter.deleteMany({ electionId: election._id });

  // ── 3. Candidate Cloudinary photos — best-effort ──────────────────────────
  const candidates = await Candidate.find(
    { electionId: election._id },
    { photoPublicId: 1 }          // only fetch the field we need
  );
  const { deleteImage } = await import('../services/upload.service');
  let photoFailures = 0;
  for (const candidate of candidates) {
    if (candidate.photoPublicId) {
      try {
        await deleteImage(candidate.photoPublicId);
      } catch {
        photoFailures++;
      }
    }
  }

  // ── 4. Candidate documents ────────────────────────────────────────────────
  await Candidate.deleteMany({ electionId: election._id });

  // ── 5. Offices ────────────────────────────────────────────────────────────
  await Office.deleteMany({ electionId: election._id });

  // ── 6. Association member list ────────────────────────────────────────────
  await AssociationMember.deleteMany({ electionId: election._id });

  // ── 7. Election document ──────────────────────────────────────────────────
  await Election.findByIdAndDelete(election._id);

  // Audit — log before returning so any DB failure is surfaced, not silenced
  await logAction({
    action:      AUDIT_ACTIONS.ELECTION_DELETED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
    metadata: {
      title:         election.title,
      deletedStatus: election.status,
      forced:        election.status !== 'draft',
      photoFailures,
    },
  });

  res.status(204).send();
});