import * as cheerio from "cheerio";
import { getDocumentProxy, extractText } from "unpdf";
import { baseItem, makeId } from "./csl.js";
import { extractMetadataWithAI } from "./ai-extractor.js";

const DOI_PATTERN = /10\.\d{4,9}\/[-._;()\/:A-Z0-9]+/i;
const ARXIV_PATTERN = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(v\d+)?/i;

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

function extractArxivId(url) {
  const match = url.match(ARXIV_PATTERN);
  return match ? match[1] + (match[2] || "") : null;
}

async function fetchArxivCsl(arxivId) {
  const endpoint = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetch(endpoint, {
    headers: { "User-Agent": "link2ref-mvp/0.1 (mailto:example@example.com)" },
  });

  if (!res.ok) throw new Error(`arXiv API failed (${res.status})`);

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const entry = $("entry").first();
  if (!entry.length) throw new Error("arXiv entry not found");

  const title = entry.find("title").first().text().replace(/\s+/g, " ").trim();
  if (!title || title === "Error") throw new Error("arXiv entry not found");

  const authors = entry
    .find("author name")
    .map((_, el) => $(el).text().trim())
    .get();

  const published = entry.find("published").first().text().trim();
  const summary = entry.find("summary").first().text().replace(/\s+/g, " ").trim();

  const doiLink = entry.find('link[title="doi"]');
  const doi = doiLink.length ? doiLink.attr("href")?.replace(/^https?:\/\/doi\.org\//i, "") : undefined;

  return baseItem({
    id: makeId("arxiv"),
    type: "article",
    title,
    author: authors.join("; "),
    issued: published ? published.slice(0, 10) : undefined,
    accessed: new Date().toISOString().slice(0, 10),
    URL: `https://arxiv.org/abs/${arxivId}`,
    DOI: doi || `10.48550/arXiv.${arxivId}`,
    publisher: "arXiv",
    abstract: summary || undefined,
  });
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

function extractTitleFromPages(pages) {
  if (!pages || !pages.length) return null;
  const firstPage = pages[0] || "";
  const lines = firstPage.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const titleLines = [];
  for (const line of lines.slice(0, 12)) {
    // Stop at body text markers
    if (/^(abstract|introduction|keywords|table of contents|copyright|doi:|http|in this\s)/i.test(line)) break;
    if (/^summary$/i.test(line)) break;
    if (/^with\s+(contributions|feedback|support)/i.test(line)) break;
    // Skip author-like lines
    if (/^(authors?|by)\s*:/i.test(line)) continue;
    if (/\b(Dr\.?\s|Prof\.?\s|Ph\.?D)/.test(line)) continue;
    if (/\.\s+(University|Institute|College|School|Department)\b/i.test(line)) continue;
    if (/^(The\s+)?(University|Institute|College|School|Department)\s+of\b/i.test(line)) continue;
    // Skip institutional boilerplate and identifiers
    if (/^[A-Z]+\s*\|/.test(line)) continue;
    if (/^[A-Z]{2,}\s+\d/.test(line)) continue;
    // Skip spaced-out decorative text like "J U N E 2 0 2 3"
    if (/^[A-Z]\s+[A-Z]\s+[A-Z]/.test(line)) continue;
    // Skip short fragments, numbers, dates
    if (line.length < 3) continue;
    if (/^\d[\d\s.–-]*$/.test(line)) continue;
    titleLines.push(line);
  }

  const title = titleLines.join(" ").replace(/\s+/g, " ").trim();
  if (title.length > 200) return titleLines[0] || null;
  return title.length > 5 ? title : null;
}

function extractAuthorsFromPages(pages) {
  if (!pages || !pages.length) return null;
  const firstPage = pages[0] || "";
  const lines = firstPage.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const authors = [];

  for (const line of lines.slice(1, 15)) {
    // "Author: Name" or "Authors: Name; Name"
    const prefixMatch = line.match(/^authors?\s*:\s*(.+)/i);
    if (prefixMatch) {
      const names = prefixMatch[1].replace(/;?\s*\w+\s*:.*/i, "").trim();
      if (names.length > 3) return names;
    }

    // Lines with academic titles (e.g. "Dr. Name and Prof. Name")
    if (/\b(Dr\.?\s|Prof\.?\s)\s*[A-Z]/.test(line) && !/^with\b/i.test(line)) {
      const cleaned = line.replace(/\b(Dr\.?\s*|Prof\.?\s*)/g, "").trim();
      if (cleaned.length > 3 && !/(University|Institute|College|School)\b/i.test(cleaned)) return cleaned;
    }

    // "Name . University of X" — collect consecutive author-affiliation lines
    const dotAffMatch = line.match(/^(.+?)\s+\.\s+(University|Institute|College|School)\b/i);
    if (dotAffMatch) {
      const name = dotAffMatch[1].trim();
      if (name.length > 3 && /^[A-Z]/.test(name)) {
        authors.push(name);
        continue;
      }
    }

    // If we were collecting dot-affiliation authors and hit a non-author line, stop
    if (authors.length) break;
  }

  return authors.length ? authors.join("; ") : null;
}

function extractPublisherFromText(text) {
  if (!text) return undefined;

  const patterns = [
    /(?:published|produced|prepared|issued)\s+by\s+(?:the\s+)?([A-Z][A-Za-z].{1,77}?)(?:\.\s|\n|$)/,
    /©\s*\d{4}\s+([A-Z][A-Za-z].{1,77}?)(?:\.\s|\n|$)/,
    /copyright\s+(?:\d{4}\s+)?([A-Z][A-Za-z].{1,77}?)(?:\.\s|\n|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const pub = match[1].replace(/\s+/g, " ").trim();
      if (pub.length < 5 || pub.length > 80) continue;
      if (pub.split(/\s+/).length < 2) continue;
      if (/[;]/.test(pub)) continue;
      if (/^(and|the|a|this|that|in|on|at|for|of)\s/i.test(pub)) continue;
      return pub;
    }
  }

  return undefined;
}

function mapDocType(t) {
  const m = { article: "article-journal", book: "book", thesis: "thesis" };
  return m[t] || "report";
}

async function parsePdfToCsl(url, buffer) {
  let pages = [];
  let pdfText = "";

  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    try {
      const result = await extractText(pdf, { mergePages: false });
      pages = result.text || [];
      pdfText = pages.join("\n");
    } catch {
      // Text extraction failed, continue with empty text.
    }
    pdf.destroy();
  } catch {
    // PDF parsing failed entirely — fall back to raw binary scan for DOI.
    pdfText = buffer.toString("latin1").slice(0, 200000);
  }

  const earlyText = pages.length ? pages.slice(0, 2).join("\n") : pdfText;
  const doi = extractDoiFromText(earlyText);
  if (doi) {
    try {
      return await fetchCrossrefCsl(doi);
    } catch {
      // Fallback when DOI metadata cannot be resolved.
    }
  }

  // AI-powered extraction attempt (falls back to regex heuristics on failure)
  const aiMetadata = await extractMetadataWithAI(earlyText);
  if (aiMetadata?.title) {
    return baseItem({
      id: makeId("pdf"),
      type: mapDocType(aiMetadata.documentType),
      title: aiMetadata.title,
      author: aiMetadata.authors || undefined,
      issued: aiMetadata.year ? String(aiMetadata.year) : undefined,
      accessed: new Date().toISOString().slice(0, 10),
      URL: url,
      DOI: doi || undefined,
      publisher: aiMetadata.publisher || undefined,
      abstract: aiMetadata.abstract || undefined,
    });
  }

  const title = extractTitleFromPages(pages) || "Untitled PDF";
  const author = extractAuthorsFromPages(pages) || undefined;
  const publisher = extractPublisherFromText(pdfText) || undefined;

  return baseItem({
    id: makeId("pdf"),
    type: "report",
    title,
    author,
    accessed: new Date().toISOString().slice(0, 10),
    URL: url,
    DOI: doi || undefined,
    publisher,
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

    const arxivId = extractArxivId(normalized);
    if (arxivId) {
      const arxivDoi = `10.48550/arXiv.${arxivId}`;
      try {
        const csl = await fetchCrossrefCsl(arxivDoi);
        csl.URL = normalized;
        return { ok: true, input, normalized, csl, sourceType: "arxiv" };
      } catch {
        // DOI lookup failed, try arXiv Atom API.
      }
      try {
        const csl = await fetchArxivCsl(arxivId);
        return { ok: true, input, normalized, csl, sourceType: "arxiv" };
      } catch {
        // Fallback to generic HTML extraction below.
      }
    }

    if (/^https?:\/\/doi.org\//i.test(normalized)) {
      const csl = await fetchCrossrefCsl(normalized);
      return { ok: true, input, normalized, csl, sourceType: "doi" };
    }

    let response = await fetch(normalized, {
      headers: {
        Accept: "text/html,application/pdf,application/xhtml+xml,*/*",
        "User-Agent": "link2ref-mvp/0.1 (mailto:example@example.com)",
      },
      redirect: "follow",
    });

    if (response.status === 403) {
      response = await fetch(normalized, {
        headers: {
          Accept: "text/html,application/pdf,application/xhtml+xml,*/*",
          "User-Agent": "Mozilla/5.0 (compatible; link2ref/0.1)",
        },
        redirect: "follow",
      });
    }

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
