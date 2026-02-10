import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLink } from "./extractors.js";
import { formatOutput, normalizeFormat, OUTPUT_FORMATS } from "./formatters.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function outputTypeFor(format) {
  return format === OUTPUT_FORMATS.CSL_JSON ? "json" : "text";
}

app.post("/api/parse", async (req, res) => {
  const format = normalizeFormat(req.body?.format);
  const links = Array.isArray(req.body?.links)
    ? req.body.links
    : typeof req.body?.link === "string"
      ? [req.body.link]
      : [];

  if (!links.length) {
    return res.status(400).json({ error: "Provide link or links" });
  }

  const jobs = links
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .slice(0, 200);

  const results = [];
  for (const item of jobs) {
    // Serial processing keeps rate-limits friendlier for DOI providers.
    // Can be parallelized later with a small concurrency pool.
    // eslint-disable-next-line no-await-in-loop
    results.push(await parseLink(item));
  }

  const csl = results.filter((r) => r.ok).map((r) => r.csl);
  const errors = results.filter((r) => !r.ok);
  const output = await formatOutput(csl, format);

  return res.json({
    format,
    outputType: outputTypeFor(format),
    total: jobs.length,
    success: csl.length,
    failed: errors.length,
    output,
    csl,
    results,
  });
});

app.post("/api/format", async (req, res) => {
  const format = normalizeFormat(req.body?.format);
  const csl = Array.isArray(req.body?.csl) ? req.body.csl : [];

  if (!csl.length) {
    return res.status(400).json({ error: "Provide csl array" });
  }

  const output = await formatOutput(csl, format);
  return res.json({
    format,
    outputType: outputTypeFor(format),
    output,
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`link2ref running on http://localhost:${port}`);
});
