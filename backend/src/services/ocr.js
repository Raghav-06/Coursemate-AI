import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { config } from "../config/index.js";
import { completeVision } from "./llm.js";
import { imageDataUrl, pixelsToDataUrl } from "./media.js";

// Text from photos of handwritten notes, whiteboards and scanned pages, read
// by the vision model. The transcription stays in the original language (no
// response-language instruction) so it matches what the student wrote.

const OCR_SYSTEM = `You transcribe images of study material (handwritten notes, whiteboards, printed or scanned pages) into plain text.
- Copy the text exactly as written, in its original language. Do not summarise, translate, correct or add commentary.
- Keep the reading order and line breaks; use "- " for bullet points and keep headings on their own line.
- Write formulas in plain text or LaTeX (e.g. F = ma, \\int_0^1 x^2 dx); keep symbols, units and numbers exact.
- Describe diagrams or figures briefly in square brackets, e.g. [Diagram: free-body diagram of a block on an incline].
- Mark words you cannot read as [illegible].
- If the image contains no text, reply with [No text].`;

const NO_TEXT = /^\[?no text\]?\.?$/i;

function cleanTranscript(text) {
  const t = String(text ?? "")
    .replace(/^```[a-z]*\n?|```$/gim, "")
    .trim();
  return NO_TEXT.test(t) ? "" : t;
}

/** Text in an image file (.png .jpg .jpeg .webp). */
export async function ocrImageFile(filePath) {
  const url = await imageDataUrl(await fs.readFile(filePath), path.extname(filePath).toLowerCase());
  const text = cleanTranscript(await completeVision(OCR_SYSTEM, "Transcribe all the text in this image.", [url]));
  if (!text) throw new Error("No text could be read from this image.");
  return text;
}

// ---- Scanned PDFs ----------------------------------------------------------

// pdf-parse's bundled pdf.js decodes page images to raw pixels in plain
// Node (no canvas needed); ffmpeg turns them into JPEGs for the model.
const require = createRequire(import.meta.url);
let pdfjs;
function getPdfjs() {
  if (!pdfjs) {
    pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
    pdfjs.disableWorker = true;
  }
  return pdfjs;
}

// A page needs OCR when its text layer is (almost) empty.
const MIN_PAGE_CHARS = 40;
const MIN_IMAGE_SIDE = 300;
export const pageNeedsOcr = (text) => String(text ?? "").replace(/\s+/g, "").length < MIN_PAGE_CHARS;

// The largest image painted on a page (a scan is one full-page image).
async function largestPageImage(page, OPS) {
  const ops = await page.getOperatorList();
  let best = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    let img = null;
    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      try {
        img = page.objs.get(ops.argsArray[i][0]);
      } catch {
        img = null;
      }
    } else if (fn === OPS.paintInlineImageXObject) {
      img = ops.argsArray[i][0];
    }
    if (img?.data && img.width * img.height > (best ? best.width * best.height : 0)) best = img;
  }
  return best && Math.min(best.width, best.height) >= MIN_IMAGE_SIDE ? best : null;
}

/**
 * Fills in the text of scanned pages: for each page whose text layer is
 * empty, the page's scan is read by the vision model. `pages` are the text
 * layers (one per page); returns the completed list and how many pages were
 * read. `onPage(done, total)` reports progress.
 */
export async function ocrScannedPages(buffer, pages, { onPage } = {}) {
  const wanted = pages.map((text, i) => (pageNeedsOcr(text) ? i : -1)).filter((i) => i >= 0);
  if (wanted.length === 0) return { pages, read: 0 };
  const limit = config.ai.vision.maxPages;
  const todo = wanted.slice(0, limit);

  const { getDocument, OPS } = getPdfjs();
  const doc = await getDocument({ data: new Uint8Array(buffer), nativeImageDecoderSupport: "none" });
  const result = [...pages];
  let read = 0;
  try {
    for (const [n, index] of todo.entries()) {
      onPage?.(n, todo.length);
      const page = await doc.getPage(index + 1);
      const image = await largestPageImage(page, OPS);
      page.cleanup();
      if (!image) continue;
      const url = await pixelsToDataUrl(image);
      const text = cleanTranscript(await completeVision(OCR_SYSTEM, `Transcribe all the text on this scanned page (page ${index + 1}).`, [url]));
      if (text) {
        result[index] = text;
        read++;
      }
    }
  } finally {
    doc.destroy();
  }
  if (wanted.length > limit) console.warn(`OCR: read ${limit} of ${wanted.length} scanned pages (VISION_MAX_PAGES).`);
  return { pages: result, read, skipped: Math.max(0, wanted.length - limit) };
}
