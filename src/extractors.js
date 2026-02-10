import * as cheerio from "cheerio";
import { baseItem, makeId } from "./csl.js";

const DOI_PATTERN = /10\.\d{4,9}\/[-._;()\/:A-Z0-9]+/i;

function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^doi:/i.test(trimmed)) return `https://doi.org/${trimmed.replace(/^doi:/i, "")}`;
  if (/^10\.\d{4,9}\//i.test(trimmed)) return `https://doi.org/${trimmed}`;
  return `https://${trimmed}`;
}

function pickMeta($, ...names) {
  for (const name of names) {
    const byName = $(`meta[name='${name}']`).attr("content");
    if (byName) return byName;
    const byProperty = $(`meta[property='${name}']`).attr("content");
    if (byProperty) return byProperty;
  }
  return null;
}

function detectTypeFromUrl(url, contentType) {
  const lower = url.toLowerCase();
  if (contentType?.includes("application/pdf") || lower.endsWith(".pdf")) return "pdf";
  if (lower.includes("doi.org/")) return "doi";
  return "html";
}

async function fetchCrossrefCsl(doiOrUrl) {
  const doi = doiOrUrl.replace(/^https?:\/\/doi.org\//i, "").replace(/^doi:/i, "");
  const endpoint = `https://doi.org/${encodeURIComponent(doi)}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.citationstyles.csl+json",
      "User-Agent": "link2ref-mvp/0.1 (mailto:example@example.com)",
    },
  });

  if (!res.ok) {
    throw new Error(`DOI lookup failed (${res.status})`);
  }

  const csl = await res.json();
  if (!csl.id) csl.id = makeId("doi");
  return csl;
}

function extractDoiFromText(text) {
  if (!text) return null;
  const match = text.match(DOI_PATTERN);
  return match ? match[0] : null;
}

function extractDoiFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const decoded = decodeURIComponent(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    return extractDoiFromText(decoded);
  } catch {
    return extractDoiFromText(url);
  }
}

async function parseHtmlToCsl(url, html) {
  const $ = cheerio.load(html);
  const doi = pickMeta($, "citation_doi") || extractDoiFromText(pickMeta($, "dc.identifier", "dc.Identifier"));

  if (doi) {
    try {
      return await fetchCrossrefCsl(doi);
    } catch {
      // Fallback to metadata extraction when DOI lookup fails.
    }
  }

  const ogType = pickMeta($, "og:type");
  const cslType = ogType === "article" ? "article-newspaper" : "webpage";

  const title =
    pickMeta($, "citation_title", "dc.title", "og:title", "twitter:title") ||
    $("title").first().text() ||
    "Untitled";

  const author =
    pickMeta($, "citation_author", "dc.creator", "author", "article:author") ||
    $("meta[name='citation_author']")
      .map((_, el) => $(el).attr("content"))
      .get()
      .join("; ");

  const issued = pickMeta($, "citation_publication_date", "article:published_time", "article:modified_time", "dc.date", "date");
  const abstract = pickMeta($, "description", "og:description", "dc.description", "citation_abstract");
  const siteName = pickMeta($, "og:site_name");
  const containerTitle = pickMeta($, "citation_journal_title") || siteName;
  const publisher = siteName || undefined;

  const accessed = new Date().toISOString().slice(0, 10);

  return baseItem({
    id: makeId("web"),
    type: cslType,
    title,
    author,
    issued,
    accessed,
    URL: url,
    DOI: doi || undefined,
    containerTitle,
    publisher,
    abstract,
  });
}

async function parsePdfToCsl(url, buffer) {
  const text = buffer.toString("latin1").slice(0, 200000);
  const doi = extractDoiFromText(text);

  if (doi) {
    try {
      return await fetchCrossrefCsl(doi);
    } catch {
      // Fallback when DOI metadata cannot be resolved.
    }
  }

  const titleGuess = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 12 && line.length < 180)
    .slice(0, 25)
    .find((line) => /^[A-Z0-9][\w\s,:'"()\-]{10,}$/.test(line));

  return baseItem({
    id: makeId("pdf"),
    type: "report",
    title: titleGuess || "Untitled PDF Report",
    URL: url,
    DOI: doi || undefined,
  });
}

export async function parseLink(input) {
  const normalized = normalizeUrl(input);
  if (!normalized) {
    return { ok: false, input, error: "Empty input" };
  }

  try {
    const doiFromUrl = extractDoiFromUrl(normalized);

    if (doiFromUrl) {
      try {
        const csl = await fetchCrossrefCsl(doiFromUrl);
        return { ok: true, input, normalized, csl, sourceType: "doi" };
      } catch {
        // Continue and try direct URL fetch when DOI provider lookup fails.
      }
    }

    if (/^https?:\/\/doi.org\//i.test(normalized)) {
      const csl = await fetchCrossrefCsl(normalized);
      return { ok: true, input, normalized, csl, sourceType: "doi" };
    }

    const response = await fetch(normalized, {
      headers: {
        Accept: "text/html,application/pdf,application/xhtml+xml,*/*",
        "User-Agent": "link2ref-mvp/0.1 (mailto:example@example.com)",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      if (doiFromUrl) {
        try {
          const csl = await fetchCrossrefCsl(doiFromUrl);
          return { ok: true, input, normalized, csl, sourceType: "doi" };
        } catch {
          // Fall through to explicit HTTP error.
        }
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const sourceType = detectTypeFromUrl(normalized, contentType);

    let csl;
    if (sourceType === "pdf") {
      const arrayBuffer = await response.arrayBuffer();
      csl = await parsePdfToCsl(normalized, Buffer.from(arrayBuffer));
    } else {
      const html = await response.text();
      csl = await parseHtmlToCsl(normalized, html);
    }

    return { ok: true, input, normalized, csl, sourceType };
  } catch (error) {
    return {
      ok: false,
      input,
      normalized,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
