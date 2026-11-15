/**
 * Solo per i test con Node: nessun file dell'app lo importa. Un'API di Claude finta, senza rete e senza chiavi vere.
 *
 * - `fakeClaude(replies)`: un provider creato con `createAnthropic({ apiKey: "test", fetch })`. La fetch finta registra
 *   indirizzo, intestazione beta e corpo di ogni richiesta e risponde con `replies`, in ordine (JSON, o eventi SSE per
 *   lo streaming). Senza risposte rimaste, la richiesta fallisce: niente arriva mai all'API vera.
 * - `installAppModules(stubs)`: per caricare i moduli veri dell'app (rotte, azioni, tool) sotto Node. Gli alias `@/…`
 *   e `server-only` come in scripts/use-case-test/test-hooks.mjs; i moduli di `stubs` (sorgente JavaScript per
 *   specificatore) al posto di quelli veri; `@ai-sdk/anthropic` resta il pacchetto vero, ma il suo `anthropic` usa la
 *   fetch finta di `useAppClaude`. Una volta per processo (ogni file di test gira nel suo).
 */
import * as nodeModule from "node:module";
import type { TestContext } from "node:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL } from "./models.ts";

export type Body = Record<string, unknown>;
export type Captured = { url: URL; betas: string[]; body: Body; signal: AbortSignal | null };
export type Reply = (init?: RequestInit) => Response | Promise<Response>;

/** Un indirizzo che nessuno ascolta: anche una fetch sfuggita al finto non raggiungerebbe l'API. */
const FAKE_BASE_URL = "http://127.0.0.1:9/v1";

function recordingFetch(replies: Reply[]) {
  const requests: Captured[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const beta = new Headers(init?.headers).get("anthropic-beta") ?? "";
    requests.push({
      url: new URL(String(url)),
      betas: beta.split(",").map((b) => b.trim()).filter(Boolean),
      body: JSON.parse(String(init?.body)) as Body,
      signal: init?.signal ?? null,
    });
    const reply = replies.shift();
    if (!reply) throw new Error("nessuna risposta finta rimasta");
    return reply(init);
  };
  return { fetch, requests };
}

export function fakeClaude(replies: Reply[]) {
  const { fetch, requests } = recordingFetch(replies);
  const provider = createAnthropic({ apiKey: "test", baseURL: FAKE_BASE_URL, fetch });
  return { provider, requests };
}

/** Una risposta dell'API (non in streaming). */
export function message(content: unknown[], stop_reason = "end_turn", extra: Body = {}): Reply {
  return () =>
    Response.json({
      id: "msg_prova",
      type: "message",
      role: "assistant",
      model: CLAUDE_MODEL,
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      ...extra,
    });
}

/** Un rifiuto dei classificatori (HTTP 200, `stop_reason: "refusal"`), con il contenuto dato (vuoto o parziale). */
export function refusal(content: unknown[] = [], category = "general_harms"): Reply {
  return message(content, "refusal", { stop_details: { type: "refusal", category, explanation: "Spiegazione del rifiuto" } });
}

/** Una risposta dell'API in streaming: gli eventi SSE. */
export function sse(events: Body[]): Reply {
  return () =>
    new Response(events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
}

/** Una richiesta che non risponde finché non viene interrotta (per i tempi massimi). */
export const hang: Reply = (init) =>
  new Promise((_, reject) => {
    const signal = init?.signal;
    if (!signal) return reject(new Error("richiesta senza abortSignal: resterebbe appesa"));
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

export const ev = {
  start: (id: string): Body => ({
    type: "message_start",
    message: { id, type: "message", role: "assistant", model: CLAUDE_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
  }),
  /** Un blocco di ragionamento: testo vuoto per default (il modello lo manda così), firma presente. */
  thinking: (index: number, signature: string, text = ""): Body[] => [
    { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } },
    ...(text ? [{ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: text } }] : []),
    { type: "content_block_delta", index, delta: { type: "signature_delta", signature } },
    { type: "content_block_stop", index },
  ],
  text: (index: number, text: string): Body[] => [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index },
  ],
  toolUse: (index: number, id: string, name: string, json: string): Body[] => [
    { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } },
    { type: "content_block_stop", index },
  ],
  end: (stop_reason: string, extra: Body = {}): Body[] => [
    { type: "message_delta", delta: { stop_reason, stop_sequence: null, ...extra }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ],
};

/** Un blocco di ragionamento in una risposta non in streaming (testo vuoto per default, firmato). */
export const THINKING = { type: "thinking", thinking: "", signature: "firma-di-prova" };

/** Le righe di console.warn e console.error del test, in ordine, unite come le stamperebbe la console (e in silenzio). */
export function recordLogs(t: TestContext): string[] {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  t.mock.method(console, "warn", record);
  t.mock.method(console, "error", record);
  return lines;
}

// ── I moduli veri dell'app sotto Node ─────────────────────────────────

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

/** Il pacchetto vero, risolto prima degli hook: il modulo finto lo importa da qui. */
const ANTHROPIC_PACKAGE = import.meta.resolve("@ai-sdk/anthropic");
const kit = globalThis as { __claudeTestKit?: { fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> } };

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

let installed = false;

export async function installAppModules(stubs: Record<string, string>): Promise<void> {
  if (installed) throw new Error("installAppModules: una volta per processo");
  installed = true;
  await import(new URL("../../../scripts/use-case-test/test-hooks.mjs", import.meta.url).href);
  const table: Record<string, string> = {
    "@ai-sdk/anthropic": asModule(
      `import { createAnthropic } from ${JSON.stringify(ANTHROPIC_PACKAGE)};
export * from ${JSON.stringify(ANTHROPIC_PACKAGE)};
export const anthropic = createAnthropic({ apiKey: "test", baseURL: ${JSON.stringify(FAKE_BASE_URL)}, fetch: (url, init) => globalThis.__claudeTestKit.fetch(url, init) });`,
    ),
  };
  for (const [specifier, source] of Object.entries(stubs)) table[specifier] = asModule(source);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(table, specifier)) return { url: table[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

/** Le risposte del Claude finto per i moduli dell'app caricati con `installAppModules`; le richieste registrate. */
export function useAppClaude(replies: Reply[]): Captured[] {
  const { fetch, requests } = recordingFetch(replies);
  kit.__claudeTestKit = { fetch };
  return requests;
}
