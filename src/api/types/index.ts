import { Request } from "express";
import mongoose from "mongoose";

// Authenticated user from Better Auth
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string;
  role?: string;
}

// Database user (from MongoDB)
export interface DbUser {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "collaborator";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Extended Express Request with auth
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  dbUser?: DbUser;
  session?: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

// Workspace access result
export interface WorkspaceAccessResult {
  hasAccess: boolean;
  isOwner: boolean;
  membership?: unknown;
  dbUser?: DbUser;
}

// Project access result
export interface ProjectAccessResult {
  hasAccess: boolean;
  project?: unknown;
  permissions: {
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canApprove: boolean;
  };
  dbUser?: DbUser;
}

// Workspace channel access result
export interface WorkspaceChannelAccessResult {
  hasAccess: boolean;
  isOwner: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  membership?: unknown;
  dbUser?: DbUser;
}

// Pagination params
export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
}

// Pagination result
export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}
