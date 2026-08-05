// webshop-analytics
// Haalt Shopify webshop-verkeer (sessies) op via ShopifyQL en geeft nette JSON terug.
//
// Vereist (Supabase secrets, dezelfde als plaats-advertentie):
//   SHOPIFY_STORE          (bv. btvcpm-ny.myshopify.com)
//   SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET   (Dev Dashboard custom app)
//   SHOPIFY_API_VERSION    (optioneel, standaard 2025-01)
//
// De custom app heeft de scopes read_reports + read_customers nodig (level 2
// protected customer data). Zonder die scopes geeft shopifyqlQuery ACCESS_DENIED.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Alleen POST" }, 405);

  try {
    // --- Auth: geldige ingelogde gebruiker die lid is van een organisatie ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    const gebruiker = userData?.user;
    if (userErr || !gebruiker) return json({ error: "Niet ingelogd" }, 401);
    const { data: lid } = await supabase
      .from("org_members").select("org_id").eq("user_id", gebruiker.id).limit(1).maybeSingle();
    if (!lid) return json({ error: "Geen toegang" }, 403);

    // --- Periode ---
    const body = await req.json().catch(() => ({}));
    let days = Number(body?.days);
    if (![7, 30, 90].includes(days)) days = 30;
    const since = `-${days}d`;

    // --- Shopify token (client credentials) ---
    const store = Deno.env.get("SHOPIFY_STORE");
    const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
    const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
    const apiVersion = Deno.env.get("SHOPIFY_API_VERSION") || "2025-01";
    if (!store || !clientId || !clientSecret) {
      return json({ error: "Shopify-secrets niet ingesteld" }, 500);
    }
    const tr = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) {
      return json({ error: "Shopify auth mislukt", detail: JSON.stringify(tj).slice(0, 200) }, 502);
    }
    const token = tj.access_token as string;

    // --- ShopifyQL helper ---
    const ql = async (q: string): Promise<Record<string, string>[]> => {
      const gql = `{ shopifyqlQuery(query: ${JSON.stringify(q)}) { tableData { rows } parseErrors } }`;
      const r = await fetch(`https://${store}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query: gql }),
      });
      const j = await r.json().catch(() => ({}));
      const node = j?.data?.shopifyqlQuery;
      if (j?.errors) throw new Error("Shopify: " + JSON.stringify(j.errors).slice(0, 300));
      return (node?.tableData?.rows as Record<string, string>[]) || [];
    };

    const num = (v: unknown) => {
      const n = Number(v);
      return isFinite(n) ? n : 0;
    };

    const [totalsRows, dailyRows, deviceRows, countryRows, sourceRows, pageRows, hourlyRows] = await Promise.all([
      ql(`FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate SINCE ${since} UNTIL today`),
      ql(`FROM sessions SHOW sessions, online_store_visitors TIMESERIES day SINCE ${since} UNTIL today`),
      ql(`FROM sessions SHOW sessions GROUP BY session_device_type SINCE ${since} UNTIL today ORDER BY sessions DESC`),
      ql(`FROM sessions SHOW sessions GROUP BY session_country SINCE ${since} UNTIL today ORDER BY sessions DESC LIMIT 8`),
      ql(`FROM sessions SHOW sessions GROUP BY referrer_source SINCE ${since} UNTIL today ORDER BY sessions DESC LIMIT 8`),
      ql(`FROM sessions SHOW sessions GROUP BY landing_page_path SINCE ${since} UNTIL today ORDER BY sessions DESC LIMIT 10`),
      ql(`FROM sessions SHOW sessions TIMESERIES hour SINCE ${since} UNTIL today`),
    ]);

    const t0 = totalsRows[0] || {};
    return json({
      days,
      totals: {
        sessions: num(t0.sessions),
        visitors: num(t0.online_store_visitors),
        conversion_rate: num(t0.conversion_rate),
        cart_adds: num(t0.sessions_with_cart_additions),
        reached_checkout: num(t0.sessions_that_reached_checkout),
        completed_checkout: num(t0.sessions_that_completed_checkout),
      },
      daily: dailyRows.map((r) => ({ day: r.day, sessions: num(r.sessions), visitors: num(r.online_store_visitors) })),
      by_device: deviceRows.map((r) => ({ label: r.session_device_type || "onbekend", sessions: num(r.sessions) })),
      by_country: countryRows.map((r) => ({ label: r.session_country || "onbekend", sessions: num(r.sessions) })),
      by_source: sourceRows.map((r) => ({ label: r.referrer_source || "onbekend", sessions: num(r.sessions) })),
      top_pages: pageRows.map((r) => ({ path: r.landing_page_path || "/", sessions: num(r.sessions) })),
      hourly: hourlyRows.map((r) => ({ ts: r.hour, sessions: num(r.sessions) })),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
