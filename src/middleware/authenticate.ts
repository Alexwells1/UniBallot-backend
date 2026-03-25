import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import User from '../models/User';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new AppError(401, 'No token provided'));
    }

    const token = authHeader.split(' ')[1];

    // FIX (Issue 8): Payload only contains userId — role is NOT in the JWT.
    // This eliminates the window where a demoted user's old token still carries
    // their elevated role. Role is always read live from the database below.
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string };

    const user = await User.findById(payload.userId);
    if (!user) return next(new AppError(401, 'User not found'));
    if (!user.isActive)   return next(new AppError(403, 'Account deactivated'));
    if (user.isSuspended) return next(new AppError(403, 'Account suspended'));

    // req.user.role is always the live DB value — never the JWT claim
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError(401, 'Invalid or expired token'));
  }
}
