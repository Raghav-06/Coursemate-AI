import fs from "node:fs/promises";
import path from "node:path";
// Import the library entry directly: the package root runs a debug harness
// that tries to read a bundled test PDF when loaded as an ES module.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import AdmZip from "adm-zip";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { config } from "../config/index.js";

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".txt", ".md", ".csv"];

// pdf-parse's default page renderer, but collecting each page's text
// separately so citations can name the page.
function pageRenderer(pages) {
  return async (pageData) => {
    const { items } = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let lastY;
    let text = "";
    for (const item of items) {
      text += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
      lastY = item.transform[5];
    }
    pages.push(text);
    return text;
  };
}

/** Text of each page of a PDF, in order. */
export async function extractPdfPages(buffer) {
  const pages = [];
  await pdfParse(buffer, { pagerender: pageRenderer(pages) });
  return pages;
}

export async function extractPdfBuffer(buffer) {
  return (await extractPdfPages(buffer)).join("\n\n");
}

/** A PDF as labelled page segments ("p. 3"). */
export async function pdfSegments(buffer) {
  return (await extractPdfPages(buffer)).map((text, i) => ({ label: `p. ${i + 1}`, text }));
}

async function extractDocx(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// .pptx is a zip of slideN.xml files; pull the text runs out of each slide,
// keeping one line per paragraph and a heading per slide.
async function pptxSegments(filePath) {
  const zip = new AdmZip(filePath);
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  return slideEntries.map((entry, i) => {
    const xml = entry.getData().toString("utf-8");
    const paragraphs = xml
      .split("</a:p>")
      .map((p) => [...p.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1])).join(""))
      .filter((p) => p.trim());
    return { label: `Slide ${i + 1}`, text: `Slide ${i + 1}\n${paragraphs.join("\n")}` };
  });
}

/**
 * Pulls the text out of an uploaded file (PDF, DOCX, PPTX, TXT, MD, CSV).
 * Returns { text } or, for paged formats, { segments: [{ label, text }] } so
 * citations can say "p. 12" or "Slide 4".
 */
export async function extractDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return { segments: await pdfSegments(await fs.readFile(filePath)) };
    case ".docx":
      return { text: await extractDocx(filePath) };
    case ".pptx":
      return { segments: await pptxSegments(filePath) };
    case ".txt":
    case ".md":
    case ".csv":
      return { text: await fs.readFile(filePath, "utf-8") };
    default:
      throw new Error(`Unsupported file type "${ext}"`);
  }
}

/** Plain text of an uploaded file. */
export async function extractText(filePath) {
  const doc = await extractDocument(filePath);
  return doc.segments ? doc.segments.map((s) => s.text).join("\n\n") : doc.text;
}

/**
 * Slide segments recovered from text extracted before locations existed
 * (every slide started with a "Slide N" line). Null if there are none.
 */
export function slideSegmentsFromText(text) {
  const parts = text.split(/^(?=Slide \d+\n)/m).filter((part) => /^Slide \d+\n/.test(part));
  if (parts.length === 0) return null;
  return parts.map((part) => ({ label: part.slice(0, part.indexOf("\n")).trim(), text: part }));
}

// Collapses the whitespace noise PDF extraction leaves behind while keeping
// paragraph breaks, so both chunks and the source viewer read cleanly.
export function normalizeText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Joins labelled segments (pages, slides…) into one normalised text and
 * records where each starts and ends: [{ label, start, end }]. The text is
 * already normalised, so normalizeText leaves the offsets valid.
 */
export function assembleSegments(segments) {
  let text = "";
  const locations = [];
  for (const segment of segments) {
    const part = normalizeText(segment.text ?? "");
    if (!part) continue;
    if (text) text += "\n\n";
    locations.push({ label: segment.label, start: text.length, end: text.length + part.length });
    text += part;
  }
  return { text, locations };
}

// "p. 12" + "p. 13" → "pp. 12–13"; "Slide 4" + "Slide 6" → "Slides 4–6";
// anything else (e.g. timestamps) keeps the first label.
function rangeLabel(first, last) {
  if (first === last) return first;
  const page = /^p\. (\d+)$/;
  const slide = /^Slide (\d+)$/;
  if (page.test(first) && page.test(last)) return `pp. ${first.match(page)[1]}–${last.match(page)[1]}`;
  if (slide.test(first) && slide.test(last)) return `Slides ${first.match(slide)[1]}–${last.match(slide)[1]}`;
  return first;
}

/** Label for the text between start and end, e.g. "p. 12" or "pp. 12–13" (null when unknown). */
export function locationFor(locations, start, end) {
  if (!locations?.length || start == null) return null;
  const stop = Math.max(end ?? start + 1, start + 1);
  const hits = locations.filter((l) => l.start < stop && l.end > start);
  if (hits.length === 0) return null;
  return rangeLabel(hits[0].label, hits[hits.length - 1].label);
}

/**
 * Splits a source into overlapping chunks. Each chunk records where it starts
 * in the full text so a citation can highlight the exact passage, and the
 * page/slide it came from when the source has locations.
 */
export async function chunkText(text, { sourceId, sourceTitle, locations = null }) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunk.size,
    chunkOverlap: config.chunk.overlap,
  });

  const chunks = await splitter.splitText(text);

  let cursor = 0;
  return chunks.map((content, index) => {
    let start = text.indexOf(content, cursor);
    if (start === -1) start = text.indexOf(content);
    if (start !== -1) cursor = start + 1;

    return new Document({
      pageContent: content,
      metadata: {
        sourceId,
        source: sourceTitle,
        chunk: index + 1,
        start: start === -1 ? null : start,
        end: start === -1 ? null : start + content.length,
        location: start === -1 ? null : locationFor(locations, start, start + content.length),
      },
    });
  });
}
