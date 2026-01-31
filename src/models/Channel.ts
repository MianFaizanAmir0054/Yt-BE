import mongoose, { Schema, Document, Model } from "mongoose";

export interface IChannel extends Document {
  _id: mongoose.Types.ObjectId;
  
  // YouTube channel info
  name: string;
  youtubeChannelId?: string; // YouTube's channel ID if connected
  youtubeHandle?: string; // @handle
  description?: string;
  thumbnailUrl?: string;
  
  // Owner - the admin who added this channel
  ownerId: mongoose.Types.ObjectId;
  
  // Optional: YouTube API credentials for this channel
  youtubeCredentials?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  };
  
  // Channel settings
  defaultAspectRatio: "9:16" | "16:9" | "1:1";
  defaultVoiceId?: string;
  defaultHashtags: string[];
  brandColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelSchema = new Schema<IChannel>(
  {
    name: {
      type: String,
      required: [true, "Channel name is required"],
      trim: true,
    },
    youtubeChannelId: {
      type: String,
      default: null,
      sparse: true,
    },
    youtubeHandle: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      default: null,
    },
    thumbnailUrl: {
      type: String,
      default: null,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    youtubeCredentials: {
      accessToken: { type: String, default: null },
      refreshToken: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
    defaultAspectRatio: {
      type: String,
      enum: ["9:16", "16:9", "1:1"],
      default: "9:16",
    },
    defaultVoiceId: {
      type: String,
      default: null,
    },
    defaultHashtags: {
      type: [String],
      default: [],
    },
    brandColors: {
      primary: { type: String, default: null },
      secondary: { type: String, default: null },
      accent: { type: String, default: null },
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
ChannelSchema.index({ ownerId: 1 });
ChannelSchema.index({ youtubeChannelId: 1 }, { sparse: true });

const Channel: Model<IChannel> =
  mongoose.models.Channel || mongoose.model<IChannel>("Channel", ChannelSchema);

export default Channel;
