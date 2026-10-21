import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_ORIGIN_SQL,
  CONFIRM_ORIGIN_SQL,
  HUB_ONLY_SOURCES,
  ORIGIN_UNDECIDED_SQL,
  channelOfSource,
  describeOriginItems,
  parseOriginDecisions,
  pendingOriginCount,
  planOrigin,
  proposeOrigin,
  type OriginRow,
} from "./origin.ts";

// use-case-admin origin (docs/use-case/DESIGN.md §10.7). Titoli e id inventati.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WS = id(900);

function row(n: number, source: string | null, author: OriginRow["author"] = "no", hidden = false): OriginRow {
  return { id: id(n), workspaceId: WS, code: `XX-000${n}`, title: `Scheda di prova ${n}`, source, hidden, author };
}

test("le quattro righe della tabella di §10.7", () => {
  assert.deepEqual(proposeOrigin({ source: null, author: "non_risolto" }), { origin: "transformation", needsConfirmation: false, rule: "activity_mapping" });
  assert.deepEqual(proposeOrigin({ source: "web_proposed", author: "si" }), { origin: "transformation", needsConfirmation: true, rule: "web_lateral_space" });
  assert.deepEqual(proposeOrigin({ source: "web_proposed", author: "non_risolto" }), { origin: "adoption", needsConfirmation: true, rule: "web_non_risolto" });
  assert.deepEqual(proposeOrigin({ source: "web_proposed", author: "no" }), { origin: "adoption", needsConfirmation: false, rule: "altro" });
  for (const source of ["slack_proposed", "claude_mcp", "claude_connector", "learning", "ai_readiness_assessment", "manual", "team_mcp", "activity_mapping"]) {
    for (const author of ["si", "no", "non_risolto"] as const) {
      assert.deepEqual(proposeOrigin({ source, author }), { origin: "adoption", needsConfirmation: false, rule: "altro" }, `${source} ${author}`);
    }
  }
});

test("activity_mapping la scrive il servizio dell'hub con l'origine scelta: resta invariata", () => {
  const planned = planOrigin([row(1, "activity_mapping", "non_risolto"), row(2, null, "non_risolto")]);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(
    planned.plan.items.map((item) => [item.source, item.action, item.write]),
    [
      ["activity_mapping", "invariata", null],
      [null, "cambia", { origin: "transformation", hide: true, fields: ["origine", "visibilita"] }],
    ],
  );
  assert.equal(pendingOriginCount([row(1, "activity_mapping")]), 0);
  assert.deepEqual([...HUB_ONLY_SOURCES], ["manual", "team_mcp", "activity_mapping"]);
});

test("canale come la riga «creato» della Storia", () => {
  assert.equal(channelOfSource(null), "activity_mapping");
  assert.equal(channelOfSource("web_proposed"), "web");
  assert.equal(channelOfSource("slack_proposed"), "slack");
  assert.equal(channelOfSource("claude_mcp"), "rest");
  assert.equal(channelOfSource("sconosciuta"), "altro");
});

