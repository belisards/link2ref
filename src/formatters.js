import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";

const FETCH_TIMEOUT_MS = 15000;

export const OUTPUT_FORMATS = {
  APA: "apa",
  ABNT: "abnt",
  CSL_JSON: "csl_json",
};

export function normalizeFormat(input) {
  const value = String(input || "").toLowerCase().trim();
  if (value === OUTPUT_FORMATS.APA) return OUTPUT_FORMATS.APA;
  if (value === OUTPUT_FORMATS.ABNT) return OUTPUT_FORMATS.ABNT;
  if (value === OUTPUT_FORMATS.CSL_JSON) return OUTPUT_FORMATS.CSL_JSON;
  return OUTPUT_FORMATS.APA;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDoi(item) {
  if (!item) return null;
  if (item.DOI) return String(item.DOI);
  if (item.doi) return String(item.doi);
  const url = item.URL || item.url;
  if (!url) return null;
  const match = String(url).match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match ? match[0] : null;
}

async function formatApaFromDoi(doi) {
  const endpoint = `https://doi.org/${encodeURIComponent(doi)}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "text/x-bibliography; style=apa",
      "User-Agent": "link2ref/0.1 (mailto:example@example.com)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`DOI APA lookup failed (${res.status})`);
  }

  return decodeHtmlEntities((await res.text()).trim());
}

async function formatAbntFromDoi(doi) {
  const endpoint = `https://doi.org/${encodeURIComponent(doi)}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "text/x-bibliography; style=associacao-brasileira-de-normas-tecnicas",
      "User-Agent": "link2ref/0.1 (mailto:example@example.com)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`DOI ABNT lookup failed (${res.status})`);
  }

  return decodeHtmlEntities((await res.text()).trim());
}

async function formatApaFallback(item) {
  try {
    const cite = new Cite(item);
    return cite
      .format("bibliography", {
        format: "text",
        template: "apa",
        lang: "en-US",
      })
      .trim();
  } catch {
    return `[APA formatting failed] ${item.title || item.URL || item.id || "Untitled"}`;
  }
}

function formatAbntAccessedDate(dateParts) {
  if (!dateParts) return null;
  const [year, month, day] = dateParts;
  if (!year) return null;
  const ABNT_MONTHS = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
  const monthStr = month ? ` ${ABNT_MONTHS[month - 1]}` : "";
  const dayStr = day ? `${day}` : "";
  return `${dayStr}${monthStr} ${year}`;
}

function formatAbntFallback(item) {
  const title = item.title || "Untitled";
  const year = item?.issued?.["date-parts"]?.[0]?.[0];
  const url = item.URL || item.url || "";
  const publisherName = item.publisher || item["container-title"] || "";

  const authorParts = Array.isArray(item.author)
    ? item.author
        .map((a) => {
          if (a.literal) return a.literal;
          const family = a.family || "";
          const given = a.given || "";
          return `${family}${given ? `, ${given}` : ""}`.trim();
        })
        .filter(Boolean)
    : [];

  const authors = authorParts.length ? `${authorParts.join("; ")}. ` : "";
  const yearPart = year ? ` ${year}.` : "";
  const publisherPart = publisherName ? ` ${publisherName}.` : "";
  const urlPart = url ? ` Available at: ${url}.` : "";

  const accessedParts = item?.accessed?.["date-parts"]?.[0];
  const accessedStr = formatAbntAccessedDate(accessedParts);
  const accessedPart = accessedStr ? ` Acesso em: ${accessedStr}.` : "";

  return `${authors}${title}.${publisherPart}${yearPart}${urlPart}${accessedPart}`.trim();
}

async function mapWithConcurrency(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      result[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return result;
}

export async function formatOutput(cslItems, format) {
  if (format === OUTPUT_FORMATS.APA) {
    return mapWithConcurrency(cslItems, 6, async (item) => {
      const doi = extractDoi(item);
      if (doi) {
        try {
          return await formatApaFromDoi(doi);
        } catch {
          // Fallback below.
        }
      }
      return formatApaFallback(item);
    });
  }

  if (format === OUTPUT_FORMATS.ABNT) {
    return mapWithConcurrency(cslItems, 6, async (item) => {
      const doi = extractDoi(item);
      if (doi) {
        try {
          return await formatAbntFromDoi(doi);
        } catch {
          // Fallback below.
        }
      }
      return formatAbntFallback(item);
    });
  }

  return cslItems;
}
