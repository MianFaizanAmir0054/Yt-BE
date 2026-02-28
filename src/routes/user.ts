import { Router, Request, Response, RequestHandler } from "express";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";
import Channel from "../models/Channel.js";
import { encrypt, decrypt, maskApiKey } from "../lib/encryption.js";

const router = Router();

// Type for authenticated user attached by middleware
interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string;
  role?: string;
}

// Helper to get user from request
function getUser(req: Request): AuthUser | undefined {
  return (req as unknown as { user?: AuthUser }).user;
}

/**
 * GET /api/user/me
 * Get current user's full profile with workspaces and channels
 */
router.get("/me", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Find user in our User model
    const user = await User.findOne({ email: authUser.email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user's workspaces based on role
    let workspaces: Array<{
      id: string;
      name: string;
      description?: string;
      role: string;
      channelCount: number;
      isOwner: boolean;
    }> = [];

    if (user.role === "super_admin") {
      // Super admin sees all workspaces
      const allWorkspaces = await Workspace.find().lean();
      workspaces = allWorkspaces.map((ws) => ({
        id: ws._id.toString(),
        name: ws.name,
        description: ws.description,
        role: "super_admin",
        channelCount: ws.channelIds?.length || 0,
        isOwner: false,
      }));
    } else if (user.role === "admin") {
      // Admin sees workspaces they own
      const ownedWorkspaces = await Workspace.find({ ownerId: user._id }).lean();
      workspaces = ownedWorkspaces.map((ws) => ({
        id: ws._id.toString(),
        name: ws.name,
        description: ws.description,
        role: "owner",
        channelCount: ws.channelIds?.length || 0,
        isOwner: true,
      }));
    } else {
      // Collaborator sees workspaces they're a member of
      const memberships = await WorkspaceMember.find({
        userId: user._id,
        status: "accepted",
      }).lean();

      const workspaceIds = memberships.map((m) => m.workspaceId);
      const memberWorkspaces = await Workspace.find({
        _id: { $in: workspaceIds },
      }).lean();

      workspaces = memberWorkspaces.map((ws) => {
        const membership = memberships.find(
          (m) => m.workspaceId.toString() === ws._id.toString()
        );
        return {
          id: ws._id.toString(),
          name: ws.name,
          description: ws.description,
          role: membership?.role || "viewer",
          channelCount: ws.channelIds?.length || 0,
          isOwner: false,
        };
      });
    }

    // Get channels if admin
    let channels: Array<{
      id: string;
      name: string;
      youtubeChannelId?: string;
      youtubeHandle?: string;
      isConnected: boolean;
    }> = [];

    if (user.role === "admin") {
      const ownedChannels = await Channel.find({ ownerId: user._id }).lean();
      channels = ownedChannels.map((ch) => ({
        id: ch._id.toString(),
        name: ch.name,
        youtubeChannelId: ch.youtubeChannelId,
        youtubeHandle: ch.youtubeHandle,
        isConnected: !!ch.youtubeCredentials?.accessToken,
      }));
    }

    // API keys configured status
    const apiKeysConfigured = {
      openai: !!user.apiKeys?.openai,
      anthropic: !!user.apiKeys?.anthropic,
      perplexity: !!user.apiKeys?.perplexity,
      pexels: !!user.apiKeys?.pexels,
      segmind: !!user.apiKeys?.segmind,
      elevenLabs: !!user.apiKeys?.elevenLabs,
    };

    // Pending invitations count (for collaborators)
    const pendingInvites = await WorkspaceMember.countDocuments({
      userId: user._id,
      status: "pending",
    });

    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        preferences: user.preferences,
        apiKeysConfigured,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
      workspaces,
      channels,
      pendingInvites,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
}) as RequestHandler);

/**
 * GET /api/user/profile
 * Get current user profile
 */
router.get("/profile", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findOne({ email: authUser.email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const apiKeysConfigured = {
      openai: !!user.apiKeys?.openai,
      anthropic: !!user.apiKeys?.anthropic,
      perplexity: !!user.apiKeys?.perplexity,
      pexels: !!user.apiKeys?.pexels,
      segmind: !!user.apiKeys?.segmind,
      elevenLabs: !!user.apiKeys?.elevenLabs,
    };

    res.json({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      preferences: user.preferences,
      apiKeysConfigured,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}) as RequestHandler);

/**
 * PUT /api/user/profile
 * Update user profile (name, image, preferences)
 */
router.put("/profile", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, image, preferences } = req.body;

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update allowed fields
    if (name !== undefined) {
      user.name = name;
    }
    if (image !== undefined) {
      user.image = image;
    }
    if (preferences) {
      user.preferences = {
        ...user.preferences,
        ...preferences,
      };
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        preferences: user.preferences,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
}) as RequestHandler);

/**
 * GET /api/user/api-keys
 * Fetch user API keys (masked) and preferences
 */
