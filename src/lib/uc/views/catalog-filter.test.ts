import test from "node:test";
import assert from "node:assert/strict";
import { GATE_PHASE } from "../gates.ts";
import { toStatement } from "../sql/statement.ts";
import {
  EMPTY_CATALOG_FILTER,
  QUESTIONS_PAGE_SIZE,
  VIA_PHASE,
  catalogQuery,
  catalogWhereSql,
  hasActiveFilter,
  hasActiveQuestionFilter,
  isDefaultView,
  parseCatalogFilter,
  parseCatalogQuery,
  parseQuestionFilter,
  parseQuestionQuery,
  presetConditionSql,
  questionAudience,
  questionBaseWhereSql,
  questionCountsSql,
  questionDefaults,
  questionPageSql,
  questionQuery,
  questionSelectionSql,
  questionWhereSql,
  reviewQueueSql,
  segmentConditionSql,
  withoutQuestionFilters,
  caseFilesCountSql,
  questionBackQuery,
  questionTabOf,
  questionsCollapsed,
  segmentPatch,
  type QuestionDefaults,
} from "./catalog-filter.ts";
import { CASE_ID, CONTACT, ITEM as ITEM_ID, LS_USER } from "./view.fixtures.ts";

test("parses known filters and ignores invalid values", () => {
  const f = parseCatalogFilter({
    tipo: "kpi",
    stato: "in_verifica",
    referente: CONTACT,
    priorita: "must",
    privacy: "riservato_azienda",
    modulo: "m.servizio.base",
    ruolo: "resp_servizio",
    preset: "bloccate",
    q: "  canale ",
    pagina: "3",
  });
  assert.deepEqual(f, {
    tipo: "kpi",
    stato: "in_verifica",
    referente: CONTACT,
    priorita: "must",
    privacy: "riservato_azienda",
    modulo: "m.servizio.base",
    ruolo: "resp_servizio",
    preset: "bloccate",
    q: "canale",
    pagina: 3,
  });
  const bad = parseCatalogFilter({ tipo: "voce", stato: "verde", referente: "1; DROP TABLE x", priorita: "alta", privacy: "x", modulo: "M!", ruolo: "1x", preset: "tutte", pagina: "-2" });
  assert.deepEqual(bad, { ...EMPTY_CATALOG_FILTER, tipo: "domanda" }, "an unknown type falls back to the initial view");
  assert.equal(parseCatalogFilter({ referente: "nessuno", priorita: "nessuno" }).referente, "nessuno");
  assert.equal(parseCatalogFilter({ priorita: "nessuno" }).priorita, "nessuno");
  assert.equal(parseCatalogFilter({ pagina: "99999" }).pagina, 1000);
  assert.equal(parseCatalogFilter({ tipo: ["kpi", "campo"] }).tipo, "kpi");
  assert.equal(parseCatalogFilter({ q: "x".repeat(300) }).q?.length, 100);
});

test("the initial view is the questions; «tipo=tutti» shows every kind", () => {
  assert.deepEqual(parseCatalogFilter({}), { ...EMPTY_CATALOG_FILTER, tipo: "domanda" });
  assert.equal(parseCatalogFilter({ tipo: "tutti" }).tipo, null);
  assert.equal(isDefaultView(parseCatalogFilter({})), true);
  assert.equal(isDefaultView(parseCatalogFilter({ pagina: "2" })), true, "the page is not a filter");
  assert.equal(isDefaultView(parseCatalogFilter({ tipo: "tutti" })), false);
  assert.equal(isDefaultView(parseCatalogFilter({ stato: "chiesta" })), false);
});

test("query strings keep filters, omit the initial type and reset the page when a filter changes", () => {
  const f = parseCatalogFilter({ stato: "chiesta", pagina: "4" });
  assert.equal(catalogQuery(f, { stato: null }), "");
  assert.equal(catalogQuery(f, { pagina: 5 }), "?stato=chiesta&pagina=5");
  assert.equal(catalogQuery(parseCatalogFilter({})), "");
  assert.equal(catalogQuery(EMPTY_CATALOG_FILTER), "?tipo=tutti");
  assert.equal(catalogQuery(f, { tipo: "kpi" }), "?tipo=kpi&stato=chiesta");
  assert.equal(catalogQuery(f, { q: "costo orario" }), "?stato=chiesta&q=costo+orario");
  assert.equal(hasActiveFilter(f), true);
  assert.equal(hasActiveFilter({ ...EMPTY_CATALOG_FILTER, pagina: 3 }), false);
  assert.equal(hasActiveFilter(parseCatalogFilter({ tipo: "kpi" })), false, "the type alone is the view, not a filter");
  for (const sp of [{}, { tipo: "tutti", preset: "bloccate" }, { tipo: "kpi", q: "x y", referente: "nessuno", pagina: "2" }]) {
    const parsed = parseCatalogFilter(sp);
    assert.deepEqual(parseCatalogQuery(catalogQuery(parsed, { pagina: parsed.pagina })), parsed, "round trip through the URL");
  }
});

