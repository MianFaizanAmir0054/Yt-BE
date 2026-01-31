import { Router, Request, Response, RequestHandler } from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import Project from "../models/Project.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";

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

// Helper to safely get string param
function getParam(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] : param || "";
}

// Check if user has access to a workspace and specific channel
// Uses email to look up user since Better Auth and Mongoose User have different IDs
async function checkWorkspaceChannelAccess(
  userEmail: string,
  workspaceId: string,
  channelId?: string
): Promise<{
  hasAccess: boolean;
  isOwner: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  membership?: InstanceType<typeof WorkspaceMember>;
  dbUser?: InstanceType<typeof User>;
}> {
  const dbUser = await User.findOne({ email: userEmail.toLowerCase() });
  if (!dbUser) {
    return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
  }

  // Super admin has full access
  if (dbUser.role === "super_admin") {
    return { hasAccess: true, isOwner: true, canCreate: true, canEdit: true, canDelete: true, canApprove: true, dbUser };
  }

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
  }

  // Check if workspace owner (admin user who created the workspace) - use MongoDB User ID
  if (workspace.ownerId.toString() === dbUser._id.toString()) {
    // If channel specified, verify it's in the workspace
    if (channelId && !workspace.channelIds.some((id: mongoose.Types.ObjectId) => id.toString() === channelId)) {
      return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
    }
    return { hasAccess: true, isOwner: true, canCreate: true, canEdit: true, canDelete: true, canApprove: true, dbUser };
  }

  // Admin users can access workspaces they own (already handled above)
  // Collaborators must be workspace members
  if (dbUser.role !== "collaborator" && dbUser.role !== "admin") {
    return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
  }

  // Check membership for collaborators (and admins who aren't owners) - use MongoDB User ID
  const membership = await WorkspaceMember.findOne({
    workspaceId,
    userId: dbUser._id,
    status: "accepted",
  });

  if (!membership) {
    return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
  }

  // If channel specified, check if member has access to it
  if (channelId) {
    const restrictedChannels = membership.permissions?.channelIds;
    if (restrictedChannels && restrictedChannels.length > 0) {
      const hasChannelAccess = restrictedChannels.some(
        (id: mongoose.Types.ObjectId) => id.toString() === channelId
      );
      if (!hasChannelAccess) {
        return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
      }
    }
    // Also verify channel is in workspace
    if (!workspace.channelIds.some((id: mongoose.Types.ObjectId) => id.toString() === channelId)) {
      return { hasAccess: false, isOwner: false, canCreate: false, canEdit: false, canDelete: false, canApprove: false };
    }
  }

  // Determine permissions based on workspace member role and explicit permissions
  const rolePermissions = {
    admin: { canCreate: true, canEdit: true, canDelete: true, canApprove: true },
    editor: { canCreate: true, canEdit: true, canDelete: false, canApprove: false },
    viewer: { canCreate: false, canEdit: false, canDelete: false, canApprove: false },
  };

  const roleDefaults = rolePermissions[membership.role as keyof typeof rolePermissions] || rolePermissions.viewer;

  // Use explicit permissions if set, otherwise fall back to role defaults
  const canCreate = membership.permissions?.canCreateProjects ?? roleDefaults.canCreate;
  const canEdit = membership.permissions?.canEditProjects ?? roleDefaults.canEdit;
  const canDelete = membership.permissions?.canDeleteProjects ?? roleDefaults.canDelete;
  const canApprove = roleDefaults.canApprove; // Only role-based, no explicit override

  return { hasAccess: true, isOwner: false, canCreate, canEdit, canDelete, canApprove, membership, dbUser };
}

