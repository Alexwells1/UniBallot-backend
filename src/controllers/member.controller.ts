import { Request, Response } from 'express';
import { z } from 'zod';
import Election from '../models/Election';
import AssociationMember from '../models/AssociationMember';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendPaginated } from '../utils/apiResponse';
import { processMembersCsv } from '../services/csv.service';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS, MATRIC_NUMBER_REGEX } from '../config/constants';

// ─── Upload ────────────────────────────────────────────────────────────────────

export const uploadMembers = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'setup')
    throw new AppError(400, 'Members can only be uploaded in setup status');
  if (election.membersLocked) throw new AppError(409, 'Member list is locked');
  if (!req.file)
    throw new AppError(400, 'No CSV file provided (form field name: "file")');

  const report = await processMembersCsv(req.file.buffer, election._id.toString());

  await logAction({
    action:      AUDIT_ACTIONS.MEMBERS_UPLOADED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
    metadata:    { inserted: report.inserted, invalid: report.invalid },
  });

  sendSuccess(res, report, 'CSV processed');
});

// ─── List ──────────────────────────────────────────────────────────────────────

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const pageNum  = Math.max(1, parseInt(req.query.page  as string || '1',  10));
  const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '50', 10)));
  const skip     = (pageNum - 1) * limitNum;

  const search = (req.query.search as string || '').trim();
  const filter: Record<string, unknown> = { electionId: req.params.id };

  if (search) {
    // Escape metacharacters to prevent ReDoS via crafted search strings
    const escaped = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.matricNumber = { $regex: escaped, $options: 'i' };
  }

  const [members, total] = await Promise.all([
    AssociationMember.find(filter).skip(skip).limit(limitNum),
    AssociationMember.countDocuments(filter),
  ]);

  sendPaginated(res, members, total, pageNum, limitNum);
});

// ─── Get single ────────────────────────────────────────────────────────────────

export const getMember = asyncHandler(async (req: Request, res: Response) => {
  const member = await AssociationMember.findOne({
    _id:        req.params.memberId,
    electionId: req.params.id,
  });
  if (!member) throw new AppError(404, 'Member not found');
  sendSuccess(res, member);
});

// ─── Update ────────────────────────────────────────────────────────────────────

const updateMemberSchema = z.object({
  matricNumber: z.string().regex(MATRIC_NUMBER_REGEX, 'Invalid matric number format'),
});

export const updateMember = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'setup')
    throw new AppError(400, 'Members can only be edited in setup status');
  if (election.membersLocked) throw new AppError(409, 'Member list is locked');

  const parsed = updateMemberSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(400, parsed.error.errors[0].message);

  const { matricNumber } = parsed.data;

  // Check uniqueness within the same election
  const conflict = await AssociationMember.findOne({
    electionId:   req.params.id,
    matricNumber: matricNumber.trim(),
    _id:          { $ne: req.params.memberId },
  });
  if (conflict) throw new AppError(409, 'Matric number already exists in this election');

  const update: Record<string, string> = {};
  update.matricNumber = matricNumber.trim();

  const member = await AssociationMember.findOneAndUpdate(
    { _id: req.params.memberId, electionId: req.params.id },
    { $set: update },
    { new: true },
  );
  if (!member) throw new AppError(404, 'Member not found');

  await logAction({
    action:      AUDIT_ACTIONS.MEMBER_UPDATED,
    performedBy: req.user._id,
    targetId:    member._id,
    targetModel: 'AssociationMember',
    metadata:    update,
  });

  sendSuccess(res, member, 'Member updated');
});

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteMember = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'setup')
    throw new AppError(400, 'Members can only be deleted in setup status');
  if (election.membersLocked) throw new AppError(409, 'Member list is locked');

  const member = await AssociationMember.findOneAndDelete({
    _id:        req.params.memberId,
    electionId: req.params.id,
  });
  if (!member) throw new AppError(404, 'Member not found');

  await logAction({
    action:      AUDIT_ACTIONS.MEMBER_DELETED,
    performedBy: req.user._id,
    targetId:    member._id,
    targetModel: 'AssociationMember',
    metadata:    { matricNumber: member.matricNumber },
  });

  sendSuccess(res, null, 'Member deleted');
});

// ─── Clear all ─────────────────────────────────────────────────────────────────

export const clearMembers = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.status !== 'setup')
    throw new AppError(400, 'Members can only be cleared in setup status');
  if (election.membersLocked) throw new AppError(409, 'Member list is locked');

  await AssociationMember.deleteMany({ electionId: election._id });

  await logAction({
    action:      AUDIT_ACTIONS.MEMBERS_CLEARED,
    performedBy: req.user._id,
    targetId:    election._id,
    targetModel: 'Election',
  });

  sendSuccess(res, null, 'Member list cleared');
});