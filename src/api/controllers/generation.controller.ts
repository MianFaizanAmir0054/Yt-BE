import { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import * as projectService from "../services/project.service.js";
import {
  performResearch,
  generateScript,
  generateImagePrompts,
  generateSceneImages,
  analyzeWithAssemblyAI,
  mapScenesToTimestamps,
  generateHashtags,
} from "../services/ai/index.js";
import { decrypt } from "../../lib/encryption.js";
import User from "../../models/User.js";
import Project from "../../models/Project.js";
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendBadRequest,
  sendForbidden,
  getRouteParam,
} from "../utils/index.js";
import { HTTP_STATUS, ERROR_MESSAGES } from "../constants/index.js";
import { AuthenticatedRequest } from "../types/index.js";

/**
 * Helper to get user API keys (decrypted)
 */
async function getUserApiKeys(userId: string) {
  const user = await User.findById(userId);
  if (!user || !user.apiKeys) {
    return null;
  }

  return {
    openai: user.apiKeys.openai ? decrypt(user.apiKeys.openai) : undefined,
    anthropic: user.apiKeys.anthropic ? decrypt(user.apiKeys.anthropic) : undefined,
    perplexity: user.apiKeys.perplexity ? decrypt(user.apiKeys.perplexity) : undefined,
    pexels: user.apiKeys.pexels ? decrypt(user.apiKeys.pexels) : undefined,
    segmind: user.apiKeys.segmind ? decrypt(user.apiKeys.segmind) : undefined,
    assemblyai: user.apiKeys.assemblyai ? decrypt(user.apiKeys.assemblyai) : undefined,
    elevenLabs: user.apiKeys.elevenLabs ? decrypt(user.apiKeys.elevenLabs) : undefined,
  };
}

function getVideoDimensions(aspectRatio: "9:16" | "16:9" | "1:1") {
  if (aspectRatio === "16:9") {
    return { width: 1920, height: 1080 };
  }

  if (aspectRatio === "1:1") {
    return { width: 1080, height: 1080 };
  }

  return { width: 1080, height: 1920 };
}

function toFfmpegPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function ensureFileExists(filePath: string, label: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function assembleVideoWithFfmpeg(options: {
  scenes: Array<{ imagePath: string; duration: number }>;
  voiceoverPath: string;
  outputPath: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
}) {
  const { scenes, voiceoverPath, outputPath, aspectRatio } = options;
  const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";

  if (scenes.length === 0) {
    throw new Error("No scenes available for video assembly");
  }

  await ensureFileExists(voiceoverPath, "Voiceover file");

  for (const scene of scenes) {
    await ensureFileExists(scene.imagePath, `Scene image`);
  }

  const concatFilePath = path.join(path.dirname(outputPath), `concat-${uuidv4()}.txt`);
  const concatContent = [
    ...scenes.flatMap((scene) => [
      `file '${toFfmpegPath(scene.imagePath)}'`,
      `duration ${Math.max(0.5, scene.duration).toFixed(3)}`,
    ]),
    `file '${toFfmpegPath(scenes[scenes.length - 1].imagePath)}'`,
  ].join("\n");

  await fs.writeFile(concatFilePath, concatContent, "utf-8");

  const { width, height } = getVideoDimensions(aspectRatio);
  const videoFilter = [
    `scale=${width}:${height}:force_original_aspect_ratio=cover`,
    `crop=${width}:${height}`,
    "format=yuv420p",
  ].join(",");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-i",
    voiceoverPath,
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    outputPath,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegBin, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderrOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });

      ffmpeg.on("error", (error) => {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          reject(new Error("FFmpeg is not installed or not available in PATH. Set FFMPEG_PATH or install ffmpeg."));
          return;
        }

        reject(error);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const lines = stderrOutput.split("\n").slice(-12).join("\n").trim();
        reject(new Error(lines ? `FFmpeg failed: ${lines}` : `FFmpeg failed with exit code ${code}`));
      });
    });
  } finally {
    await fs.unlink(concatFilePath).catch(() => undefined);
  }
}

/**
 * POST /api/projects/:id/research
 * Generate research and script for a project
 */