test("conditions are parameters, never text from the URL", () => {
  const f = parseCatalogFilter({ tipo: "domanda", referente: CONTACT, q: "x' OR 1=1 --", modulo: "m.servizio.base" });
  const s = toStatement(catalogWhereSql(CASE_ID, f, { userId: LS_USER, validatedOnly: false }));
  assert.ok(s.text.startsWith("i.case_id = $1::uuid AND i.deleted_at IS NULL"));
  assert.ok(!s.text.includes("OR 1=1"));
  assert.ok(!s.text.includes(CONTACT));
  assert.deepEqual(s.params, [CASE_ID, "domanda", CONTACT, "m.servizio.base", "x' or 1=1 --", "x' or 1=1 --"]);
});

test("presets: must not green, blocked, evolution, to verify by me", () => {
  const ctx = { userId: LS_USER, validatedOnly: false };
  const where = (preset: string) => toStatement(catalogWhereSql(CASE_ID, parseCatalogFilter({ tipo: "tutti", preset }), ctx));
  assert.match(where("must_non_verdi").text, /i\.priority = 'must' AND i\.status NOT IN \('validata', 'non_applicabile'\)/);
  assert.match(where("bloccate").text, /i\.status = 'bloccata'/);
  assert.match(where("evoluzione").text, /i\.perimeter = 'evoluzione'/);
  const mine = where("da_verificare");
  assert.match(mine.text, /i\.status IN \('in_verifica', 'parziale'\)/);
  assert.match(mine.text, /x\.responder_user_id = \$2::uuid/);
  assert.match(mine.text, /t\.issued_by_user_id = \$3::uuid/);
  assert.deepEqual(mine.params, [CASE_ID, LS_USER, LS_USER]);
  assert.equal(presetConditionSql("bloccate", ctx, true), null, "counting statuses drops the preset's own status condition");
});

test("the developer only sees green or blue items, and every facet drops its own filter", () => {
  const dev = toStatement(catalogWhereSql(CASE_ID, EMPTY_CATALOG_FILTER, { userId: LS_USER, validatedOnly: true }));
  assert.match(dev.text, /i\.status = ANY\(\$2::text\[\]\)/);
  assert.deepEqual(dev.params[1], ["validata", "non_applicabile"]);
  const f = parseCatalogFilter({ tipo: "kpi", stato: "chiesta", referente: CONTACT, priorita: "must", privacy: "nessuna", modulo: "m.a", ruolo: "resp_x", preset: "evoluzione" });
  const ctx = { userId: LS_USER, validatedOnly: false };
  const text = (without?: Parameters<typeof catalogWhereSql>[3]) => toStatement(catalogWhereSql(CASE_ID, f, ctx, without)).text;
  const columns = {
    tipo: "i.kind =",
    stato: "i.status =",
    referente: "i.assignee_contact_id =",
    priorita: "i.priority =",
    privacy: "i.privacy_class =",
    modulo: "i.request_module_key =",
    ruolo: "i.owner_role_key =",
    preset: "i.perimeter = 'evoluzione'",
  } as const;
  for (const [facet, column] of Object.entries(columns) as [keyof typeof columns, string][]) {
    const t = text(facet);
    assert.ok(!t.includes(column), `${facet} drops its own condition`);
    for (const [other, otherColumn] of Object.entries(columns)) if (other !== facet) assert.ok(t.includes(otherColumn), `${facet} keeps ${other}`);
  }
  assert.match(toStatement(catalogWhereSql(CASE_ID, parseCatalogFilter({ referente: "nessuno", priorita: "nessuno" }), ctx)).text, /i\.assignee_contact_id IS NULL AND i\.priority IS NULL/);
});

// ── Domande (DESIGN §3.6, WP3) ────────────────────────────────────────

const PREP: QuestionDefaults = { vista: "da-fare", soloIndispensabili: true };
const AFTER: QuestionDefaults = { vista: "tutte", soloIndispensabili: false };

