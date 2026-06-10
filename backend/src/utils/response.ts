import { Response } from "express";

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>
) {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
    timestamp: new Date().toISOString(),
  });
}

export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
  code?: string
) {
  return res.status(statusCode).json({
    success: false,
    error: { message, code: code || "INTERNAL_ERROR" },
    timestamp: new Date().toISOString(),
  });
}
