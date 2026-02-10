# Plan: Improve news/report URL citation quality

## Context
The app already accepts arbitrary URLs and extracts HTML meta tags. However, when given a news article URL like `https://techcrunch.com/2025/06/05/x-changes-its-terms...`, the output quality is poor because:
- The CSL type is always `"webpage"` instead of `"article-newspaper"`
- Only the year is extracted from dates (month/day discarded)
- No "accessed" date (required by APA/ABNT for web sources)
- Fallback formatters don't produce proper web-source citations

This plan improves metadata extraction and formatting for non-academic web sources.

## Changes

### 1. Parse full dates in `src/csl.js`
- Rename `parseYear` → `parseDate` (keep backward compat call)
- Parse ISO 8601 strings (`2025-06-05T16:00:00Z`) into `{ "date-parts": [[2025, 6, 5]] }`
- Fallback to year-only parsing for partial dates
- Add `accessed` field support to `baseItem` (pass-through to CSL item)
- Add `publisher` field support to `baseItem`

### 2. Detect article type in `src/extractors.js` → `parseHtmlToCsl`
- Read `og:type` meta tag — if `"article"`, set CSL type to `"article-newspaper"`
- Extract `og:site_name` as both `container-title` and `publisher`
- Extract `article:modified_time` as fallback when `published_time` is missing
- Set `accessed` date to current date (ISO string) on every web extraction
- Pass the full date string (not just year) to the improved `parseDate`

### 3. Improve fallback formatters in `src/formatters.js`
- `formatApaFallback`: already uses citation-js which handles types — no change needed (citation-js respects CSL type)
- `formatAbntFallback`: add accessed date ("Acesso em: DD mon. YYYY") and publisher

## Files to modify
| File | What changes |
|------|-------------|
| `src/csl.js` | `parseDate` (full ISO parsing), `baseItem` gains `accessed` + `publisher` |
| `src/extractors.js` | `parseHtmlToCsl` — type detection, full dates, accessed date |
| `src/formatters.js` | `formatAbntFallback` — include accessed date + publisher |

## Playwright E2E validation

### Setup
- Install Playwright: `npm i -D @playwright/test` and `npx playwright install chromium`
- Add test script to `package.json`: `"test:e2e": "npx playwright test"`
- Create `playwright.config.js` with:
  - `webServer` config to auto-start `npm start` on port 3000
  - Chromium only
  - Base URL `http://localhost:3000`

### Test file: `tests/news-url.spec.js`

**Test 1: News URL produces article-newspaper type in CSL-JSON**
- Navigate to `/`
- Fill textarea with `https://techcrunch.com/2025/06/05/x-changes-its-terms-to-bar-training-of-ai-models-using-its-content/`
- Select CSL-JSON format
- Click Convert
- Wait for output to appear
- Assert output contains `"type": "article-newspaper"`
- Assert output contains `"accessed"` field
- Assert output contains `"date-parts"` with month and day (not just year)
- Assert output contains `"container-title"` (e.g. "TechCrunch")

**Test 2: News URL produces proper APA citation**
- Fill textarea with the TechCrunch URL
- Select APA format
- Click Convert
- Wait for output
- Assert output contains "Retrieved" and "from" (APA web source pattern)
- Assert output contains the article title (partial match)
- Assert output contains a year (e.g. "2025")

**Test 3: News URL produces proper ABNT citation**
- Fill textarea with the TechCrunch URL
- Select ABNT format
- Click Convert
- Wait for output
- Assert output contains "Acesso em:" (ABNT accessed date)
- Assert output contains the article title

**Test 4: DOI regression — academic DOI still works**
- Fill textarea with `10.1038/s41586-020-2649-2`
- Select APA format
- Click Convert
- Wait for output
- Assert output is a valid APA citation (contains author, year, title)
- Assert no "Retrieved" pattern (DOI citations use DOI link instead)

**Test 5: Format switching preserves data**
- Convert a news URL in APA format
- Switch to CSL-JSON without re-converting
- Assert CSL-JSON output appears with `"type": "article-newspaper"`
- Switch to ABNT
- Assert ABNT output contains "Acesso em:"

### Test file: `tests/batch-news.spec.js`

**Test 6: Batch with mixed news + DOI**
- Fill textarea with both a news URL and a DOI (one per line)
- Select APA format
- Click Convert
- Wait for output
- Assert 2 citations appear in output
- Assert progress bar reaches completion
