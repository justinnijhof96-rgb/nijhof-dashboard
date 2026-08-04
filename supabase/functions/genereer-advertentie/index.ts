// Supabase Edge Function: genereer-advertentie
// Genereert titel + advertentietekst voor een advertentie op basis van de foto's,
// afmetingen, gegevens en het categorie-sjabloon.
//
// AI-provider is omschakelbaar via de secret AI_PROVIDER ('openai' of 'anthropic').
// Standaard: openai.
//
// Vereiste secrets (Supabase -> Edge Functions -> Secrets):
//   AI_PROVIDER        (optioneel, standaard 'openai')
//   OpenAI:    OPENAI_API_KEY   (verplicht) + OPENAI_MODEL   (optioneel, standaard 'gpt-4o')
//   Anthropic: ANTHROPIC_API_KEY (verplicht) + ANTHROPIC_MODEL (optioneel, standaard 'claude-sonnet-5')
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY worden automatisch geleverd.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Nette labels + welke maten in cm zijn (voor de {{specificaties}}-lijst)
const MAAT_LABELS: Record<string, string> = {
  breedte: "Breedte", diepte: "Diepte", diepte_lounge: "Diepte lounge",
  zitdiepte: "Zitdiepte", zitdiepte_lounge: "Zitdiepte lounge",
  zithoogte: "Zithoogte", hoogte: "Hoogte", zitplaatsen: "Aantal zitplaatsen",
  hoek: "Hoek", deuren: "Aantal deuren", planken: "Aantal planken/lades",
  vorm: "Vorm", lengte: "Lengte", diameter: "Diameter", matrasmaat: "Matrasmaat",
};
const CM_KEYS = new Set([
  "breedte", "diepte", "diepte_lounge", "zitdiepte", "zitdiepte_lounge",
  "zithoogte", "hoogte", "lengte", "diameter",
]);

// Zet de bezorgkeuze van de advertentie om in een nette regel voor de tekst.
// bezorging = { bezorgen: boolean, kosten: number }. 0 kosten = gratis.
function bezorgRegel(adv: any): string {
  const b = adv?.bezorging && typeof adv.bezorging === "object" ? adv.bezorging : {};
  if (b.bezorgen === false) return "Ophalen (bezorgen niet mogelijk).";
  const k = Number(b.kosten) || 0;
  return k > 0 ? `Bezorgen mogelijk (bezorgkosten € ${k}).` : "Bezorgen mogelijk, gratis in de regio.";
}

// Vult placeholders ({{breedte}}, {{materiaal}}, {{specificaties}}, ...) in de vaste
// sjabloon-tekst en verwijdert specificatie-regels die leeg blijven (niet ingevuld).
function fillPlaceholders(tekst: string, adv: any, item: any, maten: Record<string, unknown>): string {
  if (!tekst) return "";
  const map: Record<string, string> = {
    artikelnummer: String(item?.artikelnummer ?? ""),
    materiaal: String(adv?.materiaal ?? ""),
    kleur: String(adv?.kleur ?? ""),
    merk: String(adv?.merk ?? ""),
    staat: String(adv?.staat ?? ""),
    bijzonderheden: String(adv?.notitie ?? ""),
    vraagprijs: adv?.vraagprijs != null ? String(adv.vraagprijs) : "",
    type: String(adv?.rubriek ?? item?.categorie ?? ""),
    naam: String(item?.naam ?? ""),
    bezorging: bezorgRegel(adv),
  };
  for (const [k, v] of Object.entries(maten)) map[k] = v == null ? "" : String(v);

  // {{specificaties}}: alle ingevulde maten als "Label: waarde cm"
  const specLines: string[] = [];
  for (const [k, v] of Object.entries(maten)) {
    if (v == null || String(v).trim() === "") continue;
    const label = MAAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));
    specLines.push(`${label}: ${String(v).trim()}${CM_KEYS.has(k) ? " cm" : ""}`);
  }
  map["specificaties"] = specLines.join("\n");

  let out = tekst.replace(/\{\{(\w+)\}\}/g, (_m, k) => (k in map ? map[k] : ""));
  // Verwijder lege specificatie-regels: "Label:" (evt. gevolgd door 'cm') zonder waarde
  out = out.split("\n").filter((line) => !/^\s*[^:\n]+:\s*(cm)?\s*$/i.test(line)).join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

