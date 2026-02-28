import axios from "axios";
import fs from "fs";
import path from "path";

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
 * Analyze audio file using AssemblyAI API
 */
export async function analyzeWithAssemblyAI(
  audioFilePath: string,
  apiKey: string
): Promise<WhisperAnalysisResult> {
  try {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    // Step 1: Upload audio to AssemblyAI
    const uploadResponse = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      fs.createReadStream(audioFilePath),
      {
        headers: {
          authorization: apiKey,
          "content-type": "application/octet-stream",
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const audioUrl = uploadResponse.data?.upload_url;
    if (!audioUrl) {
      throw new Error("Failed to upload audio to AssemblyAI");
    }

    // Step 2: Request transcript with word timestamps
    const transcriptResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
        speech_models: ["universal-2"],
        punctuate: true,
        format_text: true,
      },
      {
        headers: {
          authorization: apiKey,
          "content-type": "application/json",
        },
      }
    );

    const transcriptId = transcriptResponse.data?.id;
    if (!transcriptId) {
      throw new Error("Failed to start AssemblyAI transcription");
    }

    // Step 3: Poll transcript status
    const maxAttempts = 120;
    const pollIntervalMs = 2000;

    let completedTranscript: {
      status?: string;
      error?: string;
      text?: string;
      words?: Array<{ text: string; start: number; end: number }>;
    } | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pollResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            authorization: apiKey,
          },
        }
      );

      const data = pollResponse.data as {
        status?: string;
        error?: string;
        text?: string;
        words?: Array<{ text: string; start: number; end: number }>;
      };

      if (data.status === "completed") {
        completedTranscript = data;
        break;
      }

      if (data.status === "error") {
        throw new Error(data.error || "AssemblyAI transcription failed");
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    if (!completedTranscript) {
      throw new Error("AssemblyAI transcription timed out");
    }

    const words = (completedTranscript.words || []).map((word, index) => ({
      word: word.text,
      start: Number(word.start) / 1000,
      end: Number(word.end) / 1000,
    }));

    return {
      fullTranscript: completedTranscript.text || "",
      words,
      segments: [],
    };
  } catch (error) {
    console.error("AssemblyAI analysis error:", error);

    if (axios.isAxiosError(error)) {
      const apiError = error.response?.data as { error?: string } | undefined;
      throw new Error(apiError?.error || "Failed to analyze audio with AssemblyAI");
    }

    throw new Error("Failed to analyze audio with AssemblyAI");
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
