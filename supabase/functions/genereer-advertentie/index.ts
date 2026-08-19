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
// Labels van maat-specificaties (kleingeschreven) — alleen déze lege "Label:"-regels
// worden opgeschoond, zodat bewuste sjabloonkopjes ("Afmetingen:", "Kenmerken:") blijven.
const MAAT_LABEL_SET = new Set(Object.values(MAAT_LABELS).map((l) => l.toLowerCase()));
// Ook deze specificatieregels moeten verdwijnen als ze leeg blijven ("laat onbekende
// regels volledig weg"). Kopjes zonder dubbele punt ("Specificaties") blijven staan.
for (const l of ["materiaal", "kleur", "bijzonderheden", "staat", "merk", "type", "model"]) MAAT_LABEL_SET.add(l);

// Zet de bezorgkeuze van de advertentie om in een nette regel voor de tekst.
// bezorging = { bezorgen: boolean, kosten: number }. 0 kosten = gratis.
function bezorgRegel(adv: any): string {
  const b = adv?.bezorging && typeof adv.bezorging === "object" ? adv.bezorging : {};
  if (b.bezorgen === false) return "Ophalen (bezorgen niet mogelijk).";
  const k = Number(b.kosten) || 0;
  return k > 0 ? `Bezorgen mogelijk (bezorgkosten € ${k}).` : "Bezorgen mogelijk, gratis in de regio.";
}

