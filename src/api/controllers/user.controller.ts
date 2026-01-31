import { Request, Response } from "express";
import { getUser, sendSuccess, sendError, sendNotFound } from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";
import * as memberService from "../services/member.service.js";

/**
 * GET /api/user/me
 * Get current user profile
 */
export async function getCurrentUser(req: Request, res: Response) {
  try {
    const user = getUser(req);
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!user || !dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    return sendSuccess(res, {
      user: {
        id: dbUser._id,
        name: dbUser.name,
        email: dbUser.email,
        role: dbUser.role,
        isActive: dbUser.isActive,
        createdAt: dbUser.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return sendError(res, "Failed to fetch user profile");
  }
}

/**
 * PUT /api/user/me
 * Update current user profile
 */
export async function updateCurrentUser(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { name, image } = req.body;

    const User = (await import("../../models/User.js")).default;
    
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (image !== undefined) updateData.image = image;

    const updated = await User.findByIdAndUpdate(
      dbUser._id,
      { $set: updateData },
      { new: true }
    ).select("-password -apiKeys");

    return sendSuccess(res, { message: "Profile updated successfully", user: updated });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return sendError(res, "Failed to update user profile");
  }
}

/**
 * PUT /api/user/me/password
 * Change current user password
 */
export async function changePassword(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "New password must be at least 8 characters",
      });
    }

    const bcrypt = (await import("bcryptjs")).default;
    const User = (await import("../../models/User.js")).default;

    // Get user with password
    const userWithPassword = await User.findById(dbUser._id);
    if (!userWithPassword || !userWithPassword.password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Cannot change password for this account",
      });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, userWithPassword.password);
    if (!isValid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(dbUser._id, { password: hashedPassword });

    return sendSuccess(res, { message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    return sendError(res, "Failed to change password");
  }
}

/**
 * GET /api/user/invitations
 * Get pending invitations for current user
 */
export async function getPendingInvitations(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const invitations = await memberService.getPendingInvitations(dbUser._id.toString());

    return sendSuccess(res, { invitations });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    return sendError(res, "Failed to fetch invitations");
  }
}
