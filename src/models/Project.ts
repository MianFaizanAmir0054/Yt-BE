import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISubtitle {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface IScene {
  id: string;
  order: number;
  startTime: number;
  endTime: number;
  duration: number;
  sceneText: string;
  sceneDescription: string;
  imagePrompt: string;
  imagePath?: string;
  imageSource: "ai-generated" | "stock" | "uploaded" | "google";
  subtitles: ISubtitle[];
}

export interface IProject extends Document {
  _id: mongoose.Types.ObjectId;
  
  // Workspace and Channel - required for the new structure
  workspaceId: mongoose.Types.ObjectId;
  channelId: mongoose.Types.ObjectId;
  
  // Creator - can be admin or collaborator
  createdBy: mongoose.Types.ObjectId;
  
  title: string;
  reelIdea: string;
  status:
    | "draft"
    | "researching"
    | "script-ready"
    | "voiceover-uploaded"
    | "images-ready"
    | "processing"
    | "completed"
    | "failed"
    | "pending-approval"
    | "approved"
    | "rejected";
  
  // Research & Script
  researchData?: {
    sources: Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
    keywords: string[];
    generatedAt: Date;
  };
  script?: {
    fullText: string;
    scenes: Array<{
      id: string;
      text: string;
      visualDescription: string;
    }>;
    generatedAt: Date;
  };

  // Audio
  voiceover?: {
    filePath: string;
    duration: number;
    uploadedAt: Date;
  };
  whisperAnalysis?: {
    fullTranscript: string;
    words: Array<{
      word: string;
      start: number;
      end: number;
    }>;
    segments: Array<{
      id: number;
      start: number;
      end: number;
      text: string;
    }>;
    analyzedAt: Date;
  };

  // Timeline
  timeline: {
    totalDuration: number;
    scenes: IScene[];
  };

  // Output
  output?: {
    videoPath: string;
    thumbnailPath?: string;
    hashtags: string[];
    generatedAt: Date;
  };

  // Metadata
  aspectRatio: "9:16" | "16:9" | "1:1";
  createdAt: Date;
  updatedAt: Date;
}

const SubtitleSchema = new Schema<ISubtitle>(
  {
    id: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const SceneSchema = new Schema<IScene>(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    duration: { type: Number, required: true },
    sceneText: { type: String, required: true },
    sceneDescription: { type: String, required: true },
    imagePrompt: { type: String, required: true },
    imagePath: { type: String, default: null },
    imageSource: {
      type: String,
      enum: ["ai-generated", "stock", "uploaded", "google"],
      default: "ai-generated",
    },
    subtitles: [SubtitleSchema],
  },
  { _id: false }
);

const ProjectSchema = new Schema<IProject>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    reelIdea: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "researching",
        "script-ready",
        "voiceover-uploaded",
        "images-ready",
        "processing",
        "completed",
        "failed",
        "pending-approval",
        "approved",
        "rejected",
      ],
      default: "draft",
    },
    researchData: {
      sources: [
        {
          title: String,
          url: String,
          snippet: String,
        },
      ],
      keywords: [String],
      generatedAt: Date,
    },
    script: {
      fullText: String,
      scenes: [
        {
          id: String,
          text: String,
          visualDescription: String,
        },
      ],
      generatedAt: Date,
    },
    voiceover: {
      filePath: String,
      duration: Number,
      uploadedAt: Date,
    },
    whisperAnalysis: {
      fullTranscript: String,
      words: [
        {
          word: String,
          start: Number,
          end: Number,
        },
      ],
      segments: [
        {
          id: Number,
          start: Number,
          end: Number,
          text: String,
        },
      ],
      analyzedAt: Date,
    },
    timeline: {
      totalDuration: { type: Number, default: 0 },
      scenes: [SceneSchema],
    },
    output: {
      videoPath: String,
      thumbnailPath: String,
      hashtags: [String],
      generatedAt: Date,
    },
    aspectRatio: {
      type: String,
      enum: ["9:16", "16:9", "1:1"],
      default: "9:16",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
ProjectSchema.index({ workspaceId: 1, status: 1 });
ProjectSchema.index({ workspaceId: 1, createdAt: -1 });
ProjectSchema.index({ channelId: 1 });
ProjectSchema.index({ createdBy: 1 });

const Project: Model<IProject> =
  mongoose.models.Project || mongoose.model<IProject>("Project", ProjectSchema);

export default Project;
