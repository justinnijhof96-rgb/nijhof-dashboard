// Supabase Edge Function: plaats-advertentie
// Maakt/updatet het Shopify-product voor een advertentie via productSet (idempotent
// op handle/id). Handelt ook de status-acties af. De Marktplaats Pro (Woosify) app
// publiceert het product daarna als Admarkt-advertentie.
//
// actie: 'plaatsen' | 'reserveren' | 'terug_online' | 'verkocht' | 'verwijderen'
//
// Vereiste secrets (Supabase -> Edge Functions -> Secrets):
//   SHOPIFY_STORE          (bv. btvcpm-ny.myshopify.com)
//   SHOPIFY_ADMIN_TOKEN    (Admin API token met scope write_products)
//   SHOPIFY_API_VERSION    (optioneel, standaard 2025-01)
//   SHOPIFY_LOCATION_ID    (optioneel, standaard de winkel-locatie)
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

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textToHtml(t: unknown): string {
  // Marktplaats (via de Woosify/Marktplaats Pro-sync) zet de Shopify-body_html om naar
  // platte tekst: elke <br> wordt één regeleinde, maar <p>-alineagrenzen werden tot één
  // regel samengeperst — daardoor verdwenen alle witregels op Marktplaats. We coderen
  // daarom ELK regeleinde als <br> (lege regel = <br><br>), zodat de opmaak 1-op-1
  // meekomt op Marktplaats én op de webshop.
  return escapeHtml(String(t ?? "").replace(/\r\n/g, "\n")).replace(/\n/g, "<br>");
}
function slugify(s: unknown): string {
  const base = String(s ?? "").toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || ("nb-" + Math.abs(Date.now()));
}

// De exacte producttypes van de slimme collecties in de webshop. Elk hiervan is in de
// Marktplaats Pro-app (Woosify) gekoppeld aan een Marktplaats-rubriek. Het Shopify-
// producttype MOET precies één van deze waarden zijn, anders valt het product buiten
// elke gekoppelde collectie en verschijnt de advertentie NIET op Marktplaats.
const COLLECTIES: string[] = [
  "Bankstellen", "Barkrukken", "Bedden", "Bijzettafels", "Boekenkasten", "Boxsprings",
  "Buffetkasten", "Bureaus", "Dressoirs", "Eettafels", "Fauteuils", "Kaptafels",
  "Kledingkasten", "Ladekasten", "Matrassen en Bedbodems", "Nachtkastjes", "Salontafels",
  "Schilderijen", "Schoenenkasten", "Secretaires", "Sidetables", "Slaapbanken", "Sofa's en Chaises Longues",
  "Stoelen", "Tapijten en Kleden", "Televisiemeubels", "Vitrinekasten",
  "Voetenbanken en Poefen", "Wandmeubels",
];
const _COLL_LC: Record<string, string> = {};
for (const c of COLLECTIES) _COLL_LC[c.toLowerCase()] = c;

// Marktplaats-rubriek OF dashboard-categorie (lowercase) -> exacte collectienaam, voor
// gevallen waar de naam afwijkt van de collectie. Rubrieken die 1-op-1 gelijk zijn aan
// een collectie staan hier NIET (die worden direct via _COLL_LC herkend).
const NAAR_COLLECTIE: Record<string, string> = {
  // dashboard-categorieën (grof)
  "bank": "Bankstellen", "hoekbank": "Bankstellen", "loveseat": "Bankstellen", "bankstel": "Bankstellen",
  "fauteuil": "Fauteuils", "dressoir": "Dressoirs", "stoel": "Stoelen",
  "kast": "Kledingkasten", "kledingkast": "Kledingkasten",
  // Marktplaats-rubrieken die anders heten dan hun collectie
  "complete zithoeken": "Bankstellen",
  "bureaustoelen": "Stoelen",
  "krukjes": "Voetenbanken en Poefen",
  "zitzakken": "Fauteuils",
  "computermeubels": "Bureaus",
  "roldeurkasten en archiefkasten": "Kledingkasten",
  "schoenenrekken": "Schoenenkasten",
  "stellingkasten": "Boekenkasten",
  "kasten - overige": "Kledingkasten",
  "barren": "Sidetables",
  "statafels": "Eettafels",
  "stapelbedden en hoogslapers": "Bedden",
  "waterbedden": "Bedden",
  "complete slaapkamers": "Bedden",
};

