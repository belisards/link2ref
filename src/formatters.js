import Cite from "@citation-js/core";
import "@citation-js/plugin-csl";

export const OUTPUT_FORMATS = {
  CSL_JSON: "csl_json",
  APA: "apa",
};

export function normalizeFormat(input) {
  const value = String(input || "").toLowerCase().trim();
  if (value === OUTPUT_FORMATS.APA) return OUTPUT_FORMATS.APA;
  return OUTPUT_FORMATS.CSL_JSON;
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
      "User-Agent": "link2ref-mvp/0.1 (mailto:example@example.com)",
    },
  });

  if (!res.ok) {
    throw new Error(`DOI APA lookup failed (${res.status})`);
  }

  return (await res.text()).trim();
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

export async function formatOutput(cslItems, format) {
  if (format === OUTPUT_FORMATS.APA) {
    const entries = [];
    for (const item of cslItems) {
      const doi = extractDoi(item);
      if (doi) {
        try {
          // Prefer DOI-based bibliography formatting for higher-fidelity APA output.
          // eslint-disable-next-line no-await-in-loop
          entries.push(await formatApaFromDoi(doi));
          continue;
        } catch {
          // Fallback below.
        }
      }
      // eslint-disable-next-line no-await-in-loop
      entries.push(await formatApaFallback(item));
    }
    return entries;
  }

  return cslItems;
}
