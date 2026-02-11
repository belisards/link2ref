# link2ref

## Project Overview
Browser-based tool that converts links, DOIs, and PDFs into structured citation output (APA, ABNT, CSL-JSON). Node.js/Express backend with vanilla JS frontend.

## Architecture
- `src/server.js` — Express server with `/api/parse` and `/api/format` endpoints
- `src/extractors.js` — URL normalization, DOI resolution, HTML/PDF metadata extraction
- `src/csl.js` — CSL-JSON item construction, date parsing, author splitting
- `src/formatters.js` — APA/ABNT formatting via citation-js and DOI content negotiation fallbacks
- `public/` — Static frontend (vanilla HTML/CSS/JS)

## Key Patterns
- HTML metadata extraction priority: citation_* > Dublin Core > OpenGraph > twitter
- `og:type === "article"` maps to CSL type `article-newspaper`
- Accessed dates are set automatically on web extractions
- DOI citations prefer upstream formatting; web sources use citation-js fallback
- `formatAbntFallback` includes "Acesso em:" for accessed dates

## PDF Extraction
- Uses `unpdf` library for proper text extraction (replaces raw binary scan)
- Two-tier fallback: DOI→Crossref (best) > content-based heuristics (fallback)
- DOI search limited to first 2 pages to avoid false matches from reference lists
- Title extraction from page 1 text with generic skip rules:
  - Stops at body text markers (abstract, introduction, summary, etc.)
  - Skips lines with academic titles (Dr., Prof., Ph.D)
  - Skips affiliation lines (University of..., Institute of...)
  - Skips lines matching `ALLCAPS |` or `ALLCAPS digit` patterns
  - Caps at 200 chars; falls back to first line if too long
- Author extraction patterns (all generic, no hardcoded names):
  - "Author:"/"Authors:" prefix lines (strips secondary role labels after semicolons)
  - Lines with academic titles — strips Dr./Prof. prefix, returns cleaned name
  - "Name . Institution" dot-separated affiliation lines (collects consecutive)
- Publisher extraction from text: "published by", copyright, ©
  - Requires capital letter start, min 2 words, no semicolons

## Extraction Rules Guidelines
- NEVER hardcode personal names, specific document IDs, or institution-specific strings
- All skip/match rules must be generic patterns (e.g. academic titles, affiliation patterns)
- When adding new heuristics, use structural patterns not content-specific strings

## Testing
- E2E tests use Playwright (chromium only)
- Run: `npm run test:e2e`
- Config: `playwright.config.js` (auto-starts server on port 3000)
- Test files: `tests/news-url.spec.js`, `tests/batch-news.spec.js`
- Tests cover: news URL type detection, APA/ABNT/CSL-JSON output, DOI regression, format switching, batch processing

## Commands
- `npm start` — Start production server
- `npm run dev` — Start with file watching
- `npm run test:e2e` — Run Playwright E2E tests
