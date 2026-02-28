import { Router } from "express";
import { requireAuth } from "../middlewares/index.js";
import { validateRequired } from "../middlewares/index.js";
import * as userController from "../controllers/user.controller.js";
import { asyncHandler } from "../utils/index.js";

const router = Router();

// All user routes require authentication
router.use(requireAuth);

// ============ Current User Profile ============

/**
 * GET /api/user/me
 * Get current user profile
 */
router.get("/me", asyncHandler(userController.getCurrentUser));

/**
 * PUT /api/user/me
 * Update current user profile
 */
router.put("/me", asyncHandler(userController.updateCurrentUser));

/**
 * PUT /api/user/me/password
 * Change current user password
 */
router.put(
  "/me/password",
  validateRequired(["currentPassword", "newPassword"]),
  asyncHandler(userController.changePassword)
);

// ============ Invitations ============

/**
 * GET /api/user/invitations
 * Get pending invitations for current user
 */
router.get("/invitations", asyncHandler(userController.getPendingInvitations));

// ============ API Keys ============

/**
 * GET /api/user/api-keys
 * Fetch user API keys (masked) and preferences
 */
router.get("/api-keys", asyncHandler(userController.getApiKeys));

/**
 * PUT /api/user/api-keys
 * Update user API keys and/or preferences
 */
router.put("/api-keys", asyncHandler(userController.updateApiKeys));

/**
 * DELETE /api/user/api-keys/:key
 * Delete a specific API key
 */
router.delete("/api-keys/:key", asyncHandler(userController.deleteApiKey));

/**
 * DELETE /api/user/api-keys
 * Delete all API keys
 */
router.delete("/api-keys", asyncHandler(userController.deleteAllApiKeys));

export default router;
