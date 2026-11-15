import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { CLASSIFY_FAILED } from "./classify-outcome.ts";

// (Migrazione a Claude Sonnet 5.5) Il bottone vero «Classifica attività» (classify-button.tsx), reso sul server con il
// bottone dell'interfaccia, sonner e il router finti, e poi cliccato: mostra sempre l'avviso dell'esito
// (classify-outcome.ts), anche quando la richiesta non riesce, e aggiorna la pagina solo quando l'esito lo dice.

type Prova = { onClick?: () => Promise<void>; toasts: Array<[string, string]>; refreshed: number };
const prova: Prova = { toasts: [], refreshed: 0 };
(globalThis as { __classifyButton?: Prova }).__classifyButton = prova;

await installAppModules({
  "@/components/ui/button": `export function Button(props) { globalThis.__classifyButton.onClick = props.onClick; return null; }`,
  sonner: `export const toast = new Proxy({}, {
    get: (_, level) => (text) => { globalThis.__classifyButton.toasts.push([String(level), text]); },
  });`,
  "next/navigation": `export function useRouter() { return { refresh() { globalThis.__classifyButton.refreshed += 1; } }; }`,
});
await enableTsxImports();
const { ClassifyButton } = await import("./classify-button.tsx");

/** Il clic sul bottone, con fetch che risponde con `reply`: le richieste, gli avvisi e gli aggiornamenti della pagina. */
async function click(t: TestContext, reply: () => Promise<Response>) {
  prova.toasts = [];
  prova.refreshed = 0;
  prova.onClick = undefined;
  renderToStaticMarkup(createElement(ClassifyButton, { workspaceId: "ws-prova" }));
  const sent: Array<{ url: string; method?: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
    return reply();
  });
  await prova.onClick!();
  return { sent, toasts: prova.toasts, refreshed: prova.refreshed };
}

test("una richiesta non riuscita (risposta non 2xx, o la rete): sempre l'avviso d'errore, e la pagina non si aggiorna", async (t) => {
  const failures: Record<string, () => Promise<Response>> = {
    "500": async () => new Response("Errore interno", { status: 500 }),
    rete: async () => {
      throw new TypeError("fetch failed");
    },
    "corpo illeggibile": async () => new Response("non è JSON", { status: 200 }),
  };
  for (const [name, reply] of Object.entries(failures)) {
    const { sent, toasts, refreshed } = await click(t, reply);
    assert.deepEqual(sent, [{ url: "/api/ai/classify", method: "POST", body: { workspaceId: "ws-prova" } }], name);
    assert.deepEqual(toasts, [["error", CLASSIFY_FAILED.text]], name);
    assert.equal(refreshed, 0, name);
  }
});

test("una classificazione riuscita: l'avviso dell'esito e la pagina aggiornata; niente da classificare: solo l'avviso", async (t) => {
  const done = await click(t, async () => Response.json({ classified: 2, skipped: 1, skippedText: "1 attività è rimasta da classificare.", total: 3 }));
  assert.deepEqual(done.toasts, [["warning", "2 attività classificate su 3 totali. 1 attività è rimasta da classificare. Riprova più tardi."]]);
  assert.equal(done.refreshed, 1);
  const nothing = await click(t, async () => Response.json({ classified: 0, skipped: 0, skippedText: "", total: 4 }));
  assert.deepEqual(nothing.toasts, [["info", "Tutte le attività sono già classificate"]]);
  assert.equal(nothing.refreshed, 0);
});
