import { Router, Request, Response, RequestHandler } from "express";
import crypto from "crypto";
import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";
import Channel from "../models/Channel.js";
import User from "../models/User.js";
import Project from "../models/Project.js";

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

// Helper to safely get string param
function getParam(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] : param || "";
}

// Middleware to check if user is admin (super_admin or admin)
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

// Check workspace access helper
const checkWorkspaceAccess = async (
  req: Request,
  workspaceId: string
): Promise<{
  hasAccess: boolean;
  isOwner: boolean;
  membership?: InstanceType<typeof WorkspaceMember>;
  dbUser?: InstanceType<typeof User>;
}> => {
  const user = getUser(req);
  if (!user) return { hasAccess: false, isOwner: false };

  // Look up user by email since Better Auth and Mongoose User have different IDs
  const dbUser = await User.findOne({ email: user.email.toLowerCase() });
  if (!dbUser) return { hasAccess: false, isOwner: false };

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return { hasAccess: false, isOwner: false };

  // Check if owner (using MongoDB User ID)
  if (workspace.ownerId.toString() === dbUser._id.toString()) {
    return { hasAccess: true, isOwner: true, dbUser };
  }

  // Check if member (using MongoDB User ID)
  const membership = await WorkspaceMember.findOne({
    workspaceId,
    userId: dbUser._id,
    status: "accepted",
  });

  if (membership) {
    return { hasAccess: true, isOwner: false, membership, dbUser };
  }

  // Super admin always has access
  if (dbUser.role === "super_admin") {
    return { hasAccess: true, isOwner: true, dbUser };
  }

  return { hasAccess: false, isOwner: false };
};

/**
 * GET /api/workspaces
 * List workspaces user has access to
 */
router.get("/", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Look up user by email since Better Auth and Mongoose User have different IDs
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });
    const { search, page = 1, limit = 20 } = req.query;

    let workspaces;
    let total;

    if (dbUser?.role === "super_admin") {
      // Super admin sees all workspaces
      const query: Record<string, unknown> = {};
      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = (Number(page) - 1) * Number(limit);
      [workspaces, total] = await Promise.all([
        Workspace.find(query)
          .populate("ownerId", "name email")
          .populate("channelIds", "name thumbnailUrl")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        Workspace.countDocuments(query),
      ]);
    } else if (dbUser?.role === "admin") {
      // Admin sees their own workspaces (use MongoDB User ID)
      const query: Record<string, unknown> = { ownerId: dbUser._id };
      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = (Number(page) - 1) * Number(limit);
      [workspaces, total] = await Promise.all([
        Workspace.find(query)
          .populate("channelIds", "name thumbnailUrl")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        Workspace.countDocuments(query),
      ]);
    } else {
      // Collaborator sees workspaces they're a member of
      const memberships = await WorkspaceMember.find({
        userId: user.id,
        status: "accepted",
      }).select("workspaceId");

      const workspaceIds = memberships.map((m: { workspaceId: unknown }) => m.workspaceId);
      const query: Record<string, unknown> = { _id: { $in: workspaceIds } };
      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = (Number(page) - 1) * Number(limit);
      [workspaces, total] = await Promise.all([
        Workspace.find(query)
          .populate("ownerId", "name email")
          .populate("channelIds", "name thumbnailUrl")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        Workspace.countDocuments(query),
      ]);
    }

    res.json({
      workspaces,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
}) as RequestHandler);

/**
 * POST /api/workspaces
 * Create a new workspace (admin only)
 */
router.post("/", requireAdmin as RequestHandler, (async (req: Request, res: Response) => {
  try {
    const { name, description, channelIds = [], settings } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Workspace name is required" });
    }

    // Use dbUser attached by requireAdmin middleware
    const dbUser = (req as unknown as { dbUser: InstanceType<typeof User> }).dbUser;

    // Verify all channels exist and are owned by this admin
    if (channelIds.length > 0) {
      const channelQuery: Record<string, unknown> = { _id: { $in: channelIds } };

      if (dbUser?.role !== "super_admin") {
        channelQuery.ownerId = dbUser._id;
      }

      const ownedChannels = await Channel.countDocuments(channelQuery);
      if (ownedChannels !== channelIds.length) {
        return res.status(400).json({ error: "Some channels don't exist or you don't own them" });
      }
    }

    const workspace = await Workspace.create({
      name,
      description,
      ownerId: dbUser._id, // Use MongoDB User ID, not Better Auth ID
      channelIds,
      settings: settings || {
        requireApproval: false,
      },
    });

    res.status(201).json({
      message: "Workspace created successfully",
      workspace,
    });
  } catch (error) {
    console.error("Error creating workspace:", error);
    res.status(500).json({ error: "Failed to create workspace" });
  }
}) as RequestHandler);

