import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_VIEW_KINDS,
  DATA_VIEW_LABEL,
  NO_CONFIRMER,
  NO_DOMAIN,
  SOLUTION_PAGE_SIZE,
  buildModelItems,
  entitiesByDomain,
  groupRows,
  linkGroupsByItem,
  pageCount,
  pageOffset,
  parseDataQuery,
  parseItemRef,
  parseLinkRows,
  parsePage,
  parseRulesQuery,
  ruleConfirmations,
  ruleGroupHeading,
  ruleGroups,
  ruleKindsFor,
  rulesFiltered,
  rowsToDataRows,
  rowsToEntities,
  rowsToFields,
  rowsToKindCounts,
  rowsToRuleGroupCounts,
  rowsToRuleRows,
  searchText,
  solutionHref,
  solutionPageHrefs,
  statusesOfGroup,
} from "./model.ts";
import { findForbidden } from "./copy-guard.ts";
import { linkRow, modelRow } from "./view.fixtures.ts";

const ID = "6f0c2f4e-5a8b-4c1d-9e2f-0a1b2c3d4e5f";

test("links appear on both items, with the right label for each direction", () => {
  const groups = linkGroupsByItem(parseLinkRows([linkRow({ from_item_id: "k", to_item_id: "c", relation: "usa", cardinality: "N:1" })]));
  assert.deepEqual(groups.get("k")?.map((g) => [g.direction, g.label, g.items[0].key, g.items[0].cardinality]), [["out", "Usa", "richiesta.canale", "N:1"]]);
  assert.deepEqual(groups.get("c")?.map((g) => [g.direction, g.label, g.items[0].key]), [["in", "Usata da", "kpi.servizio.tempo"]]);
});

test("model items carry template fields, owner labels and whether the viewer can open them", () => {
  const [item] = buildModelItems(
    [modelRow({ id: "r1", key: "rule.servizio.urgenti", kind: "regola", status: "in_verifica", spec: { tipo_regola: "rigida", forma_logica: "se attesa > soglia", parametri: ["par.soglia"], notes: { privacy: "riservato" } } })],
    [],
    { roles: ["ls_sviluppatore"], roleLabels: { resp_servizio: "Servizio" } },
  );
  assert.equal(item.fields.tipo_regola, "rigida");
  assert.equal(item.fields.parametri, "par.soglia");
  assert.equal(item.ownerRoleLabel, "Servizio");
  assert.equal(item.notes.privacy, "riservato");
  assert.equal(item.canOpen, false, "the developer opens only green or blue items");
});

test("a rule is confirmed by its question; the confirmed text hash comes from the rule or the question", () => {
  const rules = buildModelItems([modelRow({ id: "r1", key: "rule.servizio.urgenti", kind: "regola" })], [], { roles: ["ls_lead"], roleLabels: {} });
  const conf = ruleConfirmations(
    [linkRow({ from_item_id: "q1", to_item_id: "r1", relation: "precisa", f_key: "q.servizio.05", f_title: "È così?", f_kind: "domanda", f_status: "validata", f_confirmed_hash: "a".repeat(64) })],
    rules,
  );
  assert.equal(conf.get("r1")?.question?.key, "q.servizio.05");
  assert.equal(conf.get("r1")?.question?.statusLabel, "A posto");
  assert.equal(conf.get("r1")?.textHash, "a".repeat(64));
  assert.deepEqual(ruleConfirmations([], rules).get("r1"), { question: null, textHash: null });
});

test("entities by domain with field counts", () => {
  const entities = rowsToEntities([
    { id: "e1", key: "ent.b", title: "B", spec: { dominio: "Servizio" }, status: "da_chiedere", field_statuses: { validata: 2, chiesta: 1 } },
    { id: "e2", key: "ent.a", title: "A", spec: {}, status: "da_chiedere", field_statuses: {} },
    { id: "e3", key: "ent.c", title: "C", spec: { dominio: "Clienti" }, status: "validata", field_statuses: null },
  ]);
  assert.equal(entities[0].fieldTotal, 3);
  assert.deepEqual(entities[0].fieldCounts, { validata: 2, chiesta: 1 });
  assert.deepEqual(entitiesByDomain(entities).map((d) => d.domain), ["Clienti", "Servizio", NO_DOMAIN]);
});

