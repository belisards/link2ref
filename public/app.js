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

function parseInputs() {
  const raw = batchEl.value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(raw));
  if (orderEl.value === "alphabetical") {
    unique.sort((a, b) => a.localeCompare(b));
  }
  return unique;
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
  renderOutput();
}

function renderUniqueCount() {
  const uniqueCount = parseInputs().length;
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
  const links = parseInputs();
  const format = formatEl.value || "csl_json";
  if (!links.length) {
    statusEl.textContent = "Add at least one link.";
    return;
  }

  statusEl.textContent = `Processing ${links.length} unique link(s)...`;
  renderUniqueCount();
  showProgress(0, links.length);

  try {
    const aggregated = {
      total: links.length,
      success: 0,
      failed: 0,
      csl: [],
      results: [],
    };

    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      // Process one link at a time so progress reflects real completion.
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: [link], format: "csl_json" }),
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
    lastErrors = aggregated.results
      .filter((item) => !item.ok)
      .map((item) => ({
        input: item.input,
        normalized: item.normalized || null,
        error: item.error || "Unknown error",
      }));

    await reformatFromCsl(format);
    renderOutput();
    renderFailures();
    statusEl.textContent = `Done. ${aggregated.success}/${aggregated.total} converted, ${aggregated.failed} failed.`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
    lastErrors = [{ input: null, normalized: null, error: error.message }];
    renderFailures();
  } finally {
    hideProgress();
  }
}

function clearAll() {
  batchEl.value = "";
  lastCsl = [];
  lastOutput = [];
  lastFormat = "apa";
  lastErrors = [];
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

document.getElementById("run").addEventListener("click", run);
document.getElementById("clear").addEventListener("click", clearAll);
document.getElementById("download").addEventListener("click", download);
formatEl.addEventListener("change", async () => {
  if (!lastCsl.length) return;
  statusEl.textContent = `Reformatting output to ${formatEl.value.toUpperCase()}...`;
  try {
    await reformatFromCsl(formatEl.value);
    statusEl.textContent = "Output format updated.";
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});