export async function generateResearch(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { duration = "60s", tone = "educational" } = req.body;

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess || !access.permissions.canEdit) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_EDIT);
    }

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    // Get user API keys
    const apiKeys = await getUserApiKeys(dbUser._id.toString());
    if (!apiKeys || (!apiKeys.openai && !apiKeys.anthropic)) {
      return sendBadRequest(res, "Please configure at least one LLM API key (OpenAI or Anthropic)");
    }

    // Update status to researching
    project.status = "researching";
    await project.save();

    try {
      // Step 1: Perform research
      console.log("Starting research for:", project.reelIdea);
      const researchResult = await performResearch(project.reelIdea || project.title, apiKeys);

      // Save research data
      project.researchData = {
        sources: researchResult.sources,
        keywords: researchResult.keywords,
        generatedAt: new Date(),
      };

      // Step 2: Generate script
      console.log("Generating script...");
      const provider = apiKeys.openai ? "openai" : "anthropic";
      const apiKey = (apiKeys.openai || apiKeys.anthropic) as string;

      const script = await generateScript({
        topic: project.reelIdea || project.title,
        researchSummary: researchResult.summary,
        duration: duration as "30s" | "60s" | "90s" | "120s",
        tone: tone as "educational" | "inspirational" | "dramatic" | "casual",
        provider,
        apiKey,
      });

      // Save script
      project.script = {
        fullText: script.fullText,
        scenes: script.scenes,
        generatedAt: new Date(),
      };

      project.status = "script-ready";
      await project.save();

      return sendSuccess(res, {
        message: "Research and script generation completed",
        researchData: project.researchData,
        script: project.script,
      });
    } catch (error) {
      project.status = "failed";
      await project.save();
      throw error;
    }
  } catch (error) {
    console.error("Research generation error:", error);
    return sendError(res, "Failed to generate research and script");
  }
}

/**
 * POST /api/projects/:id/voiceover
 * Upload and analyze voiceover audio
 */
export async function uploadVoiceover(req: Request, res: Response) {
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

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!project.script?.scenes || project.script.scenes.length === 0) {
      return sendBadRequest(res, "Script must be generated before uploading voiceover");
    }

    // Check for uploaded file
    const file = (req as any).file;
    if (!file) {
      return sendBadRequest(res, "No audio file provided");
    }

    // Get user API keys
    const apiKeys = await getUserApiKeys(dbUser._id.toString());
    if (!apiKeys?.assemblyai) {
      return sendBadRequest(res, "AssemblyAI API key is required for audio analysis");
    }

    try {
      // Analyze with AssemblyAI
      console.log("Analyzing voiceover with AssemblyAI...");
      const whisperResult = await analyzeWithAssemblyAI(file.path, apiKeys.assemblyai);

      // Save voiceover data
      project.voiceover = {
        filePath: file.path,
        duration: whisperResult.words.length > 0 
          ? whisperResult.words[whisperResult.words.length - 1].end 
          : 60,
        uploadedAt: new Date(),
      };

      // Save whisper analysis
      project.whisperAnalysis = {
        fullTranscript: whisperResult.fullTranscript,
        words: whisperResult.words,
        segments: whisperResult.segments,
        analyzedAt: new Date(),
      };

      // Map scenes to timestamps
      const sceneTimestamps = mapScenesToTimestamps(
        project.script.scenes,
        whisperResult.words,
        whisperResult.segments
      );

      // Update timeline with scene timestamps
      project.timeline = {
        totalDuration: project.voiceover.duration,
        scenes: sceneTimestamps.map((st, index) => ({
          id: st.sceneId,
          order: index,
          startTime: st.startTime,
          endTime: st.endTime,
          duration: st.duration,
          sceneText: st.text,
          sceneDescription: project.script!.scenes.find(s => s.id === st.sceneId)?.visualDescription || "",
          imagePrompt: "Pending prompt generation",
          imageSource: "uploaded" as const,
          subtitles: st.subtitles,
        })),
      };

      project.status = "voiceover-uploaded";
      await project.save();

      return sendSuccess(res, {
        message: "Voiceover uploaded and analyzed",
        voiceover: project.voiceover,
        timeline: project.timeline,
      });
    } catch (error) {
      console.error("Voiceover processing error:", error);
      throw error;
    }
  } catch (error) {
    console.error("Voiceover upload error:", error);
    return sendError(res, "Failed to process voiceover");
  }
}

/**
 * POST /api/projects/:id/images
 * Generate images for project scenes
 */