/**
 * GET /api/workspaces/:id
 * Get workspace details
 */
router.get("/:id", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const { hasAccess, isOwner, membership } = await checkWorkspaceAccess(req, id);

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied to this workspace" });
    }

    const workspace = await Workspace.findById(id)
      .populate("ownerId", "name email")
      .populate("channelIds", "name youtubeChannelId youtubeHandle thumbnailUrl");

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // Get member count
    const memberCount = await WorkspaceMember.countDocuments({
      workspaceId: id,
      status: "accepted",
    });

    // Get project count
    const projectCount = await Project.countDocuments({ workspaceId: id });

    res.json({
      workspace,
      memberCount,
      projectCount,
      userRole: isOwner ? "owner" : membership?.role || "viewer",
    });
  } catch (error) {
    console.error("Error fetching workspace:", error);
    res.status(500).json({ error: "Failed to fetch workspace" });
  }
}) as RequestHandler);

/**
 * PUT /api/workspaces/:id
 * Update workspace (owner only)
 */
router.put("/:id", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const user = getUser(req);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can update settings" });
    }

    const { name, description, channelIds, settings } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (settings !== undefined) updates.settings = settings;
    
    // Handle channelIds update
    if (channelIds !== undefined) {
      // Verify all channels exist and are owned by this admin
      if (channelIds.length > 0) {
        // Use dbUser from checkWorkspaceAccess
        const dbUser = await User.findOne({ email: user!.email.toLowerCase() });
        const channelQuery: Record<string, unknown> = { _id: { $in: channelIds } };

        if (dbUser?.role !== "super_admin") {
          channelQuery.ownerId = dbUser?._id;
        }

        const ownedChannels = await Channel.countDocuments(channelQuery);
        if (ownedChannels !== channelIds.length) {
          return res.status(400).json({ error: "Some channels don't exist or you don't own them" });
        }
      }
      updates.channelIds = channelIds;
    }

    const workspace = await Workspace.findByIdAndUpdate(id, { $set: updates }, { new: true })
      .populate("channelIds", "name");

    res.json({
      message: "Workspace updated successfully",
      workspace,
    });
  } catch (error) {
    console.error("Error updating workspace:", error);
    res.status(500).json({ error: "Failed to update workspace" });
  }
}) as RequestHandler);

/**
 * DELETE /api/workspaces/:id
 * Delete workspace (owner only)
 */
router.delete("/:id", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can delete workspace" });
    }

    // Check for existing projects
    const projectCount = await Project.countDocuments({ workspaceId: id });
    if (projectCount > 0) {
      return res.status(400).json({
        error: `Cannot delete workspace with ${projectCount} projects. Delete or move projects first.`,
      });
    }

    // Delete all memberships
    await WorkspaceMember.deleteMany({ workspaceId: id });

    // Delete workspace
    await Workspace.findByIdAndDelete(id);

    res.json({ message: "Workspace deleted successfully" });
  } catch (error) {
    console.error("Error deleting workspace:", error);
    res.status(500).json({ error: "Failed to delete workspace" });
  }
}) as RequestHandler);

/**
 * POST /api/workspaces/:id/channels
 * Add channels to workspace (owner only)
 */
router.post("/:id/channels", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const user = getUser(req);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can manage channels" });
    }

    const { channelIds } = req.body;
    if (!channelIds || !Array.isArray(channelIds)) {
      return res.status(400).json({ error: "Channel IDs array is required" });
    }

    // Verify channels are owned by the admin (use dbUser from checkWorkspaceAccess)
    const dbUser = await User.findOne({ email: user!.email.toLowerCase() });
    const channelQuery: Record<string, unknown> = { _id: { $in: channelIds } };

    if (dbUser?.role !== "super_admin") {
      channelQuery.ownerId = dbUser?._id;
    }

    const ownedChannels = await Channel.countDocuments(channelQuery);
    if (ownedChannels !== channelIds.length) {
      return res.status(400).json({ error: "Some channels don't exist or you don't own them" });
    }

    const workspace = await Workspace.findByIdAndUpdate(
      id,
      { $addToSet: { channelIds: { $each: channelIds } } },
      { new: true }
    ).populate("channelIds", "name thumbnailUrl");

    res.json({
      message: "Channels added successfully",
      workspace,
    });
  } catch (error) {
    console.error("Error adding channels:", error);
    res.status(500).json({ error: "Failed to add channels" });
  }
}) as RequestHandler);

