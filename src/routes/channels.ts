import { Router, Request, Response, RequestHandler } from "express";
import Channel from "../models/Channel.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";

const router = Router();

// Type for authenticated user
interface AuthUser {
  id: string;
  email: string;
  name: string;
  role?: string;
}

// Helper to get user from request
function getUser(req: Request): AuthUser | undefined {
  return (req as unknown as { user?: AuthUser }).user;
}

// Middleware to check if user is admin
const requireAdmin: RequestHandler = async (req, res, next) => {
  const user = getUser(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Look up user by email since Better Auth and Mongoose User have different IDs
  const dbUser = await User.findOne({ email: user.email.toLowerCase() });
  if (!dbUser || !["super_admin", "admin"].includes(dbUser.role)) {
    return res.status(403).json({ error: "Forbidden - Admin access required" });
  }

  // Attach dbUser to request for use in route handlers
  (req as unknown as { dbUser: typeof dbUser }).dbUser = dbUser;

  next();
};

// Apply admin check to all routes
router.use(requireAdmin as RequestHandler);

/**
 * GET /api/channels
 * List channels owned by the admin
 */
router.get("/", (async (req: Request, res: Response) => {
  try {
    const { search, isActive, page = 1, limit = 20 } = req.query;

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;
    
    const query: Record<string, unknown> = {};
    
    // Super admin can see all channels, admin only their own
    if (dbUser?.role !== "super_admin") {
      query.ownerId = dbUser._id;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { youtubeHandle: { $regex: search, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [channels, total] = await Promise.all([
      Channel.find(query)
        .select("-youtubeCredentials")
        .populate("ownerId", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Channel.countDocuments(query),
    ]);

    res.json({
      channels,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching channels:", error);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
}) as RequestHandler);

/**
 * POST /api/channels
 * Create a new YouTube channel
 */
router.post("/", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const {
      name,
      youtubeChannelId,
      youtubeHandle,
      description,
      thumbnailUrl,
      defaultAspectRatio,
      defaultVoiceId,
      brandColors,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    // Check if channel already exists (if youtubeChannelId provided)
    if (youtubeChannelId) {
      const existingChannel = await Channel.findOne({ youtubeChannelId });
      if (existingChannel) {
        return res.status(400).json({ error: "Channel already registered" });
      }
    }

    const channel = await Channel.create({
      name,
      youtubeChannelId,
      youtubeHandle,
      description,
      thumbnailUrl,
      ownerId: user!.id,
      defaultAspectRatio: defaultAspectRatio || "9:16",
      defaultVoiceId,
      brandColors: brandColors || {},
      isActive: true,
    });

    res.status(201).json({
      message: "Channel created successfully",
      channel: {
        id: channel._id,
        name: channel.name,
        youtubeChannelId: channel.youtubeChannelId,
        youtubeHandle: channel.youtubeHandle,
        thumbnailUrl: channel.thumbnailUrl,
        isActive: channel.isActive,
        createdAt: channel.createdAt,
      },
    });
  } catch (error) {
    console.error("Error creating channel:", error);
    res.status(500).json({ error: "Failed to create channel" });
  }
}) as RequestHandler);

/**
 * GET /api/channels/:id
 * Get channel details
 */
router.get("/:id", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;
    const query: Record<string, unknown> = { _id: id };
    
    // Non-super admin can only see their own channels
    if (dbUser?.role !== "super_admin") {
      query.ownerId = dbUser._id;
    }

    const channel = await Channel.findOne(query)
      .select("-youtubeCredentials")
      .populate("ownerId", "name email");

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Get workspaces this channel is in
    const workspaces = await Workspace.find({ channelIds: id }).select("name");

    res.json({
      channel,
      workspaces,
    });
  } catch (error) {
    console.error("Error fetching channel:", error);
    res.status(500).json({ error: "Failed to fetch channel" });
  }
}) as RequestHandler);

/**
 * PUT /api/channels/:id
 * Update channel details
 */
router.put("/:id", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      youtubeHandle,
      description,
      thumbnailUrl,
      defaultAspectRatio,
      defaultVoiceId,
      brandColors,
      isActive,
    } = req.body;

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;
    const query: Record<string, unknown> = { _id: id };
    
    if (dbUser?.role !== "super_admin") {
      query.ownerId = dbUser._id;
    }

    const channel = await Channel.findOne(query);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (youtubeHandle !== undefined) updates.youtubeHandle = youtubeHandle;
    if (description !== undefined) updates.description = description;
    if (thumbnailUrl !== undefined) updates.thumbnailUrl = thumbnailUrl;
    if (defaultAspectRatio !== undefined) updates.defaultAspectRatio = defaultAspectRatio;
    if (defaultVoiceId !== undefined) updates.defaultVoiceId = defaultVoiceId;
    if (brandColors !== undefined) updates.brandColors = brandColors;
    if (isActive !== undefined) updates.isActive = isActive;

    const updatedChannel = await Channel.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true }
    ).select("-youtubeCredentials");

    res.json({
      message: "Channel updated successfully",
      channel: updatedChannel,
    });
  } catch (error) {
    console.error("Error updating channel:", error);
    res.status(500).json({ error: "Failed to update channel" });
  }
}) as RequestHandler);

/**
 * DELETE /api/channels/:id
 * Delete a channel
 */
router.delete("/:id", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;
    const query: Record<string, unknown> = { _id: id };
    
    if (dbUser?.role !== "super_admin") {
      query.ownerId = dbUser._id;
    }

    const channel = await Channel.findOne(query);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Check if channel is in any workspace
    const workspacesUsingChannel = await Workspace.countDocuments({ channelIds: id });
    if (workspacesUsingChannel > 0) {
      return res.status(400).json({
        error: "Cannot delete channel. It is used in one or more workspaces. Remove it from workspaces first.",
      });
    }

    await Channel.findByIdAndDelete(id);

    res.json({ message: "Channel deleted successfully" });
  } catch (error) {
    console.error("Error deleting channel:", error);
    res.status(500).json({ error: "Failed to delete channel" });
  }
}) as RequestHandler);

/**
 * POST /api/channels/:id/connect-youtube
 * Connect YouTube OAuth credentials
 */
router.post("/:id/connect-youtube", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { accessToken, refreshToken, expiresAt } = req.body;

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;
    const query: Record<string, unknown> = { _id: id };
    
    if (dbUser?.role !== "super_admin") {
      query.ownerId = dbUser._id;
    }

    const channel = await Channel.findOne(query);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    await Channel.findByIdAndUpdate(id, {
      $set: {
        youtubeCredentials: {
          accessToken,
          refreshToken,
          expiresAt: new Date(expiresAt),
        },
      },
    });

    res.json({ message: "YouTube credentials connected successfully" });
  } catch (error) {
    console.error("Error connecting YouTube:", error);
    res.status(500).json({ error: "Failed to connect YouTube credentials" });
  }
}) as RequestHandler);

/**
 * DELETE /api/channels/:id/disconnect-youtube
 * Disconnect YouTube OAuth credentials
 */
router.delete("/:id/disconnect-youtube", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;
    const query: Record<string, unknown> = { _id: id };
    
    if (dbUser?.role !== "super_admin") {
      query.ownerId = dbUser._id;
    }

    const channel = await Channel.findOne(query);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    await Channel.findByIdAndUpdate(id, {
      $unset: { youtubeCredentials: 1 },
    });

    res.json({ message: "YouTube credentials disconnected successfully" });
  } catch (error) {
    console.error("Error disconnecting YouTube:", error);
    res.status(500).json({ error: "Failed to disconnect YouTube credentials" });
  }
}) as RequestHandler);

export default router;
