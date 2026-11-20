import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePeriod, periodValue } from "../../../lib/uc/views/activity-period.ts";
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

test("(F-116) «Scegli le date…» scrive l'intervallo nel periodo, nello stesso formato della pagina", async () => {
  const { dateRangeValue } = await import("../../ui-10/filter-chips.tsx");
  assert.equal(dateRangeValue("2026-10-01", "2026-10-05"), "2026-10-01_2026-10-05");
  assert.equal(dateRangeValue("2026-10-01", "2026-10-05"), periodValue("2026-10-01", "2026-10-05"));
  assert.deepEqual(parsePeriod(dateRangeValue("", "2026-10-05")), { dal: null, al: "2026-10-05" });
  assert.equal(dateRangeValue("", ""), "", "senza date nessun parametro");
  const sheet = readFileSync(new URL("../../ui-10/filter-chips.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<input type="hidden" name=\{dateRange\.field\} value=\{dateRangeValue\(dates\.from, dates\.to\)\} \/>/);
  assert.match(sheet, /querySelector\(`select\[name="\$\{dateRange\.field\}"\]`\)/, "con le date la scelta del campo non parte");
  const page = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/attivita/page.tsx", import.meta.url), "utf8");
  assert.match(page, /dateRange=\{\{ field: PERIOD_PARAM, choose: "Scegli le date…", fromLabel: "Dal", toLabel: "Al", from: filter\.dal, to: filter\.al \}\}/);
  assert.match(page, /auditQuery\(\{ \.\.\.filter, pagina: 1 \}\)/, "«Scarica l'elenco» con lo stesso filtro");
});
