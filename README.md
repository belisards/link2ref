# link2ref 

Easily convert links into structured output formats.

Browser-based & ad-free. Vibed-coded & open-source.

## Features

- Batch links input 
- Link ordering: `alphabetical` (default) or `original input order`
- Live progress indicator while links are processed
- Post-query reformatting without re-fetching links
- DOI resolution via DOI content negotiation to CSL-JSON
- News/article URL detection (`og:type` → `article-newspaper` CSL type)
- Full date extraction (ISO 8601 with month/day, not just year)
- Automatic "accessed" date for web sources
- HTML metadata extraction (citation meta tags, OpenGraph, Dublin Core)
- PDF/report-PDF fallback extraction with DOI detection in text
- JSON download (`csl.json`)

## Output formats available

-`apa` 
- `abnt`
- `csl_json`


## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API

### `POST /api/parse`

Request:

```json
{
  "format": "apa",
  "links": [
    "https://example.com/article",
    "10.1038/s41586-020-2649-2",
    "https://example.com/report.pdf"
  ]
}
```

### `POST /api/format`

Reformat previously returned CSL records without re-parsing links.

```json
{
  "format": "apa",
  "csl": [
    {
      "type": "article-journal",
      "title": "Example",
      "author": [{"family": "Doe", "given": "A."}]
    }
  ]
}
```

Response shape:

```json
{
  "format": "apa",
  "outputType": "text",
  "total": 3,
  "success": 2,
  "failed": 1,
  "output": [
    "Author, A. A. (2020). Title..."
  ],
  "csl": [
    {
      "id": "...",
      "type": "article-journal",
      "title": "..."
    }
  ],
  "results": [
    {
      "ok": true,
      "input": "...",
      "normalized": "...",
      "sourceType": "doi",
      "csl": {}
    }
  ]
}
```

## Testing

E2E tests use Playwright with Chromium:

```bash
npm run test:e2e
```

Tests cover news URL citation quality, DOI regression, format switching, and batch processing.

## Notes

- This is an MVP and uses heuristic extraction for some PDFs.
- Some websites block bots or omit metadata; those will return partial records or errors.
- DOI lookups are dependent on upstream DOI providers and rate limits.
