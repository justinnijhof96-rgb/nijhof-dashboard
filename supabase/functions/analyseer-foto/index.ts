// Supabase Edge Function: analyseer-foto
// Leest UIT een enkele hulpfoto (met de afmetingen erop geschreven) de velden voor een
// advertentie: rubriek, maten, materiaal, kleur. Genereert GEEN advertentietekst — dat
// blijft een aparte stap. De hulpfoto wordt niet opgeslagen; hij komt als base64 mee.
//
// Zelfde AI-provider-schakelaar als genereer-advertentie:
//   AI_PROVIDER  ('openai' | 'anthropic', standaard 'openai')
//   OpenAI:    OPENAI_API_KEY (+ OPENAI_MODEL, standaard 'gpt-4o')
//   Anthropic: ANTHROPIC_API_KEY (+ ANTHROPIC_MODEL, standaard 'claude-sonnet-5')

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Standaard maat-sleutels (de unie van alle maat-profielen in de app). De AI gebruikt
// hiervan wat van toepassing is; de app vult ze in de juiste profielvelden.
const MAAT_KEYS = [
  "breedte", "diepte", "hoogte", "zithoogte", "zitdiepte", "diepte_lounge",
  "zitdiepte_lounge", "lengte", "diameter", "matrasmaat", "vorm", "deuren", "planken", "zitplaatsen",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({} as any));
    const imageB64: string = body?.image_base64 || "";
    const mediaType: string = body?.media_type || "image/jpeg";
    const rubrieken: string[] = Array.isArray(body?.rubrieken) ? body.rubrieken : [];
    if (!imageB64) return json({ error: "image_base64 ontbreekt" }, 400);

    // --- Autorisatie: geldige gebruikers-JWT + lidmaatschap van een org ---
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
    const gebruiker = authData?.user;
    if (authErr || !gebruiker) return json({ error: "Niet ingelogd" }, 401);
    const { data: lid } = await supabase
      .from("org_members").select("org_id").eq("user_id", gebruiker.id).limit(1).maybeSingle();
    if (!lid) return json({ error: "Geen toegang" }, 403);

    const rubriekLijst = rubrieken.length ? rubrieken.join(", ") : "(geen lijst meegegeven — gebruik een korte, gangbare Marktplaats-rubriek)";

    const systemPrompt =
`Je analyseert een foto van een tweedehands meubel voor een Marktplaats-advertentie van meubelhandel Nijhof Brothers.
Op de foto staan mogelijk AFMETINGEN geschreven (bijvoorbeeld "breedte 310", "diepte 95", "zithoogte 45"). Lees die exact over.
Bepaal daarnaast het materiaal en de kleur, en kies de best passende Marktplaats-rubriek.

- 'rubriek': kies UITSLUITEND één waarde uit deze lijst: ${rubriekLijst}.
- 'maten': een object met ALLEEN de afmetingen die je op de foto ziet, in centimeters (getallen zonder "cm"). Gebruik waar van toepassing deze sleutels: ${MAAT_KEYS.join(", ")}. Voor een tafel mag 'vorm' een woord zijn (rond/rechthoek/ovaal). Laat maten die je niet ziet gewoon weg.
- 'materiaal' en 'kleur': kort (bv. "ribstof", "eiken", "leer" / "bruin", "antraciet").

Verzin niets. Als je iets niet zeker weet, laat het veld leeg of weg.
Antwoord UITSLUITEND met geldige JSON in exact dit formaat, zonder extra tekst eromheen:
{"rubriek":"...","maten":{},"materiaal":"...","kleur":"..."}`;

    const userText = "Analyseer deze foto en geef de JSON met rubriek, maten, materiaal en kleur.";
    const provider = (Deno.env.get("AI_PROVIDER") || "openai").toLowerCase();
    let rawText = "";

    if (provider === "anthropic") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return json({ error: "ANTHROPIC_API_KEY niet ingesteld in Supabase secrets" }, 500);
      const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5";
      const content: any[] = [
        { type: "text", text: userText },
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
      ];
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 700, system: systemPrompt, messages: [{ role: "user", content }] }),
      });
      if (!r.ok) { const t = await r.text(); return json({ error: `AI-fout ${r.status}`, detail: t.slice(0, 500) }, 502); }
      const j = await r.json();
      rawText = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    } else {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return json({ error: "OPENAI_API_KEY niet ingesteld in Supabase secrets" }, 500);
      const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o";
      const userContent: any[] = [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageB64}` } },
      ];
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) { const t = await r.text(); return json({ error: `AI-fout ${r.status}`, detail: t.slice(0, 500) }, 502); }
      const j = await r.json();
      rawText = (j.choices?.[0]?.message?.content || "").trim();
    }

    let parsed: any = null;
    try { parsed = JSON.parse(rawText); }
    catch { const m = rawText.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } } }
    if (!parsed || typeof parsed !== "object") {
      return json({ error: "AI gaf geen bruikbare JSON terug", raw: rawText.slice(0, 400) }, 502);
    }

    // Alleen bekende maat-sleutels doorlaten, als string (de app vult ze als tekst in).
    const maten: Record<string, string> = {};
    if (parsed.maten && typeof parsed.maten === "object") {
      for (const k of MAAT_KEYS) {
        const v = parsed.maten[k];
        if (v != null && String(v).trim() !== "") maten[k] = String(v).trim();
      }
    }

    return json({
      rubriek: parsed.rubriek ? String(parsed.rubriek) : "",
      maten,
      materiaal: parsed.materiaal ? String(parsed.materiaal) : "",
      kleur: parsed.kleur ? String(parsed.kleur) : "",
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
