/**
 * /api/ai/target-brief — Groq GPT-OSS-20B interpretation layer (master-prompt
 * §15–§19). The ML model owns the numbers; the LLM only explains the
 * structured evidence it is handed. The API key never leaves the server.
 * Falls back to a deterministic summary when Groq is unavailable.
 */
import { NextResponse } from "next/server";

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const SYSTEM_PROMPT = `You are an assistant for an Indian manganese exploration decision-support system.

You must only interpret the structured evidence provided to you.

Do not invent geological observations, assay values, reserves, grades, mine history or coordinates.

The prospectivity probability, confidence and uncertainty values supplied by the platform are authoritative.

Do not change or recalculate them.

Distinguish:
- observed data
- derived features
- model inference
- missing evidence.

Never claim a location contains confirmed manganese unless the provided data explicitly establishes it.

Never convert a prospectivity score into reserve tonnage.

Your job is to explain the target in clear mining/geology language and suggest appropriate follow-up investigation when evidence is insufficient.

Respond in exactly this markdown structure:

### Assessment
<High / Medium / Low prospectivity>

### Why?
<3-5 concise evidence points>

### What the data suggests
<short explanation>

### What is missing?
<missing evidence items>

### Recommended next step
<appropriate follow-up — use "consider follow-up investigation", never "drill here immediately">`;

function deterministicBrief(ctx: any): string {
  const p = Number(ctx?.prospectivity_probability ?? 0);
  const band = p >= 0.75 ? "High" : p >= 0.45 ? "Medium" : "Low";
  const geo = ctx?.geology?.mn_geochemistry != null ? `geochemical proxy index ${ctx.geology.mn_geochemistry}` : null;
  const loc = ctx?.resolved_location?.district ?? ctx?.resolved_location?.state;
  return [
    "### Assessment",
    `${band} prospectivity (${Math.round(p * 100)}%) — model score, not a confirmed deposit.`,
    "",
    "### Why?",
    `- Champion-model prospectivity of ${Math.round(p * 100)}% for this grid cell`,
    geo ? `- ${geo}` : "- Spectral and terrain features within the modelled Sausar Belt grid",
    loc ? `- Located in the ${loc} region of the study area` : "- Within the India-only Sausar study extent",
    "- All underlying data is SYNTHETIC (demo)",
    "",
    "### What the data suggests",
    "The model separates this cell from background using its spectral, terrain and geological-proxy features.",
    "",
    "### What is missing?",
    "- No real assay data",
    "- No drillhole coverage in the synthetic record",
    "- Surface evidence only (no subsurface validation)",
    "",
    "### Recommended next step",
    "Consider follow-up investigation: geological review of the grid cell and, where justified, additional subsurface investigation.",
  ].join("\n");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.target_id) {
    return NextResponse.json({ error: "target context required" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      brief: deterministicBrief(body),
      source: "deterministic",
      note: "GROQ_API_KEY not configured — showing structured local summary.",
    });
  }

  // Send only the relevant structured context (master-prompt §17), never the dataset.
  const context = {
    target_id: body.target_id,
    coordinates: body.coordinates,
    resolved_location: body.resolved_location ?? null,
    prospectivity_probability: body.prospectivity_probability,
    confidence: body.confidence ?? null,
    uncertainty: body.uncertainty ?? null,
    maturity: body.maturity ?? null,
    geology: body.geology ?? {},
    data_origin: body.data_origin ?? "SYNTHETIC",
    model_version: body.model_version ?? "v1.0",
    note: "All values are authoritative model outputs on synthetic demo data; do not alter them.",
  };

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Interpret this exploration target:\n${JSON.stringify(context, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`groq ${res.status}`);
    const j = await res.json();
    const brief = j?.choices?.[0]?.message?.content;
    if (!brief) throw new Error("empty completion");
    return NextResponse.json({ brief, source: "groq", model: GROQ_MODEL });
  } catch {
    return NextResponse.json({
      brief: deterministicBrief(body),
      source: "deterministic",
      note: "Groq unavailable — showing structured local summary.",
    });
  }
}