test("Domande defaults: Da fare and only the indispensable ones until the via, then everything (§3.6.1)", () => {
  assert.deepEqual(questionDefaults("bozza", null, "ls"), PREP);
  assert.deepEqual(questionDefaults("raccolta", null, "cliente"), PREP);
  assert.deepEqual(questionDefaults("in_sviluppo", null, "ls"), AFTER);
  assert.deepEqual(questionDefaults("pronto_sviluppo", null, "ls"), AFTER);
  assert.deepEqual(questionDefaults("chiuso", null, "ls"), AFTER);
  assert.deepEqual(questionDefaults("sospeso", "raccolta", "ls"), PREP);
  assert.deepEqual(questionDefaults("sospeso", "in_sviluppo", "ls"), AFTER);
  assert.deepEqual(questionDefaults("raccolta", null, "sviluppatore"), { vista: "a-posto", soloIndispensabili: false });
});

test("Domande audience: Lateral Space, the developer alone, the client", () => {
  assert.equal(questionAudience(["ls_lead"]), "ls");
  assert.equal(questionAudience(["ls_analista", "ls_sviluppatore"]), "ls");
  assert.equal(questionAudience(["ls_sviluppatore"]), "sviluppatore");
  assert.equal(questionAudience(["owner_cliente"]), "cliente");
});

test("Domande parameters: every filter for Lateral Space, the URL wins over the defaults", () => {
  const f = parseQuestionFilter(
    {
      vista: "bloccate",
      indispensabili: "no",
      mostra: "catalogo",
      tipo: "kpi",
      argomento: "m.servizio.base",
      referente: CONTACT,
      ruolo: "resp_servizio",
      stato: "chiesta",
      riservatezza: "personale",
      perimetro: "fuori",
      q: "  canale ",
      pagina: "2",
    },
    "ls",
    PREP,
  );
  assert.deepEqual(f, {
    vista: "bloccate",
    soloIndispensabili: false,
    catalogo: true,
    documenti: false,
    tipo: "kpi",
    argomento: "m.servizio.base",
    referente: CONTACT,
    ruolo: "resp_servizio",
    stato: "chiesta",
    riservatezza: "personale",
    perimetro: "fuori",
    q: "canale",
    pagina: 2,
  });
  const d = parseQuestionFilter({}, "ls", PREP);
  assert.equal(d.vista, "da-fare");
  assert.equal(d.soloIndispensabili, true);
  assert.equal(parseQuestionFilter({ indispensabili: "si" }, "ls", AFTER).soloIndispensabili, true);
  const bad = parseQuestionFilter({ vista: "boh", pagina: "-3", referente: "x" }, "ls", AFTER);
  assert.equal(bad.vista, "tutte");
  assert.equal(bad.pagina, 1);
  assert.equal(bad.referente, null);
  assert.equal(parseQuestionFilter({ tipo: "kpi" }, "ls", AFTER).tipo, null, "the kind needs the whole catalog");
});

test("Domande parameters for the client and the developer: only what they may use (§3.6.7, §3.6.8)", () => {
  const c = parseQuestionFilter({ vista: "bloccate", stato: "chiesta", riservatezza: "personale", mostra: "catalogo", referente: "nessuno" }, "cliente", PREP);
  assert.equal(c.vista, "bloccate", "(release 10) the client opens the «In attesa» group of «Da rispondere» too");
  assert.equal(c.stato, null);
  assert.equal(c.riservatezza, null);
  assert.equal(c.catalogo, false);
  assert.equal(c.referente, "nessuno", "the client finds the questions to assign");
  assert.equal(parseQuestionFilter({ referente: CONTACT }, "cliente", PREP).referente, null, "never one colleague: the counts would be that person's progress (art. 15.4)");
  assert.equal(parseQuestionFilter({ referente: CONTACT }, "ls", PREP).referente, CONTACT);
  const done = parseQuestionFilter({ vista: "a-posto" }, "cliente", PREP);
  assert.deepEqual([done.vista, done.stato], ["tutte", "a-posto"], "(release 10) yesterday's «A posto» segment is «Tutte» with the «A posto» filter");
  const dev = parseQuestionFilter({ vista: "da-fare", indispensabili: "si", referente: CONTACT, q: "x" }, "sviluppatore", questionDefaults("in_sviluppo", null, "sviluppatore"));
  assert.equal(dev.vista, "a-posto");
  assert.equal(dev.soloIndispensabili, false);
  assert.equal(dev.referente, null);
  assert.equal(dev.q, "x");
});

