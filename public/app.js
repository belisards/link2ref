const batchEl = document.getElementById("batch");
const orderEl = document.getElementById("order");
const formatEl = document.getElementById("format");
const outputEl = document.getElementById("output");
const statusEl = document.getElementById("status");
const errorsEl = document.getElementById("errors");
const failuresWrapEl = document.getElementById("failuresWrap");
const uniqueCountEl = document.getElementById("uniqueCount");
const progressWrapEl = document.getElementById("progressWrap");
const progressBarEl = document.getElementById("progressBar");
const progressTextEl = document.getElementById("progressText");

let lastCsl = [];
let lastErrors = [];
let lastFormat = "apa";
let lastOutput = [];
let lastSuccessEntries = [];
let lastErrorEntries = [];
let lastOriginalUniqueLinks = [];
let abortController = null;
const formattedCacheByFormat = {
  apa: new Map(),
  abnt: new Map(),
};

function parseRawUniqueInputs() {
  return Array.from(
    new Set(
      batchEl.value
    .split(/\r?\n/)
    .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

function orderLinks(links, orderMode) {
  const unique = [...links];
  if (orderMode === "alphabetical") {
    unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return unique;
}

function parseInputs() {
  const unique = parseRawUniqueInputs();
  if (orderEl.value === "alphabetical") {
    unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return unique;
}

function citationSortKey(entry) {
  const csl = entry?.csl || {};
  const firstAuthor = Array.isArray(csl.author) ? csl.author[0] : null;
  const authorKey = firstAuthor
    ? (firstAuthor.family || firstAuthor.literal || firstAuthor.given || "").toLowerCase()
    : "";
  const year = csl?.issued?.["date-parts"]?.[0]?.[0] || 0;
  const titleKey = String(csl.title || "").toLowerCase();
  return `${authorKey}|${String(year)}|${titleKey}`;
}

function getOrderedEntries(entries) {
  const orderMode = orderEl.value;
  const originalIndex = new Map(lastOriginalUniqueLinks.map((link, idx) => [link, idx]));

  const copy = [...entries];
  copy.sort((a, b) => {
    const aInput = a.input || "";
    const bInput = b.input || "";

    if (orderMode === "alphabetical") {
      const aKey = a.csl ? citationSortKey(a) : aInput.toLowerCase();
      const bKey = b.csl ? citationSortKey(b) : bInput.toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    }

    const aIdx = originalIndex.has(aInput) ? originalIndex.get(aInput) : Number.MAX_SAFE_INTEGER;
    const bIdx = originalIndex.has(bInput) ? originalIndex.get(bInput) : Number.MAX_SAFE_INTEGER;
    return aIdx - bIdx;
  });
  return copy;
}

function renderOutput() {
  outputEl.textContent =
    lastFormat === "apa" || lastFormat === "abnt"
      ? lastOutput.join("\n\n")
      : JSON.stringify(lastOutput, null, 2);
}

function renderFailures() {
  if (!lastErrors.length) {
    failuresWrapEl.classList.add("hidden");
    errorsEl.textContent = "[]";
    return;
  }
  failuresWrapEl.classList.remove("hidden");
  errorsEl.textContent = JSON.stringify(lastErrors, null, 2);
}

async function reformatFromCsl(format) {
  const orderedSuccess = getOrderedEntries(lastSuccessEntries);
  const cache = formattedCacheByFormat[format];

  if ((format === "apa" || format === "abnt") && cache && orderedSuccess.length) {
    const allCached = orderedSuccess.every((entry) => cache.has(entry.input));
    if (allCached) {
      lastFormat = format;
      lastOutput = orderedSuccess.map((entry) => cache.get(entry.input));
      renderOutput();
      return;
    }
  }

  const res = await fetch("/api/format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csl: lastCsl, format }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  lastFormat = data.format || format;
  lastOutput = data.output || [];

  if ((lastFormat === "apa" || lastFormat === "abnt") && formattedCacheByFormat[lastFormat]) {
    const targetCache = formattedCacheByFormat[lastFormat];
    orderedSuccess.forEach((entry, idx) => {
      targetCache.set(entry.input, lastOutput[idx] || "");
    });
  }

  renderOutput();
}

async function refreshOutputFromCurrentData(format) {
  const orderedSuccess = getOrderedEntries(lastSuccessEntries);
  const orderedErrors = getOrderedEntries(lastErrorEntries);

  lastCsl = orderedSuccess.map((item) => item.csl);
  lastErrors = orderedErrors.map((item) => ({
    input: item.input,
    normalized: item.normalized || null,
    error: item.error || "Unknown error",
  }));

  await reformatFromCsl(format);
  renderFailures();
}

function renderUniqueCount() {
  const uniqueCount = parseRawUniqueInputs().length;
  uniqueCountEl.textContent = `Unique links identified: ${uniqueCount}`;
}

function showProgress(processed, total) {
  progressWrapEl.classList.remove("hidden");
  progressTextEl.textContent = `Processing ${processed}/${total}`;
  progressBarEl.value = total ? Math.round((processed / total) * 100) : 0;
}

function hideProgress() {
  progressWrapEl.classList.add("hidden");
  progressTextEl.textContent = "Processing 0/0";
  progressBarEl.value = 0;
}

async function run() {
  const originalUniqueLinks = parseRawUniqueInputs();
  const links = orderLinks(originalUniqueLinks, orderEl.value);
  const format = formatEl.value || "csl_json";
  if (!links.length) {
    statusEl.textContent = "Add at least one link.";
    return;
  }

  if (abortController) abortController.abort();
  abortController = new AbortController();
  const { signal } = abortController;

  statusEl.textContent = `Processing ${links.length} unique link(s)...`;
  renderUniqueCount();
  showProgress(0, links.length);

  try {
    lastOriginalUniqueLinks = originalUniqueLinks;
    const aggregated = {
      total: links.length,
      success: 0,
      failed: 0,
      csl: [],
      results: [],
    };

    for (let i = 0; i < links.length; i += 1) {
      if (signal.aborted) break;
      const link = links[i];
      // Process one link at a time so progress reflects real completion.
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: [link], format: "csl_json" }),
        signal,
      });
      // eslint-disable-next-line no-await-in-loop
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed: ${res.status}`);
      }

      aggregated.success += data.success || 0;
      aggregated.failed += data.failed || 0;
      aggregated.csl.push(...(data.csl || []));
      aggregated.results.push(...(data.results || []));
      showProgress(i + 1, links.length);
    }

    lastCsl = aggregated.csl;
    lastSuccessEntries = aggregated.results.filter((item) => item.ok);
    lastErrorEntries = aggregated.results.filter((item) => !item.ok);
    await refreshOutputFromCurrentData(format);

    if (signal.aborted) {
      statusEl.textContent = `Cancelled. ${aggregated.success}/${aggregated.total} converted before cancellation.`;
    } else {
      statusEl.textContent = `Done. ${aggregated.success}/${aggregated.total} converted, ${aggregated.failed} failed.`;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      statusEl.textContent = "Processing cancelled.";
      if (lastSuccessEntries.length) {
        await refreshOutputFromCurrentData(format);
      }
    } else {
      statusEl.textContent = `Error: ${error.message}`;
      lastErrors = [{ input: null, normalized: null, error: error.message }];
      renderFailures();
    }
  } finally {
    abortController = null;
    hideProgress();
  }
}

function clearAll() {
  batchEl.value = "";
  lastCsl = [];
  lastOutput = [];
  lastFormat = "apa";
  lastErrors = [];
  lastSuccessEntries = [];
  lastErrorEntries = [];
  lastOriginalUniqueLinks = [];
  formattedCacheByFormat.apa.clear();
  formattedCacheByFormat.abnt.clear();
  outputEl.textContent = "[]";
  hideProgress();
  renderFailures();
  statusEl.textContent = "";
}

function download() {
  const isTextStyle = lastFormat === "apa" || lastFormat === "abnt";
  const contents = isTextStyle ? lastOutput.join("\n\n") : JSON.stringify(lastOutput, null, 2);
  const blob = new Blob([contents], {
    type: isTextStyle ? "text/plain" : "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    lastFormat === "apa" ? "citations-apa.txt" : lastFormat === "abnt" ? "citations-abnt.txt" : "csl.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function copyOutput() {
  const isTextStyle = lastFormat === "apa" || lastFormat === "abnt";
  const contents = isTextStyle ? lastOutput.join("\n\n") : JSON.stringify(lastOutput, null, 2);
  try {
    await navigator.clipboard.writeText(contents);
    const btn = document.getElementById("copy");
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    statusEl.textContent = "Copy failed — use Ctrl+C instead.";
  }
}

document.getElementById("run").addEventListener("click", run);
document.getElementById("clear").addEventListener("click", clearAll);
document.getElementById("copy").addEventListener("click", copyOutput);
document.getElementById("download").addEventListener("click", download);
document.getElementById("cancel").addEventListener("click", () => {
  if (abortController) abortController.abort();
});
formatEl.addEventListener("change", async () => {
  if (!lastSuccessEntries.length) return;
  statusEl.textContent = `Reformatting output to ${formatEl.value.toUpperCase()}...`;
  try {
    await refreshOutputFromCurrentData(formatEl.value);
    statusEl.textContent = "Output format updated.";
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});
orderEl.addEventListener("change", async () => {
  if (!lastSuccessEntries.length && !lastErrorEntries.length) return;
  statusEl.textContent = "Applying link order...";
  try {
    await refreshOutputFromCurrentData(lastFormat);
    statusEl.textContent = "Link order updated.";
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});
