import mongoose from "mongoose";
import Project from "../../models/Project.js";
import WorkspaceMember from "../../models/WorkspaceMember.js";
import Workspace from "../../models/Workspace.js";
import { PaginationParams } from "../types/index.js";
import { getSkip, buildSearchQuery, mergeQueries } from "../utils/index.js";
import { USER_ROLES, MEMBER_STATUS } from "../constants/index.js";

export interface CreateProjectData {
  title: string;
  reelIdea?: string;
  workspaceId: string;
  channelId: string;
  createdBy: string;
  status?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  script?: {
    fullText?: string;
    scenes?: Array<{
      id: string;
      text: string;
      visualDescription: string;
    }>;
    generatedAt?: Date;
  };
}

export interface UpdateProjectData {
  title?: string;
  reelIdea?: string;
  status?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  script?: {
    fullText?: string;
    scenes?: Array<{
      id: string;
      text: string;
      visualDescription: string;
    }>;
    generatedAt?: Date;
  };
}

export interface ProjectFilters extends PaginationParams {
  workspaceId?: string;
  channelId?: string;
  status?: string;
  createdBy?: string;
}

/**
 * Find project by ID
 */
export async function findProjectById(id: string) {
  return Project.findById(id)
    .populate("workspaceId", "name")
    .populate("channelId", "name thumbnailUrl")
    .populate("createdBy", "name email");
}

/**
 * Get projects with filters
 */
export async function getProjects(filters: ProjectFilters) {
  const { page, limit, search, workspaceId, channelId, status, createdBy } = filters;
  const skip = getSkip(page, limit);

  const query: Record<string, unknown> = {};

  if (workspaceId) {
    query.workspaceId = workspaceId;
  }

  if (channelId) {
    query.channelId = channelId;
  }

  if (status) {
    query.status = status;
  }

  if (createdBy) {
    query.createdBy = createdBy;
  }

  const searchQuery = buildSearchQuery(search, ["title", "description"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [projects, total] = await Promise.all([
    Project.find(finalQuery)
      .populate("workspaceId", "name")
      .populate("channelId", "name thumbnailUrl")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Project.countDocuments(finalQuery),
  ]);

  return { projects, total };
}

/**
 * Get projects for a user based on their access
 */
export async function getProjectsForUser(
  userId: string,
  userRole: string,
  filters: ProjectFilters
) {
  // Super admin sees all projects
  if (userRole === USER_ROLES.SUPER_ADMIN) {
    return getProjects(filters);
  }

  // Get workspaces user has access to
  const [ownedWorkspaces, memberWorkspaces] = await Promise.all([
    Workspace.find({ ownerId: userId }).select("_id"),
    WorkspaceMember.find({ userId, status: MEMBER_STATUS.ACCEPTED }).select("workspaceId"),
  ]);

  const accessibleWorkspaceIds = [
    ...ownedWorkspaces.map((w) => w._id),
    ...memberWorkspaces.map((m) => m.workspaceId),
  ];

  if (accessibleWorkspaceIds.length === 0) {
    return { projects: [], total: 0 };
  }

  const { page, limit, search, channelId, status, createdBy } = filters;
  const skip = getSkip(page, limit);

  const query: Record<string, unknown> = {
    workspaceId: { $in: accessibleWorkspaceIds },
  };

  // If specific workspace requested, verify access
  if (filters.workspaceId) {
    const hasAccess = accessibleWorkspaceIds.some(
      (id) => id.toString() === filters.workspaceId
    );
    if (!hasAccess) {
      return { projects: [], total: 0 };
    }
    query.workspaceId = filters.workspaceId;
  }

  if (channelId) {
    query.channelId = channelId;
  }

  if (status) {
    query.status = status;
  }

  if (createdBy) {
    query.createdBy = createdBy;
  }

  const searchQuery = buildSearchQuery(search, ["title", "description"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [projects, total] = await Promise.all([
    Project.find(finalQuery)
      .populate("workspaceId", "name")
      .populate("channelId", "name thumbnailUrl")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Project.countDocuments(finalQuery),
  ]);

  return { projects, total };
}

/**
 * Create a new project
 */
export async function createProject(data: CreateProjectData) {
  const project = await Project.create({
    ...data,
    status: data.status || "draft",
  });

  return project.populate([
    { path: "workspaceId", select: "name" },
    { path: "channelId", select: "name thumbnailUrl" },
    { path: "createdBy", select: "name email" },
  ]);
}

/**
 * Update project
 */
export async function updateProject(id: string, data: UpdateProjectData) {
  return Project.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true }
  )
    .populate("workspaceId", "name")
    .populate("channelId", "name thumbnailUrl")
    .populate("createdBy", "name email");
}

/**
 * Delete project
 */
export async function deleteProject(id: string) {
  return Project.findByIdAndDelete(id);
}

/**
 * Update project status
 */
export async function updateProjectStatus(id: string, status: string, reviewedBy?: string) {
  const updateData: Record<string, unknown> = { status };
  
  if (status === "approved" && reviewedBy) {
    updateData.approvedBy = reviewedBy;
    updateData.approvedAt = new Date();
  }

  return Project.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true }
  );
}

