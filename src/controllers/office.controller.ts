import { Request, Response } from 'express';
import { z } from 'zod';
import Office from '../models/Office';
import Candidate from '../models/Candidate';
import Vote from '../models/Vote';
import Election from '../models/Election';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { logAction } from '../services/audit.service';
import { deleteImage } from '../services/upload.service';
import { AUDIT_ACTIONS } from '../config/constants';

export const officeSchema = z.object({
  title:       z.string().min(2),
  description: z.string().optional(),
});

export const createOffice = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (!['setup', 'registration_open', 'registration_closed'].includes(election.status)) {
    throw new AppError(400, 'Offices can only be created in setup, registration_open, or registration_closed status');
  }
  if (election.candidatesLocked) throw new AppError(409, 'Candidates are locked');

  const { title, description } = req.body as z.infer<typeof officeSchema>;
  const office = await Office.create({ electionId: election._id, title, description });

  await logAction({
    action:      AUDIT_ACTIONS.OFFICE_CREATED,
    performedBy: req.user._id,
    targetId:    office._id,
    targetModel: 'Office',
  });

  sendSuccess(res, office, 'Office created', 201);
});

export const listOffices = asyncHandler(async (req: Request, res: Response) => {
  const offices = await Office.find({ electionId: req.params.id });
  const withCandidates = await Promise.all(
    offices.map(async (o) => {
      const candidates = await Candidate.find({ officeId: o._id });
      return {
        ...o.toObject(),
        candidates,
        candidateCount: candidates.length,
      };
    })
  );
  sendSuccess(res, withCandidates);
});

export const updateOffice = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.candidatesLocked) throw new AppError(409, 'Candidates are locked');

  const { title, description } = req.body as Partial<z.infer<typeof officeSchema>>;

  // Build update object conditionally — never set fields to undefined
  const updateFields: Record<string, string> = {};
  if (title !== undefined) updateFields.title = title;
  if (description !== undefined) updateFields.description = description;

  const office = await Office.findOneAndUpdate(
    { _id: req.params.officeId, electionId: election._id },
    { $set: updateFields },
    { new: true, runValidators: true }
  );
  if (!office) throw new AppError(404, 'Office not found');

  sendSuccess(res, office, 'Office updated');
});

export const deleteOffice = asyncHandler(async (req: Request, res: Response) => {
  const election = await Election.findById(req.params.id);
  if (!election) throw new AppError(404, 'Election not found');
  if (election.candidatesLocked) throw new AppError(409, 'Candidates are locked');

  const office = await Office.findOne({ _id: req.params.officeId, electionId: election._id });
  if (!office) throw new AppError(404, 'Office not found');

  const voteExists = await Vote.findOne({ officeId: office._id });
  if (voteExists) throw new AppError(409, 'Cannot delete an office that has votes');

  // Remove each candidate's Cloudinary photo, then the candidate documents
  const candidates = await Candidate.find({ officeId: office._id });
  for (const c of candidates) {
    if (c.photoPublicId) {
      await deleteImage(c.photoPublicId).catch(() => null); // best-effort
    }
  }
  await Candidate.deleteMany({ officeId: office._id });
  await Office.findByIdAndDelete(office._id);

  await logAction({
    action:      AUDIT_ACTIONS.OFFICE_DELETED,
    performedBy: req.user._id,
    targetId:    office._id,
    targetModel: 'Office',
  });

  res.status(204).send();
});