test("Domande query string: only what differs from the defaults; explicit for the selection; filters reset the page", () => {
  const base = parseQuestionFilter({ pagina: "3" }, "ls", PREP);
  assert.equal(questionQuery(base, PREP, { pagina: 3 }), "?pagina=3");
  assert.equal(questionQuery(base, PREP), "");
  assert.equal(questionQuery(base, PREP, { vista: "tutte" }), "?vista=tutte");
  assert.equal(questionQuery(base, PREP, { soloIndispensabili: false }), "?indispensabili=no");
  assert.equal(questionQuery(base, AFTER), "?vista=da-fare&indispensabili=si");
  assert.equal(questionQuery(base, PREP, {}, { explicit: true }), "?vista=da-fare&indispensabili=si");
  assert.equal(questionQuery(base, PREP, { argomento: "m.a", q: "it's" }, { extra: { apri: ITEM_ID } }), `?argomento=m.a&q=it%27s&apri=${ITEM_ID}`);
  assert.equal(questionQuery({ ...base, catalogo: false, tipo: "kpi" }, PREP), "", "no kind without the whole catalog");
  const round = parseQuestionQuery(questionQuery(base, PREP, { catalogo: true, tipo: "kpi", stato: "chiesta" }, { explicit: true }), "ls", AFTER);
  assert.equal(round.vista, "da-fare");
  assert.equal(round.soloIndispensabili, true);
  assert.equal(round.tipo, "kpi");
  assert.equal(round.stato, "chiesta");
});

test("Domande filters: active only for the panel fields; clearing keeps segment, switch and search", () => {
  const f = parseQuestionFilter({ q: "canale", vista: "bloccate" }, "ls", PREP);
  assert.equal(hasActiveQuestionFilter(f), false);
  const g = { ...f, referente: CONTACT, catalogo: true };
  assert.equal(hasActiveQuestionFilter(g), true);
  const cleared = withoutQuestionFilters(g);
  assert.equal(hasActiveQuestionFilter(cleared), false);
  assert.equal(cleared.vista, "bloccate");
  assert.equal(cleared.q, "canale");
});

test("indispensable means required by the via: the same phase as gates.ts", () => {
  assert.equal(VIA_PHASE, GATE_PHASE.G1);
});

const ctxLs = { userId: LS_USER, audience: "ls" as const };

test("Domande SQL: values are parameters, questions only unless the whole catalog, the developer sees validated items", () => {
  const f = parseQuestionFilter({ q: "x'); DROP TABLE uc_items; --", argomento: "m.a", perimetro: "nel" }, "ls", PREP);
  const s = toStatement(questionBaseWhereSql(CASE_ID, f, ctxLs));
  assert.doesNotMatch(s.text, /DROP TABLE/);
  assert.match(s.text, /i\.kind = 'domanda'/);
  assert.match(s.text, /in_gate_scope AND i\.priority = 'must'/);
  assert.match(s.text, /IS DISTINCT FROM 'evoluzione'/);
  assert.ok(s.params.includes("x'); drop table uc_items; --"));
  const all = toStatement(questionBaseWhereSql(CASE_ID, { ...f, catalogo: true, tipo: null }, ctxLs));
  assert.doesNotMatch(all.text, /i\.kind =/);
  const dev = toStatement(questionBaseWhereSql(CASE_ID, parseQuestionFilter({}, "sviluppatore", questionDefaults("raccolta", null, "sviluppatore")), { userId: LS_USER, audience: "sviluppatore" }));
  assert.match(dev.text, /i\.status IN \('validata', 'non_applicabile'\)/);
});

test("«Da verificare» applies the four eyes for Lateral Space, not for the client", () => {
  const ls = toStatement(segmentConditionSql("da-verificare", ctxLs)!);
  assert.match(ls.text, /in_verifica/);
  assert.match(ls.text, /responder_user_id/);
  assert.match(ls.text, /issued_by_user_id/);
  const client = toStatement(segmentConditionSql("da-verificare", { userId: LS_USER, audience: "cliente" })!);
  assert.doesNotMatch(client.text, /responder_user_id/);
  assert.equal(segmentConditionSql("tutte", ctxLs), null);
  assert.match(toStatement(segmentConditionSql("da-fare", ctxLs)!).text, /'da_chiedere', 'chiesta', 'mancante', 'parziale'/);
  assert.match(toStatement(questionWhereSql(CASE_ID, parseQuestionFilter({ vista: "bloccate" }, "ls", PREP), ctxLs)).text, /i\.status IN \('bloccata'\)/);
});

