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
  return String(t ?? "").split(/\n{2,}/)
    .map((p) => "<p>" + escapeHtml(p).replace(/\n/g, "<br>") + "</p>").join("");
}
function slugify(s: unknown): string {
  const base = String(s ?? "").toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || ("nb-" + Math.abs(Date.now()));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const advertentie_id = body?.advertentie_id;
    const actie = body?.actie || "plaatsen";
    if (!advertentie_id) return json({ error: "advertentie_id ontbreekt" }, 400);

    const store = Deno.env.get("SHOPIFY_STORE");
    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    const apiVersion = Deno.env.get("SHOPIFY_API_VERSION") || "2025-01";
    const locationId = Deno.env.get("SHOPIFY_LOCATION_ID") || "gid://shopify/Location/121363857747";
    if (!store || !token) {
      return json({ error: "SHOPIFY_STORE of SHOPIFY_ADMIN_TOKEN niet ingesteld in Supabase secrets" }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: adv } = await supabase
      .from("advertenties").select("*").eq("id", advertentie_id).single();
    if (!adv) return json({ error: "Advertentie niet gevonden" }, 404);
    const { data: item } = await supabase
      .from("items").select("*").eq("id", adv.item_id).single();

    const shopify = async (query: string, variables: unknown) => {
      const r = await fetch(`https://${store}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
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
    const shopifyStatus = isVerwijderen ? "DRAFT" : "ACTIVE";

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

    const input: any = {
      title: titel,
      descriptionHtml: descHtml,
      productType: adv.rubriek || item?.categorie || "",
      vendor: "Nijhof Brothers Furniture",
      tags,
      status: shopifyStatus,
      variants: [variant],
    };

    const isCreate = !adv.shopify_product_id;
    const handle = slugify(`${artikelnr || ""}-${baseTitel}`);
    if (isCreate) {
      input.handle = handle;
      input.productOptions = [{ name: "Title", values: [{ name: "Default Title" }] }];
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

    const nieuweStatus = isVerwijderen ? "verwijderd"
      : isVerkocht ? "verkocht"
      : isReserveren ? "gereserveerd"
      : "live";

    await supabase.from("advertenties").update({
      shopify_product_id: prod.id,
      shopify_variant_id: variantNode?.id || adv.shopify_variant_id || null,
      shopify_inventory_item_id: variantNode?.inventoryItem?.id || adv.shopify_inventory_item_id || null,
      shopify_handle: prod.handle,
      status: nieuweStatus,
      laatste_fout: null,
      gepubliceerd_op: adv.gepubliceerd_op || new Date().toISOString(),
    }).eq("id", advertentie_id);

    return json({ ok: true, status: nieuweStatus, shopify_product_id: prod.id, handle: prod.handle });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
