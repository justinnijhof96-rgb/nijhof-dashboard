// Elke betaalde AI-aanroep vastleggen voor Growth OS → Systeem → API-kosten (tabel growth.api_gebruik in hetzelfde Supabase-project).
// Het bedrag rekent de database uit met growth.api_prijzen; hier alleen het verbruik. Geeft nooit een fout: de functie zelf gaat altijd voor.
import { createClient } from "jsr:@supabase/supabase-js@2";

const maakDb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false }, db: { schema: "growth" },
});
let db: ReturnType<typeof maakDb> | null = null;

type Aanroep = {
  bron: string;                                 // functienaam, bijv. genereer-advertentie
  provider: "anthropic" | "openai" | "fal";
  model: string;
  usage?: any;                                  // usage-blok uit het antwoord (Anthropic of OpenAI)
  stuks?: number;                               // afbeeldingen (fal.ai)
};

export async function logApi(a: Aanroep) {
  try {
    const u = a.usage || {};
    const n = (x: unknown) => Math.max(0, Math.round(Number(x) || 0));
    const rij = a.provider === "openai"
      ? { input_tokens: n(u.prompt_tokens) - n(u.prompt_tokens_details?.cached_tokens), output_tokens: n(u.completion_tokens),
          cache_lezen: n(u.prompt_tokens_details?.cached_tokens) }
      : { input_tokens: n(u.input_tokens), output_tokens: n(u.output_tokens), cache_schrijven: n(u.cache_creation_input_tokens),
          cache_lezen: n(u.cache_read_input_tokens), web_zoekopdrachten: n(u.server_tool_use?.web_search_requests) };
    db ??= maakDb();
    const { error } = await db.from("api_gebruik").insert({
      app: "dashboard", bron: a.bron, provider: a.provider, model: a.model || "onbekend", stuks: n(a.stuks), ...rij,
    });
    if (error) console.error("logApi", error.message);
  } catch (e) {
    console.error("logApi", (e as Error)?.message || e);
  }
}
