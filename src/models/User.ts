import mongoose, { Schema, Document, Model } from "mongoose";

export type UserRole = "super_admin" | "admin" | "collaborator";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  image?: string;
  role: UserRole;
  
  // Only for admins - API keys for AI services
  apiKeys?: {
    openai?: string;
    anthropic?: string;
    perplexity?: string;
    pexels?: string;
    segmind?: string;
    elevenLabs?: string;
  };
  
  preferences?: {
    defaultLLM: "openai" | "anthropic";
    defaultImageProvider: "segmind" | "pexels" | "prodia";
    subtitleStyle: "word-by-word" | "sentence";
  };
  
  // For admins - who created them (super_admin ID)
  createdBy?: mongoose.Types.ObjectId;
  
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    image: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["super_admin", "admin", "collaborator"],
      default: "collaborator",
      required: true,
    },
    apiKeys: {
      openai: { type: String, default: null },
      anthropic: { type: String, default: null },
      perplexity: { type: String, default: null },
      pexels: { type: String, default: null },
      segmind: { type: String, default: null },
      elevenLabs: { type: String, default: null },
    },
    preferences: {
      defaultLLM: {
        type: String,
        enum: ["openai", "anthropic"],
        default: "openai",
      },
      defaultImageProvider: {
        type: String,
        enum: ["segmind", "pexels", "prodia"],
        default: "pexels",
      },
      subtitleStyle: {
        type: String,
        enum: ["word-by-word", "sentence"],
        default: "sentence",
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ createdBy: 1 });

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default User;
