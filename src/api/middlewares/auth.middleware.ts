import { Response, NextFunction, RequestHandler } from "express";
import { AuthenticatedRequest } from "../types/index.js";
import { getUser } from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES, USER_ROLES } from "../constants/index.js";
import User from "../../models/User.js";

/**
 * Middleware to require admin role (admin or super_admin)
 */
export const requireAdmin: RequestHandler = async (
  req,
  res: Response,
  next: NextFunction
) => {
  const user = getUser(req);
  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }

  try {
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });
    const adminRoles = [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN] as string[];
    if (!dbUser || !adminRoles.includes(dbUser.role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.ADMIN_REQUIRED });
    }

    // Attach dbUser to request for use in route handlers
    (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];

    next();
  } catch (error) {
    console.error("requireAdmin middleware error:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

/**
 * Middleware to require super admin role only
 */
export const requireSuperAdmin: RequestHandler = async (
  req,
  res: Response,
  next: NextFunction
) => {
  const user = getUser(req);
  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }

  try {
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });
    if (!dbUser || dbUser.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.SUPER_ADMIN_REQUIRED });
    }

    // Attach dbUser to request for use in route handlers
    (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];

    next();
  } catch (error) {
    console.error("requireSuperAdmin middleware error:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

/**
 * Middleware to require authenticated user (any role)
 */
export const requireAuth: RequestHandler = async (
  req,
  res: Response,
  next: NextFunction
) => {
  const user = getUser(req);
  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }

  try {
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    // Attach dbUser to request for use in route handlers
    (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];

    next();
  } catch (error) {
    console.error("requireAuth middleware error:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};
