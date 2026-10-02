import { Router } from "express";
import { XMLParser } from "fast-xml-parser";
import { asyncHandler } from "../utils/asyncHandler.js";

export const arxivRouter = Router();

const parser = new XMLParser({ ignoreAttributes: false });

/**
 * Powers "Discover sources": searches arXiv for papers on a topic. Each
 * result carries its PDF link so the client can add it as a URL source.
 *
 * GET /api/arxiv?query=large+language+models&maxDocs=8
 */
arxivRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { query, maxDocs = 8 } = req.query;
    if (!query) return res.status(400).json({ message: "Query parameter is required." });

    const max = Math.min(Math.max(Number(maxDocs) || 8, 1), 20);
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
      query
    )}&start=0&max_results=${max}&sortBy=relevance`;

    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return res.status(502).json({ message: `arXiv responded with ${response.status}.` });
    const parsed = parser.parse(await response.text());

    const entries = [].concat(parsed?.feed?.entry ?? []);
    const results = entries.map((entry) => {
      const links = [].concat(entry.link ?? []);
      const link = links.find((l) => l["@_rel"] === "alternate")?.["@_href"];
      const pdfLink = links.find((l) => l["@_title"] === "pdf")?.["@_href"] ?? link?.replace("/abs/", "/pdf/");
      return {
        title: String(entry.title ?? "").replace(/\s+/g, " ").trim(),
        authors: [].concat(entry.author ?? []).map((a) => a.name),
        summary: String(entry.summary ?? "").replace(/\s+/g, " ").trim(),
        published: entry.published,
        link,
        pdfLink: pdfLink?.replace(/^http:/, "https:"),
      };
    });

    res.json(results);
  })
);