// Bepaal het Shopify-producttype (= collectienaam). De RUBRIEK is leidend (specifiek);
// de dashboard-categorie is alleen terugval. Zo belandt bv. een buffetkast met interne
// categorie "kast" tóch in de Buffetkasten-collectie i.p.v. Kledingkasten.
function collectieType(rubriek: unknown, categorie: unknown): string {
  const rub = String(rubriek ?? "").trim();
  const cat = String(categorie ?? "").trim();
  return _COLL_LC[rub.toLowerCase()]        // rubriek == collectie
    || NAAR_COLLECTIE[rub.toLowerCase()]    // rubriek via alias
    || NAAR_COLLECTIE[cat.toLowerCase()]    // categorie via alias
    || _COLL_LC[cat.toLowerCase()]          // categorie == collectie
    || rub || cat || "";                    // terugval (valt buiten collecties -> waarschuwing)
}
// Is een berekend producttype een bestaande, gekoppelde collectie?
function isGemapteCollectie(type: unknown): boolean {
  return !!_COLL_LC[String(type ?? "").trim().toLowerCase()];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const advertentie_id = body?.advertentie_id;
    const actie = body?.actie || "plaatsen";
    if (!advertentie_id) return json({ error: "advertentie_id ontbreekt" }, 400);

    const store = Deno.env.get("SHOPIFY_STORE");
    const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
    const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
    const apiVersion = Deno.env.get("SHOPIFY_API_VERSION") || "2025-01";
    const locationId = Deno.env.get("SHOPIFY_LOCATION_ID") || "gid://shopify/Location/121363857747";
    if (!store || !clientId || !clientSecret) {
      return json({ error: "SHOPIFY_STORE, SHOPIFY_CLIENT_ID of SHOPIFY_CLIENT_SECRET niet ingesteld in Supabase secrets" }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Autorisatie: de anon key is publiek, dus zonder deze check kan iedereen
    // met een advertentie_id advertenties live/offline zetten en voorraaditems
    // omzetten. Vereist: geldige gebruikers-JWT + lidmaatschap van de org.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
    const gebruiker = authData?.user;
    if (authErr || !gebruiker) return json({ error: "Niet ingelogd" }, 401);

    const { data: adv } = await supabase
      .from("advertenties").select("*").eq("id", advertentie_id).single();
    if (!adv) return json({ error: "Advertentie niet gevonden" }, 404);

    let lidQuery = supabase.from("org_members").select("org_id").eq("user_id", gebruiker.id);
    if (adv.org_id) lidQuery = lidQuery.eq("org_id", adv.org_id);
    const { data: lid } = await lidQuery.limit(1).maybeSingle();
    if (!lid) return json({ error: "Geen toegang tot deze advertentie" }, 403);
    const { data: item } = await supabase
      .from("items").select("*").eq("id", adv.item_id).single();

    // Dev Dashboard custom app: wissel client-ID + secret in voor een access token
    // (client credentials grant; token is ~24u geldig). Per invocatie eenmaal opgehaald.
    let _token: string | null = null;
    const getToken = async () => {
      if (_token) return _token;
      const tr = await fetch(`https://${store}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
      });
      const tj = await tr.json().catch(() => ({}));
      if (!tr.ok || !tj.access_token) {
        throw new Error("Shopify auth mislukt: " + JSON.stringify(tj).slice(0, 300));
      }
      _token = tj.access_token as string;
      return _token;
    };
    const shopify = async (query: string, variables: unknown) => {
      const tok = await getToken();
      const r = await fetch(`https://${store}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const j = await r.json();
      if (j.errors) throw new Error("Shopify: " + JSON.stringify(j.errors).slice(0, 400));
      return j.data;
    };

    // --- Afgeleide waarden op basis van de actie ---
    const isReserveren = actie === "reserveren";
    const isVerkocht = actie === "verkocht";
    const isVerwijderen = actie === "verwijderen";

    const baseTitel = adv.ai_titel || item?.naam || "Meubel";
    const titel = isReserveren ? ("GERESERVEERD - " + baseTitel).slice(0, 255) : baseTitel;
    const qty = (isVerkocht || isVerwijderen) ? 0 : 1;
    // Verkocht en verwijderen halen het product offline (DRAFT + van de kanalen af):
    // een verkocht meubel mag geen klikken/CPC meer kosten en hoort niet meer op de
    // webshop. De records (advertentie + item) blijven wel gewoon bestaan.
    const offline = isVerwijderen || isVerkocht;
    const shopifyStatus = offline ? "DRAFT" : "ACTIVE";

    // Bij live gaan (plaatsen/reserveren/terug_online) moet er een geldige vraagprijs zijn,
    // anders staat het product ACTIVE voor € 0 op de webshop/Marktplaats.
    if (!offline && !(Number(adv.vraagprijs) > 0)) {
      return json({ error: "Geen geldige vraagprijs — vul eerst een vraagprijs in voordat je de advertentie plaatst." }, 400);
    }

    const tags = ["marktplaats"];
    if (adv.merk) tags.push(String(adv.merk));
    if (adv.kleur) tags.push(String(adv.kleur));
    if (adv.maat_profiel) tags.push(String(adv.maat_profiel));
    if (isVerkocht) tags.push("verkocht");
    if (isReserveren) tags.push("gereserveerd");

    const artikelnr = item?.artikelnummer || null;
    const descHtml = textToHtml(adv.volledige_tekst || adv.ai_beschrijving || "");

    const variant: any = {
      optionValues: [{ optionName: "Title", name: "Default Title" }],
      price: String(adv.vraagprijs ?? 0),
      inventoryPolicy: "DENY",
      inventoryItem: { tracked: true, ...(artikelnr ? { sku: artikelnr } : {}) },
      inventoryQuantities: [{ locationId, name: "available", quantity: qty }],
    };
    if (artikelnr) variant.sku = artikelnr;
    if (adv.shopify_variant_id) variant.id = adv.shopify_variant_id;

    // Collectietype (= Shopify-producttype) + waarschuwing als het buiten de gekoppelde
    // slimme collecties valt (dan verschijnt de advertentie niet op Marktplaats).
    const _type = collectieType(adv.rubriek, item?.categorie);
    const collWaarschuwing = (!offline && !isGemapteCollectie(_type))
      ? `Rubriek "${adv.rubriek || item?.categorie || "?"}" valt buiten de gekoppelde Marktplaats-collecties (producttype "${_type}") — koppel/maak deze collectie in de Marktplaats Pro-app, anders verschijnt de advertentie niet op Marktplaats.`
      : null;

    const input: any = {
      title: titel,
      descriptionHtml: descHtml,
      productType: _type,
      vendor: "Nijhof Brothers Furniture",
      tags,
      status: shopifyStatus,
      variants: [variant],
      // Shopify eist productOptions zodra variants meegaan — óók bij updates
      // ("Product options input is required when updating variants")
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    };

    const isCreate = !adv.shopify_product_id;
    // Advertentie-id in de handle: twee advertenties met dezelfde titel en zonder
    // artikelnummer kregen anders dezelfde handle → productSet-upsert overschreef
    // het Shopify-product van de eerste.
    const handle = slugify(`${artikelnr || ""}-${baseTitel}-${String(advertentie_id).slice(-6)}`);
    if (isCreate) input.handle = handle;
    // Foto's: bij aanmaken én bij updaten meesturen. productSet behandelt media als een
    // list-field (volledige sync): meegestuurde foto's worden gezet, weggelaten media
    // verwijderd. Zo komen gewijzigde/toegevoegde foto's óók op een bestaande advertentie
    // door — voorheen gebeurde dat alleen bij aanmaken. Bij offline (verkocht/verwijderd)
    // laten we media met rust.
    if (!offline) {
      const fotos = Array.isArray(adv.fotos) ? adv.fotos : [];
      let urls: string[] = fotos.map((f: any) => f?.url).filter(Boolean);
      if (urls.length === 0 && item?.foto_url) urls = [item.foto_url];
      if (urls.length) input.files = urls.map((u) => ({ originalSource: u, contentType: "IMAGE" }));
    }

    const identifier = adv.shopify_product_id ? { id: adv.shopify_product_id } : { handle };

    const mutation = `mutation SetProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
      productSet(synchronous: true, identifier: $identifier, input: $input) {
        product { id handle status variants(first: 1) { edges { node { id inventoryItem { id } } } } }
        userErrors { field message }
      }
    }`;

    let data: any;
    try {
      data = await shopify(mutation, { identifier, input });
    } catch (e) {
      await supabase.from("advertenties")
        .update({ laatste_fout: String((e as Error)?.message || e).slice(0, 400) })
        .eq("id", advertentie_id);
      return json({ error: String((e as Error)?.message || e) }, 502);
    }

    const ue = data?.productSet?.userErrors || [];
    if (ue.length) {
      await supabase.from("advertenties")
        .update({ laatste_fout: JSON.stringify(ue).slice(0, 400) })
        .eq("id", advertentie_id);
      return json({ error: "Shopify userErrors", userErrors: ue }, 422);
    }

    const prod = data.productSet.product;
    const variantNode = prod?.variants?.edges?.[0]?.node;

    // Publiceer naar het Marktplaats Pro-kanaal én de Webshop (voor de productpagina
    // met WhatsApp-knop), of haal eraf bij verwijderen. Niet fataal.
    const mpPub = Deno.env.get("SHOPIFY_MARKTPLAATS_PUBLICATION_ID") || "gid://shopify/Publication/345553371475";
    const webshopPub = Deno.env.get("SHOPIFY_WEBSHOP_PUBLICATION_ID") || "gid://shopify/Publication/340813676883";
    const pubs = [{ publicationId: mpPub }, { publicationId: webshopPub }];
    // Niet fataal voor het product zelf, maar fouten worden WEL zichtbaar gemaakt:
    // zonder scope write_publications faalde dit eerder stil en stond het product nergens.
    let pubWaarschuwing: string | null = null;
    try {
      const pubData = offline
        ? await shopify(
            `mutation($id: ID!, $pubs: [PublicationInput!]!) { publishableUnpublish(id: $id, input: $pubs) { userErrors { field message } } }`,
            { id: prod.id, pubs },
          )
        : await shopify(
            `mutation($id: ID!, $pubs: [PublicationInput!]!) { publishablePublish(id: $id, input: $pubs) { userErrors { field message } } }`,
            { id: prod.id, pubs },
          );
      const pubUe = (pubData?.publishablePublish?.userErrors || pubData?.publishableUnpublish?.userErrors || []);
      if (pubUe.length) pubWaarschuwing = "Kanaal-publicatie: " + JSON.stringify(pubUe).slice(0, 300);
    } catch (e) {
      pubWaarschuwing = "Kanaal-publicatie mislukt: " + String((e as Error)?.message || e).slice(0, 300) +
        " — check of de Shopify-app de scope write_publications heeft.";
    }

    const nieuweStatus = isVerwijderen ? "verwijderd"
      : isVerkocht ? "verkocht"
      : isReserveren ? "gereserveerd"
      : "live";

    const gecombineerdeWaarschuwing = [pubWaarschuwing, collWaarschuwing].filter(Boolean).join(" | ") || null;

    await supabase.from("advertenties").update({
      shopify_product_id: prod.id,
      shopify_variant_id: variantNode?.id || adv.shopify_variant_id || null,
      shopify_inventory_item_id: variantNode?.inventoryItem?.id || adv.shopify_inventory_item_id || null,
      shopify_handle: prod.handle,
      status: nieuweStatus,
      laatste_fout: gecombineerdeWaarschuwing,
      gepubliceerd_op: adv.gepubliceerd_op || new Date().toISOString(),
    }).eq("id", advertentie_id);

    // Voorraad-item meesyncen met de advertentie-actie:
    //  verkocht     -> item op 'verkocht' (verdwijnt uit de voorraad/verkoop-lijst)
    //  terug_online -> item terug op 'beschikbaar' (maakt 'verkocht' omkeerbaar)
    // Overige acties laten de item-status ongemoeid.
    let itemStatus: string | null = null;
    if (isVerkocht) itemStatus = "verkocht";
    else if (actie === "terug_online") itemStatus = "beschikbaar";
    if (itemStatus && adv.item_id) {
      try {
        await supabase.from("items").update({ status: itemStatus }).eq("id", adv.item_id);
      } catch (_e) { /* voorraad-sync niet fataal voor de advertentie-actie */ }
    }

    return json({ ok: true, status: nieuweStatus, item_status: itemStatus, shopify_product_id: prod.id, handle: prod.handle, publicatie_waarschuwing: pubWaarschuwing, collectie_waarschuwing: collWaarschuwing });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
