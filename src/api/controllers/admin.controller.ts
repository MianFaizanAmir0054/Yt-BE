import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import * as userService from "../services/user.service.js";
import {
  getUser,
  getRouteParam,
  getPaginationParams,
  buildPaginationResponse,
  sendSuccess,
  sendCreated,
  sendError,
  sendNotFound,
  sendBadRequest,
} from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES, USER_ROLES } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";

/**
 * GET /api/admin/users
 * List all users (super admin only)
 */
export async function listUsers(req: Request, res: Response) {
  try {
    const { role } = req.query;
    const pagination = getPaginationParams(req.query);

    const { users, total } = await userService.getUsers({
      ...pagination,
      role: role as string,
    });

    const response = buildPaginationResponse(users, total, pagination.page, pagination.limit);
    return sendSuccess(res, { users: response.data, pagination: response.pagination });
  } catch (error) {
    console.error("Error fetching users:", error);
    return sendError(res, "Failed to fetch users");
  }
}

/**
 * GET /api/admin/users/:id
 * Get single user details
 */
export async function getUser_(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const user = await userService.findUserById(id);

    if (!user) {
      return sendNotFound(res, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendSuccess(res, { user });
  } catch (error) {
    console.error("Error fetching user:", error);
    return sendError(res, "Failed to fetch user");
  }
}

/**
 * POST /api/admin/users
 * Create a new user (admin or collaborator)
 */
export async function createUser(req: Request, res: Response) {
  try {
    const currentUser = getUser(req);
    const { name, email, password, role = USER_ROLES.ADMIN } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return sendBadRequest(res, "Name, email, and password are required");
    }

    // Only allow creating admin or collaborator roles
    if (![USER_ROLES.ADMIN, USER_ROLES.COLLABORATOR].includes(role)) {
      return sendBadRequest(res, "Invalid role. Must be 'admin' or 'collaborator'");
    }

    // Check if email already exists
    const emailTaken = await userService.emailExists(email);
    if (emailTaken) {
      return sendBadRequest(res, "Email already registered");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await userService.createUser({
      name,
      email,
      password: hashedPassword,
      role,
      createdBy: currentUser?.id,
    });

    return sendCreated(res, { user }, "User created successfully");
  } catch (error) {
    console.error("Error creating user:", error);
    return sendError(res, "Failed to create user");
  }
}

/**
 * PUT /api/admin/users/:id
 * Update user
 */
export async function updateUser(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const { name, role, isActive } = req.body;

    const existingUser = await userService.findUserById(id);
    if (!existingUser) {
      return sendNotFound(res, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Can't change super_admin role
    if (existingUser.role === USER_ROLES.SUPER_ADMIN && role && role !== USER_ROLES.SUPER_ADMIN) {
      return sendBadRequest(res, "Cannot change super admin role");
    }

    // Validate role if provided
    if (role && ![USER_ROLES.ADMIN, USER_ROLES.COLLABORATOR].includes(role)) {
      return sendBadRequest(res, "Invalid role");
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await userService.updateUser(id, updateData);

    return sendSuccess(res, { message: "User updated successfully", user });
  } catch (error) {
    console.error("Error updating user:", error);
    return sendError(res, "Failed to update user");
  }
}

/**
 * DELETE /api/admin/users/:id
 * Delete user
 */
export async function deleteUser(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");

    const existingUser = await userService.findUserById(id);
    if (!existingUser) {
      return sendNotFound(res, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Can't delete super_admin
    if (existingUser.role === USER_ROLES.SUPER_ADMIN) {
      return sendBadRequest(res, "Cannot delete super admin");
    }

    await userService.deleteUser(id);

    return sendSuccess(res, { message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return sendError(res, "Failed to delete user");
  }
}

/**
 * PUT /api/admin/users/:id/password
 * Reset user password
 */
export async function resetPassword(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const { password } = req.body;

    if (!password || password.length < 8) {
      return sendBadRequest(res, "Password must be at least 8 characters");
    }

    const existingUser = await userService.findUserById(id);
    if (!existingUser) {
      return sendNotFound(res, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Direct update for password
    const User = (await import("../../models/User.js")).default;
    await User.findByIdAndUpdate(id, { password: hashedPassword });

    return sendSuccess(res, { message: "Password reset successfully" });
  } catch (error) {
    console.error("Error resetting password:", error);
    return sendError(res, "Failed to reset password");
  }
}

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics
 */
export async function getStats(req: Request, res: Response) {
  try {
    const userStats = await userService.getUserStats();
    
    // Add more stats as needed
    const Workspace = (await import("../../models/Workspace.js")).default;
    const Channel = (await import("../../models/Channel.js")).default;
    const Project = (await import("../../models/Project.js")).default;

    const [workspaceCount, channelCount, projectCount] = await Promise.all([
      Workspace.countDocuments(),
      Channel.countDocuments(),
      Project.countDocuments(),
    ]);

    return sendSuccess(res, {
      users: userStats,
      workspaces: workspaceCount,
      channels: channelCount,
      projects: projectCount,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return sendError(res, "Failed to fetch stats");
  }
}
