import axios from "axios";

interface ScriptScene {
  id: string;
  text: string;
  visualDescription: string;
}

interface GeneratedScript {
  fullText: string;
  scenes: ScriptScene[];
}

interface ScriptGenerationOptions {
  topic: string;
  researchSummary: string;
  duration: "30s" | "60s" | "90s" | "120s";
  tone: "educational" | "inspirational" | "dramatic" | "casual";
  provider: "openai" | "anthropic";
  apiKey: string;
}

const SCRIPT_GENERATION_PROMPT = `You are an expert video script writer specializing in short-form content for social media reels.

Based on the research provided, create an engaging video script that:
1. Hooks the viewer in the first 3 seconds
2. Presents information in a clear, engaging narrative
3. Uses emotional storytelling techniques
4. Ends with a memorable conclusion or call-to-action

IMPORTANT FORMATTING RULES:
- Divide the script into SCENES using [SCENE: description] markers
- Each scene represents a visual change in the video
- Each scene should be 5-15 seconds of narration
- Include visual descriptions for each scene
- Total duration should be approximately {duration}
- Tone should be {tone}

OUTPUT FORMAT:
Return the script in this exact JSON format:
{
  "fullText": "The complete script text without scene markers",
  "scenes": [
    {
      "id": "scene_1",
      "text": "The narration text for this scene",
      "visualDescription": "Description of what should be shown visually"
    }
  ]
}

TOPIC: {topic}

RESEARCH SUMMARY:
{researchSummary}`;

/**
 * Generate a video script
 */
export async function generateScript(
  options: ScriptGenerationOptions
): Promise<GeneratedScript> {
  const { topic, researchSummary, duration, tone, provider, apiKey } = options;

  const prompt = SCRIPT_GENERATION_PROMPT
    .replace("{duration}", duration)
    .replace("{tone}", tone)
    .replace("{topic}", topic)
    .replace("{researchSummary}", researchSummary);

  let responseText: string;

  try {
    if (provider === "openai") {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system",
              content: "You are a professional video script writer. Always respond with valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 2000,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      responseText = response.data.choices[0].message.content;
    } else {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
        }
      );
      responseText = response.data.content[0].text;
    }

    // Parse the JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and ensure scene IDs
    const scenes = parsed.scenes.map(
      (scene: Partial<ScriptScene>, index: number) => ({
        id: scene.id || `scene_${index + 1}`,
        text: scene.text || "",
        visualDescription: scene.visualDescription || "",
      })
    );

    return {
      fullText: parsed.fullText || scenes.map((s: ScriptScene) => s.text).join(" "),
      scenes,
    };
  } catch (error) {
    console.error("Script generation error:", error);
    throw new Error("Failed to generate script");
  }
}

/**
 * Generate image prompts for scenes
 */
export async function generateImagePrompts(
  scenes: Array<{ id: string; text: string; visualDescription: string }>,
  styleGuide: string,
  provider: "openai" | "anthropic",
  apiKey: string
): Promise<Array<{ sceneId: string; prompt: string }>> {
  const prompt = `Generate detailed image prompts for the following video scenes. 
Each prompt should be optimized for AI image generation (SDXL or similar).

Style Guide: ${styleGuide || "Cinematic, high quality, professional"}

Scenes:
${scenes.map((s) => `Scene ${s.id}: "${s.text}" - Visual: ${s.visualDescription}`).join("\n")}

Return a JSON array with prompts for each scene:
[
  {"sceneId": "scene_1", "prompt": "detailed image generation prompt..."}
]`;

  try {
    let responseText: string;

    if (provider === "openai") {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system",
              content: "You are an expert at creating AI image generation prompts. Always respond with valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      responseText = response.data.choices[0].message.content;
    } else {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
        }
      );
      responseText = response.data.content[0].text;
    }

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("No JSON array found in response");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Image prompt generation error:", error);
    // Return default prompts if generation fails
    return scenes.map((scene) => ({
      sceneId: scene.id,
      prompt: `${scene.visualDescription}, cinematic, high quality, professional`,
    }));
  }
}

/**
 * Generate hashtags for the video
 */
export async function generateHashtags(
  topic: string,
  script: string,
  provider: "openai" | "anthropic",
  apiKey: string
): Promise<string[]> {
  const prompt = `Generate 15-20 relevant hashtags for a social media reel about:
Topic: ${topic}
Script excerpt: ${script.substring(0, 500)}...

Return only a JSON array of hashtags (without the # symbol):
["hashtag1", "hashtag2"]`;

  try {
    let responseText: string;

    if (provider === "openai") {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo-preview",
          messages: [
            { role: "system", content: "You are a social media expert. Respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      responseText = response.data.choices[0].message.content;
    } else {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
        }
      );
      responseText = response.data.content[0].text;
    }

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return [];
  } catch (error) {
    console.error("Hashtag generation error:", error);
    return [];
  }
}
