import Replicate from "replicate";
import axios from "axios";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

interface GenerateSceneVideoResult {
  sceneId: string;
  videoPath: string;
  success: boolean;
  error?: string;
}

/**
 * Generate a single scene video using Replicate's minimax/video-01 (Hailuo).
 * Supports image-to-video via first_frame_image, or text-only.
 */
async function generateSingleSceneVideo(
  replicate: InstanceType<typeof Replicate>,
  imagePath: string,
  prompt: string
): Promise<string> {
  console.log(`[Replicate] Running minimax/video-01 with image: ${path.basename(imagePath)}`);

  // Read the image file and create a File object for Replicate upload
  const imageBuffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const contentType = mimeMap[ext] || "image/jpeg";
  const file = new File([imageBuffer], path.basename(imagePath), { type: contentType });

  // Run the model — output is a direct video URL string
  const output = await replicate.run("minimax/video-01", {
    input: {
      prompt: prompt,
      prompt_optimizer: true,
      first_frame_image: file,
    },
  });

  // Output is a URL string (or a ReadableStream for some models)
  let videoUrl: string;

  if (typeof output === "string") {
    videoUrl = output;
  } else if (output && typeof output === "object" && "url" in (output as any)) {
    videoUrl = (output as any).url();
  } else {
    // Could be a ReadableStream — try toString
    videoUrl = String(output);
  }

  if (!videoUrl || !videoUrl.startsWith("http")) {
    throw new Error(`Replicate did not return a valid video URL. Got: ${JSON.stringify(output)}`);
  }

  console.log(`[Replicate] Video generated: ${videoUrl}`);
  return videoUrl;
}

/**
 * Download a video from URL to local path
 */
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  await fs.writeFile(outputPath, Buffer.from(response.data));
}

/**
 * Generate AI videos for all scenes in a project.
 * Uses Replicate's minimax/video-01 (Hailuo) — image-to-video with prompt.
 * Generates 6s video clips at 720p/25fps.
 */
export async function generateSceneVideos(
  scenes: Array<{
    sceneId: string;
    imagePath: string; // local file path
    text: string;
  }>,
  replicateApiToken: string | undefined,
  outputDir: string,
  _resolution: "480p" | "720p" = "720p" // minimax always outputs 720p
): Promise<GenerateSceneVideoResult[]> {
  const token = replicateApiToken || process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Replicate API token is required. Set REPLICATE_API_TOKEN in .env or add it in Settings."
    );
  }

  const replicate = new Replicate({ auth: token });

  await fs.mkdir(outputDir, { recursive: true });

  const results: GenerateSceneVideoResult[] = [];

  for (const scene of scenes) {
    try {
      console.log(`[Video] Generating AI video for scene ${scene.sceneId}...`);

      // Verify image exists
      await fs.stat(scene.imagePath);

      // Generate video via Replicate minimax/video-01
      const videoUrl = await generateSingleSceneVideo(
        replicate,
        scene.imagePath,
        scene.text
      );

      // Download to local file
      const videoFilename = `scene-video-${scene.sceneId}-${uuidv4()}.mp4`;
      const videoPath = path.join(outputDir, videoFilename);
      await downloadVideo(videoUrl, videoPath);

      console.log(`[Video] Scene ${scene.sceneId} video saved: ${videoPath}`);

      results.push({
        sceneId: scene.sceneId,
        videoPath,
        success: true,
      });
    } catch (error: any) {
      let errorMsg = "Unknown error";
      if (error?.response?.data) {
        const d = error.response.data;
        errorMsg = `HTTP ${error.response.status}: ${typeof d === "string" ? d : JSON.stringify(d)}`;
      } else if (error instanceof Error) {
        errorMsg = error.message;
      }
      console.error(`[Video] Failed to generate video for scene ${scene.sceneId}:`, errorMsg);
      results.push({
        sceneId: scene.sceneId,
        videoPath: "",
        success: false,
        error: errorMsg,
      });
    }
  }

  return results;
}
