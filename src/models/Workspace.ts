import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWorkspace extends Document {
  _id: mongoose.Types.ObjectId;
  
  name: string;
  description?: string;
  
  // Owner - the admin who created this workspace
  ownerId: mongoose.Types.ObjectId;
  
  // Channels assigned to this workspace
  channelIds: mongoose.Types.ObjectId[];
  
  // Workspace settings
  settings?: {
    defaultAspectRatio?: "9:16" | "16:9" | "1:1";
    allowCollaboratorImageUpload?: boolean;
    requireApproval?: boolean; // Require admin approval before publishing
  };
  
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
  {
    name: {
      type: String,
      required: [true, "Workspace name is required"],
      trim: true,
    },
    description: {
      type: String,
      default: null,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    channelIds: {
      type: [Schema.Types.ObjectId],
      ref: "Channel",
      default: [],
    },
    settings: {
      defaultAspectRatio: {
        type: String,
        enum: ["9:16", "16:9", "1:1"],
        default: "9:16",
      },
      allowCollaboratorImageUpload: {
        type: Boolean,
        default: true,
      },
      requireApproval: {
        type: Boolean,
        default: false,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
WorkspaceSchema.index({ ownerId: 1 });
WorkspaceSchema.index({ channelIds: 1 });

const Workspace: Model<IWorkspace> =
  mongoose.models.Workspace || mongoose.model<IWorkspace>("Workspace", WorkspaceSchema);

export default Workspace;
