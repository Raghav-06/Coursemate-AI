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

export async function extractPdfBuffer(buffer) {
  const { text } = await pdfParse(buffer);
  return text;
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
async function extractPptx(filePath) {
  const zip = new AdmZip(filePath);
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  return slideEntries
    .map((entry, i) => {
      const xml = entry.getData().toString("utf-8");
      const paragraphs = xml
        .split("</a:p>")
        .map((p) => [...p.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1])).join(""))
        .filter((p) => p.trim());
      return `Slide ${i + 1}\n${paragraphs.join("\n")}`;
    })
    .join("\n\n");
}

/** Pulls plain text out of an uploaded file (PDF, DOCX, PPTX, TXT, MD, CSV). */
export async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return extractPdfBuffer(await fs.readFile(filePath));
    case ".docx":
      return extractDocx(filePath);
    case ".pptx":
      return extractPptx(filePath);
    case ".txt":
    case ".md":
    case ".csv":
      return fs.readFile(filePath, "utf-8");
    default:
      throw new Error(`Unsupported file type "${ext}"`);
  }
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
 * Splits a source into overlapping chunks. Each chunk records where it starts
 * in the full text so a citation can highlight the exact passage.
 */
export async function chunkText(text, { sourceId, sourceTitle }) {
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
      },
    });
  });
}
