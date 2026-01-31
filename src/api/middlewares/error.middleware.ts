import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { HTTP_STATUS, ERROR_MESSAGES } from "../constants/index.js";

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(message, HTTP_STATUS.BAD_REQUEST, details);
  }

  static unauthorized(message: string = ERROR_MESSAGES.UNAUTHORIZED) {
    return new ApiError(message, HTTP_STATUS.UNAUTHORIZED);
  }

  static forbidden(message: string = ERROR_MESSAGES.FORBIDDEN) {
    return new ApiError(message, HTTP_STATUS.FORBIDDEN);
  }

  static notFound(message: string = ERROR_MESSAGES.NOT_FOUND) {
    return new ApiError(message, HTTP_STATUS.NOT_FOUND);
  }

  static conflict(message: string) {
    return new ApiError(message, HTTP_STATUS.CONFLICT);
  }

  static internal(message: string = ERROR_MESSAGES.INTERNAL_ERROR) {
    return new ApiError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * Global error handler middleware
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error("Error:", err);

  // Handle ApiError
  if (err instanceof ApiError) {
    const response: { error: string; details?: unknown } = { error: err.message };
    if (err.details) {
      response.details = err.details;
    }
    return res.status(err.statusCode).json(response);
  }

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: "Validation error",
      details: err.message,
    });
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === "CastError") {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: "Invalid ID format",
    });
  }

  // Handle duplicate key errors
  if ((err as unknown as { code?: number }).code === 11000) {
    return res.status(HTTP_STATUS.CONFLICT).json({
      error: "Duplicate entry",
    });
  }

  // Default error response
  return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: process.env.NODE_ENV === "production"
      ? ERROR_MESSAGES.INTERNAL_ERROR
      : err.message || ERROR_MESSAGES.INTERNAL_ERROR,
  });
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (_req: Request, res: Response) => {
  return res.status(HTTP_STATUS.NOT_FOUND).json({
    error: "Route not found",
  });
};
