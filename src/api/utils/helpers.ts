import { Request, Response } from "express";
import { AuthUser, AuthenticatedRequest, PaginationParams } from "../types/index.js";
import { PAGINATION, HTTP_STATUS } from "../constants/index.js";

/**
 * Get authenticated user from request
 */
export function getUser(req: Request): AuthUser | undefined {
  return (req as AuthenticatedRequest).user;
}

/**
 * Get database user from request (attached by middleware)
 */
export function getDbUser(req: Request): unknown {
  return (req as AuthenticatedRequest).dbUser;
}

/**
 * Safely get string param from request params
 */
export function getParam(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] : param || "";
}

/**
 * Get string from request.params safely (Express 5 compatibility)
 */
export function getRouteParam(req: Request, paramName: string): string {
  const param = req.params[paramName];
  return Array.isArray(param) ? param[0] : param || "";
}

/**
 * Parse pagination params from query
 */
export function getPaginationParams(query: Request["query"]): PaginationParams {
  const page = Math.max(1, Number(query.page) || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, Number(query.limit) || PAGINATION.DEFAULT_LIMIT)
  );
  const search = typeof query.search === "string" ? query.search : undefined;

  return { page, limit, search };
}

/**
 * Calculate skip value for pagination
 */
export function getSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Build pagination response
 */
export function buildPaginationResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Send success response
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode: number = HTTP_STATUS.OK
) {
  return res.status(statusCode).json(data);
}

/**
 * Send created response
 */
export function sendCreated<T>(res: Response, data: T, message?: string) {
  return res.status(HTTP_STATUS.CREATED).json({
    message: message || "Created successfully",
    ...data,
  });
}

/**
 * Send error response
 */
export function sendError(
  res: Response,
  error: string,
  statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  details?: unknown
) {
  const response: { error: string; details?: unknown } = { error };
  if (details) {
    response.details = details;
  }
  return res.status(statusCode).json(response);
}

/**
 * Send unauthorized response
 */
export function sendUnauthorized(res: Response, message?: string) {
  return sendError(res, message || "Unauthorized", HTTP_STATUS.UNAUTHORIZED);
}

/**
 * Send forbidden response
 */
export function sendForbidden(res: Response, message?: string) {
  return sendError(res, message || "Forbidden", HTTP_STATUS.FORBIDDEN);
}

/**
 * Send not found response
 */
export function sendNotFound(res: Response, message?: string) {
  return sendError(res, message || "Not found", HTTP_STATUS.NOT_FOUND);
}

/**
 * Send bad request response
 */
export function sendBadRequest(res: Response, message: string, details?: unknown) {
  return sendError(res, message, HTTP_STATUS.BAD_REQUEST, details);
}

/**
 * Async handler wrapper to catch errors
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response) => Promise<T>
) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/**
 * Build search query for text fields
 */
export function buildSearchQuery(
  search: string | undefined,
  fields: string[]
): Record<string, unknown> | null {
  if (!search) return null;

  return {
    $or: fields.map((field) => ({
      [field]: { $regex: search, $options: "i" },
    })),
  };
}

/**
 * Merge query conditions
 */
export function mergeQueries(
  ...queries: (Record<string, unknown> | null | undefined)[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  
  for (const query of queries) {
    if (query) {
      Object.assign(merged, query);
    }
  }
  
  return merged;
}
