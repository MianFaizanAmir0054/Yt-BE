import { Request, Response } from "express";
import { getUser, sendSuccess, sendError, sendNotFound } from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";
import * as memberService from "../services/member.service.js";
import { decrypt, encrypt, maskApiKey } from "../../lib/encryption.js";
import User from "../../models/User.js";

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

/**
 * GET /api/user/api-keys
 * Fetch user API keys (masked) and preferences
 */
export async function getApiKeys(req: Request, res: Response) {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    const apiKeys = user.apiKeys || {};

    // Return masked keys
    const maskedKeys = {
      openai: apiKeys.openai ? maskApiKey(decrypt(apiKeys.openai)) : null,
      anthropic: apiKeys.anthropic ? maskApiKey(decrypt(apiKeys.anthropic)) : null,
      perplexity: apiKeys.perplexity ? maskApiKey(decrypt(apiKeys.perplexity)) : null,
      pexels: apiKeys.pexels ? maskApiKey(decrypt(apiKeys.pexels)) : null,
      segmind: apiKeys.segmind ? maskApiKey(decrypt(apiKeys.segmind)) : null,
      assemblyai: apiKeys.assemblyai ? maskApiKey(decrypt(apiKeys.assemblyai)) : null,
      elevenLabs: apiKeys.elevenLabs ? maskApiKey(decrypt(apiKeys.elevenLabs)) : null,
    };

    // Return which keys are configured
    const configured = {
      openai: !!apiKeys.openai,
      anthropic: !!apiKeys.anthropic,
      perplexity: !!apiKeys.perplexity,
      pexels: !!apiKeys.pexels,
      segmind: !!apiKeys.segmind,
      assemblyai: !!apiKeys.assemblyai,
      elevenLabs: !!apiKeys.elevenLabs,
    };

    return sendSuccess(res, {
      maskedKeys,
      configured,
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Get API keys error:", error);
    return sendError(res, "Failed to fetch API keys");
  }
}

/**
 * PUT /api/user/api-keys
 * Update user API keys and/or preferences
 */
export async function updateApiKeys(req: Request, res: Response) {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { apiKeys, preferences } = req.body;

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    // Handle API keys update
    if (apiKeys) {
      const existingKeys = user.apiKeys || {};

      // Update with new values (encrypt non-empty values)
      for (const [key, value] of Object.entries(apiKeys)) {
        if (value !== undefined) {
          (existingKeys as Record<string, string | undefined>)[key] = value
            ? encrypt(value as string)
            : undefined;
        }
      }

      user.apiKeys = existingKeys;
    }

    // Handle preferences update
    if (preferences) {
      user.preferences = {
        ...user.preferences,
        ...preferences,
      };
    }

    await user.save();

    return sendSuccess(res, {
      message: "Settings updated successfully",
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Update API keys error:", error);
    return sendError(res, "Failed to update settings");
  }
}

/**
 * DELETE /api/user/api-keys/:key
 * Delete a specific API key
 */
export async function deleteApiKey(req: Request, res: Response) {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const validKeys = ["openai", "anthropic", "perplexity", "pexels", "segmind", "assemblyai", "elevenLabs"];
    
    if (!validKeys.includes(key)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Invalid API key name" });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    // Delete the specific API key
    if (user.apiKeys) {
      delete (user.apiKeys as Record<string, any>)[key];
    }

    await user.save();

    return sendSuccess(res, {
      message: `API key '${key}' deleted successfully`,
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Delete API key error:", error);
    return sendError(res, "Failed to delete API key");
  }
}

/**
 * DELETE /api/user/api-keys
 * Delete all API keys
 */
export async function deleteAllApiKeys(req: Request, res: Response) {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.USER_NOT_FOUND });
    }

    // Delete all API keys
    user.apiKeys = {
      openai: undefined,
      anthropic: undefined,
      perplexity: undefined,
      pexels: undefined,
      segmind: undefined,
      assemblyai: undefined,
      elevenLabs: undefined,
    };

    await user.save();

    return sendSuccess(res, {
      message: "All API keys deleted successfully",
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Delete all API keys error:", error);
    return sendError(res, "Failed to delete API keys");
  }
}
