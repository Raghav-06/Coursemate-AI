import dns from "node:dns/promises";
import net from "node:net";
import * as cheerio from "cheerio";
import { extractPdfBuffer } from "./ingestion.js";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MIN_TEXT_CHARS = 200;

// Tags that never carry the page's actual content.
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "form",
  "button",
  "nav",
  "header",
  "footer",
  "aside",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[aria-hidden=true]",
].join(",");

const BLOCK_SELECTORS = "p,div,section,article,li,tr,h1,h2,h3,h4,h5,h6,pre,blockquote,dt,dd,figcaption,table";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function isPrivateAddress(address) {
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// The server fetches whatever URL a user pastes, so refuse anything that
// points back into the local network (localhost, router admin pages, cloud
// metadata endpoints…). Set ALLOW_PRIVATE_URLS=true to lift this locally.
async function assertPublicUrl(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw httpError(400, "Only http:// and https:// links are supported.");
  }
  if (process.env.ALLOW_PRIVATE_URLS === "true") return;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true }).catch(() => {
        throw httpError(400, `Could not resolve ${hostname}.`);
      })).map((r) => r.address);

  if (addresses.some(isPrivateAddress)) {
    throw httpError(400, "Links to private or local network addresses are not allowed.");
  }
}

// fetch() with redirects followed manually so every hop is re-checked.
async function safeFetch(rawUrl) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AskAI/1.0; +https://localhost)",
        Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      throw httpError(502, `The site responded with ${response.status} ${response.statusText}.`);
    }
    return { response, finalUrl: url };
  }
  throw httpError(502, "Too many redirects.");
}

async function readBody(response) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES) throw httpError(413, "The linked file is larger than 15MB.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw httpError(413, "The linked file is larger than 15MB.");
  return buffer;
}

function tidy(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, lines) => line || lines[i - 1])
    .join("\n")
    .trim();
}

function extractHtml(html, finalUrl) {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    finalUrl.hostname;
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  $(NOISE_SELECTORS).remove();

  // Prefer the page's main content region; fall back to the whole body when
  // the region is missing or suspiciously short.
  let root = $("article").first();
  if (root.text().trim().length < 500) root = $("main, [role=main]").first();
  if (root.text().trim().length < 500) root = $("body");

  root.find("br").replaceWith("\n");
  root.find(BLOCK_SELECTORS).each((_, el) => {
    $(el).append("\n");
  });

  const body = tidy(root.text());
  const text = [`Title: ${title}`, `URL: ${finalUrl.href}`, description && `Description: ${description}`, "", body]
    .filter((part) => part !== false && part !== undefined)
    .join("\n");

  return { title, text, bodyLength: body.length };
}

/**
 * Downloads a web page (or a PDF / plain-text file behind a link) and returns
 * its readable text, ready for the same chunk -> embed pipeline as uploads.
 */
export async function loadUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw httpError(400, `"${rawUrl}" is not a valid URL.`);
  }

  const { response, finalUrl } = await safeFetch(parsed.href);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const buffer = await readBody(response);

  if (contentType.includes("application/pdf") || finalUrl.pathname.toLowerCase().endsWith(".pdf")) {
    const text = await extractPdfBuffer(buffer);
    const fileName = decodeURIComponent(finalUrl.pathname.split("/").pop() || "") || finalUrl.hostname;
    return { title: fileName, text, finalUrl: finalUrl.href };
  }

  if (contentType.includes("html") || contentType === "") {
    const { title, text, bodyLength } = extractHtml(buffer.toString("utf-8"), finalUrl);
    if (bodyLength < MIN_TEXT_CHARS) {
      throw httpError(
        422,
        "This page has almost no readable text — it may need JavaScript or a login to load its content."
      );
    }
    return { title, text, finalUrl: finalUrl.href };
  }

  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
    return { title: finalUrl.pathname.split("/").pop() || finalUrl.hostname, text: buffer.toString("utf-8"), finalUrl: finalUrl.href };
  }

  throw httpError(415, `Unsupported content type "${contentType.split(";")[0]}" at this link.`);
}