test("fields show type, unit, quality and sources", () => {
  const [f] = rowsToFields([{ id: "f1", key: "richiesta.canale", title: "Canale", spec: { tipo_dato: "testo", qualita: "spesso vuoto" }, response_config: { unit: "x" }, status: "validata", sources: ["src.crm.richieste"] }], ["ls_lead"]);
  assert.equal(f.type, "testo");
  assert.equal(f.unit, "x");
  assert.equal(f.quality, "spesso vuoto");
  assert.deepEqual(f.sources, ["src.crm.richieste"]);
  assert.equal(f.canOpen, true);
});

test("counts per kind and status", () => {
  const counts = rowsToKindCounts([
    { kind: "kpi", status: "validata", n: 2 },
    { kind: "kpi", status: "chiesta", n: "3" },
    { kind: "boh", status: "chiesta", n: 1 },
  ]);
  assert.equal(counts.get("kpi")?.validata, 2);
  assert.equal(counts.get("kpi")?.chiesta, 3);
  assert.equal(counts.get("kpi")?.mancante, 0);
  assert.equal(counts.size, 1);
});

test("rules: search, filters, constraints switch, page and panel come from the address", () => {
  assert.deepEqual(parseRulesQuery({}), { q: null, stato: null, perimetro: null, vincoli: false, pagina: 1, apri: null });
  assert.deepEqual(parseRulesQuery({ q: "  margine   minimo ", stato: "da-verificare", perimetro: "fuori", vincoli: "1", pagina: "3", apri: ID.toUpperCase() }), {
    q: "margine minimo",
    stato: "da_verificare",
    perimetro: "evoluzione",
    vincoli: true,
    pagina: 3,
    apri: ID,
  });
  const odd = parseRulesQuery({ q: "", stato: "boh", perimetro: "x", vincoli: "si", pagina: "-1", apri: "rule.servizio.urgenti" });
  assert.deepEqual(odd, { q: null, stato: null, perimetro: null, vincoli: false, pagina: 1, apri: null }, "a key is not a rule id in the panel");
  assert.equal(parseRulesQuery({ q: "x".repeat(300) }).q?.length, 100);
  assert.deepEqual(ruleKindsFor({ vincoli: false }), ["regola"]);
  assert.deepEqual(ruleKindsFor({ vincoli: true }), ["regola", "vincolo_rigido", "vincolo_morbido"]);
  assert.equal(rulesFiltered({ q: null, stato: null, perimetro: null }), false);
  assert.equal(rulesFiltered({ q: "x", stato: null, perimetro: null }), true);
  assert.deepEqual(statusesOfGroup("da_fare"), ["da_chiedere", "chiesta", "mancante", "parziale"]);
  assert.deepEqual(statusesOfGroup("a_posto"), ["validata", "non_applicabile"]);
});

test("pages of 100 rows on the server", () => {
  assert.equal(SOLUTION_PAGE_SIZE, 100);
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(100), 1);
  assert.equal(pageCount(261), 3);
  assert.equal(pageOffset(1), 0);
  assert.equal(pageOffset(3), 200);
  assert.equal(parsePage("2"), 2);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage("999999"), 1, "absurd pages are the first one");
  assert.equal(searchText("  "), null);
});

