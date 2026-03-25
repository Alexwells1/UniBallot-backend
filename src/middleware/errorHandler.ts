import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import mongoose from 'mongoose';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

type ErrorResponse = {
  success: false;
  message: string;
  statusCode: number;
  code?: string; // forwarded from AppError.code when present
};

function send(res: Response, statusCode: number, message: string, code?: string): void {
  const body: ErrorResponse = { success: false, message, statusCode };
  if (code) body.code = code;
  res.status(statusCode).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    send(res, err.statusCode, err.message, err.code); // <-- code forwarded here
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const message = Object.values(err.errors).map((e) => e.message).join('; ');
    send(res, 400, message);
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    send(res, 400, 'Invalid ID format');
    return;
  }

  if (err instanceof TokenExpiredError) {
    send(res, 401, 'Token expired');
    return;
  }

  if (err instanceof JsonWebTokenError) {
    send(res, 401, 'Invalid token');
    return;
  }

  // Mongoose duplicate key
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === 11000
  ) {
    const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    const field    = Object.keys(keyValue)[0] ?? 'field';
    send(res, 409, `Value already exists for ${field}`);
    return;
  }

  // Cloudinary upload failure
  const errMsg = err instanceof Error ? err.message : '';
  if (
    errMsg.toLowerCase().includes('cloudinary') ||
    errMsg.toLowerCase().includes('upload_stream') ||
    errMsg.toLowerCase().includes('upload failed')
  ) {
    send(res, 502, 'File upload failed — please try again');
    return;
  }

  // Unknown — never leak stack trace to client in production
  if (process.env.NODE_ENV !== 'production') {
    console.error('[Unhandled Error]', err);
  }
  send(res, 500, 'Internal server error');
}

export function notFound(_req: Request, res: Response): void {
  send(res, 404, 'Route not found');
}