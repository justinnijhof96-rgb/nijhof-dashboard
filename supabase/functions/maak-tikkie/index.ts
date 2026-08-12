// Supabase Edge Function: maak-tikkie
// Maakt een Tikkie-betaalverzoek aan via de ABN AMRO Tikkie API en geeft de
// betaal-URL terug. De verkoopapp toont die URL als QR-code zodat de klant
// direct kan scannen en betalen.
//
// Vereiste secrets (Supabase -> Edge Functions -> Secrets):
//   TIKKIE_API_KEY    (API-key uit het ABN AMRO Developer Portal, Tikkie API)
//   TIKKIE_APP_TOKEN  (app-token uit het Tikkie Zakelijk portaal: business.tikkie.me
//                      -> instellingen -> API's -> "Token aanmaken" met
//                      "Aanmaken betaalverzoekjes" aan)
//   TIKKIE_SANDBOX    (optioneel, "true" = sandbox-omgeving)
//
// Body:  { bedrag_cent: number, omschrijving: string, referentie?: string }
// Antwoord: { ok, url, paymentRequestToken, bedrag_cent, omschrijving }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
    const apiKey = Deno.env.get("TIKKIE_API_KEY");
    const appToken = Deno.env.get("TIKKIE_APP_TOKEN");
    const sandbox = (Deno.env.get("TIKKIE_SANDBOX") || "").toLowerCase() === "true";
    if (!apiKey || !appToken) {
      return json({
        error: "Tikkie is nog niet gekoppeld: zet TIKKIE_API_KEY en TIKKIE_APP_TOKEN in de Supabase Edge Function secrets.",
      }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const bedragCent = Math.round(Number(body?.bedrag_cent) || 0);
    const omschrijving = String(body?.omschrijving || "").slice(0, 35).trim(); // Tikkie-limiet: 35 tekens
    const referentie = body?.referentie ? String(body.referentie).slice(0, 35) : undefined;
    if (bedragCent <= 0) return json({ error: "bedrag_cent moet groter dan 0 zijn" }, 400);
    if (!omschrijving) return json({ error: "omschrijving ontbreekt" }, 400);

    const base = sandbox
      ? "https://api-sandbox.abnamro.com/v2/tikkie"
      : "https://api.abnamro.com/v2/tikkie";

    const r = await fetch(`${base}/paymentrequests`, {
      method: "POST",
      headers: {
        "API-Key": apiKey,
        "X-App-Token": appToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amountInCents: bedragCent,
        description: omschrijving,
        ...(referentie ? { referenceId: referentie } : {}),
      }),
    });

    const t = await r.text();
    let j: any = {};
    try { j = JSON.parse(t); } catch { /* niet-JSON antwoord, t blijft ruw */ }

    if (!r.ok) {
      // Tikkie geeft gestructureerde fouten terug in j.errors[].message
      const detail = (Array.isArray(j?.errors) && j.errors.map((e: any) => e?.message).filter(Boolean).join("; ")) || t.slice(0, 300);
      return json({ error: `Tikkie API ${r.status}: ${detail}` }, 502);
    }
    if (!j?.url) return json({ error: "Tikkie gaf geen betaal-URL terug", raw: t.slice(0, 300) }, 502);

    return json({
      ok: true,
      url: j.url,
      paymentRequestToken: j.paymentRequestToken || null,
      bedrag_cent: bedragCent,
      omschrijving,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