test("Domande page: 50 rows, by topic in schema order with the indispensable first; «Da verificare» from the oldest answer", () => {
  const f = parseQuestionFilter({ pagina: "3" }, "ls", PREP);
  const page = questionPageSql(CASE_ID, f, ctxLs);
  assert.equal(QUESTIONS_PAGE_SIZE, 50);
  assert.match(page.text, /ORDER BY mo\.ord NULLS LAST, \(i\.priority = 'must'\) DESC, i\.sort_order, i\.key/);
  assert.ok(page.params.includes(50));
  assert.ok(page.params.includes(100));
  assert.match(page.text, /request_modules/);
  assert.match(page.text, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\)/);
  const verify = questionPageSql(CASE_ID, { ...f, vista: "da-verificare" }, ctxLs);
  assert.match(verify.text, /ORDER BY mo\.ord NULLS LAST, a\.created_at NULLS LAST/, "by topic, then from the oldest answer");
  assert.doesNotMatch(page.text, /uc_validations/, "(release 10) the row says one thing: the automatic checks are in the panel");
  const counts = questionCountsSql(CASE_ID, f, ctxLs);
  assert.match(counts.text, /GROUP BY 1/);
  assert.doesNotMatch(counts.text, /WHERE[\s\S]*AND i\.status IN \('da_chiedere', 'chiesta', 'mancante', 'parziale'\)\s*GROUP/, "the counts run without the segment");
  assert.match(questionSelectionSql(CASE_ID, f, ctxLs).text, /LIMIT \$\d+/);
  const queue = reviewQueueSql(CASE_ID, LS_USER);
  assert.match(queue.text, /i\.status = 'in_verifica'/);
  assert.match(queue.text, /AS mine/);
});

test("(release 10, §3.5) yesterday's segments still open: «Bloccate» is the «In attesa» group of «Da fare», «A posto» is a filter of «Tutte»", () => {
  for (const audience of ["ls", "cliente"] as const) {
    const blocked = parseQuestionFilter({ vista: "bloccate" }, audience, PREP);
    assert.equal(blocked.vista, "bloccate", audience);
    assert.equal(questionTabOf(blocked.vista), "da-fare", "the segment lit is «Da fare»");
    const done = parseQuestionFilter({ vista: "a-posto", stato: "chiesta" }, audience, AFTER);
    assert.equal(done.vista, "tutte", audience);
    assert.equal(done.stato, audience === "ls" ? "chiesta" : "a-posto", "a detailed state from the address wins for Lateral Space");
  }
  const dev = parseQuestionFilter({ vista: "a-posto", stato: "a-posto" }, "sviluppatore", questionDefaults("in_sviluppo", null, "sviluppatore"));
  assert.deepEqual([dev.vista, dev.stato], ["a-posto", null], "the developer only sees the questions in order, as before");
  assert.equal(questionTabOf("a-posto"), null);
  assert.equal(questionTabOf("da-verificare"), "da-verificare");
  assert.equal(questionTabOf("tutte"), "tutte");
  const sql = toStatement(questionBaseWhereSql(CASE_ID, parseQuestionFilter({ stato: "a-posto" }, "cliente", AFTER), { userId: LS_USER, audience: "cliente" }));
  assert.match(sql.text, /i\.status IN \('validata', 'non_applicabile'\)/);
  assert.equal(parseQuestionFilter({ stato: "chiesta" }, "cliente", AFTER).stato, null, "no detailed state for the client");
});

test("(release 10, §3.5) «Documenti» is a filter: sources, documents and questions answered with a file; the whole catalog wins", () => {
  const docs = parseQuestionFilter({ mostra: "documenti" }, "cliente", AFTER);
  assert.equal(docs.documenti, true);
  assert.equal(docs.catalogo, false);
  const where = toStatement(questionBaseWhereSql(CASE_ID, docs, { userId: LS_USER, audience: "cliente" })).text;
  assert.match(where, /i\.kind IN \('fonte', 'documento'\) OR i\.response_type IN \('file', 'dataset'\)/);
  assert.doesNotMatch(where, /i\.kind = 'domanda'/);
  assert.equal(questionQuery(docs, AFTER), "?mostra=documenti");
  assert.equal(hasActiveQuestionFilter(docs), true);
  assert.equal(withoutQuestionFilters(docs).documenti, false);
  const both = parseQuestionFilter({ mostra: "catalogo" }, "ls", AFTER);
  assert.equal(questionQuery({ ...both, documenti: true }, AFTER), "?mostra=catalogo", "one «Mostra» at a time");
  assert.equal(parseQuestionFilter({ mostra: "catalogo" }, "cliente", AFTER).catalogo, false, "the whole catalog stays for Lateral Space");
});

