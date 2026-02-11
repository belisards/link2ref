import * as cheerio from "cheerio";
import { getDocumentProxy, extractText } from "unpdf";
import { baseItem, makeId } from "./csl.js";

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
  for (const line of lines.slice(0, 8)) {
    if (/^(abstract|introduction|keywords|table of contents|copyright|doi:|http)/i.test(line)) break;
    if (/^[A-Z]\s+[A-Z]\s+[A-Z]/.test(line)) continue;
    if (line.length < 3) continue;
    titleLines.push(line);
  }

  const title = titleLines.join(" ").replace(/\s+/g, " ").trim();
  return title.length > 5 ? title : null;
}

function extractAuthorsFromPages(pages) {
  if (!pages || !pages.length) return null;
  const firstPage = pages[0] || "";
  const lines = firstPage.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const AUTHOR_LINE = /^(?:[A-Z][a-z]{1,20}\s+){1,3}[A-Z][a-z]{1,20}(?:\s*[,;&]\s*(?:[A-Z][a-z]{1,20}\s+){1,3}[A-Z][a-z]{1,20})+$/;
  for (const line of lines.slice(1, 12)) {
    if (AUTHOR_LINE.test(line)) return line;
  }
  return null;
}

function extractPublisherFromText(text, url) {
  if (text) {
    const patterns = [
      /(?:published|produced|prepared|issued)\s+by\s+(.{3,80}?)(?:\.|,|\n|$)/i,
      /©\s*\d{4}\s+(.{3,80}?)(?:\.|,|\n|$)/i,
      /copyright\s+(?:\d{4}\s+)?(.{3,80}?)(?:\.|,|\n|$)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const pub = match[1].replace(/\s+/g, " ").trim();
        if (pub.length > 2 && pub.length < 80) return pub;
      }
    }
  }

  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      const parts = hostname.split(".");
      const domain = parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
      if (domain.length > 3 && !/\.com$|\.net$|\.org$|\.io$/.test(domain)) return undefined;
    } catch {}
  }

  return undefined;
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

  const doi = extractDoiFromText(pdfText);
  if (doi) {
    try {
      return await fetchCrossrefCsl(doi);
    } catch {
      // Fallback when DOI metadata cannot be resolved.
    }
  }

  const title = extractTitleFromPages(pages) || "Untitled PDF";
  const author = extractAuthorsFromPages(pages) || undefined;
  const publisher = extractPublisherFromText(pdfText, url) || undefined;

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
