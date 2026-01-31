import { Response, NextFunction, RequestHandler } from "express";
import { AuthenticatedRequest } from "../types/index.js";
import { getUser } from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES, USER_ROLES, MEMBER_STATUS } from "../constants/index.js";
import User from "../../models/User.js";
import Workspace from "../../models/Workspace.js";
import WorkspaceMember from "../../models/WorkspaceMember.js";

/**
 * Middleware to check workspace access and attach workspace info to request
 * Use after requireAuth middleware
 */
export const requireWorkspaceAccess: RequestHandler = async (
  req,
  res: Response,
  next: NextFunction
) => {
  const user = getUser(req);
  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }

  const workspaceId = req.params.workspaceId || req.params.id;
  if (!workspaceId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Workspace ID is required" });
  }

  try {
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.WORKSPACE_NOT_FOUND });
    }

    // Super admin always has access
    if (dbUser.role === USER_ROLES.SUPER_ADMIN) {
      (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];
      (req as unknown as { workspace: typeof workspace }).workspace = workspace;
      (req as unknown as { isWorkspaceOwner: boolean }).isWorkspaceOwner = true;
      return next();
    }

    // Check if owner
    if (workspace.ownerId.toString() === dbUser._id.toString()) {
      (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];
      (req as unknown as { workspace: typeof workspace }).workspace = workspace;
      (req as unknown as { isWorkspaceOwner: boolean }).isWorkspaceOwner = true;
      return next();
    }

    // Check if member
    const membership = await WorkspaceMember.findOne({
      workspaceId,
      userId: dbUser._id,
      status: MEMBER_STATUS.ACCEPTED,
    });

    if (!membership) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.NO_WORKSPACE_ACCESS });
    }

    (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];
    (req as unknown as { workspace: typeof workspace }).workspace = workspace;
    (req as unknown as { membership: typeof membership }).membership = membership;
    (req as unknown as { isWorkspaceOwner: boolean }).isWorkspaceOwner = false;

    next();
  } catch (error) {
    console.error("requireWorkspaceAccess middleware error:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

/**
 * Middleware to require workspace owner access
 */
export const requireWorkspaceOwner: RequestHandler = async (
  req,
  res: Response,
  next: NextFunction
) => {
  const user = getUser(req);
  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }

  const workspaceId = req.params.workspaceId || req.params.id;
  if (!workspaceId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Workspace ID is required" });
  }

  try {
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.WORKSPACE_NOT_FOUND });
    }

    // Super admin always has owner access
    if (dbUser.role === USER_ROLES.SUPER_ADMIN) {
      (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];
      (req as unknown as { workspace: typeof workspace }).workspace = workspace;
      return next();
    }

    // Check if owner
    if (workspace.ownerId.toString() !== dbUser._id.toString()) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Only workspace owner can perform this action" });
    }

    (req as AuthenticatedRequest).dbUser = dbUser as unknown as AuthenticatedRequest["dbUser"];
    (req as unknown as { workspace: typeof workspace }).workspace = workspace;

    next();
  } catch (error) {
    console.error("requireWorkspaceOwner middleware error:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};