/**
 * Get project statistics for a workspace
 */
export async function getProjectStats(workspaceId: string) {
  const stats = await Project.aggregate([
    { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const statusCounts: Record<string, number> = {
    draft: 0,
    in_progress: 0,
    review: 0,
    approved: 0,
    published: 0,
    archived: 0,
  };

  for (const stat of stats) {
    statusCounts[stat._id] = stat.count;
  }

  return {
    total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    byStatus: statusCounts,
  };
}

/**
 * Check project access for a user
 */
export async function checkProjectAccess(
  userId: string,
  userRole: string,
  projectId: string
) {
  const project = await Project.findById(projectId);
  if (!project) {
    return {
      hasAccess: false,
      permissions: { canEdit: false, canDelete: false, canApprove: false },
    };
  }

  // Super admin has full access
  if (userRole === USER_ROLES.SUPER_ADMIN) {
    return {
      hasAccess: true,
      project,
      permissions: { canEdit: true, canDelete: true, canApprove: true },
    };
  }

  const workspace = await Workspace.findById(project.workspaceId);
  if (!workspace) {
    return {
      hasAccess: false,
      permissions: { canEdit: false, canDelete: false, canApprove: false },
    };
  }

  // Workspace owner has full access
  if (workspace.ownerId.toString() === userId) {
    return {
      hasAccess: true,
      project,
      permissions: { canEdit: true, canDelete: true, canApprove: true },
    };
  }

  // Check membership
  const membership = await WorkspaceMember.findOne({
    workspaceId: project.workspaceId,
    userId,
    status: MEMBER_STATUS.ACCEPTED,
  });

  if (!membership) {
    return {
      hasAccess: false,
      permissions: { canEdit: false, canDelete: false, canApprove: false },
    };
  }

  // Determine permissions based on role and explicit permissions
  const rolePermissions = {
    admin: { canEdit: true, canDelete: true, canApprove: true },
    editor: { canEdit: true, canDelete: false, canApprove: false },
    viewer: { canEdit: false, canDelete: false, canApprove: false },
  };

  const roleDefaults = rolePermissions[membership.role as keyof typeof rolePermissions] || rolePermissions.viewer;

  // Project creator can always edit their own project
  const isCreator = project.createdBy.toString() === userId;

  return {
    hasAccess: true,
    project,
    permissions: {
      canEdit: isCreator || (membership.permissions?.canEditProjects ?? roleDefaults.canEdit),
      canDelete: membership.permissions?.canDeleteProjects ?? roleDefaults.canDelete,
      canApprove: roleDefaults.canApprove,
    },
  };
}
