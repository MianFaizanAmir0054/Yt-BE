import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface WhisperAnalysisResult {
  fullTranscript: string;
  words: WhisperWord[];
  segments: WhisperSegment[];
}

/**
 * Analyze audio file using OpenAI Whisper API
 */
export async function analyzeWithWhisper(
  audioFilePath: string,
  apiKey: string
): Promise<WhisperAnalysisResult> {
  try {
    // Read the audio file
    const audioBuffer = fs.readFileSync(audioFilePath);
    const fileName = path.basename(audioFilePath);

    // Create form data for the API request
    const formData = new FormData();
    formData.append("file", audioBuffer, {
      filename: fileName,
      contentType: "audio/mpeg",
    });
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "word");
    formData.append("timestamp_granularities[]", "segment");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const data = response.data;

    return {
      fullTranscript: data.text,
      words: data.words || [],
      segments: data.segments || [],
    };
  } catch (error) {
    console.error("Whisper analysis error:", error);
    throw new Error("Failed to analyze audio with Whisper");
  }
}

interface SceneTimestamp {
  sceneId: string;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
  subtitles: Array<{
    id: string;
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Map script scenes to timestamps based on Whisper analysis
 */
export function mapScenesToTimestamps(
  scenes: Array<{ id: string; text: string }>,
  whisperWords: WhisperWord[],
  whisperSegments: WhisperSegment[]
): SceneTimestamp[] {
  const results: SceneTimestamp[] = [];

  if (whisperWords.length === 0) {
    // Fallback to segment-based mapping
    const totalDuration = whisperSegments.length > 0 
      ? whisperSegments[whisperSegments.length - 1].end 
      : 0;
    const durationPerScene = totalDuration / scenes.length;

    scenes.forEach((scene, index) => {
      const startTime = index * durationPerScene;
      const endTime = (index + 1) * durationPerScene;

      // Find relevant segments
      const sceneSegments = whisperSegments.filter(
        (seg) => seg.start >= startTime && seg.start < endTime
      );

      results.push({
        sceneId: scene.id,
        startTime,
        endTime,
        duration: endTime - startTime,
        text: scene.text,
        subtitles: sceneSegments.map((seg, i) => ({
          id: `${scene.id}_sub_${i}`,
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
        })),
      });
    });

    return results;
  }

  // Word-based mapping for more precise timing
  let currentWordIndex = 0;

  for (const scene of scenes) {
    const sceneWords = scene.text.toLowerCase().split(/\s+/).filter(Boolean);
    let startWordIndex = currentWordIndex;
    let matchedWords = 0;

    // Find matching words in the whisper output
    for (let i = currentWordIndex; i < whisperWords.length && matchedWords < sceneWords.length; i++) {
      const whisperWord = whisperWords[i].word.toLowerCase().replace(/[^\w]/g, "");
      const sceneWord = sceneWords[matchedWords]?.replace(/[^\w]/g, "");

      if (whisperWord.includes(sceneWord) || sceneWord?.includes(whisperWord)) {
        if (matchedWords === 0) {
          startWordIndex = i;
        }
        matchedWords++;
      }
    }

    const endWordIndex = Math.min(
      startWordIndex + Math.max(sceneWords.length, matchedWords),
      whisperWords.length - 1
    );

    const startTime = whisperWords[startWordIndex]?.start || 0;
    const endTime = whisperWords[endWordIndex]?.end || startTime + 5;

    // Generate word-by-word subtitles
    const subtitles: SceneTimestamp["subtitles"] = [];
    for (let i = startWordIndex; i <= endWordIndex; i++) {
      if (whisperWords[i]) {
        subtitles.push({
          id: `${scene.id}_sub_${i - startWordIndex}`,
          start: whisperWords[i].start,
          end: whisperWords[i].end,
          text: whisperWords[i].word,
        });
      }
    }

    results.push({
      sceneId: scene.id,
      startTime,
      endTime,
      duration: endTime - startTime,
      text: scene.text,
      subtitles,
    });

    currentWordIndex = endWordIndex + 1;
  }

  return results;
}

/**
 * Get audio duration using ffprobe (if available) or estimate from whisper data
 */
export async function getAudioDuration(
  audioFilePath: string,
  whisperWords?: WhisperWord[],
  whisperSegments?: WhisperSegment[]
): Promise<number> {
  // If we have whisper data, use that
  if (whisperSegments && whisperSegments.length > 0) {
    return whisperSegments[whisperSegments.length - 1].end;
  }

  if (whisperWords && whisperWords.length > 0) {
    return whisperWords[whisperWords.length - 1].end;
  }

  // TODO: Implement ffprobe-based duration detection
  // For now, return a default
  return 60;
}
