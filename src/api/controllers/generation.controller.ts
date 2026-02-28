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
  generateTimestampsFromScript,
  getAudioDuration,
  generateHashtags,
  generateSceneVideos,
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
    fal: user.apiKeys.fal ? decrypt(user.apiKeys.fal) : undefined,
    replicate: user.apiKeys.replicate ? decrypt(user.apiKeys.replicate) : undefined,
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

/**
 * Generate an SRT subtitle file from scene data.
 * SRT is the most widely compatible subtitle format.
 */
function generateSrtSubtitle(
  scenes: Array<{
    sceneText: string;
    startTime: number;
    endTime: number;
    subtitles: Array<{ start: number; end: number; text: string }>;
  }>
): string {
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
  };

  const entries: string[] = [];
  let index = 1;

  for (const scene of scenes) {
    if (scene.subtitles && scene.subtitles.length > 0) {
      // Group words into chunks of ~5 words for readable subtitle lines
      const words = scene.subtitles;
      const chunkSize = 5;

      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize);
        const start = chunk[0].start;
        const end = chunk[chunk.length - 1].end;
        const text = chunk.map((w) => w.text).join(" ");

        entries.push(`${index}\n${formatTime(start)} --> ${formatTime(end)}\n${text}\n`);
        index++;
      }
    } else if (scene.sceneText) {
      // Fallback: show the full scene text for the scene duration
      entries.push(`${index}\n${formatTime(scene.startTime)} --> ${formatTime(scene.endTime)}\n${scene.sceneText}\n`);
      index++;
    }
  }

  return entries.join("\n");
}