test("rules are grouped by who confirms them, with the counts of every page", () => {
  const rows = rowsToRuleRows([
    { id: "r1", title: "Soglia minima (F012)", status: "validata", kind: "regola", owner_role_key: "resp_commerciale" },
    { id: "r2", title: "Sconto massimo", status: "da_chiedere", kind: "regola", owner_role_key: "resp_commerciale" },
    { id: "r3", title: "Orario", status: "bloccata", kind: "vincolo_rigido", owner_role_key: "resp_servizio" },
    { id: "r4", title: "Senza ruolo", status: "boh", kind: "regola", owner_role_key: null },
  ], "ls");
  assert.equal(rows[0].title, "Soglia minima", "no fact codes in a row");
  assert.equal(rows[3].status, "da_chiedere");
  const counts = rowsToRuleGroupCounts([
    { owner_role_key: "resp_commerciale", total: 40, confirmed: "12" },
    { owner_role_key: "resp_servizio", total: 1, confirmed: 0 },
    { owner_role_key: null, total: 3, confirmed: 0 },
  ]);
  const groups = ruleGroups(rows, counts, { resp_commerciale: "Commerciale" });
  assert.deepEqual(
    groups.map((g) => [g.label, g.total, g.confirmed, g.rows.map((r) => r.id)]),
    [
      ["Commerciale", 40, 12, ["r1", "r2"]],
      ["Resp servizio", 1, 0, ["r3"]],
      [NO_CONFIRMER, 3, 0, ["r4"]],
    ],
  );
  assert.equal(ruleGroupHeading(groups[0]), "La conferma: Commerciale · 12 di 40 confermate");
  assert.equal(ruleGroupHeading(groups[1]), "La conferma: Resp servizio · 0 di 1 confermata");
  assert.equal(ruleGroupHeading({ label: "Commerciale", total: 1200, confirmed: 1000 }), "La conferma: Commerciale · 1.000 di 1.200 confermate");
});

test("rule and data titles reach the client without articles or keys, never as a bare key", () => {
  // Invented titles shaped like the seeded ones.
  const raw = [
    { id: "r1", title: "Il margine si conferma con il commerciale (art. 15.2).", status: "validata", kind: "regola", owner_role_key: null },
    { id: "r2", title: "Le urgenti seguono rule.servizio.urgenti_prima.", status: "da_chiedere", kind: "regola", owner_role_key: null },
    { id: "r3", title: "rule.servizio.urgenti", status: "da_chiedere", kind: "regola", owner_role_key: null },
  ];
  const client = rowsToRuleRows(raw, "cliente");
  assert.deepEqual(
    client.map((r) => r.title),
    ["Il margine si conferma con il commerciale.", "Le urgenti seguono.", "Regola"],
  );
  for (const r of client) assert.deepEqual(findForbidden(r.title, "cliente"), [], r.title);
  assert.equal(rowsToRuleRows(raw, "ls")[0].title, raw[0].title, "Lateral Space reads the title it wrote");
  const sources = rowsToDataRows(
    [
      { id: "s1", key: "src.banca.movimenti", kind: "fonte", title: "Registro (da compilare, q.fonti.28) · Mensile", explanation: "Estratto di src.banca.movimenti (art. 5).", status: "da_chiedere" },
      { id: "s2", key: "src.crm.richieste", kind: "fonte", title: "src.crm.richieste", explanation: null, status: "da_chiedere" },
    ],
    "fonti",
    "cliente",
  );
  assert.deepEqual(
    sources.map((r) => [r.title, r.line]),
    [
      ["Banca · Registro · Mensile", "Estratto di."],
      ["Crm · Fonte", null],
    ],
  );
  for (const r of sources) assert.deepEqual(findForbidden(`${r.title} ${r.line ?? ""}`, "cliente"), []);
});

test("data: the view, the search and the panel come from the address, old entity links included", () => {
  assert.deepEqual(parseDataQuery({}), { vista: "entita", q: null, pagina: 1, apri: null });
  assert.deepEqual(parseDataQuery({ vista: "fonti", q: "crm", pagina: "2", apri: ID }), { vista: "fonti", q: "crm", pagina: 2, apri: { id: ID } });
  assert.deepEqual(parseDataQuery({ vista: "entita", entita: "ent.richiesta" }).apri, { key: "ent.richiesta" }, "?entita= of the old Modello dati");
  assert.deepEqual(parseDataQuery({ apri: "ent.richiesta" }).apri, { key: "ent.richiesta" });
  assert.equal(parseDataQuery({ vista: "prova", apri: ID }).apri, null, "test cases have no panel");
  assert.equal(parseDataQuery({ vista: "boh" }).vista, "entita");
  assert.equal(parseItemRef("DROP TABLE"), null);
  assert.equal(parseItemRef("x".repeat(300)), null);
  assert.deepEqual(Object.values(DATA_VIEW_LABEL), ["Entità", "Variabili", "Formule", "Fonti", "Qualità dei dati", "Prova sul passato"]);
  assert.deepEqual(DATA_VIEW_KINDS.variabili, ["decisione", "parametro", "vincolo_rigido", "vincolo_morbido", "obiettivo", "incertezza", "uscita"]);
});

