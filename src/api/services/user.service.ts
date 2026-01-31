import User from "../../models/User.js";
import { PaginationParams } from "../types/index.js";
import { getSkip, buildSearchQuery, mergeQueries } from "../utils/index.js";

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
  role: string;
  createdBy?: string;
}

export interface UpdateUserData {
  name?: string;
  role?: string;
  isActive?: boolean;
}

export interface UserFilters extends PaginationParams {
  role?: string;
}

/**
 * Find user by ID
 */
export async function findUserById(id: string) {
  return User.findById(id).select("-password -apiKeys");
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string) {
  return User.findOne({ email: email.toLowerCase() });
}

/**
 * Find user by email with password (for auth)
 */
export async function findUserByEmailWithPassword(email: string) {
  return User.findOne({ email: email.toLowerCase() });
}

/**
 * Get all users with pagination and filters
 */
export async function getUsers(filters: UserFilters) {
  const { page, limit, search, role } = filters;
  const skip = getSkip(page, limit);

  const query: Record<string, unknown> = {};

  // Role filter
  if (role && role !== "all") {
    query.role = role;
  }

  // Search filter
  const searchQuery = buildSearchQuery(search, ["name", "email"]);
  const finalQuery = mergeQueries(query, searchQuery);

  const [users, total] = await Promise.all([
    User.find(finalQuery)
      .select("-password -apiKeys")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(finalQuery),
  ]);

  return { users, total };
}

/**
 * Create a new user
 */
export async function createUser(data: CreateUserData) {
  const user = await User.create({
    ...data,
    email: data.email.toLowerCase(),
    isActive: true,
  });

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

/**
 * Update user by ID
 */
export async function updateUser(id: string, data: UpdateUserData) {
  return User.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true }
  ).select("-password -apiKeys");
}

/**
 * Delete user by ID
 */
export async function deleteUser(id: string) {
  return User.findByIdAndDelete(id);
}

/**
 * Check if email exists
 */
export async function emailExists(email: string, excludeId?: string) {
  const query: Record<string, unknown> = { email: email.toLowerCase() };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const user = await User.findOne(query);
  return !!user;
}

/**
 * Count users by role
 */
export async function countUsersByRole(role: string) {
  return User.countDocuments({ role });
}

/**
 * Get user statistics
 */
export async function getUserStats() {
  const [total, superAdmins, admins, collaborators, activeUsers] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "super_admin" }),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ role: "collaborator" }),
    User.countDocuments({ isActive: true }),
  ]);

  return {
    total,
    byRole: {
      super_admin: superAdmins,
      admin: admins,
      collaborator: collaborators,
    },
    active: activeUsers,
    inactive: total - activeUsers,
  };
}