/**
 * DELETE /api/workspaces/:id/channels/:channelId
 * Remove channel from workspace (owner only)
 */
router.delete("/:id/channels/:channelId", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const channelId = getParam(req.params.channelId);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can manage channels" });
    }

    const workspace = await Workspace.findByIdAndUpdate(
      id,
      { $pull: { channelIds: channelId } },
      { new: true }
    ).populate("channelIds", "name thumbnailUrl");

    res.json({
      message: "Channel removed successfully",
      workspace,
    });
  } catch (error) {
    console.error("Error removing channel:", error);
    res.status(500).json({ error: "Failed to remove channel" });
  }
}) as RequestHandler);

// ==================== Member Management ====================

/**
 * GET /api/workspaces/:id/members
 * List workspace members
 */
router.get("/:id/members", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied to this workspace" });
    }

    const { status = "accepted" } = req.query;

    const query: Record<string, unknown> = { workspaceId: id };
    if (status !== "all") {
      query.status = status;
    }

    const members = await WorkspaceMember.find(query)
      .populate("userId", "name email")
      .populate("invitedBy", "name email")
      .sort({ createdAt: -1 });

    // Get workspace owner
    const workspace = await Workspace.findById(id).populate("ownerId", "name email");

    res.json({
      owner: workspace?.ownerId,
      members,
      canManage: isOwner,
    });
  } catch (error) {
    console.error("Error fetching members:", error);
    res.status(500).json({ error: "Failed to fetch members" });
  }
}) as RequestHandler);

/**
 * POST /api/workspaces/:id/members/invite
 * Invite a collaborator to workspace (owner only)
 */
router.post("/:id/members/invite", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const user = getUser(req);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can invite members" });
    }

    const { email, role = "editor" } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user by email
    const invitedUser = await User.findOne({ email: email.toLowerCase() });
    if (!invitedUser) {
      return res.status(404).json({ error: "User not found. They must register first." });
    }

    // Check if already a member
    const existingMembership = await WorkspaceMember.findOne({
      workspaceId: id,
      userId: invitedUser._id,
    });

    if (existingMembership) {
      if (existingMembership.status === "accepted") {
        return res.status(400).json({ error: "User is already a member" });
      }
      if (existingMembership.status === "pending") {
        return res.status(400).json({ error: "Invitation already pending" });
      }
      // If rejected or removed, allow re-inviting
      await WorkspaceMember.findByIdAndDelete(existingMembership._id);
    }

    // Create invitation
    const inviteToken = crypto.randomBytes(32).toString("hex");
    const membership = await WorkspaceMember.create({
      workspaceId: id,
      userId: invitedUser._id,
      role: ["admin", "editor", "viewer"].includes(role) ? role : "editor",
      invitedBy: user!.id,
      inviteToken,
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: "pending",
    });

    // TODO: Send invitation email

    res.status(201).json({
      message: "Invitation sent successfully",
      membership: {
        id: membership._id,
        email: invitedUser.email,
        name: invitedUser.name,
        role: membership.role,
        status: membership.status,
        inviteExpiresAt: membership.inviteExpiresAt,
      },
    });
  } catch (error) {
    console.error("Error inviting member:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
}) as RequestHandler);

/**
 * POST /api/workspaces/accept-invite
 * Accept workspace invitation
 */
router.post("/accept-invite", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Invitation token is required" });
    }

    const membership = await WorkspaceMember.findOne({
      inviteToken: token,
      userId: user.id,
      status: "pending",
    });

    if (!membership) {
      return res.status(404).json({ error: "Invitation not found or already processed" });
    }

    if (membership.inviteExpiresAt && membership.inviteExpiresAt < new Date()) {
      return res.status(400).json({ error: "Invitation has expired" });
    }

    membership.status = "accepted";
    membership.inviteToken = undefined;
    membership.inviteExpiresAt = undefined;
    await membership.save();

    const workspace = await Workspace.findById(membership.workspaceId);

    res.json({
      message: "Invitation accepted successfully",
      workspace: {
        id: workspace?._id,
        name: workspace?.name,
      },
    });
  } catch (error) {
    console.error("Error accepting invitation:", error);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
}) as RequestHandler);

/**
 * POST /api/workspaces/decline-invite
 * Decline workspace invitation
 */