export async function generateImages(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { provider = "pexels", styleGuide = "" } = req.body;

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess || !access.permissions.canEdit) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_EDIT);
    }

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!project.timeline?.scenes || project.timeline.scenes.length === 0) {
      return sendBadRequest(res, "Timeline must exist before generating images");
    }

    // Get user API keys
    const apiKeys = await getUserApiKeys(dbUser._id.toString());
    if (!apiKeys) {
      return sendBadRequest(res, "API keys not configured");
    }

    // Validate required keys
    if (provider === "segmind" && !apiKeys.segmind) {
      return sendBadRequest(res, "Segmind API key required for AI image generation");
    }
    if (provider === "pexels" && !apiKeys.pexels) {
      return sendBadRequest(res, "Pexels API key required for stock photos");
    }

    const llmProvider = apiKeys.openai ? "openai" : "anthropic";
    const llmKey = apiKeys.openai || apiKeys.anthropic;

    if (!llmKey) {
      return sendBadRequest(res, "LLM API key required for generating image prompts");
    }

    try {
      // Step 1: Generate image prompts for each scene
      console.log("Generating image prompts...");
      const scenes = project.timeline.scenes.map((s) => ({
        id: s.id,
        text: s.sceneText,
        visualDescription: s.sceneDescription,
      }));

      const imagePrompts = await generateImagePrompts(
        scenes,
        styleGuide,
        llmProvider,
        llmKey
      );

      // Update scenes with prompts
      for (const prompt of imagePrompts) {
        const scene = project.timeline.scenes.find((s) => s.id === prompt.sceneId);
        if (scene) {
          scene.imagePrompt = prompt.prompt;
        }
      }

      // Step 2: Generate images
      console.log("Generating images...");
      const outputDir = path.join(
        process.cwd(),
        "uploads",
        dbUser._id.toString(),
        id,
        "images"
      );

      await fs.mkdir(outputDir, { recursive: true });

      const imageResults = await generateSceneImages(
        imagePrompts.map((p) => ({
          sceneId: p.sceneId,
          prompt: p.prompt,
          provider: provider as "segmind" | "pexels",
        })),
        {
          segmind: apiKeys.segmind,
          pexels: apiKeys.pexels,
        },
        outputDir,
        project.aspectRatio
      );

      // Update scenes with image paths
      for (const result of imageResults) {
        const scene = project.timeline.scenes.find((s) => s.id === result.sceneId);
        if (scene && result.success && result.imagePath) {
          scene.imagePath = result.imagePath;
          scene.imageSource = result.imageSource;
        }
      }

      project.status = "images-ready";
      await project.save();

      return sendSuccess(res, {
        message: "Images generated",
        results: imageResults,
        timeline: project.timeline,
      });
    } catch (error) {
      console.error("Image generation error:", error);
      throw error;
    }
  } catch (error) {
    console.error("Image generation error:", error);
    return sendError(res, "Failed to generate images");
  }
}

/**
 * POST /api/projects/:id/generate
 * Generate/assemble the final video
 */
export async function generateVideo(req: Request, res: Response) {
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

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    // Validate project state
    if (!project.voiceover?.filePath) {
      return sendBadRequest(res, "Voiceover is required before generating video");
    }

    if (!project.timeline?.scenes || project.timeline.scenes.length === 0) {
      return sendBadRequest(res, "Timeline with scenes is required");
    }

    // Check all scenes have images
    const missingImages = project.timeline.scenes.filter((s) => !s.imagePath);
    if (missingImages.length > 0) {
      return sendBadRequest(res, `${missingImages.length} scene(s) are missing images`);
    }

    // Get user API keys for hashtag generation
    const apiKeys = await getUserApiKeys(dbUser._id.toString());
    const llmProvider = apiKeys?.openai ? "openai" : "anthropic";
    const llmKey = apiKeys?.openai || apiKeys?.anthropic;

    project.status = "processing";
    await project.save();

    try {
      // Generate hashtags
      let hashtags: string[] = [];
      if (llmKey) {
        console.log("Generating hashtags...");
        hashtags = await generateHashtags(
          project.reelIdea || project.title,
          project.script?.fullText || "",
          llmProvider,
          llmKey
        );
      }

      const outputDir = path.join(
        process.cwd(),
        "outputs",
        dbUser._id.toString(),
        id
      );

      await fs.mkdir(outputDir, { recursive: true });

      const outputVideoPath = path.join(outputDir, "output.mp4");

      const scenes = [...project.timeline.scenes]
        .filter((scene) => Boolean(scene.imagePath))
        .sort((a, b) => a.order - b.order)
        .map((scene) => ({
          imagePath: scene.imagePath as string,
          duration:
            typeof scene.duration === "number" && scene.duration > 0
              ? scene.duration
              : Math.max(0.5, scene.endTime - scene.startTime),
        }));

      await assembleVideoWithFfmpeg({
        scenes,
        voiceoverPath: project.voiceover.filePath,
        outputPath: outputVideoPath,
        aspectRatio: project.aspectRatio,
      });

      project.output = {
        videoPath: outputVideoPath,
        hashtags,
        generatedAt: new Date(),
      };
      project.status = "completed";

      await project.save();

      return sendSuccess(res, {
        message: "Video generated successfully",
        output: {
          hashtags,
          status: project.status,
        },
      });
    } catch (error) {
      project.status = "failed";
      await project.save();
      throw error;
    }
  } catch (error) {
    console.error("Video generation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to generate video";
    return sendError(res, errorMessage);
  }
}

