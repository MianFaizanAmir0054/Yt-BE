import { Request, Response } from "express";
import * as channelService from "../services/channel.service.js";
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
import { HTTP_STATUS, ERROR_MESSAGES, USER_ROLES, ASPECT_RATIOS } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";

/**
 * GET /api/channels
 * List channels owned by the admin
 */
export async function listChannels(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { isActive } = req.query;
    const pagination = getPaginationParams(req.query);

    let result;

    if (dbUser.role === USER_ROLES.SUPER_ADMIN) {
      // Super admin sees all channels
      result = await channelService.getAllChannels({
        ...pagination,
        isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      });
    } else {
      // Admin sees only their own channels
      result = await channelService.getChannelsByOwner(dbUser._id.toString(), {
        ...pagination,
        isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      });
    }

    const response = buildPaginationResponse(
      result.channels,
      result.total,
      pagination.page,
      pagination.limit
    );

    return sendSuccess(res, { channels: response.data, pagination: response.pagination });
  } catch (error) {
    console.error("Error fetching channels:", error);
    return sendError(res, "Failed to fetch channels");
  }
}

/**
 * GET /api/channels/:id
 * Get single channel details
 */
export async function getChannel(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const channel = await channelService.findChannelById(id);

    if (!channel) {
      return sendNotFound(res, ERROR_MESSAGES.CHANNEL_NOT_FOUND);
    }

    // Get additional stats
    const stats = await channelService.getChannelStats(id);

    return sendSuccess(res, { channel, stats });
  } catch (error) {
    console.error("Error fetching channel:", error);
    return sendError(res, "Failed to fetch channel");
  }
}

/**
 * POST /api/channels
 * Create a new YouTube channel
 */
export async function createChannel(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

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
      return sendBadRequest(res, "Name is required");
    }

    // Check if channel already exists (if youtubeChannelId provided)
    if (youtubeChannelId) {
      const exists = await channelService.channelExistsByYoutubeId(youtubeChannelId);
      if (exists) {
        return sendBadRequest(res, "Channel already registered");
      }
    }

    const channel = await channelService.createChannel({
      name,
      youtubeChannelId,
      youtubeHandle,
      description,
      thumbnailUrl,
      ownerId: dbUser._id.toString(),
      defaultAspectRatio: defaultAspectRatio || ASPECT_RATIOS.VERTICAL,
      defaultVoiceId,
      brandColors: brandColors || {},
    });

    return sendCreated(res, { channel }, "Channel created successfully");
  } catch (error) {
    console.error("Error creating channel:", error);
    return sendError(res, "Failed to create channel");
  }
}

/**
 * PUT /api/channels/:id
 * Update channel
 */
export async function updateChannel(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const {
      name,
      description,
      thumbnailUrl,
      defaultAspectRatio,
      defaultVoiceId,
      brandColors,
      isActive,
    } = req.body;

    const channel = await channelService.findChannelById(id);
    if (!channel) {
      return sendNotFound(res, ERROR_MESSAGES.CHANNEL_NOT_FOUND);
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (thumbnailUrl !== undefined) updateData.thumbnailUrl = thumbnailUrl;
    if (defaultAspectRatio !== undefined) updateData.defaultAspectRatio = defaultAspectRatio;
    if (defaultVoiceId !== undefined) updateData.defaultVoiceId = defaultVoiceId;
    if (brandColors !== undefined) updateData.brandColors = brandColors;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await channelService.updateChannel(id, updateData);

    return sendSuccess(res, { message: "Channel updated successfully", channel: updated });
  } catch (error) {
    console.error("Error updating channel:", error);
    return sendError(res, "Failed to update channel");
  }
}

/**
 * DELETE /api/channels/:id
 * Delete channel
 */
export async function deleteChannel(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");

    const channel = await channelService.findChannelById(id);
    if (!channel) {
      return sendNotFound(res, ERROR_MESSAGES.CHANNEL_NOT_FOUND);
    }

    await channelService.deleteChannel(id);

    return sendSuccess(res, { message: "Channel deleted successfully" });
  } catch (error) {
    console.error("Error deleting channel:", error);
    return sendError(res, "Failed to delete channel");
  }
}

/**
 * GET /api/channels/available
 * Get channels available for adding to workspace
 */
export async function getAvailableChannels(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const channels = await channelService.getAvailableChannelsForUser(
      dbUser._id.toString(),
      dbUser.role
    );

    return sendSuccess(res, { channels });
  } catch (error) {
    console.error("Error fetching available channels:", error);
    return sendError(res, "Failed to fetch available channels");
  }
}
