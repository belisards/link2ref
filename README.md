# link2ref (MVP)

Browser-based MVP that accepts a single link or a batch list of links (HTML pages, PDFs/report PDFs, DOIs) and outputs CSL-JSON.

## Features

- Batch links input (one per line)
- Output format selector: `apa` (default), `abnt`, or `csl_json`
- DOI resolution via DOI content negotiation to CSL-JSON
- HTML metadata extraction (citation meta tags, OpenGraph, Dublin Core)
- PDF/report-PDF fallback extraction with DOI detection in text
- JSON download (`csl.json`)

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

## Notes

- This is an MVP and uses heuristic extraction for some PDFs.
- Some websites block bots or omit metadata; those will return partial records or errors.
- DOI lookups are dependent on upstream DOI providers and rate limits.