// Check if user has access to a project
// Uses email to look up user since Better Auth and Mongoose User have different IDs
async function checkProjectAccess(
  userEmail: string,
  projectId: string
): Promise<{
  hasAccess: boolean;
  project?: InstanceType<typeof Project>;
  permissions: { canEdit: boolean; canDelete: boolean; canApprove: boolean };
  dbUser?: InstanceType<typeof User>;
}> {
  const project = await Project.findById(projectId);
  if (!project) {
    return { hasAccess: false, permissions: { canEdit: false, canDelete: false, canApprove: false } };
  }

  const access = await checkWorkspaceChannelAccess(userEmail, project.workspaceId.toString(), project.channelId?.toString());

  if (!access.hasAccess) {
    return { hasAccess: false, permissions: { canEdit: false, canDelete: false, canApprove: false } };
  }

  // Creator always has edit access to their own project (compare with MongoDB User ID)
  const isCreator = access.dbUser && project.createdBy.toString() === access.dbUser._id.toString();

  return {
    hasAccess: true,
    project,
    permissions: {
      canEdit: access.canEdit || isCreator || false,
      canDelete: access.canDelete || isCreator || false,
      canApprove: access.canApprove,
    },
    dbUser: access.dbUser,
  };
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const user = getUser(req);
    if (!user) {
      return cb(new Error("Unauthorized"), "");
    }
    const projectId = getParam(req.params.id);
    const uploadDir = path.join(process.cwd(), "uploads", projectId);

    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `voiceover_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: function (req, file, cb) {
    const allowedTypes = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/m4a", "audio/x-m4a"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only MP3, WAV, and M4A are allowed."));
    }
  },
});

/**
 * GET /api/projects
 * List projects the user has access to
 */
router.get("/", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workspaceId, channelId, status, search, page = 1, limit = 20 } = req.query;
    // Look up user by email since Better Auth and Mongoose User have different IDs
    const dbUser = await User.findOne({ email: user.email.toLowerCase() });

    const projectQuery: Record<string, unknown> = {};

    if (dbUser?.role === "super_admin") {
      // Super admin can see all projects
      if (workspaceId) projectQuery.workspaceId = workspaceId;
      if (channelId) projectQuery.channelId = channelId;
    } else if (dbUser?.role === "admin") {
      // Admin can see projects in their workspaces (use MongoDB User ID)
      const ownedWorkspaces = await Workspace.find({ ownerId: dbUser._id }).select("_id");
      const workspaceIds = ownedWorkspaces.map((w: { _id: mongoose.Types.ObjectId }) => w._id);

      if (workspaceId) {
        // Verify they own this workspace
        if (!workspaceIds.some((id: mongoose.Types.ObjectId) => id.toString() === workspaceId)) {
          return res.status(403).json({ error: "Access denied to this workspace" });
        }
        projectQuery.workspaceId = workspaceId;
      } else {
        projectQuery.workspaceId = { $in: workspaceIds };
      }

      if (channelId) projectQuery.channelId = channelId;
    } else {
      // Collaborator can see projects in workspaces they're a member of (use MongoDB User ID)
      const memberships = await WorkspaceMember.find({
        userId: dbUser?._id,
        status: "accepted",
      }).select("workspaceId permissions");

      if (memberships.length === 0) {
        return res.json({
          projects: [],
          pagination: { page: 1, limit: Number(limit), total: 0, pages: 0 },
        });
      }

      const workspaceIds = memberships.map((m: { workspaceId: mongoose.Types.ObjectId }) => m.workspaceId);

      if (workspaceId) {
        if (!workspaceIds.some((id: mongoose.Types.ObjectId) => id.toString() === workspaceId)) {
          return res.status(403).json({ error: "Access denied to this workspace" });
        }
        projectQuery.workspaceId = workspaceId;
      } else {
        projectQuery.workspaceId = { $in: workspaceIds };
      }

      // Check for channel restrictions
      if (channelId) {
        const membership = memberships.find((m: { workspaceId: mongoose.Types.ObjectId }) => m.workspaceId.toString() === workspaceId);
        const restrictedChannels = membership?.permissions?.channelIds;
        if (restrictedChannels && restrictedChannels.length > 0) {
          if (!restrictedChannels.some((id: mongoose.Types.ObjectId) => id.toString() === channelId)) {
            return res.status(403).json({ error: "Access denied to this channel" });
          }
        }
        projectQuery.channelId = channelId;
      }
    }

    if (status) {
      projectQuery.status = status;
    }

    if (search) {
      projectQuery.$or = [
        { title: { $regex: search, $options: "i" } },
        { reelIdea: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [projects, total] = await Promise.all([
      Project.find(projectQuery)
        .populate("workspaceId", "name")
        .populate("channelId", "name thumbnailUrl")
        .populate("createdBy", "name email")
        .select("title reelIdea status aspectRatio createdAt updatedAt output.videoPath")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Project.countDocuments(projectQuery),
    ]);

    res.json({
      projects,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
}) as RequestHandler);

/**
 * POST /api/projects
 * Create a new project (requires workspace and channel access)
 */
router.post("/", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { title, reelIdea, workspaceId, channelId, aspectRatio = "9:16" } = req.body;

    if (!title || !reelIdea) {
      return res.status(400).json({ error: "Title and reel idea are required" });
    }

    if (!workspaceId || !channelId) {
      return res.status(400).json({ error: "Workspace and channel are required" });
    }

    // Check access (pass email instead of user.id)
    const access = await checkWorkspaceChannelAccess(user.email, workspaceId, channelId);
    if (!access.hasAccess || !access.canCreate) {
      return res.status(403).json({ error: "You don't have permission to create projects in this workspace/channel" });
    }

    // Get workspace settings
    const workspace = await Workspace.findById(workspaceId);
    const requiresApproval = workspace?.settings?.requireApproval && !access.isOwner;

    const project = await Project.create({
      workspaceId,
      channelId,
      createdBy: access.dbUser!._id, // Use MongoDB User ID
      title,
      reelIdea,
      aspectRatio,
      status: requiresApproval ? "pending-approval" : "draft",
      timeline: { totalDuration: 0, scenes: [] },
    });

    res.status(201).json({
      message: requiresApproval ? "Project created and pending approval" : "Project created successfully",
      project: {
        id: project._id,
        title: project.title,
        reelIdea: project.reelIdea,
        status: project.status,
        requiresApproval,
      },
    });
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
}) as RequestHandler);

/**
 * GET /api/projects/:id
 * Get single project
 */
router.get("/:id", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Populate references
    await project.populate([
      { path: "workspaceId", select: "name settings" },
      { path: "channelId", select: "name youtubeChannelId thumbnailUrl" },
      { path: "createdBy", select: "name email" },
    ]);

    res.json({ project, permissions });
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
}) as RequestHandler);

/**
 * PUT /api/projects/:id
 * Update project
 */
router.put("/:id", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    // Don't allow changing workspace or channel - destructure to exclude from updates
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workspaceId: _workspaceId, channelId: _channelId, createdBy: _createdBy, ...updates } = req.body;

    const updatedProject = await Project.findByIdAndUpdate(id, { $set: updates }, { new: true });

    res.json({ message: "Project updated successfully", project: updatedProject });
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
}) as RequestHandler);

/**
 * DELETE /api/projects/:id
 * Delete project
 */
router.delete("/:id", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canDelete) {
      return res.status(403).json({ error: "You don't have permission to delete this project" });
    }

    await Project.findByIdAndDelete(id);

    // Clean up files
    const uploadDir = path.join(process.cwd(), "uploads", id);
    const outputDir = path.join(process.cwd(), "outputs", id);

    try {
      await fs.rm(uploadDir, { recursive: true, force: true });
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // Ignore file deletion errors
    }

    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: "Failed to delete project" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/approve
 * Approve a project (workspace owner/admin only)
 */
router.post("/:id/approve", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canApprove) {
      return res.status(403).json({ error: "You don't have permission to approve projects" });
    }

    if (project.status !== "pending-approval") {
      return res.status(400).json({ error: "Project is not pending approval" });
    }

    project.status = "approved";
    await project.save();

    res.json({ message: "Project approved successfully", project });
  } catch (error) {
    console.error("Error approving project:", error);
    res.status(500).json({ error: "Failed to approve project" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/reject
 * Reject a project (workspace owner/admin only)
 */
router.post("/:id/reject", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canApprove) {
      return res.status(403).json({ error: "You don't have permission to reject projects" });
    }

    if (project.status !== "pending-approval") {
      return res.status(400).json({ error: "Project is not pending approval" });
    }

    project.status = "rejected";
    await project.save();

    res.json({ message: "Project rejected", project });
  } catch (error) {
    console.error("Error rejecting project:", error);
    res.status(500).json({ error: "Failed to reject project" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/research
 * Run AI research and generate script
 */
router.post("/:id/research", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    // Update status
    project.status = "researching";
    await project.save();

    // TODO: Implement actual AI research
    res.json({
      message: "Research started",
      projectId: id,
      status: "researching",
    });
  } catch (error) {
    console.error("Error starting research:", error);
    res.status(500).json({ error: "Failed to start research" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/voiceover
 * Upload voiceover file
 */
router.post("/:id/voiceover", upload.single("audio"), (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    // Update project with voiceover path
    const relativePath = path.relative(process.cwd(), file.path);
    project.voiceover = {
      filePath: relativePath,
      duration: 0, // Will be updated when analyzed
      uploadedAt: new Date(),
    };
    project.status = "voiceover-uploaded";
    await project.save();

    res.json({
      message: "Voiceover uploaded successfully",
      voiceover: {
        path: relativePath,
        originalName: file.originalname,
        size: file.size,
      },
    });
  } catch (error) {
    console.error("Error uploading voiceover:", error);
    res.status(500).json({ error: "Failed to upload voiceover" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/images
 * Generate images for timeline
 */
router.post("/:id/images", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    // Update status
    project.status = "processing";
    await project.save();

    // TODO: Implement actual image generation
    res.json({
      message: "Image generation started",
      projectId: id,
      status: "processing",
    });
  } catch (error) {
    console.error("Error generating images:", error);
    res.status(500).json({ error: "Failed to generate images" });
  }
}) as RequestHandler);

/**
 * PUT /api/projects/:id/timeline
 * Update entire timeline
 */
router.put("/:id/timeline", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);
    const { timeline } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    project.timeline = timeline;
    await project.save();

    res.json({
      message: "Timeline updated successfully",
      timeline: project.timeline,
    });
  } catch (error) {
    console.error("Error updating timeline:", error);
    res.status(500).json({ error: "Failed to update timeline" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/timeline/scene
 * Add scene to timeline
 */
router.post("/:id/timeline/scene", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);
    const { scene, position } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    // Add scene ID if not provided
    const newScene = {
      ...scene,
      id: scene.id || uuidv4(),
    };

    // Add to timeline
    if (position !== undefined && position < project.timeline.scenes.length) {
      project.timeline.scenes.splice(position, 0, newScene);
    } else {
      project.timeline.scenes.push(newScene);
    }

    // Recalculate total duration
    project.timeline.totalDuration = project.timeline.scenes.reduce(
      (total: number, s: { duration?: number }) => total + (s.duration || 0),
      0
    );

    await project.save();

    res.json({
      message: "Scene added successfully",
      scene: newScene,
      timeline: project.timeline,
    });
  } catch (error) {
    console.error("Error adding scene:", error);
    res.status(500).json({ error: "Failed to add scene" });
  }
}) as RequestHandler);

/**
 * DELETE /api/projects/:id/timeline/scene/:sceneId
 * Remove scene from timeline
 */
router.delete("/:id/timeline/scene/:sceneId", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);
    const sceneId = getParam(req.params.sceneId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to edit this project" });
    }

    // Find and remove scene
    const sceneIndex = project.timeline.scenes.findIndex((s: { id?: string }) => s.id === sceneId);

    if (sceneIndex === -1) {
      return res.status(404).json({ error: "Scene not found" });
    }

    project.timeline.scenes.splice(sceneIndex, 1);

    // Recalculate total duration
    project.timeline.totalDuration = project.timeline.scenes.reduce(
      (total: number, s: { duration?: number }) => total + (s.duration || 0),
      0
    );

    await project.save();

    res.json({
      message: "Scene removed successfully",
      timeline: project.timeline,
    });
  } catch (error) {
    console.error("Error removing scene:", error);
    res.status(500).json({ error: "Failed to remove scene" });
  }
}) as RequestHandler);

/**
 * POST /api/projects/:id/generate
 * Generate final video
 */
router.post("/:id/generate", (async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = getParam(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const { hasAccess, project, permissions } = await checkProjectAccess(user.email, id);

    if (!hasAccess || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!permissions.canEdit) {
      return res.status(403).json({ error: "You don't have permission to generate this video" });
    }

    // Check prerequisites
    if (!project.timeline?.scenes?.length) {
      return res.status(400).json({ error: "Timeline has no scenes" });
    }

    // Update status
    project.status = "processing";
    await project.save();

    // TODO: Implement actual video generation
    const outputDir = path.join("outputs", id);
    const outputPath = path.join(outputDir, `${project.title.replace(/\s+/g, "_")}_${Date.now()}.mp4`);

    res.json({
      message: "Video generation started",
      projectId: id,
      status: "processing",
      outputPath,
    });
  } catch (error) {
    console.error("Error generating video:", error);
    res.status(500).json({ error: "Failed to generate video" });
  }
}) as RequestHandler);

export default router;