test("(release 10, §3.5) «Senza argomento» opens with `argomento=nessuno`", () => {
  const none = parseQuestionFilter({ argomento: "nessuno" }, "ls", AFTER);
  assert.equal(none.argomento, "nessuno");
  assert.match(toStatement(questionBaseWhereSql(CASE_ID, none, ctxLs)).text, /i\.request_module_key IS NULL/);
  assert.equal(questionQuery(none, AFTER), "?argomento=nessuno");
});

test("(release 10, §3.5) topics stay closed until the address asks for precise questions: a filter, a search, the «In attesa» group", () => {
  assert.equal(questionsCollapsed(parseQuestionFilter({}, "ls", PREP)), true);
  assert.equal(questionsCollapsed(parseQuestionFilter({ vista: "tutte", indispensabili: "no", pagina: "3" }, "ls", PREP)), true, "the segment, the switch and the page do not open");
  assert.equal(questionsCollapsed(parseQuestionFilter({}, "sviluppatore", questionDefaults("in_sviluppo", null, "sviluppatore"))), true);
  for (const sp of [{ argomento: "m.a" }, { referente: CONTACT }, { q: "preventivi" }, { vista: "bloccate" }, { stato: "a-posto" }, { mostra: "documenti" }, { perimetro: "fuori" }, { ruolo: "resp_servizio" }]) {
    assert.equal(questionsCollapsed(parseQuestionFilter(sp, "ls", PREP)), false, JSON.stringify(sp));
  }
});

test("(release 10, §3.5) back from a question: the list's own parameters, nothing else", () => {
  assert.equal(questionBackQuery({}), "");
  assert.equal(
    questionBackQuery({ apri: ITEM_ID, vista: "da-verificare", argomento: "m.a", pagina: "2", da: "verifica", q: ["it's", "x"] }),
    "?vista=da-verificare&argomento=m.a&q=it%27s&pagina=2",
  );
});

test("(release 10, §3.5) «File (6)»: the archive as the panel lists it; the personal zone only for who sees its metadata; the developer only ready files of documents in order", () => {
  const ls = caseFilesCountSql(CASE_ID, { personalZone: true, validatedOnly: false });
  assert.match(ls.text, /FROM uc_files f/);
  assert.match(ls.text, /f\.deleted_at IS NULL/);
  assert.ok(ls.params.includes(true));
  assert.doesNotMatch(ls.text, /uc_items/);
  const dev = caseFilesCountSql(CASE_ID, { personalZone: false, validatedOnly: true });
  assert.match(dev.text, /f\.scan_status = 'pulito'/);
  assert.match(dev.text, /i\.status IN \('validata', 'non_applicabile'\)/);
  assert.ok(dev.params.includes(false));
});

test("(release 10, §3.5) «A posto» chosen from the sheet opens «Tutte»: the client on «Da rispondere» sees the questions in order, not an empty list", () => {
  for (const audience of ["ls", "cliente"] as const) {
    const f = parseQuestionFilter({ stato: "a-posto" }, audience, PREP);
    assert.deepEqual([f.vista, f.stato], ["tutte", "a-posto"], audience);
    assert.equal(parseQuestionFilter({ stato: "a-posto", vista: "da-verificare" }, audience, PREP).vista, "tutte");
  }
  assert.equal(parseQuestionFilter({ stato: "chiesta", vista: "da-fare" }, "ls", PREP).vista, "da-fare", "a detailed state keeps the segment");
  // Andando a un altro segmento il filtro «A posto» si toglie; in «Tutte» resta.
  const done = parseQuestionFilter({ stato: "a-posto" }, "cliente", PREP);
  assert.deepEqual(segmentPatch(done, "da-fare"), { vista: "da-fare", stato: null });
  assert.deepEqual(segmentPatch(done, "bloccate"), { vista: "bloccate", stato: null });
  assert.deepEqual(segmentPatch(done, "tutte"), { vista: "tutte" });
  assert.equal(questionQuery(done, PREP, segmentPatch(done, "da-fare")), "", "back to the default «Da rispondere»");
  assert.deepEqual(segmentPatch(parseQuestionFilter({ stato: "chiesta" }, "ls", PREP), "da-verificare"), { vista: "da-verificare" });
});
