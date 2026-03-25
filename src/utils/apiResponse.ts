import type { Response } from 'express';

export function sendSuccess(
  res:        Response,
  data:       unknown,
  message     = 'Success',
  statusCode  = 200
): Response {
  return res.status(statusCode).json({ success: true, message, data });
}

export function sendPaginated(
  res:     Response,
  data:    unknown,
  total:   number,
  page:    number,
  limit:   number,
  message  = 'Success'
): Response {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}
