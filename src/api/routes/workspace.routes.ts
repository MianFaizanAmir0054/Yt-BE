import { Router } from "express";
import { requireAuth, requireAdmin, requireWorkspaceAccess, requireWorkspaceOwner } from "../middlewares/index.js";
import { validateObjectId, validateRequired, lowercaseEmail } from "../middlewares/index.js";
import * as workspaceController from "../controllers/workspace.controller.js";
import { asyncHandler } from "../utils/index.js";

const router = Router();

// ============ Invitation Routes (Before workspace routes) ============

/**
 * GET /api/workspaces/invitations/pending
 * Get pending invitations for current user
 */
router.get(
  "/invitations/pending",
  requireAuth,
  asyncHandler(workspaceController.getPendingInvitations)
);

/**
 * POST /api/workspaces/invitations/:token/accept
 * Accept workspace invitation
 */
router.post(
  "/invitations/:token/accept",
  requireAuth,
  asyncHandler(workspaceController.acceptInvitation)
);

/**
 * POST /api/workspaces/invitations/:token/reject
 * Reject workspace invitation
 */
router.post(
  "/invitations/:token/reject",
  requireAuth,
  asyncHandler(workspaceController.rejectInvitation)
);

// ============ Workspace CRUD ============

/**
 * GET /api/workspaces
 * List workspaces user has access to
 */
router.get("/", requireAuth, asyncHandler(workspaceController.listWorkspaces));

/**
 * GET /api/workspaces/:id
 * Get single workspace details
 */
router.get(
  "/:id",
  requireAuth,
  validateObjectId("id"),
  requireWorkspaceAccess,
  asyncHandler(workspaceController.getWorkspace)
);

/**
 * POST /api/workspaces
 * Create a new workspace (admin only)
 */
router.post(
  "/",
  requireAdmin,
  validateRequired(["name"]),
  asyncHandler(workspaceController.createWorkspace)
);

/**
 * PUT /api/workspaces/:id
 * Update workspace (owner only)
 */
router.put(
  "/:id",
  requireAuth,
  validateObjectId("id"),
  requireWorkspaceOwner,
  asyncHandler(workspaceController.updateWorkspace)
);

/**
 * DELETE /api/workspaces/:id
 * Delete workspace (owner only)
 */
router.delete(
  "/:id",
  requireAuth,
  validateObjectId("id"),
  requireWorkspaceOwner,
  asyncHandler(workspaceController.deleteWorkspace)
);

// ============ Channel Management ============

/**
 * POST /api/workspaces/:id/channels
 * Add channel to workspace
 */
router.post(
  "/:id/channels",
  requireAuth,
  validateObjectId("id"),
  requireWorkspaceOwner,
  validateRequired(["channelId"]),
  asyncHandler(workspaceController.addChannel)
);

/**
 * DELETE /api/workspaces/:id/channels/:channelId
 * Remove channel from workspace
 */
router.delete(
  "/:id/channels/:channelId",
  requireAuth,
  validateObjectId("id"),
  validateObjectId("channelId"),
  requireWorkspaceOwner,
  asyncHandler(workspaceController.removeChannel)
);

// ============ Member Management ============

/**
 * GET /api/workspaces/:id/members
 * List workspace members
 */
router.get(
  "/:id/members",
  requireAuth,
  validateObjectId("id"),
  requireWorkspaceAccess,
  asyncHandler(workspaceController.listMembers)
);

/**
 * POST /api/workspaces/:id/members
 * Invite a new member (owner only)
 */
router.post(
  "/:id/members",
  requireAuth,
  validateObjectId("id"),
  requireWorkspaceOwner,
  validateRequired(["email"]),
  lowercaseEmail("email"),
  asyncHandler(workspaceController.inviteMember)
);

/**
 * PUT /api/workspaces/:id/members/:memberId
 * Update member role/permissions (owner only)
 */
router.put(
  "/:id/members/:memberId",
  requireAuth,
  validateObjectId("id"),
  validateObjectId("memberId"),
  requireWorkspaceOwner,
  asyncHandler(workspaceController.updateMember)
);

/**
 * DELETE /api/workspaces/:id/members/:memberId
 * Remove member from workspace (owner only)
 */
router.delete(
  "/:id/members/:memberId",
  requireAuth,
  validateObjectId("id"),
  validateObjectId("memberId"),
  requireWorkspaceOwner,
  asyncHandler(workspaceController.removeMember)
);

export default router;
