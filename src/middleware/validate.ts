import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '../utils/AppError';

type ValidationSource = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: ValidationSource = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(new AppError(400, message));
      return;
    }

    // Write validated + coerced data back to the correct source
    if (source === 'body') {
      req.body = result.data;
    } else if (source === 'query') {
      // req.query is read-only by default — override via Object.assign
      Object.assign(req.query, result.data);
    } else if (source === 'params') {
      Object.assign(req.params, result.data);
    }

    next();
  };
}