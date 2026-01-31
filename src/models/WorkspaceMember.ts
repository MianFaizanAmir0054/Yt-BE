import mongoose, { Schema, Document, Model } from "mongoose";

export type MemberRole = "admin" | "editor" | "viewer";

export interface IWorkspaceMember extends Document {
  _id: mongoose.Types.ObjectId;
  
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  
  // Role within this workspace
  role: MemberRole;
  
  // Invitation details
  invitedBy: mongoose.Types.ObjectId;
  invitedAt: Date;
  acceptedAt?: Date;
  
  // Status
  status: "pending" | "accepted" | "rejected" | "removed";
  inviteToken?: string; // For email invitations
  inviteExpiresAt?: Date;
  
  // Permissions override (optional - if not set, uses role defaults)
  permissions?: {
    canCreateProjects?: boolean;
    canEditProjects?: boolean;
    canDeleteProjects?: boolean;
    canUploadMedia?: boolean;
    canPublish?: boolean;
    // Restrict to specific channels (empty = all channels)
    channelIds?: mongoose.Types.ObjectId[];
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "editor", "viewer"],
      default: "editor",
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "removed"],
      default: "pending",
    },
    inviteToken: {
      type: String,
      default: null,
    },
    inviteExpiresAt: {
      type: Date,
      default: null,
    },
    permissions: {
      canCreateProjects: { type: Boolean, default: true },
      canEditProjects: { type: Boolean, default: true },
      canDeleteProjects: { type: Boolean, default: false },
      canUploadMedia: { type: Boolean, default: true },
      canPublish: { type: Boolean, default: false },
      channelIds: [{ type: Schema.Types.ObjectId, ref: "Channel" }],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
WorkspaceMemberSchema.index({ workspaceId: 1 });
WorkspaceMemberSchema.index({ userId: 1 });
WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
WorkspaceMemberSchema.index({ inviteToken: 1 }, { sparse: true });

const WorkspaceMember: Model<IWorkspaceMember> =
  mongoose.models.WorkspaceMember || 
  mongoose.model<IWorkspaceMember>("WorkspaceMember", WorkspaceMemberSchema);

export default WorkspaceMember;
