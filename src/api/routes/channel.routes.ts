import { Router } from "express";
import { requireAdmin } from "../middlewares/index.js";
import { validateObjectId, validateRequired } from "../middlewares/index.js";
import * as channelController from "../controllers/channel.controller.js";
import { asyncHandler } from "../utils/index.js";

const router = Router();

// Apply admin check to all routes (channels are admin-only resources)
router.use(requireAdmin);

// ============ Channel CRUD ============

/**
 * GET /api/channels
 * List channels owned by the admin
 */
router.get("/", asyncHandler(channelController.listChannels));

/**
 * GET /api/channels/available
 * Get channels available for adding to workspace
 */
router.get("/available", asyncHandler(channelController.getAvailableChannels));

/**
 * GET /api/channels/:id
 * Get single channel details
 */
router.get("/:id", validateObjectId("id"), asyncHandler(channelController.getChannel));

/**
 * POST /api/channels
 * Create a new YouTube channel
 */
router.post(
  "/",
  validateRequired(["name"]),
  asyncHandler(channelController.createChannel)
);

/**
 * PUT /api/channels/:id
 * Update channel
 */
router.put("/:id", validateObjectId("id"), asyncHandler(channelController.updateChannel));

/**
 * DELETE /api/channels/:id
 * Delete channel
 */
router.delete("/:id", validateObjectId("id"), asyncHandler(channelController.deleteChannel));

export default router;
