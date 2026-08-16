// Supabase Edge Function: check-tikkie
// Vraagt de status van een bestaand Tikkie-betaalverzoek op, zodat de app kan
// tonen of de klant al betaald heeft (live, terwijl de QR openstaat).
//
// Vereiste secrets (zelfde als maak-tikkie):
//   TIKKIE_API_KEY, TIKKIE_APP_TOKEN, TIKKIE_SANDBOX (optioneel)
//
// Body:  { paymentRequestToken: string }
// Antwoord: { ok, betaald, status, bedrag_cent, betaald_cent, aantal_betalingen, betaald_op }

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
    const token = String(body?.paymentRequestToken || "").trim();
    if (!token) return json({ error: "paymentRequestToken ontbreekt" }, 400);

    const base = sandbox
      ? "https://api-sandbox.abnamro.com/v2/tikkie"
      : "https://api.abnamro.com/v2/tikkie";

    const r = await fetch(`${base}/paymentrequests/${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { "API-Key": apiKey, "X-App-Token": appToken },
    });

    const t = await r.text();
    let j: any = {};
    try { j = JSON.parse(t); } catch { /* niet-JSON antwoord */ }

    if (!r.ok) {
      const detail = (Array.isArray(j?.errors) && j.errors.map((e: any) => e?.message).filter(Boolean).join("; ")) || t.slice(0, 300);
      return json({ error: `Tikkie API ${r.status}: ${detail}` }, 502);
    }

    const bedragCent = Math.round(Number(j?.amountInCents) || 0);
    const betaaldCent = Math.round(Number(j?.totalAmountPaidInCents) || 0);
    const aantal = Math.round(Number(j?.numberOfPayments) || 0);
    const status = String(j?.status || "");
    // "betaald" = het volledige bedrag is ontvangen; als het bedrag onbekend is,
    // vallen we terug op "minstens 1 geslaagde betaling".
    const betaald = bedragCent > 0 ? betaaldCent >= bedragCent : aantal > 0;

    // Werkelijke betaaldatum ophalen zodra er betaald is: een inhaalcheck draait
    // vaak dagen later, en dan hoort de ontvangst in de maand waarin de klant
    // betaalde — niet in de maand waarin wij toevallig keken.
    let betaaldOp: string | null = null;
    if (betaald) {
      try {
        const rp = await fetch(`${base}/paymentrequests/${encodeURIComponent(token)}/payments`, {
          method: "GET",
          headers: { "API-Key": apiKey, "X-App-Token": appToken },
        });
        if (rp.ok) {
          const jp: any = await rp.json().catch(() => ({}));
          const lijst: any[] = Array.isArray(jp?.payments) ? jp.payments : [];
          const datums = lijst
            .map((p) => String(p?.dateTimePaid || p?.created || ""))
            .filter(Boolean)
            .sort();
          if (datums.length) betaaldOp = datums[datums.length - 1].slice(0, 10);
        }
      } catch { /* datum is bonus — de status telt */ }
    }

    return json({
      ok: true,
      betaald,
      status,
      bedrag_cent: bedragCent,
      betaald_cent: betaaldCent,
      aantal_betalingen: aantal,
      betaald_op: betaaldOp,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
