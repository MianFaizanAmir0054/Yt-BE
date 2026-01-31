import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

interface ImageGenerationResult {
  success: boolean;
  imagePath?: string;
  imageUrl?: string;
  error?: string;
}

interface PexelsPhoto {
  id: number;
  url: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    portrait: string;
  };
  alt: string;
  photographer: string;
}

/**
 * Generate image using Segmind API (Stable Diffusion)
 */
export async function generateWithSegmind(
  prompt: string,
  apiKey: string,
  outputDir: string,
  aspectRatio: "9:16" | "16:9" | "1:1" = "9:16"
): Promise<ImageGenerationResult> {
  try {
    const dimensions = {
      "9:16": { width: 1080, height: 1920 },
      "16:9": { width: 1920, height: 1080 },
      "1:1": { width: 1080, height: 1080 },
    };

    const { width, height } = dimensions[aspectRatio];

    const response = await axios.post(
      "https://api.segmind.com/v1/sdxl1.0-txt2img",
      {
        prompt: prompt,
        negative_prompt:
          "low quality, blurry, distorted, deformed, ugly, bad anatomy, watermark, signature, text",
        style: "base",
        samples: 1,
        scheduler: "UniPC",
        num_inference_steps: 25,
        guidance_scale: 7.5,
        strength: 1,
        seed: Math.floor(Math.random() * 1000000),
        img_width: width,
        img_height: height,
        base64: true,
      },
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 120000, // 2 minute timeout
      }
    );

    if (response.data.image) {
      // Save base64 image to file
      const imageBuffer = Buffer.from(response.data.image, "base64");
      const fileName = `${uuidv4()}.png`;
      const filePath = path.join(outputDir, fileName);

      // Ensure directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(filePath, imageBuffer);

      return {
        success: true,
        imagePath: filePath,
      };
    }

    return {
      success: false,
      error: "No image returned from Segmind",
    };
  } catch (error) {
    console.error("Segmind generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Search for stock photos using Pexels API
 */
export async function searchPexels(
  query: string,
  apiKey: string,
  orientation: "portrait" | "landscape" | "square" = "portrait"
): Promise<PexelsPhoto[]> {
  try {
    const response = await axios.get("https://api.pexels.com/v1/search", {
      params: {
        query,
        per_page: 5,
        orientation,
      },
      headers: {
        Authorization: apiKey,
      },
    });

    return response.data.photos;
  } catch (error) {
    console.error("Pexels search error:", error);
    return [];
  }
}

/**
 * Download image from URL and save to local file
 */
export async function downloadImage(
  url: string,
  outputDir: string
): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    const fileName = `${uuidv4()}.jpg`;
    const filePath = path.join(outputDir, fileName);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(filePath, response.data);

    return filePath;
  } catch (error) {
    console.error("Image download error:", error);
    return null;
  }
}

/**
 * Generate image using Pexels stock photos
 */
export async function generateWithPexels(
  prompt: string,
  apiKey: string,
  outputDir: string,
  aspectRatio: "9:16" | "16:9" | "1:1" = "9:16"
): Promise<ImageGenerationResult> {
  try {
    const orientation =
      aspectRatio === "9:16"
        ? "portrait"
        : aspectRatio === "16:9"
        ? "landscape"
        : "square";

    const photos = await searchPexels(prompt, apiKey, orientation);

    if (photos.length === 0) {
      return {
        success: false,
        error: "No photos found for the given prompt",
      };
    }

    // Use the first result's portrait/large version
    const photo = photos[0];
    const imageUrl =
      aspectRatio === "9:16"
        ? photo.src.portrait || photo.src.large
        : photo.src.large;

    const imagePath = await downloadImage(imageUrl, outputDir);

    if (imagePath) {
      return {
        success: true,
        imagePath,
        imageUrl,
      };
    }

    return {
      success: false,
      error: "Failed to download image",
    };
  } catch (error) {
    console.error("Pexels generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

interface SceneImageRequest {
  sceneId: string;
  prompt: string;
  provider: "segmind" | "pexels";
}

interface SceneImageResult {
  sceneId: string;
  success: boolean;
  imagePath?: string;
  imageSource: "ai-generated" | "stock";
  error?: string;
}

/**
 * Generate images for multiple scenes
 */
export async function generateSceneImages(
  scenes: SceneImageRequest[],
  apiKeys: {
    segmind?: string;
    pexels?: string;
  },
  outputDir: string,
  aspectRatio: "9:16" | "16:9" | "1:1" = "9:16"
): Promise<SceneImageResult[]> {
  const results: SceneImageResult[] = [];

  for (const scene of scenes) {
    let result: ImageGenerationResult;
    let imageSource: "ai-generated" | "stock" = "ai-generated";

    if (scene.provider === "segmind" && apiKeys.segmind) {
      result = await generateWithSegmind(
        scene.prompt,
        apiKeys.segmind,
        outputDir,
        aspectRatio
      );
      imageSource = "ai-generated";
    } else if (apiKeys.pexels) {
      result = await generateWithPexels(
        scene.prompt,
        apiKeys.pexels,
        outputDir,
        aspectRatio
      );
      imageSource = "stock";
    } else {
      results.push({
        sceneId: scene.sceneId,
        success: false,
        imageSource: "stock",
        error: "No API key available for image generation",
      });
      continue;
    }

    results.push({
      sceneId: scene.sceneId,
      success: result.success,
      imagePath: result.imagePath,
      imageSource,
      error: result.error,
    });
  }

  return results;
}
