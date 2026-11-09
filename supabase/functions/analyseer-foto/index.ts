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
import { logApi } from "../_shared/api-gebruik.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Standaard maat-sleutels: zo heten de vaste velden in de app (en de webshop-metafields).
// Alles wat daarbuiten op de maatfoto staat komt OOK mee, onder een eigen beschrijvende
// sleutel — de advertentietekst moet élke maat van de foto bevatten, niet alleen deze.
const MAAT_KEYS = [
  "breedte", "diepte", "hoogte", "zithoogte", "zitdiepte", "diepte_lounge",
  "zitdiepte_lounge", "lengte", "diameter", "matrasmaat", "vorm", "deuren", "planken", "zitplaatsen",
];
const MAX_MATEN = 40;
// Veelvoorkomende varianten terug naar de standaardsleutel, zodat de vaste velden gevuld raken.
const MAAT_SYNONIEM: Record<string, string> = {
  totale_breedte: "breedte", breedte_totaal: "breedte", totale_lengte: "lengte", lengte_totaal: "lengte",
  totale_hoogte: "hoogte", hoogte_totaal: "hoogte", totale_diepte: "diepte", diepte_totaal: "diepte",
  zit_hoogte: "zithoogte", zit_diepte: "zitdiepte",
  lounge_diepte: "diepte_lounge", diepte_chaise_longue: "diepte_lounge", diepte_chaise: "diepte_lounge",
  lengte_lounge: "diepte_lounge", lengte_chaise_longue: "diepte_lounge", lengte_chaise: "diepte_lounge",
  lounge_zitdiepte: "zitdiepte_lounge", zitdiepte_chaise_longue: "zitdiepte_lounge", zitdiepte_chaise: "zitdiepte_lounge",
  aantal_zitplaatsen: "zitplaatsen", aantal_deuren: "deuren", aantal_planken: "planken", aantal_lades: "planken",
};
// Sleutel normaliseren: kleine letters, geen accenten, underscores, max 40 tekens.
function maatSleutel(k: unknown): string {
  let s = String(k ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\(cm\)|\bcm\b/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return MAAT_SYNONIEM[s] || s;
}
// Waarde als tekst, zonder "cm" erachter (de tekstgenerator zet dat er zelf bij).
function maatWaarde(v: unknown): string {
  return String(v ?? "").trim().replace(/\s*cm\.?$/i, "").trim().slice(0, 40);
}

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
Op de foto staan meestal AFMETINGEN geschreven of getekend (bijvoorbeeld "breedte 310", "diepte 95", "zithoogte 45", "rugleuning 85", "armleuning 20").
Neem ÁLLE afmetingen over die op de foto staan, exact zoals ze er staan. Laat er geen één weg: elke maat op de foto moet in de advertentie komen.
Bepaal daarnaast het materiaal en de kleur, en kies de best passende Marktplaats-rubriek.

- 'rubriek': kies UITSLUITEND één waarde uit deze lijst: ${rubriekLijst}.
- 'maten': een object met ALLE afmetingen die op de foto staan, in centimeters (alleen het getal, zonder "cm").
  Gebruik deze standaardsleutels waar ze passen: breedte (totale breedte; bij een bank of zithoek de lange zijde), diepte (totale diepte), hoogte (totale hoogte), zithoogte, zitdiepte, diepte_lounge (totale diepte of lengte van het lounge- of chaise-longuedeel), zitdiepte_lounge, lengte, diameter, matrasmaat (bv. "140x200"), vorm (rond/rechthoek/ovaal), deuren, planken, zitplaatsen.
  Staat er een maat op die hier niet bij past, geef die dan een eigen korte sleutel in het Nederlands, kleine letters met underscores, bijvoorbeeld: hoogte_rugleuning, hoogte_armleuning, breedte_armleuning, breedte_zitting, diepte_zitting, hoogte_poten, breedte_chaise_longue, lengte_korte_zijde, lengte_lange_zijde, hoogte_hoofdsteun, dikte_blad, hoogte_onderkant.
  Elke maat krijgt zijn eigen sleutel; voeg nooit twee maten samen. Laat alleen maten weg die écht niet op de foto staan.
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
        body: JSON.stringify({ model, max_tokens: 1200, system: systemPrompt, messages: [{ role: "user", content }] }),
      });
      if (!r.ok) { const t = await r.text(); return json({ error: `AI-fout ${r.status}`, detail: t.slice(0, 500) }, 502); }
      const j = await r.json();
      await logApi({ bron: "analyseer-foto", provider: "anthropic", model: j.model || model, usage: j.usage });
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
      await logApi({ bron: "analyseer-foto", provider: "openai", model: j.model || model, usage: j.usage });
      rawText = (j.choices?.[0]?.message?.content || "").trim();
    }

    let parsed: any = null;
    try { parsed = JSON.parse(rawText); }
    catch { const m = rawText.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } } }
    if (!parsed || typeof parsed !== "object") {
      return json({ error: "AI gaf geen bruikbare JSON terug", raw: rawText.slice(0, 400) }, 502);
    }

    // ALLE maten doorlaten (niet alleen de standaardsleutels), als string; sleutels
    // genormaliseerd zodat de vaste velden in de app en de extra velden netjes gevuld raken.
    // Voorheen bleef alleen MAAT_KEYS over, waardoor maten als "hoogte rugleuning" stil
    // verdwenen en nooit in de advertentietekst kwamen.
    const maten: Record<string, string> = {};
    const voegToe = (rk: unknown, rv: unknown) => {
      if (Object.keys(maten).length >= MAX_MATEN) return;
      const k = maatSleutel(rk), v = maatWaarde(rv);
      if (!k || !v || maten[k]) return;
      maten[k] = v;
    };
    if (Array.isArray(parsed.maten)) {
      // Mocht het model een lijst teruggeven: [{sleutel/naam/label, waarde/value}]
      for (const m of parsed.maten) {
        if (m && typeof m === "object") voegToe(m.sleutel ?? m.naam ?? m.label ?? m.key, m.waarde ?? m.value);
      }
    } else if (parsed.maten && typeof parsed.maten === "object") {
      // Standaardsleutels eerst (vaste volgorde in het formulier), daarna de rest zoals gelezen.
      for (const k of MAAT_KEYS) if (parsed.maten[k] != null) voegToe(k, parsed.maten[k]);
      for (const [rk, rv] of Object.entries(parsed.maten)) voegToe(rk, rv);
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
