import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { config } from "../config/index.js";

// ffmpeg converts and splits lecture recordings and shrinks large images
// before they go to the vision model. FFMPEG_PATH > ffmpeg-static > PATH.
const ffmpegBinary = () => config.media.ffmpegPath || ffmpegStatic || "ffmpeg";

/** Runs ffmpeg; resolves to { stdout: Buffer, stderr: string }. `input` is piped to stdin. */
export function runFfmpeg(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ffmpegBinary(), ["-hide_banner", "-nostdin", ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      reject(new Error(`ffmpeg could not be started (${err.message}). Run npm install in backend/ or set FFMPEG_PATH.`));
      return;
    }
    const out = [];
    let stderr = "";
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    child.on("error", (err) =>
      reject(new Error(`ffmpeg could not be started (${err.code === "ENOENT" ? "not found" : err.message}). Run npm install in backend/ or set FFMPEG_PATH.`))
    );
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr });
      else {
        // Last lines of the log, without server file paths.
        const reason = stderr
          .trim()
          .split("\n")
          .filter(Boolean)
          .slice(-2)
          .join(" ")
          .replace(/(?:[A-Za-z]:)?[\\/][^\s'"]*[\\/][^\s'":]*/g, "<file>")
          .slice(0, 300);
        reject(Object.assign(new Error(`ffmpeg failed: ${reason || `exit code ${code}`}`), { stderr }));
      }
    });
    child.stdin.on("error", () => {}); // ffmpeg may exit before reading all input
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

// ---- Images ----------------------------------------------------------------

export const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_IMAGE_SIDE = 2048;
// Images up to this size go to the model unchanged; bigger ones are re-encoded.
const SEND_AS_IS_BYTES = 1.5 * 1024 * 1024;
const SCALE = `scale='min(${MAX_IMAGE_SIDE},iw)':'min(${MAX_IMAGE_SIDE},ih)':force_original_aspect_ratio=decrease`;

/** An image as a data URL for the vision model; large photos are scaled down to a JPEG. */
export async function imageDataUrl(buffer, ext) {
  const mime = IMAGE_TYPES[ext] ?? "image/png";
  if (buffer.length > SEND_AS_IS_BYTES) {
    try {
      const { stdout } = await runFfmpeg(["-i", "pipe:0", "-vf", SCALE, "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], {
        input: buffer,
      });
      if (stdout.length) return `data:image/jpeg;base64,${stdout.toString("base64")}`;
    } catch (err) {
      if (buffer.length > 15 * 1024 * 1024) throw err;
      // Small enough to send as it is.
    }
  }
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

// pdf.js image kinds: 1 = 1 bit grey (1 = white), 2 = RGB, 3 = RGBA.
const PIXEL_FORMATS = { 1: "monob", 2: "rgb24", 3: "rgba" };

/** Decoded pdf.js image pixels ({ width, height, kind, data }) → JPEG data URL. */
export async function pixelsToDataUrl({ width, height, kind, data }) {
  const format = PIXEL_FORMATS[kind];
  if (!format) throw new Error(`Unsupported image format in PDF (kind ${kind}).`);
  const { stdout } = await runFfmpeg(
    ["-f", "rawvideo", "-pix_fmt", format, "-s", `${width}x${height}`, "-i", "pipe:0", "-vf", `${SCALE},format=yuvj420p`, "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
    { input: Buffer.from(data.buffer, data.byteOffset, data.byteLength) }
  );
  return `data:image/jpeg;base64,${stdout.toString("base64")}`;
}

// ---- Audio -----------------------------------------------------------------

export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".webm", ".ogg"];
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv"];

// Speech compresses well: mono 16 kHz at 32 kbit/s is ~14 MB per hour.
const AUDIO_BITRATE = 32_000;
const MAX_PIECE_SECONDS = 600;

const parseClock = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/**
 * Extracts the audio track of a recording, compresses it and splits it into
 * pieces below `maxBytes`. Resolves to { dir, duration, pieces: [{ file, start }] };
 * the caller removes `dir`.
 */
export async function splitAudio(inputPath, workRoot, maxBytes) {
  const dir = await fs.mkdtemp(path.join(workRoot, "audio-"));
  // Pieces are capped by size (with headroom for the container) and at 10 minutes.
  const seconds = Math.max(30, Math.min(MAX_PIECE_SECONDS, Math.floor(((maxBytes * 8) / AUDIO_BITRATE) * 0.85)));
  try {
    const { stderr } = await runFfmpeg([
      "-i", inputPath,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k",
      "-f", "segment", "-segment_time", String(seconds), "-reset_timestamps", "1",
      "-segment_list", path.join(dir, "pieces.csv"), "-segment_list_type", "csv",
      path.join(dir, "piece%03d.mp3"),
    ]);
    const list = await fs.readFile(path.join(dir, "pieces.csv"), "utf-8").catch(() => "");
    const pieces = list
      .split("\n")
      .map((line) => line.trim().split(","))
      .filter((cols) => cols.length >= 3 && cols[0])
      .map(([file, start, end]) => ({ file: path.join(dir, file), start: Number(start) || 0, end: Number(end) || 0 }));
    if (pieces.length === 0) throw new Error("No audio could be extracted from this file.");
    for (const piece of pieces) {
      const { size } = await fs.stat(piece.file);
      if (size > maxBytes) throw new Error("An audio piece is larger than TRANSCRIBE_MAX_MB; lower it or check the recording.");
    }
    const clock = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const duration = clock ? parseClock(clock[1], clock[2], clock[3]) : pieces[pieces.length - 1].end;
    return { dir, duration, pieces };
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    const log = `${err.message}\n${err.stderr ?? ""}`;
    if (/matches no streams/i.test(log)) throw new Error("This recording has no audio track.");
    if (/Invalid data found|could not find codec|does not contain any stream/i.test(log)) {
      throw new Error("This file has no audio that can be read.");
    }
    throw err;
  }
}

/** "12:34", or "1:02:03" past the hour. */
export function formatTimestamp(totalSeconds) {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
