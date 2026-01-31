import { Request, Response } from "express";
import * as projectService from "../services/project.service.js";
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
import { HTTP_STATUS, ERROR_MESSAGES, USER_ROLES, PROJECT_STATUS } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";

/**
 * GET /api/projects
 * List projects user has access to
 */
export async function listProjects(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { workspaceId, channelId, status } = req.query;
    const pagination = getPaginationParams(req.query);

    const result = await projectService.getProjectsForUser(
      dbUser._id.toString(),
      dbUser.role,
      {
        ...pagination,
        workspaceId: workspaceId as string,
        channelId: channelId as string,
        status: status as string,
      }
    );

    const response = buildPaginationResponse(
      result.projects,
      result.total,
      pagination.page,
      pagination.limit
    );

    return sendSuccess(res, { projects: response.data, pagination: response.pagination });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return sendError(res, "Failed to fetch projects");
  }
}

/**
 * GET /api/projects/:id
 * Get single project details
 */
export async function getProject(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess) {
      return sendForbidden(res, ERROR_MESSAGES.NO_PROJECT_ACCESS);
    }

    const project = await projectService.findProjectById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    return sendSuccess(res, { project, permissions: access.permissions });
  } catch (error) {
    console.error("Error fetching project:", error);
    return sendError(res, "Failed to fetch project");
  }
}

/**
 * POST /api/projects
 * Create a new project
 */
export async function createProject(req: Request, res: Response) {
  try {
    const dbUser = (req as AuthenticatedRequest).dbUser;
    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { title, reelIdea, workspaceId, channelId, script, aspectRatio } = req.body;

    if (!title) {
      return sendBadRequest(res, "Title is required");
    }

    if (!workspaceId) {
      return sendBadRequest(res, "Workspace ID is required");
    }

    if (!channelId) {
      return sendBadRequest(res, "Channel ID is required");
    }

    const project = await projectService.createProject({
      title,
      reelIdea,
      workspaceId,
      channelId,
      script,
      aspectRatio,
      createdBy: dbUser._id.toString(),
    });

    return sendCreated(res, { project }, "Project created successfully");
  } catch (error) {
    console.error("Error creating project:", error);
    return sendError(res, "Failed to create project");
  }
}

/**
 * PUT /api/projects/:id
 * Update project
 */
export async function updateProject(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess) {
      return sendForbidden(res, ERROR_MESSAGES.NO_PROJECT_ACCESS);
    }

    if (!access.permissions.canEdit) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_EDIT);
    }

    const { title, reelIdea, script, aspectRatio } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (reelIdea !== undefined) updateData.reelIdea = reelIdea;
    if (script !== undefined) updateData.script = script;
    if (aspectRatio !== undefined) updateData.aspectRatio = aspectRatio;

    const project = await projectService.updateProject(id, updateData);

    return sendSuccess(res, { message: "Project updated successfully", project });
  } catch (error) {
    console.error("Error updating project:", error);
    return sendError(res, "Failed to update project");
  }
}

/**
 * DELETE /api/projects/:id
 * Delete project
 */
export async function deleteProject(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess) {
      return sendForbidden(res, ERROR_MESSAGES.NO_PROJECT_ACCESS);
    }

    if (!access.permissions.canDelete) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_DELETE);
    }

    await projectService.deleteProject(id);

    return sendSuccess(res, { message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    return sendError(res, "Failed to delete project");
  }
}

/**
 * PUT /api/projects/:id/status
 * Update project status
 */
export async function updateStatus(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const { status } = req.body;
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Validate status
    const validStatuses = Object.values(PROJECT_STATUS);
    if (!validStatuses.includes(status)) {
      return sendBadRequest(res, `Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess) {
      return sendForbidden(res, ERROR_MESSAGES.NO_PROJECT_ACCESS);
    }

    // Approval requires special permission
    if (status === PROJECT_STATUS.APPROVED && !access.permissions.canApprove) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_APPROVE);
    }

    const project = await projectService.updateProjectStatus(
      id,
      status,
      status === PROJECT_STATUS.APPROVED ? dbUser._id.toString() : undefined
    );

    return sendSuccess(res, { message: "Status updated successfully", project });
  } catch (error) {
    console.error("Error updating status:", error);
    return sendError(res, "Failed to update status");
  }
}

/**
 * PUT /api/projects/:id/submit
 * Submit project for review
 */
export async function submitForReview(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess || !access.permissions.canEdit) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_EDIT);
    }

    const project = await projectService.updateProjectStatus(id, PROJECT_STATUS.REVIEW);

    return sendSuccess(res, { message: "Project submitted for review", project });
  } catch (error) {
    console.error("Error submitting for review:", error);
    return sendError(res, "Failed to submit for review");
  }
}

/**
 * PUT /api/projects/:id/approve
 * Approve project
 */
export async function approveProject(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess) {
      return sendForbidden(res, ERROR_MESSAGES.NO_PROJECT_ACCESS);
    }

    if (!access.permissions.canApprove) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_APPROVE);
    }

    const project = await projectService.updateProjectStatus(
      id,
      PROJECT_STATUS.APPROVED,
      dbUser._id.toString()
    );

    return sendSuccess(res, { message: "Project approved", project });
  } catch (error) {
    console.error("Error approving project:", error);
    return sendError(res, "Failed to approve project");
  }
}

/**
 * POST /api/projects/:id/reject
 * Reject project
 */
export async function rejectProject(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const { reason } = req.body;
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess) {
      return sendForbidden(res, ERROR_MESSAGES.NO_PROJECT_ACCESS);
    }

    if (!access.permissions.canApprove) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_APPROVE);
    }

    const project = await projectService.updateProjectStatus(id, "rejected");

    return sendSuccess(res, { message: "Project rejected", project, reason });
  } catch (error) {
    console.error("Error rejecting project:", error);
    return sendError(res, "Failed to reject project");
  }
}

/**
 * GET /api/projects/stats
 * Get project statistics for a workspace
 */
export async function getProjectStats(req: Request, res: Response) {
  try {
    const { workspaceId } = req.query;

    if (!workspaceId) {
      return sendBadRequest(res, "Workspace ID is required");
    }

    const stats = await projectService.getProjectStats(workspaceId as string);

    return sendSuccess(res, { stats });
  } catch (error) {
    console.error("Error fetching project stats:", error);
    return sendError(res, "Failed to fetch project stats");
  }
}
