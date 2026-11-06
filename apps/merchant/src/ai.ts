/**
 * Real AI work behind the paid translation endpoints: an open-weight model on this machine via Ollama
 * (OLLAMA_URL, MERCHANT_AI_MODEL). If the model is unreachable the endpoint still answers, from a small
 * dictionary, and says so in `engine`, so a paid call never returns nothing.
 */
const OLLAMA = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.MERCHANT_AI_MODEL ?? "qwen3.5:4b";

export const LANGS: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi", gu: "Gujarati", ta: "Tamil", te: "Telugu", bn: "Bengali", es: "Spanish", fr: "French" };

const DICT: Record<string, Record<string, string>> = {
  hi: { hello: "नमस्ते", thanks: "धन्यवाद", payment: "भुगतान", agent: "एजेंट" },
  es: { hello: "hola", thanks: "gracias", payment: "pago", agent: "agente" },
  fr: { hello: "bonjour", thanks: "merci", payment: "paiement", agent: "agent" },
};

export function dictTranslate(text: string, to: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => DICT[to]?.[w] ?? w)
    .join(" ");
}

const cache = new Map<string, { translation: string; engine: string }>();

export async function aiTranslate(text: string, to: string, opts: { careful?: boolean } = {}): Promise<{ translation: string; engine: string }> {
  const lang = LANGS[to] ?? "English";
  const key = `${to}|${opts.careful ? 1 : 0}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const system = `You are a professional translator for business documents. Translate the user's text into ${lang}. Keep every number, amount, currency code, date, invoice number and name exactly. Reply with the translation only.${opts.careful ? " Then add one line starting with 'Check:' that lists the amounts and dates you found." : ""}`;
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, stream: false, think: false, options: { temperature: 0 }, messages: [{ role: "system", content: system }, { role: "user", content: text }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const out = ((await r.json()) as { message?: { content?: string } }).message?.content ?? "";
    const translation = out.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!translation) throw new Error("empty");
    const res = { translation, engine: `${MODEL} (open model, on the merchant's own server)` };
    cache.set(key, res);
    return res;
  } catch {
    return { translation: dictTranslate(text, to), engine: "dictionary (AI model offline)" };
  }
}
