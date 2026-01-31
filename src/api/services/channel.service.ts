import Channel from "../../models/Channel.js";
import Workspace from "../../models/Workspace.js";
import { PaginationParams } from "../types/index.js";
import { getSkip, buildSearchQuery, mergeQueries } from "../utils/index.js";
import { USER_ROLES } from "../constants/index.js";

export interface CreateChannelData {
  name: string;
  youtubeChannelId?: string;
  youtubeHandle?: string;
  description?: string;
  thumbnailUrl?: string;
  ownerId: string;
  defaultAspectRatio?: string;
  defaultVoiceId?: string;
  brandColors?: Record<string, string>;
}

export interface UpdateChannelData {
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  defaultAspectRatio?: string;
  defaultVoiceId?: string;
  brandColors?: Record<string, string>;
  isActive?: boolean;
}

export interface ChannelFilters extends PaginationParams {
  ownerId?: string;
  isActive?: boolean;
}

/**
 * Find channel by ID
 */
export async function findChannelById(id: string) {
  return Channel.findById(id)
    .select("-youtubeCredentials")
    .populate("ownerId", "name email");
}

/**
 * Find channel by YouTube channel ID
 */
export async function findChannelByYoutubeId(youtubeChannelId: string) {
  return Channel.findOne({ youtubeChannelId }).select("-youtubeCredentials");
}

/**
 * Get channels by owner
 */
export async function getChannelsByOwner(ownerId: string, filters: PaginationParams & { isActive?: boolean }) {
  const { page, limit, search, isActive } = filters;
  const skip = getSkip(page, limit);

  const query: Record<string, unknown> = { ownerId };
  
  if (isActive !== undefined) {
    query.isActive = isActive;
  }

  const searchQuery = buildSearchQuery(search, ["name", "youtubeHandle"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [channels, total] = await Promise.all([
    Channel.find(finalQuery)
      .select("-youtubeCredentials")
      .populate("ownerId", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Channel.countDocuments(finalQuery),
  ]);

  return { channels, total };
}

/**
 * Get all channels (for super admin)
 */
export async function getAllChannels(filters: ChannelFilters) {
  const { page, limit, search, isActive } = filters;
  const skip = getSkip(page, limit);

  const query: Record<string, unknown> = {};
  
  if (isActive !== undefined) {
    query.isActive = isActive;
  }

  const searchQuery = buildSearchQuery(search, ["name", "youtubeHandle"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [channels, total] = await Promise.all([
    Channel.find(finalQuery)
      .select("-youtubeCredentials")
      .populate("ownerId", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Channel.countDocuments(finalQuery),
  ]);

  return { channels, total };
}

/**
 * Create a new channel
 */
export async function createChannel(data: CreateChannelData) {
  const channel = await Channel.create({
    ...data,
    isActive: true,
  });

  return {
    id: channel._id,
    name: channel.name,
    youtubeChannelId: channel.youtubeChannelId,
    youtubeHandle: channel.youtubeHandle,
    thumbnailUrl: channel.thumbnailUrl,
    isActive: channel.isActive,
    defaultAspectRatio: channel.defaultAspectRatio,
    createdAt: channel.createdAt,
  };
}

/**
 * Update channel
 */
export async function updateChannel(id: string, data: UpdateChannelData) {
  return Channel.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true }
  )
    .select("-youtubeCredentials")
    .populate("ownerId", "name email");
}

/**
 * Delete channel
 */
export async function deleteChannel(id: string) {
  // Remove channel from all workspaces
  await Workspace.updateMany(
    { channelIds: id },
    { $pull: { channelIds: id } }
  );

  return Channel.findByIdAndDelete(id);
}

/**
 * Check if channel exists by YouTube ID
 */
export async function channelExistsByYoutubeId(youtubeChannelId: string, excludeId?: string) {
  const query: Record<string, unknown> = { youtubeChannelId };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const channel = await Channel.findOne(query);
  return !!channel;
}

/**
 * Get channel statistics
 */
export async function getChannelStats(channelId: string) {
  const workspaceCount = await Workspace.countDocuments({ channelIds: channelId });
  
  return {
    workspaces: workspaceCount,
  };
}

/**
 * Get available channels for a user to add to workspace
 */
export async function getAvailableChannelsForUser(userId: string, userRole: string) {
  const query: Record<string, unknown> = { isActive: true };
  
  // Only super admin can see all channels
  if (userRole !== USER_ROLES.SUPER_ADMIN) {
    query.ownerId = userId;
  }

  return Channel.find(query)
    .select("_id name youtubeHandle thumbnailUrl")
    .sort({ name: 1 });
}
