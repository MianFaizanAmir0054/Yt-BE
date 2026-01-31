import mongoose from "mongoose";
import Workspace from "../../models/Workspace.js";
import WorkspaceMember from "../../models/WorkspaceMember.js";
import Channel from "../../models/Channel.js";
import Project from "../../models/Project.js";
import { PaginationParams } from "../types/index.js";
import { getSkip, buildSearchQuery, mergeQueries } from "../utils/index.js";
import { MEMBER_STATUS, USER_ROLES } from "../constants/index.js";

export interface CreateWorkspaceData {
  name: string;
  description?: string;
  ownerId: string;
  channelIds?: string[];
}

export interface UpdateWorkspaceData {
  name?: string;
  description?: string;
  channelIds?: string[];
}

export interface WorkspaceFilters extends PaginationParams {
  ownerId?: string;
  channelId?: string;
}

/**
 * Find workspace by ID
 */
export async function findWorkspaceById(id: string) {
  return Workspace.findById(id)
    .populate("ownerId", "name email")
    .populate("channelIds", "name thumbnailUrl");
}

/**
 * Get workspaces by owner
 */
export async function getWorkspacesByOwner(ownerId: string, filters: PaginationParams) {
  const { page, limit, search } = filters;
  const skip = getSkip(page, limit);

  const query: Record<string, unknown> = { ownerId };
  const searchQuery = buildSearchQuery(search, ["name"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [workspaces, total] = await Promise.all([
    Workspace.find(finalQuery)
      .populate("channelIds", "name thumbnailUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Workspace.countDocuments(finalQuery),
  ]);

  return { workspaces, total };
}

/**
 * Get all workspaces (for super admin)
 */
export async function getAllWorkspaces(filters: PaginationParams) {
  const { page, limit, search } = filters;
  const skip = getSkip(page, limit);

  const searchQuery = buildSearchQuery(search, ["name"]);
  const finalQuery = searchQuery || {};

  const [workspaces, total] = await Promise.all([
    Workspace.find(finalQuery)
      .populate("ownerId", "name email")
      .populate("channelIds", "name thumbnailUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Workspace.countDocuments(finalQuery),
  ]);

  return { workspaces, total };
}

/**
 * Get workspaces user is member of
 */
export async function getWorkspacesByMembership(userId: string, filters: PaginationParams) {
  const { page, limit, search } = filters;

  const memberships = await WorkspaceMember.find({
    userId,
    status: MEMBER_STATUS.ACCEPTED,
  }).select("workspaceId");

  const workspaceIds = memberships.map((m) => m.workspaceId);

  if (workspaceIds.length === 0) {
    return { workspaces: [], total: 0 };
  }

  const skip = getSkip(page, limit);
  const query: Record<string, unknown> = { _id: { $in: workspaceIds } };
  const searchQuery = buildSearchQuery(search, ["name"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [workspaces, total] = await Promise.all([
    Workspace.find(finalQuery)
      .populate("ownerId", "name email")
      .populate("channelIds", "name thumbnailUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Workspace.countDocuments(finalQuery),
  ]);

  return { workspaces, total };
}

/**
 * Create a new workspace
 */
export async function createWorkspace(data: CreateWorkspaceData) {
  const workspace = await Workspace.create(data);
  return workspace.populate("channelIds", "name thumbnailUrl");
}

/**
 * Update workspace
 */
export async function updateWorkspace(id: string, data: UpdateWorkspaceData) {
  return Workspace.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true }
  )
    .populate("ownerId", "name email")
    .populate("channelIds", "name thumbnailUrl");
}

/**
 * Delete workspace and all related data
 */
export async function deleteWorkspace(id: string) {
  // Delete all related data
  await Promise.all([
    WorkspaceMember.deleteMany({ workspaceId: id }),
    Project.deleteMany({ workspaceId: id }),
  ]);

  return Workspace.findByIdAndDelete(id);
}

/**
 * Add channel to workspace
 */
export async function addChannelToWorkspace(workspaceId: string, channelId: string) {
  return Workspace.findByIdAndUpdate(
    workspaceId,
    { $addToSet: { channelIds: channelId } },
    { new: true }
  );
}

/**
 * Remove channel from workspace
 */
export async function removeChannelFromWorkspace(workspaceId: string, channelId: string) {
  return Workspace.findByIdAndUpdate(
    workspaceId,
    { $pull: { channelIds: channelId } },
    { new: true }
  );
}

/**
 * Check workspace access for a user
 */
export async function checkWorkspaceAccess(
  userId: string,
  workspaceId: string,
  userRole: string
) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return { hasAccess: false, isOwner: false };
  }

  // Super admin has full access
  if (userRole === USER_ROLES.SUPER_ADMIN) {
    return { hasAccess: true, isOwner: true, workspace };
  }

  // Check if owner
  if (workspace.ownerId.toString() === userId) {
    return { hasAccess: true, isOwner: true, workspace };
  }

  // Check membership
  const membership = await WorkspaceMember.findOne({
    workspaceId,
    userId,
    status: MEMBER_STATUS.ACCEPTED,
  });

  if (membership) {
    return { hasAccess: true, isOwner: false, workspace, membership };
  }

  return { hasAccess: false, isOwner: false };
}

/**
 * Get workspace statistics
 */
export async function getWorkspaceStats(workspaceId: string) {
  const [memberCount, projectCount, channelCount] = await Promise.all([
    WorkspaceMember.countDocuments({ workspaceId, status: MEMBER_STATUS.ACCEPTED }),
    Project.countDocuments({ workspaceId }),
    Workspace.findById(workspaceId).then((w) => w?.channelIds?.length || 0),
  ]);

  return {
    members: memberCount,
    projects: projectCount,
    channels: channelCount,
  };
}
