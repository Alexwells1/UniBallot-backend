import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import User from '../models/User';
import Avatar from '../models/Avatar';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { sanitizeUser } from '../utils/sanitize';
import { uploadImage, deleteImage } from '../services/upload.service';
import { logAction } from '../services/audit.service';
import { AUDIT_ACTIONS, CLOUDINARY_FOLDERS, MATRIC_NUMBER_REGEX } from '../config/constants';

export const profileSchema = z.object({
  fullName:     z.string().min(2, 'Full name must be at least 2 characters'),
  matricNumber: z.string().regex(MATRIC_NUMBER_REGEX, 'Invalid matric number format'),
  gender:       z.enum(['male', 'female', 'other']).optional(),
});

/**
 * Schema for subsequent profile updates (PATCH).
 * matricNumber is intentionally excluded — it is immutable after first completion.
 */
export const updateProfileSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').optional(),
  gender:   z.enum(['male', 'female', 'other']).optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, sanitizeUser(req.user), 'Profile retrieved');
});

/**
 * First-time profile completion (PUT).
 * Sets matricNumber and marks profileCompleted = true.
 * Subsequent edits must use PATCH /me/profile (updateProfile).
 */
export const completeProfile = asyncHandler(async (req: Request, res: Response) => {
  if (req.user.profileCompleted) throw new AppError(409, 'Profile already completed');

  const { fullName, matricNumber, gender } = req.body as z.infer<typeof profileSchema>;

  const updateFields: Record<string, unknown> = { fullName, matricNumber, profileCompleted: true };
  if (gender) updateFields.gender = gender;

  const updated = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updateFields },
    { new: true, runValidators: true }
  );
  if (!updated) throw new AppError(404, 'User not found');

  await logAction({
    action:      AUDIT_ACTIONS.PROFILE_COMPLETED,
    performedBy: req.user._id,
    targetId:    req.user._id,
    targetModel: 'User',
  });

  sendSuccess(res, sanitizeUser(updated), 'Profile completed successfully');
});

/**
 * Updates fullName and/or gender for users who have already completed their profile.
 * matricNumber is read-only after initial completion and is silently ignored.
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const { fullName, gender } = req.body as z.infer<typeof updateProfileSchema>;

  const fields: Record<string, unknown> = {};
  if (fullName !== undefined) fields.fullName = fullName;
  if (gender !== undefined)   fields.gender   = gender;

  if (Object.keys(fields).length === 0) {
    throw new AppError(400, 'No updatable fields provided');
  }

  const updated = await User.findByIdAndUpdate(
    req.user._id,
    { $set: fields },
    { new: true, runValidators: true }
  );
  if (!updated) throw new AppError(404, 'User not found');

  sendSuccess(res, sanitizeUser(updated), 'Profile updated');
});

export const uploadAvatarHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError(400, 'No image file provided (form field name: "avatar")');

  const existing = await Avatar.findOne({ userId: req.user._id });
  if (existing) {
    await deleteImage(existing.publicId).catch(() => null);
    await Avatar.deleteOne({ userId: req.user._id });
  }

  const { url, publicId } = await uploadImage(
    req.file.buffer,
    CLOUDINARY_FOLDERS.AVATARS,
    req.user._id.toString()
  );

  await Avatar.create({ userId: req.user._id, url, publicId });
  await User.findByIdAndUpdate(req.user._id, { $set: { avatarPath: url } });

  sendSuccess(res, { avatarUrl: url }, 'Avatar uploaded successfully');
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof passwordChangeSchema>;

  if (!req.user.mustChangePassword) {
    if (!currentPassword) throw new AppError(400, 'Current password is required');
    const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!valid) throw new AppError(400, 'Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(req.user._id, {
    $set: { passwordHash, mustChangePassword: false },
  });

  sendSuccess(res, null, 'Password changed successfully');
});