/**
 * PUT /api/projects/:id/timeline
 * Update project timeline
 */
export async function updateTimeline(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { timeline } = req.body;

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess || !access.permissions.canEdit) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_EDIT);
    }

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    // Update timeline
    if (timeline) {
      if (timeline.scenes) {
        project.timeline.scenes = timeline.scenes;
      }
      if (timeline.totalDuration !== undefined) {
        project.timeline.totalDuration = timeline.totalDuration;
      }
    }

    await project.save();

    return sendSuccess(res, {
      message: "Timeline updated",
      timeline: project.timeline,
    });
  } catch (error) {
    console.error("Update timeline error:", error);
    return sendError(res, "Failed to update timeline");
  }
}

/**
 * POST /api/projects/:id/timeline
 * Add a scene to the timeline
 */
export async function addTimelineScene(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { afterSceneId, scene } = req.body;

    // Check access
    const access = await projectService.checkProjectAccess(
      dbUser._id.toString(),
      dbUser.role,
      id
    );

    if (!access.hasAccess || !access.permissions.canEdit) {
      return sendForbidden(res, ERROR_MESSAGES.CANNOT_EDIT);
    }

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    // Create new scene
    const newScene = {
      id: scene?.id || uuidv4(),
      order: 0,
      startTime: scene?.startTime || 0,
      endTime: scene?.endTime || 0,
      duration: scene?.duration || 0,
      sceneText: scene?.sceneText || "",
      sceneDescription: scene?.sceneDescription || "",
      imagePrompt: scene?.imagePrompt || "Pending prompt generation",
      imagePath: scene?.imagePath,
      imageSource: scene?.imageSource || "uploaded" as const,
      subtitles: scene?.subtitles || [],
    };

    if (!project.timeline) {
      project.timeline = { totalDuration: 0, scenes: [] };
    }

    if (afterSceneId) {
      const index = project.timeline.scenes.findIndex((s) => s.id === afterSceneId);
      if (index !== -1) {
        project.timeline.scenes.splice(index + 1, 0, newScene);
      } else {
        project.timeline.scenes.push(newScene);
      }
    } else {
      project.timeline.scenes.push(newScene);
    }

    // Recalculate orders
    project.timeline.scenes = project.timeline.scenes.map((s, i) => ({
      ...s,
      order: i,
    }));

    await project.save();

    return sendSuccess(res, {
      message: "Scene added",
      scene: newScene,
      timeline: project.timeline,
    });
  } catch (error) {
    console.error("Add scene error:", error);
    return sendError(res, "Failed to add scene");
  }
}

/**
 * DELETE /api/projects/:id/timeline/:sceneId
 * Remove a scene from the timeline
 */
export async function deleteTimelineScene(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const sceneId = getRouteParam(req, "sceneId");
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

    // Get project
    const project = await Project.findById(id);
    if (!project) {
      return sendNotFound(res, ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!project.timeline?.scenes) {
      return sendBadRequest(res, "No timeline to delete from");
    }

    const sceneIndex = project.timeline.scenes.findIndex((s) => s.id === sceneId);
    if (sceneIndex === -1) {
      return sendNotFound(res, "Scene not found");
    }

    project.timeline.scenes.splice(sceneIndex, 1);

    // Recalculate orders
    project.timeline.scenes = project.timeline.scenes.map((s, i) => ({
      ...s,
      order: i,
    }));

    await project.save();

    return sendSuccess(res, {
      message: "Scene deleted",
      timeline: project.timeline,
    });
  } catch (error) {
    console.error("Delete scene error:", error);
    return sendError(res, "Failed to delete scene");
  }
}
