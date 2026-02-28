import { Request, Response } from "express";
import * as workspaceService from "../services/workspace.service.js";
import * as memberService from "../services/member.service.js";
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
  sendForbidden,
} from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES, USER_ROLES } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";

/**
 * GET /api/workspaces
 * List workspaces user has access to
 */
export async function listWorkspaces(req: Request, res: Response) {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const dbUser = (req as AuthenticatedRequest).dbUser;
    const pagination = getPaginationParams(req.query);

    let result;

    if (dbUser?.role === USER_ROLES.SUPER_ADMIN) {
      // Super admin sees all workspaces
      result = await workspaceService.getAllWorkspaces(pagination);
    } else if (dbUser?.role === USER_ROLES.ADMIN) {
      // Admin sees their own workspaces
      result = await workspaceService.getWorkspacesByOwner(dbUser._id.toString(), pagination);
    } else {
      // Collaborator sees workspaces they're a member of
      result = await workspaceService.getWorkspacesByMembership(
        dbUser?._id.toString() || user.id,
        pagination
      );
    }

    const response = buildPaginationResponse(
      result.workspaces,
      result.total,
      pagination.page,
      pagination.limit
    );

    return sendSuccess(res, { workspaces: response.data, pagination: response.pagination });
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    return sendError(res, "Failed to fetch workspaces");
  }
}

/**
 * GET /api/workspaces/:id
 * Get single workspace details
 */
export async function getWorkspace(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const user = getUser(req);
    const dbUser = (req as AuthenticatedRequest).dbUser;

    const workspace = await workspaceService.findWorkspaceById(id);

    if (!workspace) {
      return sendNotFound(res, ERROR_MESSAGES.WORKSPACE_NOT_FOUND);
    }

    // Determine user role
    let userRole = "viewer";
    if (dbUser?.role === USER_ROLES.SUPER_ADMIN) {
      userRole = "owner";
    } else if (workspace.ownerId.toString() === dbUser?._id.toString()) {
      userRole = "owner";
    } else {
      // Check if user is a member with a specific role
      const membership = await memberService.getMemberByUserAndWorkspace(
        dbUser?._id?.toString() || user?.id || "",
        id
      );
      if (membership) {
        userRole = membership.role;
      }
    }

    // Get additional stats
    const stats = await workspaceService.getWorkspaceStats(id);

    return sendSuccess(res, {
      workspace,
      memberCount: stats.members,
      projectCount: stats.projects,
      userRole,
    });
  } catch (error) {
    console.error("Error fetching workspace:", error);
    return sendError(res, "Failed to fetch workspace");
  }
}

/**
 * POST /api/workspaces
 * Create a new workspace
 */
export async function createWorkspace(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { name, description, channelIds } = req.body;

    if (!name) {
      return sendBadRequest(res, "Name is required");
    }

    const workspace = await workspaceService.createWorkspace({
      name,
      description,
      channelIds: channelIds || [],
      ownerId: dbUser._id.toString(),
    });

    return sendCreated(res, { workspace }, "Workspace created successfully");
  } catch (error) {
    console.error("Error creating workspace:", error);
    return sendError(res, "Failed to create workspace");
  }
}

/**
 * PUT /api/workspaces/:id
 * Update workspace
 */
export async function updateWorkspace(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const { name, description, channelIds } = req.body;

    const workspace = await workspaceService.findWorkspaceById(id);
    if (!workspace) {
      return sendNotFound(res, ERROR_MESSAGES.WORKSPACE_NOT_FOUND);
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (channelIds !== undefined) updateData.channelIds = channelIds;

    const updated = await workspaceService.updateWorkspace(id, updateData);

    return sendSuccess(res, { message: "Workspace updated successfully", workspace: updated });
  } catch (error) {
    console.error("Error updating workspace:", error);
    return sendError(res, "Failed to update workspace");
  }
}

/**
 * DELETE /api/workspaces/:id
 * Delete workspace
 */
export async function deleteWorkspace(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");

    const workspace = await workspaceService.findWorkspaceById(id);
    if (!workspace) {
      return sendNotFound(res, ERROR_MESSAGES.WORKSPACE_NOT_FOUND);
    }

    await workspaceService.deleteWorkspace(id);

    return sendSuccess(res, { message: "Workspace deleted successfully" });
  } catch (error) {
    console.error("Error deleting workspace:", error);
    return sendError(res, "Failed to delete workspace");
  }
}

