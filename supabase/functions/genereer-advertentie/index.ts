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
Regels: gebruik alleen wat je op de foto's ziet of wat als feit is meegegeven, verzin niets. Schrijf de beschrijving in prettig leesbare korte alinea's. Neem de afmetingen op in de beschrijving. Sluit de beschrijving NIET af met contactgegevens, bezorging of prijs (dat staat al in de vaste tekst).
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

    const intro = sjab?.vaste_intro ? String(sjab.vaste_intro).trim() + "\n\n" : "";
    let blokken = sjab?.vaste_blokken ? String(sjab.vaste_blokken) : "";
    blokken = blokken.replace(/\{\{artikelnummer\}\}/g, item?.artikelnummer || "");
    const volledige = `${intro}${beschrijving}\n\n${blokken}`.trim();

    const behoudStatus = ["live", "gereserveerd", "verkocht"].includes(adv.status);
    const nieuweStatus = behoudStatus ? adv.status : "gegenereerd";

    await supabase.from("advertenties").update({
      ai_titel: titel,
      ai_beschrijving: beschrijving,
      volledige_tekst: volledige,
      status: nieuweStatus,
      laatste_fout: null,
    }).eq("id", advertentie_id);

    return json({ ok: true, titel, beschrijving, volledige_tekst: volledige });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
