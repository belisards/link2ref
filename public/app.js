const singleEl = document.getElementById("single");
const batchEl = document.getElementById("batch");
const formatEl = document.getElementById("format");
const outputEl = document.getElementById("output");
const statusEl = document.getElementById("status");
const errorsEl = document.getElementById("errors");
const outputTitleEl = document.querySelector(".output-panel h2");

let lastCsl = [];
let lastErrors = [];
let lastFormat = "csl_json";
let lastOutput = [];

function parseInputs() {
  const single = singleEl.value.trim();
  const batch = batchEl.value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);

  const links = [...(single ? [single] : []), ...batch];
  return Array.from(new Set(links));
}

async function run() {
  const links = parseInputs();
  const format = formatEl.value || "csl_json";
  if (!links.length) {
    statusEl.textContent = "Add at least one link.";
    return;
  }

  statusEl.textContent = `Processing ${links.length} link(s)...`;

  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links, format }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }

    lastCsl = data.csl || [];
    lastFormat = data.format || format;
    lastOutput = data.output || [];
    lastErrors = (data.results || [])
      .filter((item) => !item.ok)
      .map((item) => ({
        input: item.input,
        normalized: item.normalized || null,
        error: item.error || "Unknown error",
      }));

    outputTitleEl.textContent = lastFormat === "apa" ? "APA Output" : "CSL-JSON Output";
    outputEl.textContent =
      lastFormat === "apa"
        ? lastOutput.join("\n\n")
        : JSON.stringify(lastOutput, null, 2);
    errorsEl.textContent = JSON.stringify(lastErrors, null, 2);
    statusEl.textContent = `Done. ${data.success}/${data.total} converted, ${data.failed} failed.`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
    errorsEl.textContent = JSON.stringify(
      [{ input: null, normalized: null, error: error.message }],
      null,
      2
    );
  }
}

function clearAll() {
  singleEl.value = "";
  batchEl.value = "";
  lastCsl = [];
  lastOutput = [];
  lastFormat = "csl_json";
  lastErrors = [];
  outputEl.textContent = "[]";
  outputTitleEl.textContent = "CSL-JSON Output";
  errorsEl.textContent = "[]";
  statusEl.textContent = "";
}

function download() {
  const isApa = lastFormat === "apa";
  const contents = isApa ? lastOutput.join("\n\n") : JSON.stringify(lastOutput, null, 2);
  const blob = new Blob([contents], {
    type: isApa ? "text/plain" : "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = isApa ? "citations-apa.txt" : "csl.json";
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("run").addEventListener("click", run);
document.getElementById("clear").addEventListener("click", clearAll);
document.getElementById("download").addEventListener("click", download);