test("--decisions: oggetto con id e «adoption» o «transformation»", () => {
  const ok = parseOriginDecisions({ [id(1).toUpperCase()]: "transformation", [id(2)]: "adoption" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual([...ok.decisions], [[id(1), "transformation"], [id(2), "adoption"]]);
  for (const value of [null, [], { "uc-1": "adoption" }, { [id(1)]: "Adoption" }, { [id(1)]: "dall'alto" }, { [id(1)]: true }]) {
    assert.equal(parseOriginDecisions(value).ok, false, JSON.stringify(value));
  }
});

test("senza decisioni: Activity mapping cambia da sola, le incerte aspettano, le altre restano", () => {
  const rows = [row(1, null), row(2, "web_proposed", "si"), row(3, "web_proposed", "non_risolto"), row(4, "web_proposed", "no"), row(5, "slack_proposed"), row(6, null, "no", true)];
  const planned = planOrigin(rows);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const { items, counts } = planned.plan;
  assert.deepEqual(counts, { cambia: 2, registra: 0, attende_conferma: 2, invariata: 2 });
  assert.deepEqual(items[0].write, { origin: "transformation", hide: true, fields: ["origine", "visibilita"] });
  assert.deepEqual(items[5].write, { origin: "transformation", hide: false, fields: ["origine"] }, "già nascosta: cambia solo l'origine");
  assert.equal(items[1].write, null);
  assert.equal(items[2].write, null);
  assert.equal(pendingOriginCount(rows), 4);
});

test("con le decisioni: transformation nasconde, adoption registra la conferma", () => {
  const rows = [row(1, null), row(2, "web_proposed", "si"), row(3, "web_proposed", "non_risolto"), row(4, "slack_proposed")];
  const decisions = new Map([
    [id(2), "transformation" as const],
    [id(3), "adoption" as const],
    [id(1), "adoption" as const],
    [id(4), "transformation" as const],
  ]);
  const planned = planOrigin(rows, decisions);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const byId = new Map(planned.plan.items.map((item) => [item.id, item]));
  assert.deepEqual(byId.get(id(2))?.write, { origin: "transformation", hide: true, fields: ["origine", "visibilita"] });
  assert.equal(byId.get(id(2))?.action, "cambia");
  assert.deepEqual(byId.get(id(3))?.write, { origin: "adoption", hide: false, fields: ["origine"] });
  assert.equal(byId.get(id(3))?.action, "registra");
  assert.equal(byId.get(id(1))?.action, "registra", "una decisione corregge anche la proposta automatica");
  assert.equal(byId.get(id(4))?.action, "cambia");
  assert.deepEqual(planned.plan.counts, { cambia: 2, registra: 2, attende_conferma: 0, invariata: 0 });
});

test("un id del file fuori dalla lista ferma il comando", () => {
  const planned = planOrigin([row(1, null)], new Map([[id(9), "adoption" as const]]));
  assert.equal(planned.ok, false);
  if (!planned.ok) assert.match(planned.message, new RegExp(id(9)));
});

test("l'uscita: codice, titolo, canale, autore di Lateral Space e proposta; le invariate si contano soltanto", () => {
  const planned = planOrigin([row(1, null), row(2, "web_proposed", "si"), row(3, "web_proposed", "non_risolto"), row(4, "slack_proposed")]);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const out = describeOriginItems(planned.plan);
  assert.deepEqual(
    out.map((o) => [o.codice, o.canale, o.autoreLateralSpace, o.proposta, o.conferma, o.azione]),
    [
      ["XX-0001", "activity_mapping", "no", "transformation", "no", "cambia"],
      ["XX-0002", "web", "sì", "transformation", "serve", "attende_conferma"],
      ["XX-0003", "web", "non risolto", "adoption", "serve", "attende_conferma"],
    ],
  );
  for (const item of out) {
    assert.deepEqual(Object.keys(item).sort(), ["autoreLateralSpace", "azione", "canale", "codice", "conferma", "decisione", "id", "nascondi", "proposta", "titolo", "workspace"]);
  }
});

test("SQL: decisa con una riga di Storia «origine» o con la conferma in intake", () => {
  assert.match(ORIGIN_UNDECIDED_SQL, /NOT EXISTS \(SELECT 1 FROM use_case_events e WHERE e\.use_case_id = u\.id AND 'origine' = ANY\(e\.fields\)\)/);
  assert.match(ORIGIN_UNDECIDED_SQL, /AND NOT coalesce\(u\.intake -> 'originConfirmed' = 'true'::jsonb, false\)/);
  for (const sql of [APPLY_ORIGIN_SQL, CONFIRM_ORIGIN_SQL]) {
    assert.match(sql, /origin = 'adoption'/);
    assert.ok(sql.includes(ORIGIN_UNDECIDED_SQL), "solo se ancora da decidere");
  }
});

test("SQL: un cambio ha la sua riga di Storia nello stesso statement; una conferma no", () => {
  assert.match(APPLY_ORIGIN_SQL, /^WITH upd AS \(\s+UPDATE use_cases u/);
  assert.match(APPLY_ORIGIN_SQL, /INSERT INTO use_case_events/);
  assert.match(APPLY_ORIGIN_SQL, /NULL, 'sistema', 'script', 'modificato'/, "nessuna persona nella Storia");
  assert.match(APPLY_ORIGIN_SQL, /jsonb_build_object\('hiddenFromSearch', true\)/);
  assert.doesNotMatch(CONFIRM_ORIGIN_SQL, /use_case_events\s*\(|INSERT/, "niente Storia per una modifica che non c'è");
  assert.doesNotMatch(CONFIRM_ORIGIN_SQL, /updated_at|SET origin/);
  assert.match(CONFIRM_ORIGIN_SQL, /SET intake = coalesce\(u\.intake, '\{\}'::jsonb\) \|\| jsonb_build_object\('originConfirmed', true\)/);
});
