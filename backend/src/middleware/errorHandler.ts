import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { sendError } from "../utils/response";
import { config } from "../config";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    const message = err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
    return sendError(res, message, 400, "VALIDATION_ERROR");
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return sendError(res, "A record with this value already exists", 409, "DUPLICATE");
    }
    if (err.code === "P2025") {
      return sendError(res, "Record not found", 404, "NOT_FOUND");
    }
    if (err.code === "P2003") {
      return sendError(res, "Related record not found", 400, "FOREIGN_KEY");
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return sendError(res, "Invalid data provided", 400, "VALIDATION_ERROR");
  }

  if (err instanceof AppError) {
    return sendError(res, err.message, err.statusCode, err.code);
  }

  if (config.server.isDev) console.error("Unhandled error:", err);

  return sendError(
    res,
    config.server.isDev ? err.message : "An unexpected error occurred",
    500,
    "INTERNAL_ERROR"
  );
}

export function notFoundHandler(req: Request, res: Response) {
  return sendError(res, `Route ${req.method} ${req.path} not found`, 404, "ROUTE_NOT_FOUND");
}