// Marktplaats kapt titels boven de 60 tekens af. Nooit midden in een woord snijden:
// eerst hele " | "-blokken laten vallen, dan pas op woordgrens afkappen.
function kortTitel(t: string): string {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (s.length <= 60) return s;
  const delen = s.split(/\s*\|\s*/).filter(Boolean);
  while (delen.length > 1) {
    delen.pop();
    const kort = delen.join(" | ");
    if (kort.length <= 60) return kort;
  }
  const eerste = delen[0] || s;
  if (eerste.length <= 60) return eerste;
  const knip = eerste.slice(0, 60);
  const spatie = knip.lastIndexOf(" ");
  return (spatie > 30 ? knip.slice(0, spatie) : knip).trim();
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

  let out = tekst.replace(/\{\{(\w+)\}\}/g, (_m, k) => (Object.hasOwn(map, k) ? map[k] : ""));
  // Verwijder lege specificatie-regels ("Label:" evt. met 'cm'), maar ALLEEN als het label
  // een bekende maat is — anders zou een bewust kopje als "Afmetingen:" ook sneuvelen.
  out = out.split("\n").filter((line) => {
    const m = line.match(/^\s*([^:\n]+):\s*(cm)?\s*$/i);
    return !m || !MAAT_LABEL_SET.has(m[1].trim().toLowerCase());
  }).join("\n");
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

    // ── Autorisatie: de anon key is publiek, dus zonder deze check kan iedereen
    // met een advertentie_id teksten overschrijven en AI-calls op onze kosten
    // afvuren. Vereist: geldige gebruikers-JWT + lidmaatschap van de org.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
    const gebruiker = authData?.user;
    if (authErr || !gebruiker) return json({ error: "Niet ingelogd" }, 401);

    const { data: adv, error: advErr } = await supabase
      .from("advertenties").select("*").eq("id", advertentie_id).single();
    if (advErr || !adv) return json({ error: "Advertentie niet gevonden" }, 404);

    let lidQuery = supabase.from("org_members").select("org_id").eq("user_id", gebruiker.id);
    if (adv.org_id) lidQuery = lidQuery.eq("org_id", adv.org_id);
    const { data: lid } = await lidQuery.limit(1).maybeSingle();
    if (!lid) return json({ error: "Geen toegang tot deze advertentie" }, 403);

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
    // Combinaties EERST: die zijn het specifiekst en mogen niet door de cap sneuvelen
    // (bij een meerwoordig materiaal vulden de losse woorden anders de 7 plekken).
    const _kandidaten: string[] = [];
    if (_hoofd && _materiaal && _materiaal !== _hoofd) _kandidaten.push(`${_hoofd} ${_materiaal}`);
    if (_hoofd && _kleur) _kandidaten.push(`${_hoofd} ${_kleur}`);
    _kandidaten.push(_categorie, _rubriek, _merk, _materiaal, _kleur);
    // Samengesteld materiaal "ribstof" → ook los "rib" meepakken.
    if (_materiaal.endsWith("stof") && _materiaal.length > 5) _kandidaten.push(_materiaal.slice(0, -4));
    // Losse woorden uit een meerwoordig materiaal (bv. "gerecycled leer" → "leer").
    for (const w of _materiaal.split(/\s+/)) if (w.length > 2) _kandidaten.push(w);
    const zoekBasis = _kandidaten
      .map(_norm)
      .filter((s: string, i: number, a: string[]) => s && s.length > 1 && a.indexOf(s) === i)
      .slice(0, 7);
    // Alleen kleur/merk (zonder hoofdwoord) leveren vaak niet-meubel-termen op; die queries
    // markeren we als "zwak" zodat hun resultaten lager wegen dan meubel-specifieke queries.
    const _zwak = new Set([_merk, _kleur].filter((s) => s && !s.includes(" ")));
    const mmResultaten = await Promise.all(zoekBasis.map((w: string) => haalMarktMonitorTermen(w).then((r) => ({ w, r }))));
    const mmTermen: (MMTerm & { _score: number })[] = [];
    for (const { w, r } of mmResultaten) {
      const zwak = _zwak.has(w);
      for (const t of r) {
        if (mmTermen.some((x) => x.keyword === t.keyword)) continue;
        // Score: volume, gehalveerd voor zwakke bronqueries, verdubbeld als de term het
        // hoofdwoord bevat (dan is hij bijna zeker relevant voor dit meubel).
        const bevatHoofd = _hoofd && t.keyword.toLowerCase().includes(_hoofd);
        mmTermen.push({ ...t, _score: t.volume * (zwak ? 0.5 : 1) * (bevatHoofd ? 2 : 1) });
      }
    }
    mmTermen.sort((a, b) => b._score - a._score);
    const topTermen: MMTerm[] = mmTermen.slice(0, 10).map(({ _score, ...t }) => t);
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
`Je bent de vaste advertentiecopywriter van Nijhof Brothers, een familiebedrijf van twee broers uit Apeldoorn.
Schrijf alsof een goede menselijke meubelverkoper het meubel zélf heeft bekeken en het aan een klant uitlegt.

TOON
Rustig, zelfverzekerd, warm, verzorgd, betrouwbaar, toegankelijk, licht premium en menselijk.
Normaal, natuurlijk Nederlands. Aantrekkelijk, maar nooit overdreven verkooppraat.
De lezer moet denken: "Dit is een mooie, goede bank die netjes wordt aangeboden door een bedrijf dat weet wat het verkoopt."
Niet: "Dit is een AI-tekst." Varieer de zinsbouw per advertentie; niet elke advertentie dezelfde omschrijving.

VERTAAL EIGENSCHAPPEN NAAR BETEKENIS
Beschrijf niet alleen kenmerken, maar wat ze voor de koper betekenen.
NIET: "De bank heeft een zitdiepte van 62 cm." WEL: "De diepe zit geeft genoeg ruimte om comfortabel achterover of languit te zitten."
NIET: "De bank is beige." WEL: "De warme beige tint houdt de bank rustig en laat zich makkelijk combineren met natuurlijke en donkere materialen."
Doe dit alleen als het logisch voortkomt uit de meegegeven gegevens of duidelijk zichtbaar is op de foto's.

VERBODEN (generieke AI-taal — gebruik deze nooit)
"Ervaar ultiem comfort", "de perfecte mix van comfort en stijl", "een ware eyecatcher", "voegt een vleugje elegantie toe",
"transformeer uw woonkamer", "past perfect in ieder interieur", "een stijlvolle toevoeging aan uw interieur",
"optimaal comfort", "heerlijk ontspannen na een lange dag", "deze prachtige bank".
Vermijd ook clichés als "genoeg zitruimte voor het hele gezin" en "warme, moderne uitstraling".

VERBODEN (romantiseren van tweedehands)
Het meubel is GEEN artefact, erfstuk of object met een vorig leven. Nooit: "klaar voor een volgend hoofdstuk",
"een nieuw leven", "heeft al vele verhalen meegemaakt", "wacht op zijn volgende gezin", "een object met geschiedenis",
"tijdloos erfstuk". Leg ook geen onnodige nadruk op dat iemand het eerder gebruikt heeft.
De waarde zit in het meubel zelf + de selectie, reiniging en presentatie door Nijhof Brothers.

FEITELIJKHEID
Verzin NOOIT merk, model, afmetingen, materiaal, functies, leeftijd, herkomst, oorspronkelijke nieuwprijs, conditie,
afritsbare hoezen, elektrische functies of zitcomfort wanneer dat niet is meegegeven of duidelijk zichtbaar is.
Bij twijfel: weglaten.
${sjab?.ai_instructie ? "\nRUBRIEK-SPECIFIEK\n" + sjab.ai_instructie : ""}

TITEL (veld "titel")
Zoekvriendelijk en duidelijk, niet clickbait. Opbouw: [type meubel] + [belangrijk kenmerk] + [kleur/stof/merk indien relevant] + [sterk verkoopargument], gescheiden door " | ".
HARDE EIS: maximaal 60 tekens inclusief spaties — Marktplaats kapt langere titels af. Kort af waar nodig
(bijv. "Gereinigd" i.p.v. "Professioneel gereinigd") en laat het minst belangrijke deel weg. Tel je tekens.
${sjab?.titel_hint ? "Extra titelinstructie: " + sjab.titel_hint : ""}

KORTE KOP (veld "kop")
Circa 3 tot 7 woorden die de uitstraling van dít meubel vangen. Bijvoorbeeld: "Royaal comfort, rustige uitstraling",
"Ruim, zacht en uitnodigend", "Strakke vorm, comfortabele zit", "Rustig design met karakter".
Gebruik niet steeds dezelfde kop. Geen punt aan het eind.

BESCHRIJVING (veld "beschrijving")
Maximaal 2 à 3 korte alinea's, gescheiden door een lege regel.
Alinea 1: wat dit specifieke meubel aantrekkelijk maakt.
Alinea 2: vertaal vorm, zit, kleur, stof of formaat naar wat de koper ervaart.
Alinea 3: alleen bij een werkelijk relevante extra eigenschap.
Sluit af met een regel in de geest van: "Deze bank is door Nijhof Brothers geselecteerd, professioneel gereinigd en netjes klaargemaakt voor gebruik." (varieer de formulering; pas 'bank' aan het type meubel aan).
Neem GEEN afmetingen, specificatielijst, bezorging, prijs of contactgegevens op — die staan al in de vaste tekst eronder.

Kwaliteits- en lengtereferentie (stijlvoorbeeld, NIET letterlijk overnemen):
"Een ruime en comfortabele zithoek met bijpassende fauteuil, uitgevoerd in een warme grijs/antraciete stof.

De diepe zit, zachte kussens en brede armleuningen maken dit een set waar je echt goed in kunt ontspannen. Tegelijk zorgen de rustige lijnen en neutrale kleur ervoor dat hij makkelijk zijn plek vindt in zowel een modern als warm interieur.

De bank is door Nijhof Brothers geselecteerd, professioneel gereinigd en netjes klaargemaakt voor gebruik."

GRAMMATICA
Pas woordkeus aan het werkelijke type aan: losse bank, hoekbank, fauteuil, zithoek, dressoir, tafel enzovoort.${mmBlok}

Antwoord UITSLUITEND met geldige JSON in exact dit formaat, zonder extra tekst eromheen:
{"titel":"...","kop":"...","beschrijving":"..."}`;

    const userText = `Feiten over dit meubel:\n${feiten}\n\nBekijk de foto's en schrijf de titel, de korte kop en de beschrijving.`;

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

    const titel = kortTitel(String(parsed.titel));
    // De korte kop hoort bovenaan het verhaal-gedeelte, zodat élke afnemer (preview,
    // Marktplaats-tekst, Shopify-omschrijving) hem automatisch meekrijgt.
    const kop = String(parsed.kop || "").trim().replace(/[.\s]+$/, "");
    const verhaal = String(parsed.beschrijving || "").trim();
    const beschrijving = kop ? `${kop}\n\n${verhaal}` : verhaal;

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
