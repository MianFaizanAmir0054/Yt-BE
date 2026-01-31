// User roles
export const USER_ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  COLLABORATOR: "collaborator",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// Workspace member roles
export const WORKSPACE_MEMBER_ROLES = {
  ADMIN: "admin",
  EDITOR: "editor",
  VIEWER: "viewer",
} as const;

export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[keyof typeof WORKSPACE_MEMBER_ROLES];

// Member status
export const MEMBER_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
} as const;

export type MemberStatus = (typeof MEMBER_STATUS)[keyof typeof MEMBER_STATUS];

// Project status
export const PROJECT_STATUS = {
  DRAFT: "draft",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  APPROVED: "approved",
  PUBLISHED: "published",
  ARCHIVED: "archived",
} as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

// Default pagination values
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error messages
export const ERROR_MESSAGES = {
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Resource not found",
  INTERNAL_ERROR: "Internal server error",
  INVALID_INPUT: "Invalid input",
  
  // Auth errors
  ADMIN_REQUIRED: "Admin access required",
  SUPER_ADMIN_REQUIRED: "Super Admin access required",
  
  // Resource errors
  USER_NOT_FOUND: "User not found",
  WORKSPACE_NOT_FOUND: "Workspace not found",
  CHANNEL_NOT_FOUND: "Channel not found",
  PROJECT_NOT_FOUND: "Project not found",
  
  // Permission errors
  NO_WORKSPACE_ACCESS: "No access to this workspace",
  NO_CHANNEL_ACCESS: "No access to this channel",
  NO_PROJECT_ACCESS: "No access to this project",
  CANNOT_CREATE: "You don't have permission to create",
  CANNOT_EDIT: "You don't have permission to edit",
  CANNOT_DELETE: "You don't have permission to delete",
  CANNOT_APPROVE: "You don't have permission to approve",
} as const;

// Success messages
export const SUCCESS_MESSAGES = {
  CREATED: "Created successfully",
  UPDATED: "Updated successfully",
  DELETED: "Deleted successfully",
  INVITATION_SENT: "Invitation sent successfully",
} as const;

// Aspect ratios
export const ASPECT_RATIOS = {
  VERTICAL: "9:16",
  HORIZONTAL: "16:9",
  SQUARE: "1:1",
} as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[keyof typeof ASPECT_RATIOS];
