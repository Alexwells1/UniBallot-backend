import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import User, { IUser } from '../models/User';
import { getCachedUser, setCachedUser, CachedUser } from '../services/userCache.service';

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

    // Only userId in payload — role is always read live (from cache or DB)
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string };

    // 1. Try Redis cache first
    let user: IUser | CachedUser | null = await getCachedUser(payload.userId);

    if (!user) {
      const dbUser = await User.findById(payload.userId).lean<IUser>();
      if (!dbUser) return next(new AppError(401, 'User not found'));
      await setCachedUser(dbUser);
      user = dbUser;
    }

    if (!user.isActive)   return next(new AppError(403, 'Account deactivated'));
    if (user.isSuspended) return next(new AppError(403, 'Account suspended'));

    // passwordHash is stripped in CachedUser — cast is safe because all
    // fields required by downstream handlers are present on both types.
    req.user = user as IUser;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError(401, 'Invalid or expired token'));
  }
}