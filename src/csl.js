function normalizeText(value) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function splitAuthors(value) {
  if (!value) return [];

  const candidates = value
    .split(/\s+(?:and|&)\s+|\s*;\s*|\s*\|\s*/i)
    .map((v) => normalizeText(v))
    .filter(Boolean);

  return candidates.map((name) => {
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

function parseYear(value) {
  if (!value) return undefined;
  const match = String(value).match(/\b(\d{4})\b/);
  if (!match) return undefined;
  return { "date-parts": [[Number(match[1])]] };
}

export function baseItem({ id, type = "webpage", title, author, issued, URL, DOI, containerTitle, abstract }) {
  const item = {
    id,
    type,
    title: normalizeText(title) || "Untitled",
  };

  const authors = Array.isArray(author) ? author : splitAuthors(author);
  if (authors.length) item.author = authors;

  if (issued) {
    const parsedIssued = typeof issued === "string" ? parseYear(issued) : issued;
    if (parsedIssued) item.issued = parsedIssued;
  }

  if (URL) item.URL = URL;
  if (DOI) item.DOI = DOI;
  if (containerTitle) item["container-title"] = normalizeText(containerTitle);
  if (abstract) item.abstract = normalizeText(abstract);

  return item;
}

export function makeId(prefix = "ref") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