test("data rows: title, status, one line and the lock, grouped by domain or kind", () => {
  const entities = rowsToDataRows(
    [
      { id: "e1", key: "ent.cliente", kind: "entita", title: "Cliente", explanation: "Chi apre\n la richiesta (F010).", status: "validata", locked: false, domain: "servizio" },
      { id: "e2", key: "ent.operatore", kind: "entita", title: "Operatore", explanation: null, status: "bloccata", locked: true, domain: null },
    ],
    "entita",
    "ls",
  );
  assert.deepEqual(entities[0], { id: "e1", kind: "entita", title: "Cliente", line: "Chi apre la richiesta.", status: "validata", locked: false, group: "Servizio" });
  assert.equal(entities[1].locked, true);
  assert.equal(entities[1].group, NO_DOMAIN);
  const [source] = rowsToDataRows([{ id: "s1", key: "src.crm.richieste", kind: "fonte", title: "Export delle richieste", status: "da_chiedere", locked: "t" }], "fonti", "ls");
  assert.equal(source.title, "Crm · Export delle richieste");
  assert.equal(source.locked, true);
  const [formula] = rowsToDataRows([{ id: "f1", key: "f.costo", kind: "formula", title: "Costo", explanation: null, formula: "ore × costo / richieste", status: "da_chiedere" }], "formule", "ls");
  assert.equal(formula.line, "ore × costo / richieste", "the formula stands in for a missing explanation");
  const [check] = rowsToDataRows([{ id: "q1", key: "dq.x", kind: "controllo_qualita", title: "Canale valido", controllo: "canale tra email e chat", status: "da_chiedere" }], "qualita", "ls");
  assert.equal(check.line, "canale tra email e chat");
  const variables = rowsToDataRows(
    [
      { id: "v1", key: "par.a", kind: "parametro", title: "A", status: "da_chiedere" },
      { id: "v2", key: "par.b", kind: "parametro", title: "B", status: "da_chiedere" },
      { id: "v3", key: "out.c", kind: "uscita", title: "C", status: "da_chiedere" },
    ],
    "variabili",
    "ls",
  );
  assert.deepEqual(
    groupRows(variables).map((g) => [g.label, g.rows.length]),
    [
      ["Parametri", 2],
      ["Uscite", 1],
    ],
  );
  assert.deepEqual(groupRows([{ group: null }, { group: null }]).length, 1);
});

test("rows open their panel and pages move without losing search and filters", () => {
  const base = "/dashboard/w/casi-duso/c/soluzione/regole";
  const sp = { q: "margine", stato: "da-fare", pagina: "2", apri: undefined, vuoto: "" };
  assert.equal(solutionHref(base, sp, { apri: ID }), `${base}?q=margine&stato=da-fare&pagina=2&apri=${ID}`);
  assert.equal(solutionHref(base, { apri: ID }, { apri: null }), base);
  assert.equal(solutionHref(base, { q: ["a", "b"] }, {}), `${base}?q=a`);
  assert.deepEqual(solutionPageHrefs(base, { q: "x", pagina: "2", apri: ID }, 2, 3), { prevHref: `${base}?q=x`, nextHref: `${base}?q=x&pagina=3` });
  assert.deepEqual(solutionPageHrefs(base, {}, 1, 1), { prevHref: null, nextHref: null });
  assert.deepEqual(solutionPageHrefs(base, {}, 9, 3), { prevHref: `${base}?pagina=3`, nextHref: null }, "a page past the end goes back to the last one");
});

test("fields carry the lock only when the reading says so", () => {
  const [plain] = rowsToFields([{ id: "f1", key: "richiesta.canale", title: "Canale", status: "validata" }], ["ls_lead"]);
  assert.equal("locked" in plain, false);
  const [locked] = rowsToFields([{ id: "f2", key: "operatore.turno", title: "Turno", status: "bloccata", locked: true, sources: ["Turni degli operatori"] }], ["ls_lead"]);
  assert.equal(locked.locked, true);
  assert.deepEqual(locked.sources, ["Turni degli operatori"]);
});
