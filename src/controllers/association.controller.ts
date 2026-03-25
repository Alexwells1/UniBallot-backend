import { Request, Response } from 'express';
import { z } from 'zod';
import Association from '../models/Association';
import Election from '../models/Election';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS } from '../config/constants';

export const associationSchema = z.object({
  name:        z.string().min(2),
  description: z.string().optional(),
});

export const createAssociation = asyncHandler(async (req: Request, res: Response) => {
  const { name, description } = req.body as z.infer<typeof associationSchema>;
  const association = await Association.create({ name, description });
  await logAction({
    action:      AUDIT_ACTIONS.ASSOCIATION_CREATED,
    performedBy: req.user._id,
    targetId:    association._id,
    targetModel: 'Association',
  });
  sendSuccess(res, association, 'Association created', 201);
});

export const listAssociations = asyncHandler(async (_req: Request, res: Response) => {
  const associations = await Association.find().sort({ name: 1 });

  // FIX (Issue 13): Replace N+1 Election.countDocuments per association with a
  // single aggregation that groups all election counts at once, then merges into
  // the association list in memory. With N associations the old code fired N+1
  // DB round-trips; this version always uses exactly 2.
  const electionCountsRaw = await Election.aggregate<{ _id: string; count: number }>([
    { $match: { associationId: { $in: associations.map((a) => a._id) } } },
    { $group: { _id: '$associationId', count: { $sum: 1 } } },
  ]);

  const electionCountMap = new Map(electionCountsRaw.map((r) => [r._id.toString(), r.count]));

  const withCounts = associations.map((a) => ({
    ...a.toObject(),
    electionCount: electionCountMap.get(a._id.toString()) ?? 0,
  }));

  sendSuccess(res, withCounts);
});

export const getAssociation = asyncHandler(async (req: Request, res: Response) => {
  const association = await Association.findById(req.params.id);
  if (!association) throw new AppError(404, 'Association not found');
  const elections = await Election.find({ associationId: association._id });
  sendSuccess(res, { ...association.toObject(), elections });
});

export const updateAssociation = asyncHandler(async (req: Request, res: Response) => {
  const { name, description } = req.body as Partial<z.infer<typeof associationSchema>>;

  const updateFields: Record<string, string> = {};
  if (name        !== undefined) updateFields.name        = name;
  if (description !== undefined) updateFields.description = description;

  const association = await Association.findByIdAndUpdate(
    req.params.id,
    { $set: updateFields },
    { new: true, runValidators: true }
  );
  if (!association) throw new AppError(404, 'Association not found');

  await logAction({
    action:      AUDIT_ACTIONS.ASSOCIATION_UPDATED,
    performedBy: req.user._id,
    targetId:    association._id,
    targetModel: 'Association',
  });
  sendSuccess(res, association, 'Association updated');
});

export const deleteAssociation = asyncHandler(async (req: Request, res: Response) => {
  const association = await Association.findById(req.params.id);
  if (!association) throw new AppError(404, 'Association not found');

  const hasActiveElections = await Election.findOne({
    associationId: association._id,
    status:        { $ne: 'draft' },
  });
  if (hasActiveElections) {
    throw new AppError(409, 'Cannot delete an association with non-draft elections');
  }

  await Association.findByIdAndDelete(association._id);
  await logAction({
    action:      AUDIT_ACTIONS.ASSOCIATION_DELETED,
    performedBy: req.user._id,
    targetId:    association._id,
    targetModel: 'Association',
  });

  res.status(204).send();
});