/**
 * POST /api/workspaces/:id/channels
 * Add channel to workspace
 */
export async function addChannel(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const { channelId } = req.body;

    if (!channelId) {
      return sendBadRequest(res, "Channel ID is required");
    }

    const workspace = await workspaceService.addChannelToWorkspace(id, channelId);

    return sendSuccess(res, { message: "Channel added to workspace", workspace });
  } catch (error) {
    console.error("Error adding channel:", error);
    return sendError(res, "Failed to add channel");
  }
}

/**
 * DELETE /api/workspaces/:id/channels/:channelId
 * Remove channel from workspace
 */
export async function removeChannel(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const channelId = getRouteParam(req, "channelId");

    const workspace = await workspaceService.removeChannelFromWorkspace(id, channelId);

    return sendSuccess(res, { message: "Channel removed from workspace", workspace });
  } catch (error) {
    console.error("Error removing channel:", error);
    return sendError(res, "Failed to remove channel");
  }
}

// ============ Member Management ============

/**
 * GET /api/workspaces/:id/members
 * List workspace members
 */
export async function listMembers(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const pagination = getPaginationParams(req.query);

    const { members, total } = await memberService.getWorkspaceMembers(id, pagination);

    const response = buildPaginationResponse(members, total, pagination.page, pagination.limit);

    return sendSuccess(res, { members: response.data, pagination: response.pagination });
  } catch (error) {
    console.error("Error fetching members:", error);
    return sendError(res, "Failed to fetch members");
  }
}

/**
 * POST /api/workspaces/:id/members
 * Invite a new member
 */
export async function inviteMember(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;
    const { email, role, permissions } = req.body;

    if (!email) {
      return sendBadRequest(res, "Email is required");
    }

    const member = await memberService.inviteMember({
      workspaceId: id,
      email,
      role,
      permissions,
      invitedBy: dbUser?._id.toString() || "",
    });

    return sendCreated(res, { member }, "Invitation sent successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to invite member";
    console.error("Error inviting member:", error);
    return sendBadRequest(res, message);
  }
}

/**
 * PUT /api/workspaces/:id/members/:memberId
 * Update member role/permissions
 */
export async function updateMember(req: Request, res: Response) {
  try {
    const memberId = getRouteParam(req, "memberId");
    const { role, permissions } = req.body;

    const member = await memberService.updateMember(memberId, { role, permissions });

    if (!member) {
      return sendNotFound(res, "Member not found");
    }

    return sendSuccess(res, { message: "Member updated successfully", member });
  } catch (error) {
    console.error("Error updating member:", error);
    return sendError(res, "Failed to update member");
  }
}

/**
 * DELETE /api/workspaces/:id/members/:memberId
 * Remove member from workspace
 */
export async function removeMember(req: Request, res: Response) {
  try {
    const memberId = getRouteParam(req, "memberId");

    const member = await memberService.getMemberById(memberId);
    if (!member) {
      return sendNotFound(res, "Member not found");
    }

    await memberService.removeMember(memberId);

    return sendSuccess(res, { message: "Member removed successfully" });
  } catch (error) {
    console.error("Error removing member:", error);
    return sendError(res, "Failed to remove member");
  }
}

/**
 * POST /api/workspaces/invitations/:token/accept
 * Accept workspace invitation
 */
export async function acceptInvitation(req: Request, res: Response) {
  try {
    const token = getRouteParam(req, "token");

    const member = await memberService.acceptInvitation(token);

    return sendSuccess(res, { message: "Invitation accepted", member });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to accept invitation";
    console.error("Error accepting invitation:", error);
    return sendBadRequest(res, message);
  }
}

/**
 * POST /api/workspaces/invitations/:token/reject
 * Reject workspace invitation
 */
export async function rejectInvitation(req: Request, res: Response) {
  try {
    const token = getRouteParam(req, "token");

    await memberService.rejectInvitation(token);

    return sendSuccess(res, { message: "Invitation rejected" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reject invitation";
    console.error("Error rejecting invitation:", error);
    return sendBadRequest(res, message);
  }
}

/**
 * GET /api/workspaces/invitations/pending
 * Get pending invitations for current user
 */
export async function getPendingInvitations(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const invitations = await memberService.getPendingInvitations(dbUser._id.toString());

    return sendSuccess(res, { invitations });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    return sendError(res, "Failed to fetch invitations");
  }
}
