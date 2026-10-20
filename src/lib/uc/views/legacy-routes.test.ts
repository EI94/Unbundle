import test from "node:test";
import assert from "node:assert/strict";
import { parseQuestionFilter, type QuestionDefaults } from "./catalog-filter.ts";
import { LEGACY_CASE_SEGMENTS, legacyCaseRoute, legacyCaseRouteFromPath } from "./legacy-routes.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const base = `/dashboard/${WS}/casi-duso/${CASE}`;
const route = (segments: string[], query = "") => legacyCaseRoute(base, segments, new URLSearchParams(query));

test("voci goes to Domande and translates every filter of the old catalog", () => {
  assert.equal(route(["voci"]), `${base}/domande`);
  assert.equal(route(["voci"], "preset=must_non_verdi"), `${base}/domande?vista=da-fare`);
  assert.equal(route(["voci"], "preset=bloccate"), `${base}/domande?vista=bloccate`);
  assert.equal(route(["voci"], "preset=da_verificare"), `${base}/domande?vista=da-verificare`);
  assert.equal(route(["voci"], "preset=evoluzione"), `${base}/domande?vista=tutte&perimetro=fuori`);
  assert.equal(route(["voci"], "modulo=servizio"), `${base}/domande?argomento=servizio`);
  assert.equal(route(["voci"], "privacy=personale"), `${base}/domande?riservatezza=personale`);
  for (const p of ["should", "could", "nessuno", "__none"]) assert.equal(route(["voci"], `priorita=${p}`), `${base}/domande?indispensabili=no`, p);
  assert.equal(route(["voci"], "priorita=must"), `${base}/domande`, "only the indispensable ones is the default");
  assert.equal(route(["voci"], "tipo=kpi"), `${base}/domande?mostra=catalogo&tipo=kpi`);
  assert.equal(route(["voci"], "tipo=tutti"), `${base}/domande?mostra=catalogo`);
  assert.equal(route(["voci"], "tipo=domanda"), `${base}/domande`, "questions are the default view");
  assert.equal(
    route(["voci"], `stato=parziale&referente=${ITEM}&ruolo=resp_servizio&q=preventivi&pagina=3`),
    `${base}/domande?stato=parziale&referente=${ITEM}&ruolo=resp_servizio&q=preventivi&pagina=3`,
  );
  assert.equal(route(["voci"], "preset=bloccate&modulo=prezzi&q=sconto"), `${base}/domande?vista=bloccate&argomento=prezzi&q=sconto`);
  assert.equal(route(["voci"], "sconosciuto=1&preset=inventato"), `${base}/domande`, "unknown parameters are dropped");
});

test("an item keeps its id and its query", () => {
  assert.equal(route(["voci", ITEM]), `${base}/domande/${ITEM}`);
  assert.equal(route(["voci", ITEM], "da=verifica"), `${base}/domande/${ITEM}?da=verifica`);
  assert.equal(route(["voci", ITEM, "altro"]), null);
});

test("the verification queue goes to the «Da verificare» view, the page passes", () => {
  assert.equal(route(["verifica"]), `${base}/domande?vista=da-verificare`);
  assert.equal(route(["verifica"], "pagina=2&altro=x"), `${base}/domande?vista=da-verificare&pagina=2`);
});

test("documents, map, rules, data model, KPI, ROI and progress", () => {
  assert.equal(route(["documenti"], "x=1"), `${base}/domande/documenti?x=1`);
  assert.equal(route(["mappa"], "vista=dati&altro=1"), `${base}/soluzione/mappa?vista=dati`);
  assert.equal(route(["regole"], "apri=abc"), `${base}/soluzione/regole?apri=abc`);
  assert.equal(route(["regole"], "q=1"), `${base}/soluzione/regole`);
  assert.equal(route(["modello-dati"], `vista=fonti&entita=${ITEM}`), `${base}/soluzione/dati?vista=fonti&apri=${ITEM}`);
  assert.equal(route(["kpi"], "apri=k1"), `${base}/valore/kpi?apri=k1`);
  assert.equal(route(["roi"], "x=1"), `${base}/valore`);
  assert.equal(route(["avanzamento"], "x=1"), `${base}/via`);
});

