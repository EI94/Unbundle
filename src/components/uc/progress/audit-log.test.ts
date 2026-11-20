import test, { before } from "node:test";
import assert from "node:assert/strict";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import type { ActivityDay } from "../../../lib/uc/views/audit.ts";

// Rilascio 10, §3.5 (Attività): il titolo di una domanda resta intero e porta alla domanda, per chi la apre; per gli
// altri, accorciato oltre 80 caratteri, il titolo intero sta nel `title` e per i lettori di schermo.

let render: (days: ActivityDay[], href: ((id: string) => string | null) | null) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { ActivityTimeline } = await import("./audit-log.tsx");
  render = (days, href) => renderToStaticMarkup(react.createElement(ActivityTimeline, { days, questionHref: href }));
});

const ID = "33333333-3333-4333-8333-333333333333";
const full = "«Quanti preventivi si perdono ogni mese per mancanza di risposta da parte del commerciale di zona»";
const shown = "«Quanti preventivi si perdono ogni mese per mancanza di risposta da parte del…»";
const day = (lines: ActivityDay["lines"]): ActivityDay[] => [{ key: "2026-10-14", label: "Oggi", lines }];

test("chi apre la domanda la raggiunge dal titolo, intero", () => {
  const html = render(day([{ id: "e1", time: "10:42", who: "Luca Verdi", text: "ha messo a posto «Sconti»", count: 1, question: { shown: "«Sconti»", full: "«Sconti»", itemId: ID, itemStatus: "validata" } }]), (id) => `/q/${id}`);
  assert.match(html, new RegExp(`<a [^>]*href="/q/${ID}"[^>]*><span>«Sconti»</span></a>`));
  assert.ok(html.includes("ha messo a posto "), "il verbo resta");
});

test("chi non la apre legge il titolo; accorciato, quello intero sta nel «title» e per i lettori di schermo", () => {
  const html = render(day([{ id: "e1", time: "10:42", who: "Anna Bianchi", text: `ha modificato ${shown}`, count: 1, question: { shown, full, itemId: ID, itemStatus: "chiesta" } }]), null);
  assert.ok(!html.includes("<a "), "nessun link");
  assert.ok(html.includes(`title="${full}"`), "il titolo intero nel «title»");
  assert.match(html, /<span class="sr-only">«Quanti preventivi[^<]*commerciale di zona»<\/span>/);
  assert.match(html, /<span aria-hidden="true">«Quanti preventivi[^<]*del…»<\/span>/);
});
