function normalizeText(value) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

const INSTITUTIONAL_KEYWORDS = /\b(organization|organisation|commission|committee|institute|institution|foundation|association|ministry|department|agency|council|authority|bureau|office|fund|bank|university|college|school|corporation|company|group|center|centre|network|program|programme|project|service|society|academy|board|division)\b/i;

function isInstitutionalName(name) {
  if (INSTITUTIONAL_KEYWORDS.test(name)) return true;
  // All-uppercase acronyms like "WHO", "IMF", "UNESCO" (3+ letters)
  if (/^[A-Z]{3,}$/.test(name.trim())) return true;
  return false;
}

function splitAuthors(value) {
  if (!value) return [];

  const candidates = value
    .split(/\s+(?:and|&)\s+|\s*;\s*|\s*\|\s*/i)
    .map((v) => normalizeText(v))
    .filter(Boolean);

  return candidates.map((name) => {
    if (isInstitutionalName(name)) return { literal: name };

    if (name.includes(",")) {
      const [family, given] = name.split(",").map((part) => normalizeText(part));
      return { family, given };
    }

    const parts = name.split(" ").filter(Boolean);
    if (parts.length === 1) return { literal: parts[0] };

    return {
      given: parts.slice(0, -1).join(" "),
      family: parts[parts.length - 1],
    };
  });
}

function parseDate(value) {
  if (!value) return undefined;
  const str = String(value).trim();

  // ISO 8601: 2025-06-05T16:00:00Z or 2025-06-05
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return { "date-parts": [[Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])]] };
  }

  // Year-month: 2025-06
  const ymMatch = str.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) {
    return { "date-parts": [[Number(ymMatch[1]), Number(ymMatch[2])]] };
  }

  // Year-only fallback
  const yearMatch = str.match(/\b(\d{4})\b/);
  if (!yearMatch) return undefined;
  return { "date-parts": [[Number(yearMatch[1])]] };
}

export function baseItem({ id, type = "webpage", title, author, issued, accessed, URL, DOI, containerTitle, publisher, abstract }) {
  const item = {
    id,
    type,
    title: normalizeText(title) || "Untitled",
  };

  const authors = Array.isArray(author) ? author : splitAuthors(author);
  if (authors.length) item.author = authors;

  if (issued) {
    const parsedIssued = typeof issued === "string" ? parseDate(issued) : issued;
    if (parsedIssued) item.issued = parsedIssued;
  }

  if (accessed) {
    const parsedAccessed = typeof accessed === "string" ? parseDate(accessed) : accessed;
    if (parsedAccessed) item.accessed = parsedAccessed;
  }

  if (URL) item.URL = URL;
  if (DOI) item.DOI = DOI;
  if (containerTitle) item["container-title"] = normalizeText(containerTitle);
  if (publisher) item.publisher = normalizeText(publisher);
  if (abstract) item.abstract = normalizeText(abstract);

  return item;
}

export function makeId(prefix = "ref") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
