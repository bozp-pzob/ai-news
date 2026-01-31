/**
 * Transcription Script for Video Recordings
 *
 * Extracts audio from video files and generates timestamped transcripts
 * using Google Gemini via OpenRouter. Outputs aligned JSON format with
 * word-level timestamps, compatible with Remotion and the-council format.
 *
 * Usage:
 *   npm run transcribe -- <video.mp4>
 *   npm run transcribe -- --video=episode.mp4 --output=transcript.json
 *   npm run transcribe -- episodes/*.mp4
 *
 * Output: {basename}_aligned.json with segments containing word-level timestamps
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as dotenv from "dotenv";
import { logger } from "../src/helpers/cliHelper";

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

// ============================================================================
// Types - Aligned JSON Format (matches the-council)
// ============================================================================

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker_id: string;
  speaker_name: string;
  scene: number;
  words: Word[];
}

interface AlignedTranscript {
  segments: Segment[];
  metadata?: {
    source: string;
    model: string;
    duration_seconds?: number;
    generated_at: string;
  };
}

interface GeminiWord {
  word: string;
  start: number;
  end: number;
}

interface GeminiSegment {
  start: number;
  end: number;
  text: string;
  speaker_id: string;
  speaker_name: string;
  words: GeminiWord[];
}

interface GeminiResponse {
  segments: GeminiSegment[];
}

interface CliArgs {
  videos: string[];
  output?: string;
  model?: string;
  dryRun?: boolean;
  keepAudio?: boolean;
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): CliArgs {
  const args: CliArgs = { videos: [] };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--keep-audio") {
      args.keepAudio = true;
    } else if (arg.startsWith("--video=")) {
      args.videos.push(arg.split("=")[1]);
    } else if (arg.startsWith("--output=")) {
      args.output = arg.split("=")[1];
    } else if (arg.startsWith("--model=")) {
      args.model = arg.split("=")[1];
    } else if (arg === "-o") {
      args.output = process.argv[++i];
    } else if (!arg.startsWith("-")) {
      // Positional argument - treat as video file
      args.videos.push(arg);
    }
  }

  return args;
}

// ============================================================================
// Audio Extraction
// ============================================================================

function getAudioDuration(audioPath: string): number {
  try {
    const result = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { encoding: "utf-8" }
    );
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

function extractAudio(videoPath: string, outputPath: string): string {
  logger.info(`Extracting audio from ${path.basename(videoPath)}...`);

  // Try encoders in order of preference: MP3 > AAC > WAV (fallback)
  const encoders = [
    { ext: ".mp3", cmd: (i: string, o: string) => `ffmpeg -y -i "${i}" -vn -acodec libmp3lame -q:a 4 "${o}"`, format: "mp3" },
    { ext: ".m4a", cmd: (i: string, o: string) => `ffmpeg -y -i "${i}" -vn -acodec aac -b:a 128k "${o}"`, format: "m4a" },
    { ext: ".wav", cmd: (i: string, o: string) => `ffmpeg -y -i "${i}" -vn -acodec pcm_s16le -ar 16000 "${o}"`, format: "wav" },
  ];

  for (const encoder of encoders) {
    const actualOutput = outputPath.replace(/\.[^.]+$/, encoder.ext);
    try {
      execSync(encoder.cmd(videoPath, actualOutput), { stdio: "pipe" });
      logger.success(`Audio extracted to ${path.basename(actualOutput)} (${encoder.format})`);
      return actualOutput;
    } catch (error: any) {
      const isEncoderMissing = error.message.includes("Encoder not found") ||
        error.message.includes("Unknown encoder");
      if (!isEncoderMissing) {
        throw new Error(`Failed to extract audio: ${error.message}`);
      }
      logger.info(`${encoder.format.toUpperCase()} encoder not available, trying next...`);
    }
  }

  throw new Error("No suitable audio encoder found. Please install ffmpeg with MP3 or AAC support.");
}

// ============================================================================
// API Communication
// ============================================================================

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY or OPENAI_API_KEY environment variable is required"
    );
  }
  return key;
}

function getAudioFormat(audioPath: string): string {
  const ext = path.extname(audioPath).toLowerCase().slice(1);
  const formatMap: Record<string, string> = {
    mp3: "mp3",
    m4a: "m4a",
    aac: "aac",
    wav: "wav",
    ogg: "ogg",
    flac: "flac",
  };
  return formatMap[ext] || ext;
}

async function transcribeWithGemini(
  audioPath: string,
  model: string
): Promise<GeminiResponse> {
  const apiKey = getApiKey();

  // Read and base64 encode the audio
  logger.info("Encoding audio for API...");
  const audioBuffer = fs.readFileSync(audioPath);
  const base64Audio = audioBuffer.toString("base64");
  const audioSizeMB = (audioBuffer.length / (1024 * 1024)).toFixed(2);
  logger.info(`Audio size: ${audioSizeMB} MB`);

  const systemPrompt = `Transcribe the audio I'm providing. Return ONLY a JSON object with this structure:

{"segments":[{"start":NUMBER,"end":NUMBER,"text":"TRANSCRIBED_TEXT","speaker_id":"STRING","speaker_name":"STRING","words":[{"word":"STRING","start":NUMBER,"end":NUMBER}]}]}

Requirements:
- Transcribe ALL speech from the audio file completely
- "start" and "end" are timestamps in seconds (decimals like 16.5)
- "words" array must contain EVERY word with its own start/end timestamps
- "speaker_id": lowercase identifier (speaker1, speaker2, host, guest)
- "speaker_name": display name (Speaker 1, Host, Guest)
- Break speech into sentence/phrase segments
- Include punctuation attached to words
- Create new segment for each speaker change

DO NOT return example text. Transcribe the ACTUAL audio content.`;

  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: systemPrompt },
          {
            type: "input_audio",
            input_audio: {
              data: base64Audio,
              format: getAudioFormat(audioPath),
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 64000,
  };

  logger.info(`Sending to ${model} via OpenRouter...`);

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/M3-org/ai-news",
      "X-Title": "AI News Transcription",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  if (!result.choices?.[0]?.message?.content) {
    throw new Error("No content in API response");
  }

  const content = result.choices[0].message.content;

  // Parse JSON from response (may have markdown code blocks)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not extract JSON from response");
  }

  return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// Output Generation
// ============================================================================

function convertToAlignedFormat(
  geminiResponse: GeminiResponse,
  sourcePath: string,
  model: string,
  durationSeconds?: number
): AlignedTranscript {
  // Add scene numbers (default to 1, could be enhanced later with scene detection)
  const segments: Segment[] = geminiResponse.segments.map((seg, index) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
    speaker_id: seg.speaker_id || `speaker${index + 1}`,
    speaker_name: seg.speaker_name || `Speaker ${index + 1}`,
    scene: 1, // Default scene, can be enhanced with scene detection
    words: seg.words || [],
  }));

  return {
    segments,
    metadata: {
      source: path.basename(sourcePath),
      model,
      duration_seconds: durationSeconds,
      generated_at: new Date().toISOString(),
    },
  };
}

function getOutputPath(videoPath: string, customOutput?: string): string {
  if (customOutput) {
    return customOutput;
  }

  const dir = path.dirname(videoPath);
  const basename = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${basename}_aligned.json`);
}

// ============================================================================
// Main Processing
// ============================================================================

async function processVideo(
  videoPath: string,
  args: CliArgs
): Promise<AlignedTranscript> {
  const absolutePath = path.resolve(videoPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const model = args.model || DEFAULT_MODEL;
  const outputPath = getOutputPath(absolutePath, args.output);

  // Create temp audio file path (actual extension will be determined by extractAudio)
  const tempDir = path.dirname(absolutePath);
  const baseAudioPath = path.join(
    tempDir,
    `${path.basename(absolutePath, path.extname(absolutePath))}_temp.mp3`
  );

  let actualAudioPath: string | null = null;

  try {
    // Step 1: Extract audio (returns actual path with correct extension)
    actualAudioPath = extractAudio(absolutePath, baseAudioPath);

    // Get audio duration
    const durationSeconds = getAudioDuration(actualAudioPath);
    if (durationSeconds > 0) {
      const durationMin = (durationSeconds / 60).toFixed(1);
      logger.info(`Audio duration: ${durationMin} minutes`);
    }

    if (args.dryRun) {
      logger.info(`[DRY RUN] Would transcribe ${path.basename(absolutePath)}`);
      logger.info(`[DRY RUN] Output would be: ${outputPath}`);
      return {
        segments: [],
        metadata: {
          source: path.basename(absolutePath),
          model,
          duration_seconds: durationSeconds,
          generated_at: new Date().toISOString(),
        },
      };
    }

    // Step 2: Transcribe with Gemini
    const geminiResponse = await transcribeWithGemini(actualAudioPath, model);

    // Step 3: Convert to aligned format
    const output = convertToAlignedFormat(
      geminiResponse,
      absolutePath,
      model,
      durationSeconds
    );

    // Step 4: Write output
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    logger.success(`Transcript written to ${outputPath}`);

    // Count words
    const totalWords = output.segments.reduce((sum, seg) => sum + seg.words.length, 0);
    logger.info(`  - ${output.segments.length} segments, ${totalWords} words`);

    return output;
  } finally {
    // Cleanup temp audio file
    if (!args.keepAudio && actualAudioPath && fs.existsSync(actualAudioPath)) {
      fs.unlinkSync(actualAudioPath);
      logger.info("Cleaned up temporary audio file");
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.videos.length === 0) {
    printHelp();
    process.exit(1);
  }

  logger.info("=== Video Transcription ===");
  logger.info(`Videos to process: ${args.videos.length}`);

  for (const video of args.videos) {
    logger.info(`\nProcessing: ${video}`);
    try {
      await processVideo(video, args);
    } catch (error: any) {
      logger.error(`Failed to process ${video}: ${error.message}`);
    }
  }

  logger.success("\n=== Done ===");
}

function printHelp(): void {
  console.log(`
Video Transcription CLI

Extracts audio from video files and generates timestamped transcripts
using Google Gemini via OpenRouter. Outputs aligned JSON format with
word-level timestamps, compatible with Remotion and the-council format.

Usage:
  npm run transcribe -- <video.mp4> [options]
  npm run transcribe -- episodes/*.mp4

Options:
  --video=<path>      Video file to transcribe (can use multiple times)
  -o, --output=<path> Custom output path (only for single video)
  --model=<model>     Model to use (default: google/gemini-2.5-flash)
  --keep-audio        Keep extracted audio file after processing
  --dry-run           Preview without making API calls

Examples:
  npm run transcribe -- episode.mp4
  npm run transcribe -- --video=ep1.mp4 --video=ep2.mp4
  npm run transcribe -- episode.mp4 -o custom_aligned.json
  npm run transcribe -- episodes/*.mp4 --dry-run

Output Format (aligned JSON with word-level timestamps):
  {
    "segments": [
      {
        "start": 16.5,
        "end": 22.0,
        "text": "Welcome to the show everyone",
        "speaker_id": "host",
        "speaker_name": "Host",
        "scene": 1,
        "words": [
          { "word": "Welcome", "start": 16.5, "end": 16.9 },
          { "word": "to", "start": 16.9, "end": 17.1 },
          { "word": "the", "start": 17.1, "end": 17.3 },
          { "word": "show", "start": 17.3, "end": 17.7 },
          { "word": "everyone", "start": 17.7, "end": 18.2 }
        ]
      }
    ],
    "metadata": {
      "source": "video.mp4",
      "model": "google/gemini-2.5-flash",
      "duration_seconds": 600.0,
      "generated_at": "2026-01-31T12:00:00.000Z"
    }
  }

Environment Variables:
  OPENROUTER_API_KEY  API key for OpenRouter (required)
  OPENAI_API_KEY      Fallback API key if OPENROUTER_API_KEY not set
`);
}

main().catch((err) => {
  logger.error(`Error: ${err.message}`);
  process.exit(1);
});