async function assembleVideoWithFfmpeg(options: {
  scenes: Array<{
    imagePath: string;
    videoPath?: string;
    duration: number;
    sceneText: string;
    startTime: number;
    endTime: number;
    subtitles: Array<{ start: number; end: number; text: string }>;
  }>;
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
    if (scene.videoPath) {
      await ensureFileExists(scene.videoPath, `Scene AI video`);
    } else {
      await ensureFileExists(scene.imagePath, `Scene image`);
    }
  }

  const { width, height } = getVideoDimensions(aspectRatio);
  const fps = 30;
  const zoomSpeed = 0.0003; // slow gentle zoom per frame

  // --- Build complex filter graph ---
  // Scenes with videoPath use the AI-generated video clip; others use static image + Ken Burns.
  // All clips are scaled to target dimensions, then concatenated with subtitles burned on top.

  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = Math.max(0.5, scene.duration);

    if (scene.videoPath) {
      // AI-generated video clip — scale, loop if shorter than scene, trim to scene duration
      inputArgs.push("-stream_loop", "-1", "-i", scene.videoPath);
      filterParts.push(
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setpts=PTS-STARTPTS,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
      );
    } else {
      // Static image — use zoompan (Ken Burns) effect
      const totalFrames = Math.ceil(dur * fps);
      inputArgs.push("-loop", "1", "-i", scene.imagePath);
      filterParts.push(
        `[${i}:v]zoompan=z='1+${zoomSpeed}*in':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps},setpts=PTS-STARTPTS,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
      );
    }

    concatInputs.push(`[v${i}]`);
  }

  // Audio input (last input index)
  const audioIdx = scenes.length;
  inputArgs.push("-i", voiceoverPath);

  // Concatenate all video segments
  filterParts.push(
    `${concatInputs.join("")}concat=n=${scenes.length}:v=1:a=0[vconcat]`
  );

  // Generate SRT subtitle file
  const srtFilePath = path.join(path.dirname(outputPath), `subs-${uuidv4()}.srt`);
  const srtContent = generateSrtSubtitle(scenes);
  await fs.writeFile(srtFilePath, srtContent, "utf-8");
  console.log(`Subtitle file written to: ${srtFilePath} (${srtContent.split('\n').length} lines)`);

  // Burn subtitles using the subtitles filter
  // On Windows we must escape backslashes and colons for the FFmpeg filter parser
  const srtPathEscaped = toFfmpegPath(srtFilePath).replace(/:/g, "\\:");
  filterParts.push(
    `[vconcat]subtitles='${srtPathEscaped}':force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=-1,Outline=2,Shadow=0,Alignment=2,MarginV=60',format=yuv420p[vout]`
  );

  const filterComplex = filterParts.join(";");

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    `${audioIdx}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-r",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    outputPath,
  ];

  console.log("FFmpeg command args:", args.join(" "));

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
    await fs.unlink(srtFilePath).catch(() => undefined);
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

    try {
      // Get audio duration (ffprobe → file-size estimate → fallback)
      console.log("Getting audio duration...");
      const audioDuration = await getAudioDuration(file.path);
      console.log(`Audio duration: ${audioDuration.toFixed(2)}s`);

      // Save voiceover data
      project.voiceover = {
        filePath: file.path,
        duration: audioDuration,
        uploadedAt: new Date(),
      };

      // Generate subtitles directly from script text (no transcription needed)
      // The audio is TTS-generated from this exact script, so the text is already known.
      const fullScriptText = project.script.scenes.map((s) => s.text).join(" ");
      project.whisperAnalysis = {
        fullTranscript: fullScriptText,
        words: [],
        segments: [],
        analyzedAt: new Date(),
      };

      // Map scenes to timestamps using script text + audio duration
      const sceneTimestamps = generateTimestampsFromScript(
        project.script.scenes,
        audioDuration
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
 * POST /api/projects/:id/scene-videos
 * Generate AI videos for each scene using Fabric 1.0 (fal.ai)
 */
export async function generateSceneVideosEndpoint(req: Request, res: Response) {
  try {
    const id = getRouteParam(req, "id");
    const dbUser = (req as AuthenticatedRequest).dbUser;

    if (!dbUser) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    }

    const { resolution = "480p" } = req.body;

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
      return sendBadRequest(res, "Timeline must exist before generating scene videos");
    }

    // Check all scenes have images
    const missingImages = project.timeline.scenes.filter((s) => !s.imagePath);
    if (missingImages.length > 0) {
      return sendBadRequest(res, `${missingImages.length} scene(s) are missing images`);
    }

    // Get user API keys
    const apiKeys = await getUserApiKeys(dbUser._id.toString());
    const replicateToken = apiKeys?.replicate || process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) {
      return sendBadRequest(res, "Replicate API token is required for AI video generation. Set REPLICATE_API_TOKEN in env or add it in Settings.");
    }

    // Update status to processing
    const previousStatus = project.status;
    project.status = "processing";
    await project.save();

    try {
      const outputDir = path.join(
        process.cwd(),
        "uploads",
        dbUser._id.toString(),
        id,
        "videos"
      );

      const scenesForVideo = project.timeline.scenes
        .filter((s) => s.imagePath)
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          sceneId: s.id,
          imagePath: s.imagePath as string,
          text: s.sceneText || s.sceneDescription || "Describe this scene",
        }));

      console.log(`Generating AI videos for ${scenesForVideo.length} scenes...`);

      const results = await generateSceneVideos(
        scenesForVideo,
        replicateToken,
        outputDir,
        resolution as "480p" | "720p"
      );

      // Update scenes with video paths
      let successCount = 0;
      for (const result of results) {
        const scene = project.timeline.scenes.find((s) => s.id === result.sceneId);
        if (scene && result.success && result.videoPath) {
          scene.videoPath = result.videoPath;
          successCount++;
        }
      }

      const failedCount = results.filter((r) => !r.success).length;

      project.status = successCount > 0 ? "videos-ready" : previousStatus;
      await project.save();

      return sendSuccess(res, {
        message: `AI videos generated: ${successCount} succeeded, ${failedCount} failed`,
        results: results.map((r) => ({
          sceneId: r.sceneId,
          success: r.success,
          error: r.error,
        })),
        timeline: project.timeline,
      });
    } catch (error) {
      project.status = "failed";
      await project.save();
      throw error;
    }
  } catch (error) {
    console.error("Scene video generation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to generate scene videos";
    return sendError(res, errorMessage);
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

    // Ensure subtitles exist on timeline scenes — regenerate from script if missing
    const hasAnySubtitles = project.timeline.scenes.some(
      (s) => s.subtitles && s.subtitles.length > 0
    );
    if (!hasAnySubtitles && project.script?.scenes && project.voiceover?.duration) {
      console.log("Regenerating subtitles from script...");
      const sceneTimestamps = generateTimestampsFromScript(
        project.script.scenes,
        project.voiceover.duration
      );
      for (const st of sceneTimestamps) {
        const scene = project.timeline.scenes.find((s) => s.id === st.sceneId);
        if (scene) {
          scene.subtitles = st.subtitles;
          scene.startTime = st.startTime;
          scene.endTime = st.endTime;
          scene.duration = st.duration;
        }
      }
      await project.save();
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
          videoPath: scene.videoPath || undefined,
          duration:
            typeof scene.duration === "number" && scene.duration > 0
              ? scene.duration
              : Math.max(0.5, scene.endTime - scene.startTime),
          sceneText: scene.sceneText || "",
          startTime: scene.startTime,
          endTime: scene.endTime,
          subtitles: (scene.subtitles || []).map((s) => ({
            start: s.start,
            end: s.end,
            text: s.text,
          })),
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