// ── MarktMonitor: realtime populaire zoektermen van Marktplaats ──────────────
// Scrapet de server-side gerenderde Nuxt-payload van de publieke MarktMonitor
// (marktmonitor.marktplaatszakelijk.nl) en haalt de gerelateerde zoektermen
// met zoekvolume eruit. Fail-soft: bij elke fout gewoon een lege lijst.
type MMTerm = { keyword: string; volume: number; trend: number };

function _devalueResolve(arr: any[], i: number, d = 0): any {
  if (d > 14 || typeof i !== "number" || i < 0 || i >= arr.length) return null;
  const TAGS = new Set(["ShallowReactive", "Reactive", "Ref", "ShallowRef"]);
  const v = arr[i];
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === "string" && TAGS.has(v[0])) return _devalueResolve(arr, v[1], d + 1);
    return v.map((x) => (typeof x === "number" ? _devalueResolve(arr, x, d + 1) : x));
  }
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, ix] of Object.entries(v)) o[k] = _devalueResolve(arr, ix as number, d + 1);
    return o;
  }
  return v;
}

async function haalMarktMonitorTermen(zoekwoord: string, timeoutMs = 6000): Promise<MMTerm[]> {
  const woord = (zoekwoord || "").trim().toLowerCase();
  if (!woord) return [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(
      `https://marktmonitor.marktplaatszakelijk.nl/detail/${encodeURIComponent(woord)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; NijhofBrothers-advertentie)" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) return [];
    const html = await r.text();
    const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const root = _devalueResolve(JSON.parse(m[1]), 0);
    for (const [k, v] of Object.entries((root?.data as Record<string, any>) || {})) {
      if (k.includes("related%2Fsearch") && Array.isArray((v as any)?.data)) {
        return ((v as any).data as any[])
          .map((x) => ({ keyword: String(x?.keyword || ""), volume: Number(x?.cumulative) || 0, trend: Number(x?.trend) || 0 }))
          .filter((x) => x.keyword)
          .slice(0, 10);
      }
    }
    return [];
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { advertentie_id } = await req.json().catch(() => ({}));
    if (!advertentie_id) return json({ error: "advertentie_id ontbreekt" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: adv, error: advErr } = await supabase
      .from("advertenties").select("*").eq("id", advertentie_id).single();
    if (advErr || !adv) return json({ error: "Advertentie niet gevonden" }, 404);

    const { data: item } = await supabase
      .from("items").select("*").eq("id", adv.item_id).single();

    const { data: sjab } = await supabase
      .from("advertentie_sjablonen").select("*")
      .eq("org_id", adv.org_id).eq("maat_profiel", adv.maat_profiel || "")
      .maybeSingle();

    // Foto's verzamelen (advertentiefoto's, anders de inkoopfoto)
    const fotos = Array.isArray(adv.fotos) ? adv.fotos : [];
    let imageUrls: string[] = fotos.map((f: any) => f?.url).filter(Boolean);
    if (imageUrls.length === 0 && item?.foto_url) imageUrls = [item.foto_url];
    imageUrls = imageUrls.slice(0, 8);

    const maten = adv.maten && typeof adv.maten === "object" ? adv.maten : {};
    const matenText = Object.entries(maten)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k}: ${v}`).join(", ") || "niet opgegeven";

    // Realtime MarktMonitor-zoektermen — DIEPER dan alleen categorie/merk. We zoeken op
    // meerdere ingangen zodat je specifieke termen als "ribstof" of "rib" ook meepakt,
    // niet alleen "hoekbank". Parallel (Promise.all → wall-clock ≈ traagste, niet som) en
    // fail-soft. Cap op 7 queries ivm rate-limiting op de publieke MarktMonitor.
    const _norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    const _categorie = _norm(item?.categorie);
    const _rubriek = adv.rubriek && !String(adv.rubriek).includes("|") ? _norm(adv.rubriek) : "";
    const _merk = _norm(adv.merk);
    const _materiaal = _norm(adv.materiaal || item?.stof);
    const _kleur = _norm(adv.kleur);
    const _hoofd = _categorie || _rubriek; // basiswoord voor combinaties (bv. "hoekbank")
    const _kandidaten: string[] = [_categorie, _rubriek, _merk, _materiaal, _kleur];
    // Samengesteld materiaal "ribstof" → ook los "rib" meepakken.
    if (_materiaal.endsWith("stof") && _materiaal.length > 5) _kandidaten.push(_materiaal.slice(0, -4));
    // Losse woorden uit een meerwoordig materiaal (bv. "gerecycled leer" → "leer").
    for (const w of _materiaal.split(/\s+/)) if (w.length > 2) _kandidaten.push(w);
    // Combinaties met het hoofdwoord: "hoekbank ribstof", "hoekbank grijs".
    if (_hoofd && _materiaal && _materiaal !== _hoofd) _kandidaten.push(`${_hoofd} ${_materiaal}`);
    if (_hoofd && _kleur) _kandidaten.push(`${_hoofd} ${_kleur}`);
    const zoekBasis = _kandidaten
      .map(_norm)
      .filter((s: string, i: number, a: string[]) => s && s.length > 1 && a.indexOf(s) === i)
      .slice(0, 7);
    const mmResultaten = await Promise.all(zoekBasis.map((w: string) => haalMarktMonitorTermen(w)));
    const mmTermen: MMTerm[] = [];
    for (const lijst of mmResultaten) {
      for (const t of lijst) {
        if (!mmTermen.some((x) => x.keyword === t.keyword)) mmTermen.push(t);
      }
    }
    mmTermen.sort((a, b) => b.volume - a.volume);
    const topTermen = mmTermen.slice(0, 10);
    const mmBlok = topTermen.length
      ? `\nActuele populaire zoektermen op Marktplaats voor dit type meubel (zoekvolume afgelopen 12 maanden, vandaag opgehaald):\n` +
        topTermen.map((t) => `- ${t.keyword} (${t.volume.toLocaleString("nl-NL")}${t.trend > 5 ? ", stijgend" : t.trend < -5 ? ", dalend" : ""})`).join("\n") +
        `\nVerwerk de best passende zoekterm(en) natuurlijk in de titel en beschrijving, maar UITSLUITEND als ze feitelijk kloppen met dit meubel (schrijf geen "leer" bij een stoffen bank). Geen keyword-stapeling.`
      : "";

    const feiten = [
      `Interne naam: ${item?.naam ?? ""}`,
      `Marktplaats-rubriek: ${adv.rubriek ?? item?.categorie ?? ""}`,
      `Staat: ${adv.staat ?? ""}`,
      `Merk: ${adv.merk ?? ""}`,
      `Materiaal: ${adv.materiaal ?? ""}`,
      `Kleur: ${adv.kleur ?? ""}`,
      `Afmetingen: ${matenText}`,
      `Vraagprijs: EUR ${adv.vraagprijs ?? ""}`,
      `Belangrijk om te benoemen (notitie): ${adv.notitie ?? "-"}`,
      `NIET vermelden: ${adv.niet_vermelden ?? "-"}`,
    ].join("\n");

    const systemPrompt =
`Je bent een ervaren tekstschrijver voor tweedehands meubeladvertenties op Marktplaats, voor meubelhandel Nijhof Brothers.
${sjab?.ai_instructie ?? "Schrijf een wervende maar eerlijke Nederlandse advertentie."}
${sjab?.titel_hint ? "Titelinstructie: " + sjab.titel_hint : "Titel: maximaal 60 tekens, type + merk + kleur/materiaal + sterk verkooppunt."}
Regels: gebruik alleen wat je op de foto's ziet of wat als feit is meegegeven, verzin niets. Schrijf de beschrijving in prettig leesbare korte alinea's en varieer de formuleringen per meubel (niet elke keer dezelfde zinnen). Neem in de beschrijving GEEN afmetingen, specificaties, bezorging, prijs of contactgegevens op — die staan al in de vaste tekst van de advertentie.${mmBlok}
Antwoord UITSLUITEND met geldige JSON in exact dit formaat, zonder extra tekst eromheen:
{"titel":"...","beschrijving":"..."}`;

    const userText = `Feiten over dit meubel:\n${feiten}\n\nBekijk de foto's en schrijf de titel en beschrijving.`;

    const provider = (Deno.env.get("AI_PROVIDER") || "openai").toLowerCase();
    let rawText = "";

    if (provider === "anthropic") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return json({ error: "ANTHROPIC_API_KEY niet ingesteld in Supabase secrets" }, 500);
      const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5";
      const content: any[] = [{ type: "text", text: userText }];
      for (const url of imageUrls) content.push({ type: "image", source: { type: "url", url } });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1200, system: systemPrompt, messages: [{ role: "user", content }] }),
      });
      if (!r.ok) {
        const t = await r.text();
        await supabase.from("advertenties").update({ laatste_fout: `AI-fout ${r.status}: ${t.slice(0, 300)}` }).eq("id", advertentie_id);
        return json({ error: `AI-fout ${r.status}`, detail: t.slice(0, 500) }, 502);
      }
      const j = await r.json();
      rawText = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    } else {
      // OpenAI (standaard)
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return json({ error: "OPENAI_API_KEY niet ingesteld in Supabase secrets" }, 500);
      const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o";
      const userContent: any[] = [{ type: "text", text: userText }];
      for (const url of imageUrls) userContent.push({ type: "image_url", image_url: { url } });
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        await supabase.from("advertenties").update({ laatste_fout: `AI-fout ${r.status}: ${t.slice(0, 300)}` }).eq("id", advertentie_id);
        return json({ error: `AI-fout ${r.status}`, detail: t.slice(0, 500) }, 502);
      }
      const j = await r.json();
      rawText = (j.choices?.[0]?.message?.content || "").trim();
    }

    let parsed: any = null;
    try { parsed = JSON.parse(rawText); }
    catch { const m = rawText.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } } }
    if (!parsed || !parsed.titel) {
      return json({ error: "AI gaf geen bruikbare JSON terug", raw: rawText.slice(0, 500) }, 502);
    }

    const titel = String(parsed.titel).slice(0, 60);
    const beschrijving = String(parsed.beschrijving || "");

    const intro = fillPlaceholders(sjab?.vaste_intro ? String(sjab.vaste_intro) : "", adv, item, maten).trim();
    const blokken = fillPlaceholders(sjab?.vaste_blokken ? String(sjab.vaste_blokken) : "", adv, item, maten).trim();
    const introDeel = intro ? intro + "\n\n" : "";
    let volledige = `${introDeel}${beschrijving.trim()}\n\n${blokken}`.trim();
    // Bezorging garanderen: als de sjabloon het niet al noemt (via {{bezorging}} of los),
    // plakken we de bezorgregel onderaan. Zo verdwijnt de bezorgkeuze niet meer.
    if (!/bezorg|ophalen/i.test(volledige)) volledige = `${volledige}\n\n${bezorgRegel(adv)}`.trim();

    const behoudStatus = ["live", "gereserveerd", "verkocht"].includes(adv.status);
    const nieuweStatus = behoudStatus ? adv.status : "gegenereerd";

    await supabase.from("advertenties").update({
      ai_titel: titel,
      ai_beschrijving: beschrijving,
      volledige_tekst: volledige,
      status: nieuweStatus,
      laatste_fout: null,
    }).eq("id", advertentie_id);

    return json({ ok: true, titel, beschrijving, volledige_tekst: volledige, zoektermen_gebruikt: topTermen });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