test("the old audit log and its CSV go to Attività with their filters", () => {
  assert.equal(route(["registro"], "tipo=caso&attore=utente&dal=2026-10-01&al=2026-10-03&pagina=2&x=1"), `${base}/attivita?tipo=caso&attore=utente&dal=2026-10-01&al=2026-10-03&pagina=2`);
  assert.equal(route(["registro"], "chi=ls"), `${base}/attivita?chi=ls`);
  assert.equal(route(["registro", "csv"], "tipo=caso&dal=2026-10-01"), `${base}/attivita/csv?tipo=caso&dal=2026-10-01`);
  assert.equal(route(["registro", "altro"]), null);
});

test("segments that are not old addresses are not redirected", () => {
  for (const s of ["domande", "soluzione", "valore", "via", "persone", "privacy", "attivita", "export", "files", ""]) assert.equal(route([s]), null, s);
  assert.equal(route([]), null);
  assert.equal(route(["roi", "x"]), null);
});

test("every old segment has a destination", () => {
  for (const s of LEGACY_CASE_SEGMENTS) assert.notEqual(route([s]), null, s);
});

test("a plain object of search params works like URLSearchParams, first value wins", () => {
  assert.equal(legacyCaseRoute(base, ["voci"], { preset: ["bloccate", "evoluzione"], q: "x" }), `${base}/domande?vista=bloccate&q=x`);
  assert.equal(legacyCaseRoute(`${base}/`, ["roi"]), `${base}/valore`, "a trailing slash on the base is ignored");
});

test("from the request path: only dossier paths, already encoded", () => {
  assert.equal(legacyCaseRouteFromPath(`${base}/voci`, new URLSearchParams("preset=bloccate")), `${base}/domande?vista=bloccate`);
  assert.equal(legacyCaseRouteFromPath(`${base}/voci/${ITEM}/`), `${base}/domande/${ITEM}`);
  assert.equal(legacyCaseRouteFromPath(`${base}/registro/csv`, new URLSearchParams("tipo=caso")), `${base}/attivita/csv?tipo=caso`);
  assert.equal(legacyCaseRouteFromPath(base), null);
  assert.equal(legacyCaseRouteFromPath(`/dashboard/${WS}/use-cases/${CASE}/voci`), null);
  const encoded = legacyCaseRouteFromPath(`/dashboard/a%20b/casi-duso/${CASE}/roi`);
  assert.equal(encoded, `/dashboard/a%20b/casi-duso/${CASE}/valore`);
  assert.ok(!legacyCaseRoute(base, ["voci"], new URLSearchParams("q=a\r\nb"))!.includes("\n"), "values are encoded");
});

test("an old catalog address keeps its filters through the 308 in Domande of today", () => {
  const preparing: QuestionDefaults = { vista: "da-fare", soloIndispensabili: true };
  const after = (segments: string[], query: string) => {
    const target = legacyCaseRoute(base, segments, new URLSearchParams(query))!;
    return parseQuestionFilter(Object.fromEntries(new URL(target, "http://x").searchParams), "ls", preparing);
  };
  const blocked = after(["voci"], "preset=bloccate&modulo=prezzi&tipo=kpi&q=x");
  assert.deepEqual([blocked.vista, blocked.argomento, blocked.catalogo, blocked.tipo, blocked.q], ["bloccate", "prezzi", true, "kpi", "x"]);
  const outside = after(["voci"], "preset=evoluzione&tipo=tutti");
  assert.deepEqual([outside.vista, outside.perimetro, outside.catalogo, outside.tipo], ["tutte", "fuori", true, null]);
  const people = after(["voci"], `stato=parziale&referente=${ITEM}&ruolo=resp_servizio&privacy=personale&q=preventivi&pagina=3`);
  assert.deepEqual([people.stato, people.referente, people.ruolo, people.riservatezza, people.q, people.pagina], ["parziale", ITEM, "resp_servizio", "personale", "preventivi", 3]);
  assert.equal(after(["voci"], "priorita=should").soloIndispensabili, false, "«not only must» turns the switch off");
  assert.deepEqual(after(["voci"], ""), parseQuestionFilter({}, "ls", preparing), "no filter, the defaults");
  const queue = after(["verifica"], "pagina=2");
  assert.deepEqual([queue.vista, queue.pagina], ["da-verificare", 2], "the bell's «risposte da verificare» still opens the answers to check");
});
