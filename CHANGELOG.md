# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Browser MVP for converting links (HTML, PDF/report PDF, DOI) into citations.
- Batch input workflow with progress indicator and failure reporting.
- Output formats: `APA` (default), `ABNT`, and `CSL-JSON`.
- Post-query reformat endpoint: `POST /api/format`.

### Changed
- Link ordering controls moved to output panel.
- Sorting behavior updated to support original input order and metadata-based alphabetical citation order.
- Download action updated to support text or JSON output (`Download Output 📥`).

### Performance
- Parallelized APA/ABNT formatting with bounded concurrency.
- Added client-side cache for formatted outputs to speed up resort/reformat operations.

## [0.1.0] - 2026-02-10

### Added
- Initial Express backend and static frontend.
- DOI content negotiation and metadata extraction pipelines.
- Initial project scaffolding, README, and Git setup.

