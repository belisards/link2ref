const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const AI_TIMEOUT = Number(process.env.AI_TIMEOUT_MS) || 15000;
const MAX_TEXT_LENGTH = 4000;

const PROMPT = `Extract metadata from this academic/professional document text. Return ONLY valid JSON, no markdown, no explanation.

Required format:
{"title":"string","authors":"Last, First; Last, First","year":number or null,"publisher":"string or null","abstract":"string or null","documentType":"article|report|book|thesis"}

Rules:
- Extract only what is explicitly stated in the text
- authors in "Last, First" format separated by semicolons
- year is the publication/copyright year as a number
- If a field cannot be determined, use null
- Return ONLY the JSON object

Text:
`;

function parseJsonResponse(text) {
  if (!text) return null;
  let cleaned = text.replace(/```(?:json)?\s*\n?/g, "").replace(/\n?\s*```$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  cleaned = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || !parsed.title) return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title.trim() : null,
      authors: typeof parsed.authors === "string" ? parsed.authors.trim() : null,
      year: typeof parsed.year === "number" ? parsed.year : null,
      publisher: typeof parsed.publisher === "string" ? parsed.publisher.trim() : null,
      abstract: typeof parsed.abstract === "string" ? parsed.abstract.trim() : null,
      documentType: typeof parsed.documentType === "string" ? parsed.documentType : null,
    };
  } catch {
    return null;
  }
}

export async function extractMetadataWithAI(pdfText) {
  if (!AI_API_URL) return null;
  if (!pdfText || pdfText.trim().length < 50) return null;

  const truncated = pdfText.slice(0, MAX_TEXT_LENGTH);

  try {
    const headers = { "Content-Type": "application/json" };
    if (AI_API_KEY) headers["Authorization"] = `Bearer ${AI_API_KEY}`;

    const res = await Promise.race([
      fetch(AI_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "user", content: PROMPT + truncated }],
          temperature: 0,
        }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("AI timeout")), AI_TIMEOUT)),
    ]);

    if (!res.ok) throw new Error(`AI API ${res.status}`);

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;

    const metadata = parseJsonResponse(content);
    if (metadata) {
      console.log("[AI Extractor] Success");
    } else {
      console.warn("[AI Extractor] Failed to parse AI response");
    }
    return metadata;
  } catch (error) {
    console.error("[AI Extractor]", error.message || error);
    return null;
  }
}
