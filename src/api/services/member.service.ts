import WorkspaceMember from "../../models/WorkspaceMember.js";
import User from "../../models/User.js";
import Workspace from "../../models/Workspace.js";
import crypto from "crypto";
import { PaginationParams } from "../types/index.js";
import { getSkip } from "../utils/index.js";
import { MEMBER_STATUS, WORKSPACE_MEMBER_ROLES } from "../constants/index.js";

export interface InviteMemberData {
  workspaceId: string;
  email: string;
  role?: string;
  permissions?: {
    channelIds?: string[];
    canCreateProjects?: boolean;
    canEditProjects?: boolean;
    canDeleteProjects?: boolean;
  };
  invitedBy: string;
}

export interface UpdateMemberData {
  role?: string;
  permissions?: {
    channelIds?: string[];
    canCreateProjects?: boolean;
    canEditProjects?: boolean;
    canDeleteProjects?: boolean;
  };
}

/**
 * Get workspace members
 */
export async function getWorkspaceMembers(workspaceId: string, filters: PaginationParams) {
  const { page, limit, search } = filters;
  const skip = getSkip(page, limit);

  // If search is provided, first find matching users
  let userIds: string[] | undefined;
  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    }).select("_id");
    userIds = users.map((u) => u._id.toString());
  }

  const query: Record<string, unknown> = { workspaceId };
  if (userIds) {
    query.userId = { $in: userIds };
  }

  const [members, total] = await Promise.all([
    WorkspaceMember.find(query)
      .populate("userId", "name email image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    WorkspaceMember.countDocuments(query),
  ]);

  return { members, total };
}

/**
 * Get member by ID
 */
export async function getMemberById(memberId: string) {
  return WorkspaceMember.findById(memberId).populate("userId", "name email image");
}

/**
 * Get member by user and workspace
 */
export async function getMemberByUserAndWorkspace(userId: string, workspaceId: string) {
  return WorkspaceMember.findOne({ userId, workspaceId });
}

/**
 * Invite a new member to workspace
 */
export async function inviteMember(data: InviteMemberData) {
  // Check if user exists
  const user = await User.findOne({ email: data.email.toLowerCase() });
  if (!user) {
    throw new Error("User not found with this email");
  }

  // Check if already a member
  const existingMember = await WorkspaceMember.findOne({
    workspaceId: data.workspaceId,
    userId: user._id,
  });

  if (existingMember) {
    if (existingMember.status === MEMBER_STATUS.ACCEPTED) {
      throw new Error("User is already a member of this workspace");
    }
    if (existingMember.status === MEMBER_STATUS.PENDING) {
      throw new Error("Invitation already sent to this user");
    }
    // If rejected, update to pending
    existingMember.status = MEMBER_STATUS.PENDING as "pending";
    existingMember.inviteToken = crypto.randomBytes(32).toString("hex");
    existingMember.inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await existingMember.save();
    return existingMember;
  }

  // Create new membership
  const member = await WorkspaceMember.create({
    workspaceId: data.workspaceId,
    userId: user._id,
    role: data.role || WORKSPACE_MEMBER_ROLES.VIEWER,
    permissions: data.permissions || {},
    status: MEMBER_STATUS.PENDING,
    invitedBy: data.invitedBy,
    inviteToken: crypto.randomBytes(32).toString("hex"),
    inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return member.populate("userId", "name email image");
}

/**
 * Accept invitation
 */
export async function acceptInvitation(token: string) {
  const member = await WorkspaceMember.findOne({
    inviteToken: token,
    status: MEMBER_STATUS.PENDING,
  });

  if (!member) {
    throw new Error("Invalid or expired invitation");
  }

  if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
    throw new Error("Invitation has expired");
  }

  member.status = MEMBER_STATUS.ACCEPTED as "accepted";
  member.inviteToken = undefined;
  member.inviteExpiresAt = undefined;
  member.acceptedAt = new Date();
  await member.save();

  return member.populate("userId", "name email image");
}

/**
 * Reject invitation
 */
export async function rejectInvitation(token: string) {
  const member = await WorkspaceMember.findOne({
    inviteToken: token,
    status: MEMBER_STATUS.PENDING,
  });

  if (!member) {
    throw new Error("Invalid or expired invitation");
  }

  member.status = MEMBER_STATUS.REJECTED as "rejected";
  member.inviteToken = undefined;
  member.inviteExpiresAt = undefined;
  await member.save();

  return member;
}

/**
 * Update member role/permissions
 */
export async function updateMember(memberId: string, data: UpdateMemberData) {
  const updateData: Record<string, unknown> = {};
  
  if (data.role) {
    updateData.role = data.role;
  }
  
  if (data.permissions) {
    updateData.permissions = data.permissions;
  }

  return WorkspaceMember.findByIdAndUpdate(
    memberId,
    { $set: updateData },
    { new: true }
  ).populate("userId", "name email image");
}

/**
 * Remove member from workspace
 */
export async function removeMember(memberId: string) {
  return WorkspaceMember.findByIdAndDelete(memberId);
}

/**
 * Get pending invitations for a user
 */
export async function getPendingInvitations(userId: string) {
  return WorkspaceMember.find({
    userId,
    status: MEMBER_STATUS.PENDING,
  })
    .populate("workspaceId", "name description")
    .populate("invitedBy", "name email");
}

/**
 * Count workspace members
 */
export async function countWorkspaceMembers(workspaceId: string, status?: string) {
  const query: Record<string, unknown> = { workspaceId };
  if (status) {
    query.status = status;
  }
  return WorkspaceMember.countDocuments(query);
}
