import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { formatTimestamp, splitAudio } from "./media.js";
import { currentAiContext } from "./aiContext.js";
import { logAiCall } from "../db/aiCalls.js";

// Lecture recordings → timestamped transcript. ffmpeg extracts and
// compresses the audio and splits it below the provider's upload limit; each
// piece goes to an OpenAI-compatible /audio/transcriptions endpoint with
// verbose_json so segments carry timestamps. (LangChain has no generic
// speech-to-text model, so this is a plain HTTP call.)

const REQUEST_TIMEOUT_MS = 10 * 60_000;
// Transcript paragraphs: consecutive segments merged until about this long,
// each labelled with its start time ("12:34") for citations.
const PARAGRAPH_SECONDS = 45;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function explain(status, detail) {
  const { baseUrl, model } = config.ai.transcribe;
  const hint =
    status === 401 || status === 403
      ? " Check TRANSCRIBE_API_KEY."
      : status === 404 || status === 400 || status === 422
        ? ` Is "${model}" a speech-to-text model served at ${baseUrl}? Set TRANSCRIBE_PROVIDER (or TRANSCRIBE_BASE_URL) and TRANSCRIBE_MODEL (e.g. OpenAI whisper-1 or Groq whisper-large-v3-turbo).`
        : status === 413
          ? " The audio piece was too large for the provider; lower TRANSCRIBE_MAX_MB."
          : status === 402 || status === 429
            ? " The provider rejected the request for quota, credits or rate limits."
            : "";
  return httpError(502, `Transcription failed${status ? ` (${status})` : ""}: ${String(detail).slice(0, 300)}${hint}`);
}

// Each piece is one logged AI call (tier "transcribe").
async function transcribePiece(file) {
  const context = currentAiContext();
  const started = Date.now();
  let failure = null;
  try {
    return await requestPiece(file);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    const status = failure?.message?.match(/\((\d{3})\)/)?.[1];
    logAiCall({
      tier: "transcribe",
      model: config.ai.transcribe.model,
      task: "transcribe",
      userId: context.userId,
      notebookId: context.notebookId,
      latencyMs: Date.now() - started,
      ok: !failure,
      errorCode: failure ? status ?? (failure.status === 503 ? "missing_key" : "error") : null,
    });
  }
}

async function requestPiece(file) {
  const { baseUrl, apiKey, model } = config.ai.transcribe;
  if (!apiKey) throw httpError(503, "Transcribing recordings needs TRANSCRIBE_API_KEY (or AI_API_KEY) in backend/.env.");

  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([await fs.readFile(file)], { type: "audio/mpeg" }), path.basename(file));
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    let response;
    try {
      response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < 2) continue;
      throw explain(null, err.name === "TimeoutError" ? "the request timed out" : `could not reach ${baseUrl} (${err.cause?.code ?? err.message})`);
    }
    const body = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(body);
      } catch {
        // Some servers ignore response_format and return plain text.
        return { text: body };
      }
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    let detail = body;
    try {
      detail = JSON.parse(body).error?.message ?? body;
    } catch {
      // not JSON
    }
    throw explain(response.status, detail);
  }
}

/** Timed segments from one piece's response, shifted by the piece's start time. */
export function segmentsFrom(result, offset, pieceEnd) {
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  const timed = segments
    .map((s) => ({ start: offset + (Number(s.start) || 0), text: String(s.text ?? "").trim() }))
    .filter((s) => s.text);
  if (timed.length) return timed;
  const text = String(result?.text ?? "").trim();
  return text ? [{ start: offset, text, end: pieceEnd }] : [];
}

/** Groups timed segments into paragraphs labelled with their start time. */
export function transcriptSegments(timed) {
  const paragraphs = [];
  let current = null;
  for (const s of timed) {
    if (!current || s.start - current.start >= PARAGRAPH_SECONDS) {
      current = { start: s.start, parts: [] };
      paragraphs.push(current);
    }
    current.parts.push(s.text);
  }
  return paragraphs.map((p) => ({ label: formatTimestamp(p.start), text: p.parts.join(" ") }));
}

/**
 * Transcribes an audio or video file. Resolves to { segments: [{ label, text }] }
 * (labels are timestamps). `onProgress(fraction, note)` reports progress.
 */
export async function transcribeFile(filePath, { onProgress } = {}) {
  const maxBytes = Math.floor(config.ai.transcribe.maxMb * 1024 * 1024);
  onProgress?.(0, "Extracting audio…");
  const { dir, pieces, duration } = await splitAudio(filePath, config.paths.uploadDir, maxBytes);
  try {
    const timed = [];
    for (const [i, piece] of pieces.entries()) {
      onProgress?.(
        (i + 0.1) / pieces.length,
        pieces.length > 1 ? `Transcribing part ${i + 1} of ${pieces.length} (${formatTimestamp(duration)} of audio)…` : "Transcribing…"
      );
      timed.push(...segmentsFrom(await transcribePiece(piece.file), piece.start, piece.end));
    }
    if (timed.length === 0) throw new Error("No speech was found in this recording.");
    return { segments: transcriptSegments(timed) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