router.post("/decline-invite", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Invitation token is required" });
    }

    const membership = await WorkspaceMember.findOne({
      inviteToken: token,
      userId: user.id,
      status: "pending",
    });

    if (!membership) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    membership.status = "rejected";
    membership.inviteToken = undefined;
    await membership.save();

    res.json({ message: "Invitation declined" });
  } catch (error) {
    console.error("Error declining invitation:", error);
    res.status(500).json({ error: "Failed to decline invitation" });
  }
}) as RequestHandler);

/**
 * PUT /api/workspaces/:id/members/:memberId
 * Update member role (owner only)
 */
router.put("/:id/members/:memberId", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const memberId = getParam(req.params.memberId);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can manage members" });
    }

    const { role, permissions } = req.body;

    const updates: Record<string, unknown> = {};
    if (role && ["admin", "editor", "viewer"].includes(role)) {
      updates.role = role;
    }
    if (permissions) {
      updates.permissions = permissions;
    }

    const membership = await WorkspaceMember.findOneAndUpdate(
      { _id: memberId, workspaceId: id },
      { $set: updates },
      { new: true }
    ).populate("userId", "name email");

    if (!membership) {
      return res.status(404).json({ error: "Member not found" });
    }

    res.json({
      message: "Member updated successfully",
      membership,
    });
  } catch (error) {
    console.error("Error updating member:", error);
    res.status(500).json({ error: "Failed to update member" });
  }
}) as RequestHandler);

/**
 * DELETE /api/workspaces/:id/members/:memberId
 * Remove member from workspace (owner only)
 */
router.delete("/:id/members/:memberId", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const memberId = getParam(req.params.memberId);
    const { hasAccess, isOwner } = await checkWorkspaceAccess(req, id);

    if (!hasAccess || !isOwner) {
      return res.status(403).json({ error: "Only workspace owner can remove members" });
    }

    const membership = await WorkspaceMember.findOneAndUpdate(
      { _id: memberId, workspaceId: id },
      { status: "removed" },
      { new: true }
    );

    if (!membership) {
      return res.status(404).json({ error: "Member not found" });
    }

    res.json({ message: "Member removed successfully" });
  } catch (error) {
    console.error("Error removing member:", error);
    res.status(500).json({ error: "Failed to remove member" });
  }
}) as RequestHandler);

/**
 * POST /api/workspaces/:id/leave
 * Leave workspace (for collaborators)
 */
router.post("/:id/leave", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const user = getUser(req);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const workspace = await Workspace.findById(id);
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // Owner cannot leave their own workspace
    if (workspace.ownerId.toString() === user.id) {
      return res.status(400).json({
        error: "Owners cannot leave their workspace. Transfer ownership or delete it.",
      });
    }

    const membership = await WorkspaceMember.findOneAndUpdate(
      { workspaceId: id, userId: user.id, status: "accepted" },
      { status: "removed" },
      { new: true }
    );

    if (!membership) {
      return res.status(404).json({ error: "Membership not found" });
    }

    res.json({ message: "Successfully left workspace" });
  } catch (error) {
    console.error("Error leaving workspace:", error);
    res.status(500).json({ error: "Failed to leave workspace" });
  }
}) as RequestHandler);

/**
 * GET /api/workspaces/:id/channels-access
 * Get channels the current user has access to in this workspace
 */
router.get("/:id/channels-access", (async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const { hasAccess, isOwner, membership } = await checkWorkspaceAccess(req, id);

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied to this workspace" });
    }

    const workspace = await Workspace.findById(id).populate(
      "channelIds",
      "name youtubeChannelId youtubeHandle thumbnailUrl"
    );

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // Owners and admins have access to all channels in workspace
    if (isOwner || membership?.role === "admin") {
      res.json({
        channels: workspace.channelIds,
        fullAccess: true,
      });
    } else {
      // Check if member has restricted channel access
      const channelIds = membership?.permissions?.channelIds;
      if (channelIds && channelIds.length > 0) {
        const allowedChannelIds = channelIds.map((cid: { toString: () => string }) => cid.toString());
        const filteredChannels = (workspace.channelIds as Array<{ _id: { toString: () => string } }>).filter(
          (channel) => allowedChannelIds.includes(channel._id.toString())
        );
        res.json({
          channels: filteredChannels,
          fullAccess: false,
        });
      } else {
        // No restrictions, full access
        res.json({
          channels: workspace.channelIds,
          fullAccess: true,
        });
      }
    }
  } catch (error) {
    console.error("Error fetching channel access:", error);
    res.status(500).json({ error: "Failed to fetch channel access" });
  }
}) as RequestHandler);

export default router;
