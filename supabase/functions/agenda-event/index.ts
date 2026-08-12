// Supabase Edge Function: agenda-event
// Maakt / update / verwijdert een Google Calendar-event in een gedeelde
// "Nijhof Ritten"-agenda via een service account. Beide broers voegen die
// agenda toe aan hun Google Agenda en zien de leveringen dan automatisch.
//
// Vereiste secrets (Supabase -> Edge Functions -> Secrets):
//   GOOGLE_SA_EMAIL        service-account e-mail (…@….iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY  private_key uit de service-account JSON (met \n)
//   GOOGLE_CALENDAR_ID     id van de gedeelde agenda (…@group.calendar.google.com)
//
// Body:  { datum: "YYYY-MM-DD", tijd?: "HH:MM", titel, beschrijving?, locatie?,
//          event_id?: string, verwijder?: boolean }
// Antwoord: { ok, event_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function pad(n: number): string { return String(n).padStart(2, "0"); }
function b64urlBytes(b: Uint8Array): string {
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Service-account JWT -> Google OAuth2 access token (scope calendar).
async function getAccessToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: saEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  }));
  const signingInput = `${header}.${claim}`;
  const pem = privateKeyPem.replace(/\\n/g, "\n");
  const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64urlBytes(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const saEmail = Deno.env.get("GOOGLE_SA_EMAIL");
    const pk = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
    const calId = Deno.env.get("GOOGLE_CALENDAR_ID");
    if (!saEmail || !pk || !calId) {
      return json({ error: "Google Agenda nog niet gekoppeld: zet GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY en GOOGLE_CALENDAR_ID in de Supabase secrets." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const datum = String(body?.datum || "").trim();               // YYYY-MM-DD
    const tijd = String(body?.tijd || "").trim();                  // HH:MM (optioneel)
    const titel = String(body?.titel || "Levering").slice(0, 250);
    const beschrijving = String(body?.beschrijving || "");
    const locatie = String(body?.locatie || "");
    const eventId = body?.event_id ? String(body.event_id) : null;
    const verwijder = body?.verwijder === true;

    const token = await getAccessToken(saEmail, pk);
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

    // Verwijderen
    if (verwijder) {
      if (eventId) await fetch(`${base}/${encodeURIComponent(eventId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      return json({ ok: true, event_id: null });
    }

    if (!datum) return json({ error: "datum ontbreekt" }, 400);

    const evt: Record<string, unknown> = { summary: titel, description: beschrijving, location: locatie };
    if (/^\d{2}:\d{2}$/.test(tijd)) {
      const [hh, mm] = tijd.split(":").map((x) => parseInt(x, 10) || 0);
      let eh = hh + 1, em = mm; if (eh > 23) { eh = 23; em = 59; }
      evt.start = { dateTime: `${datum}T${tijd}:00`, timeZone: "Europe/Amsterdam" };
      evt.end = { dateTime: `${datum}T${pad(eh)}:${pad(em)}:00`, timeZone: "Europe/Amsterdam" };
    } else {
      evt.start = { date: datum };
      evt.end = { date: datum };
    }

    const url = eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
    const method = eventId ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(evt),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: `Google Calendar ${r.status}: ${JSON.stringify(j).slice(0, 300)}` }, 502);
    return json({ ok: true, event_id: j.id || eventId || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