router.get("/api-keys", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const apiKeys = user.apiKeys || {};

    // Return masked keys
    const maskedKeys = {
      openai: apiKeys.openai ? maskApiKey(decrypt(apiKeys.openai)) : null,
      anthropic: apiKeys.anthropic ? maskApiKey(decrypt(apiKeys.anthropic)) : null,
      perplexity: apiKeys.perplexity ? maskApiKey(decrypt(apiKeys.perplexity)) : null,
      pexels: apiKeys.pexels ? maskApiKey(decrypt(apiKeys.pexels)) : null,
      segmind: apiKeys.segmind ? maskApiKey(decrypt(apiKeys.segmind)) : null,
      elevenLabs: apiKeys.elevenLabs ? maskApiKey(decrypt(apiKeys.elevenLabs)) : null,
    };

    // Return which keys are configured
    const configured = {
      openai: !!apiKeys.openai,
      anthropic: !!apiKeys.anthropic,
      perplexity: !!apiKeys.perplexity,
      pexels: !!apiKeys.pexels,
      segmind: !!apiKeys.segmind,
      elevenLabs: !!apiKeys.elevenLabs,
    };

    res.json({
      maskedKeys,
      configured,
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Get API keys error:", error);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
}) as RequestHandler);

/**
 * PUT /api/user/api-keys
 * Update user API keys and/or preferences
 */
router.put("/api-keys", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { apiKeys, preferences } = req.body;

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
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

    res.json({
      message: "Settings updated successfully",
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Update API keys error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
}) as RequestHandler);

/**
 * DELETE /api/user/api-keys/:key
 * Delete a specific API key
 */
router.delete("/api-keys/:key", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const validKeys = ["openai", "anthropic", "perplexity", "pexels", "segmind", "elevenLabs"];
    
    if (!validKeys.includes(key)) {
      return res.status(400).json({ error: "Invalid API key name" });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete the specific API key
    if (user.apiKeys) {
      delete (user.apiKeys as Record<string, any>)[key];
    }

    await user.save();

    res.json({
      message: `API key '${key}' deleted successfully`,
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Delete API key error:", error);
    res.status(500).json({ error: "Failed to delete API key" });
  }
}) as RequestHandler);

/**
 * DELETE /api/user/api-keys
 * Delete all API keys
 */
router.delete("/api-keys", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete all API keys
    user.apiKeys = {
      openai: undefined,
      anthropic: undefined,
      perplexity: undefined,
      pexels: undefined,
      segmind: undefined,
      elevenLabs: undefined,
    };

    await user.save();

    res.json({
      message: "All API keys deleted successfully",
      preferences: user.preferences,
    });
  } catch (error) {
    console.error("Delete all API keys error:", error);
    res.status(500).json({ error: "Failed to delete API keys" });
  }
}) as RequestHandler);

/**
 * GET /api/user/invitations
 * Get pending workspace invitations for the current user
 */
router.get("/invitations", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const invitations = await WorkspaceMember.find({
      userId: user._id,
      status: "pending",
    })
      .populate("workspaceId", "name description")
      .populate("invitedBy", "name email")
      .lean();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedInvitations = invitations.map((inv: any) => ({
      id: inv._id.toString(),
      workspace: inv.workspaceId && typeof inv.workspaceId === "object"
        ? {
            id: inv.workspaceId._id?.toString() || inv.workspaceId.toString(),
            name: inv.workspaceId.name,
            description: inv.workspaceId.description,
          }
        : null,
      role: inv.role,
      invitedBy: inv.invitedBy && typeof inv.invitedBy === "object"
        ? {
            name: inv.invitedBy.name,
            email: inv.invitedBy.email,
          }
        : null,
      createdAt: inv.createdAt,
    }));

    res.json({ invitations: formattedInvitations });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
}) as RequestHandler);

/**
 * POST /api/user/invitations/:id/accept
 * Accept a workspace invitation
 */
router.post("/invitations/:id/accept", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const invitation = await WorkspaceMember.findOne({
      _id: id,
      userId: user._id,
      status: "pending",
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    invitation.status = "accepted";
    await invitation.save();

    const workspace = await Workspace.findById(invitation.workspaceId);

    res.json({
      message: "Invitation accepted",
      workspace: workspace
        ? {
            id: workspace._id.toString(),
            name: workspace.name,
          }
        : null,
    });
  } catch (error) {
    console.error("Error accepting invitation:", error);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
}) as RequestHandler);

/**
 * POST /api/user/invitations/:id/decline
 * Decline a workspace invitation
 */
router.post("/invitations/:id/decline", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const invitation = await WorkspaceMember.findOne({
      _id: id,
      userId: user._id,
      status: "pending",
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    invitation.status = "rejected";
    await invitation.save();

    res.json({ message: "Invitation declined" });
  } catch (error) {
    console.error("Error declining invitation:", error);
    res.status(500).json({ error: "Failed to decline invitation" });
  }
}) as RequestHandler);

/**
 * DELETE /api/user/account
 * Deactivate user account (soft delete)
 */
router.delete("/account", (async (req: Request, res: Response) => {
  try {
    const authUser = getUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Super admins cannot deactivate themselves
    if (user.role === "super_admin") {
      return res.status(403).json({ error: "Super admin accounts cannot be deactivated" });
    }

    // Soft delete - mark as inactive
    user.isActive = false;
    await user.save();

    // Remove from all workspace memberships
    await WorkspaceMember.updateMany(
      { userId: user._id },
      { status: "removed" }
    );

    res.json({ message: "Account deactivated successfully" });
  } catch (error) {
    console.error("Error deactivating account:", error);
    res.status(500).json({ error: "Failed to deactivate account" });
  }
}) as RequestHandler);

export default router;
