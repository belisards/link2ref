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
