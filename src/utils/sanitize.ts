import type { IUser } from '../models/User';

type AnyObject = Record<string, unknown>;

/**
 * Strips passwordHash and __v from any user document or plain object
 * before sending to the client.
 */
export function sanitizeUser(user: IUser | AnyObject): AnyObject {
  let obj: AnyObject;
  if (typeof (user as IUser).toObject === 'function') {
    obj = (user as IUser).toObject() as AnyObject;
  } else {
    obj = { ...(user as AnyObject) };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, __v, ...sanitized } = obj;
  return sanitized;
}
