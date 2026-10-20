import test from "node:test";
import assert from "node:assert/strict";
import { findForbidden } from "./copy-guard.ts";
import {
  MAP_TONE_COLOR,
  buildMaps,
  catalogItems,
  edgeLabelShown,
  hasAgentProcess,
  mapItemKeys,
  mapItemTitles,
  mapLegend,
  mapPageViews,
  mapTone,
  parseMapRows,
  questionCountText,
  readableFlowData,
  readableOtherData,
  resolveMapPageView,
  stepItemsByStatus,
  stepTechKeys,
  stepTone,
  type MapItemRef,
} from "./map.ts";
import { NODE_HEIGHT, NODE_WIDTH, edgeAnchor, flowOrder, layoutGraph, nodeDepths, wrapLabel } from "./map-layout.ts";
import { CONTACT } from "./view.fixtures.ts";

const mapRows = [
  {
    kind: "soluzione",
    title: "Come funziona",
    version: 1,
    graph: {
      nodes: [
        { id: "n1", label: "Richiesta in arrivo", input: ["Email"], output: ["Scheda"], items: ["ent.richiesta", "richiesta.canale"] },
        { id: "n2", label: "Classificazione", input: [], output: [], items: ["rule.servizio.urgenti", "x.non_esiste"] },
        { id: "n3", label: "Misura", input: [], output: [], items: [] },
      ],
      edges: [
        { from: "n1", to: "n2", label: "priorità" },
        { from: "n2", to: "n3" },
        { from: "n2", to: "zz" },
      ],
    },
  },
  {
    kind: "processo_to_be",
    title: "Processo con l'agente",
    version: 2,
    graph: { nodes: [{ id: "p1", label: "Arriva la richiesta", fase: "Ingresso", chi: "Desk", strumento: "Email", tempo: "5 min", attrito: "Copia a mano", input: ["Email"], output: ["Scheda"], dati: ["richiesta.canale", "dato libero"], items: ["richiesta.canale"], decisione_umana: "Conferma" }] },
  },
  { kind: "boh", graph: {} },
];

const items = new Map([
  ["ent.richiesta", { id: "e1", key: "ent.richiesta", title: "Richiesta", kind: "entita", status: "validata", assignee_contact_id: null, owner_role_key: null }],
  ["richiesta.canale", { id: "f1", key: "richiesta.canale", title: "Canale", kind: "campo", status: "mancante", assignee_contact_id: CONTACT, owner_role_key: "resp_servizio" }],
  ["rule.servizio.urgenti", { id: "r1", key: "rule.servizio.urgenti", title: "Urgenti prima", kind: "regola", status: "in_verifica", assignee_contact_id: null, owner_role_key: "resp_servizio" }],
]);
const contacts = new Map([[CONTACT, { id: CONTACT, name: "Referente servizio", roleLabel: null, templateRoleKey: null, assignable: true }]]);

test("nodes are coloured with their worst item; unlinked nodes have no colour", () => {
  const parsed = parseMapRows(mapRows);
  assert.equal(parsed.length, 2);
  assert.deepEqual(mapItemKeys(parsed).sort(), ["ent.richiesta", "richiesta.canale", "richiesta.canale", "rule.servizio.urgenti", "x.non_esiste"].filter((v, i, a) => a.indexOf(v) === i).sort());
  const maps = buildMaps(parsed, { items, contacts, roleLabels: { resp_servizio: "Servizio" }, roles: ["ls_lead"] });
  const nodes = maps.solution!.nodes;
  assert.equal(nodes[0].worst, "mancante");
  assert.equal(nodes[1].worst, "in_verifica");
  assert.equal(nodes[2].worst, null);
  assert.deepEqual(nodes[1].items.map((i) => [i.key, i.status, i.owner, i.canOpen]), [
    ["rule.servizio.urgenti", "in_verifica", "Servizio", true],
    ["x.non_esiste", null, null, false],
  ]);
  assert.equal(nodes[0].items[1].owner, "Referente servizio");
  assert.deepEqual(maps.solution!.edges, [
    { from: "n1", to: "n2", label: "priorità" },
    { from: "n2", to: "n3", label: null },
  ]);
  const step = maps.toBe!.steps[0];
  assert.equal(step.phase, "Ingresso");
  assert.equal(step.humanDecision, "Conferma");
  assert.deepEqual(step.otherData, ["dato libero"]);
  assert.equal(maps.asIs, null);
  const viewer = buildMaps(parsed, { items, contacts, roleLabels: {}, roles: ["osservatore"] });
  assert.equal(viewer.solution!.nodes[0].items[0].canOpen, false);
});

test("layout: depth from the flow, stable positions, no overlaps", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const edges = [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d" },
    { from: "d", to: "e" },
    { from: "e", to: "b" },
  ];
  const depths = nodeDepths(nodes.map((n) => n.id), edges);
  assert.equal(depths.get("a"), 0);
  assert.equal(depths.get("c"), 1);
  const one = layoutGraph(nodes, edges);
  const two = layoutGraph(nodes, edges);
  assert.deepEqual([...one.positions], [...two.positions]);
  const pos = [...one.positions.values()];
  for (let i = 0; i < pos.length; i++) {
    assert.ok(pos[i].x >= NODE_WIDTH / 2 && pos[i].y >= NODE_HEIGHT / 2 && pos[i].x <= one.width && pos[i].y <= one.height);
    for (let j = i + 1; j < pos.length; j++) {
      const overlap = Math.abs(pos[i].x - pos[j].x) < NODE_WIDTH && Math.abs(pos[i].y - pos[j].y) < NODE_HEIGHT;
      assert.equal(overlap, false, `nodes ${i} and ${j} overlap`);
    }
  }
  assert.ok(one.positions.get("a")!.x < one.positions.get("d")!.x, "flow goes left to right");
  assert.deepEqual(layoutGraph([], []).positions.size, 0);
});

test("edge anchors sit on the node border and labels wrap on two lines", () => {
  const a = edgeAnchor({ x: 100, y: 100 }, { x: 400, y: 100 });
  assert.deepEqual(a, { x: 100 + NODE_WIDTH / 2, y: 100 });
  const b = edgeAnchor({ x: 100, y: 100 }, { x: 100, y: 400 });
  assert.deepEqual(b, { x: 100, y: 100 + NODE_HEIGHT / 2 });
  assert.deepEqual(wrapLabel("Richiesta in arrivo"), ["Richiesta in arrivo"]);
  assert.deepEqual(wrapLabel("Scelta della persona che coordina il servizio clienti", 20), ["Scelta della persona", "che coordina il…"]);
  assert.deepEqual(wrapLabel("Supercalifragilistichespiralidoso", 10), ["Supercali…"]);
});

test("map questions reach the client by title without articles or keys, and with the role that answers", () => {
  // Invented question titles shaped like the seeded ones.
  const clientItems = new Map<string, Record<string, unknown>>([
    ...items,
    ["q.servizio.12", { id: "q12", key: "q.servizio.12", title: "Costi da autorizzare (art. 8.4), vedi rule.servizio.urgenti", kind: "domanda", status: "da_chiedere", assignee_contact_id: CONTACT, owner_role_key: null }],
    ["q.servizio.13", { id: "q13", key: "q.servizio.13", title: "q.servizio.13", kind: "domanda", status: "da_chiedere", assignee_contact_id: null, owner_role_key: null }],
  ]);
  const rows = [{ kind: "soluzione", title: "Mappa", graph: { nodes: [{ id: "n1", label: "Passo", items: ["richiesta.canale", "q.servizio.12", "q.servizio.13"] }], edges: [] } }];
  const ctx = { items: clientItems, roleLabels: { resp_servizio: "Responsabile del servizio" } };
  // The client gets no contacts (loadSolutionMap reads them for Lateral Space only).
  const client = buildMaps(parseMapRows(rows), { ...ctx, contacts: new Map(), roles: ["owner_cliente"] }).solution!.nodes[0].items;
  assert.deepEqual(
    client.map((i) => [i.title, i.owner]),
    [
      ["Canale", "Responsabile del servizio"],
      ["Costi da autorizzare", "Referente"],
      ["Domanda", null],
    ],
  );
  for (const i of client) assert.deepEqual(findForbidden(i.title, "cliente"), [], i.title);
  const ls = buildMaps(parseMapRows(rows), { ...ctx, contacts, roles: ["ls_lead"] }).solution!.nodes[0].items;
  assert.deepEqual(
    ls.map((i) => i.owner),
    ["Referente servizio", "Referente servizio", null],
    "Lateral Space sees the name of the referent",
  );
});

test("step and edge texts are clean for every view: the list and the analysis graph say the same", () => {
  // Invented texts with a fact code, a contract article and a key.
  const rows = [
    {
      kind: "soluzione",
      graph: {
        nodes: [
          { id: "n1", label: "Arriva la richiesta (F014)", description: "Si legge il canale (art. 8.4).", chi: "Servizio", items: [] },
          { id: "n2", label: "Classifica", description: "Segue rule.servizio.urgenti.", items: [] },
        ],
        edges: [{ from: "n1", to: "n2", label: "priorità (F002)" }],
      },
    },
    { kind: "processo_as_is", graph: { nodes: [{ id: "p1", label: "Copia a mano (F010)", attrito: "Errori frequenti (art. 5)", decisione_umana: "Sceglie (F011)", items: [] }] } },
  ];
  const ls = buildMaps(parseMapRows(rows), { items, contacts, roleLabels: {}, roles: ["ls_lead"] });
  assert.deepEqual(
    ls.solution!.nodes.map((n) => [n.label, n.description]),
    [
      ["Arriva la richiesta", "Si legge il canale (art. 8.4)."],
      ["Classifica", "Segue rule.servizio.urgenti."],
    ],
    "no fact codes for anyone; Lateral Space keeps what it wrote",
  );
  assert.equal(ls.solution!.edges[0].label, "priorità");
  assert.deepEqual([ls.asIs!.steps[0].label, ls.asIs!.steps[0].humanDecision], ["Copia a mano", "Sceglie"]);
  const client = buildMaps(parseMapRows(rows), { items, contacts: new Map(), roleLabels: {}, roles: ["owner_cliente"] });
  const texts = [
    ...client.solution!.nodes.flatMap((n) => [n.label, n.description ?? ""]),
    ...client.solution!.edges.map((e) => e.label ?? ""),
    client.asIs!.steps[0].label,
    client.asIs!.steps[0].friction ?? "",
    client.asIs!.steps[0].humanDecision ?? "",
  ];
  for (const t of texts) assert.deepEqual(findForbidden(t, "cliente"), [], t);
  assert.equal(client.asIs!.steps[0].friction, "Errori frequenti");
});

const ref = (key: string, status: MapItemRef["status"], id: string | null = key): MapItemRef => ({ key, id, title: `Titolo ${key}`, kind: status ? "domanda" : null, status, owner: null, canOpen: true });

test("the map opens on «Con l'agente»; views that do not exist do not appear; old links still work", () => {
  const none = { solution: null, toBe: null, asIs: null, example: null };
  const parsed = buildMaps(parseMapRows(mapRows), { items, contacts, roleLabels: {}, roles: ["ls_lead"] });
  assert.deepEqual(mapPageViews(none), []);
  assert.equal(resolveMapPageView("oggi", []), null, "no map at all: the empty state");
  assert.deepEqual(mapPageViews(parsed), ["con-agente"], "the example map has the agent process only");
  assert.deepEqual(mapPageViews({ ...parsed, toBe: null }), ["con-agente"], "the solution map stands in for the agent process");
  const all = mapPageViews({ ...parsed, asIs: parsed.toBe, example: parsed.toBe });
  assert.deepEqual(all, ["con-agente", "oggi", "esempio"]);
  assert.equal(resolveMapPageView(null, all), "con-agente");
  assert.equal(resolveMapPageView("oggi", all), "oggi");
  assert.equal(resolveMapPageView("esempio", all), "esempio");
  assert.equal(resolveMapPageView("as_is", all), "oggi", "?vista=as_is of the old Mappa");
  assert.equal(resolveMapPageView("soluzione", all), "con-agente");
  assert.equal(resolveMapPageView("oggi", ["con-agente"]), "con-agente", "a view the case does not have falls back");
  assert.equal(resolveMapPageView(null, ["oggi", "esempio"]), "oggi");
  assert.equal(resolveMapPageView(null, ["esempio"]), "esempio");
});

test("a map without steps is no map: the page shows its empty state", () => {
  const ctx = { items, contacts, roleLabels: {} };
  // Every case is created with a solution map, even when the template has none: 0 nodes.
  const blank = buildMaps(parseMapRows([{ kind: "soluzione", graph: { nodes: [], edges: [] } }]), { ...ctx, roles: ["ls_lead"] });
  assert.equal(blank.solution?.nodes.length, 0);
  assert.deepEqual(mapPageViews(blank), []);
  assert.equal(resolveMapPageView(null, mapPageViews(blank)), null);
  const emptyProcesses = buildMaps(
    parseMapRows([
      { kind: "soluzione", graph: { nodes: [], edges: [] } },
      { kind: "processo_to_be", graph: { nodes: [] } },
      { kind: "processo_as_is", graph: { nodes: [] } },
      { kind: "esempio", graph: { nodes: [] } },
    ]),
    { ...ctx, roles: ["ls_lead"] },
  );
  assert.deepEqual(mapPageViews(emptyProcesses), []);
  assert.equal(hasAgentProcess(emptyProcesses), false);
  const solutionOnly = buildMaps(parseMapRows([mapRows[0], { kind: "processo_to_be", graph: { nodes: [] } }]), { ...ctx, roles: ["ls_lead"] });
  assert.deepEqual(mapPageViews(solutionOnly), ["con-agente"], "an empty agent process leaves the solution steps");
  assert.equal(hasAgentProcess(solutionOnly), false);
});

test("three tones: done, to verify, to do (blocked included); no catalogue question is dashed", () => {
  assert.equal(mapTone("validata"), "a_posto");
  assert.equal(mapTone("non_applicabile"), "a_posto");
  assert.equal(mapTone("in_verifica"), "da_verificare");
  for (const s of ["da_chiedere", "chiesta", "mancante", "parziale", "bloccata"] as const) assert.equal(mapTone(s), "da_fare", s);
  assert.equal(mapTone(null), null);
  assert.deepEqual(MAP_TONE_COLOR, { a_posto: "verde", da_verificare: "giallo", da_fare: "grigio" });
  assert.equal(stepTone([ref("a", "validata"), ref("b", "in_verifica")]), "da_verificare");
  assert.equal(stepTone([ref("a", "validata"), ref("b", "bloccata"), ref("c", "in_verifica")]), "da_fare", "the worst question wins");
  assert.equal(stepTone([ref("a", "validata")]), "a_posto");
  assert.equal(stepTone([ref("x", null, null)]), null, "only references outside the catalogue: dashed");
  assert.equal(stepTone([]), null);
  assert.deepEqual(
    mapLegend("ls").map((l) => [l.color, l.label]),
    [
      ["verde", "A posto"],
      ["giallo", "Da verificare"],
      ["grigio", "Da fare"],
      [null, "Nessuna domanda collegata"],
    ],
  );
  assert.deepEqual(
    mapLegend("cliente").map((l) => l.label),
    ["A posto", "In verifica", "Da rispondere", "Nessuna domanda collegata"],
  );
});

test("the analysis panel groups a step's questions by status; outside-catalogue references are technical details", () => {
  const list = [ref("a", "validata"), ref("b", "da_chiedere"), ref("c", "bloccata"), ref("d", "in_verifica"), ref("x.fuori", null, null)];
  assert.deepEqual(catalogItems(list).map((i) => i.key), ["a", "b", "c", "d"]);
  assert.deepEqual(
    stepItemsByStatus(list, "ls").map((g) => [g.label, g.items.map((i) => i.key)]),
    [
      ["Da fare", ["b"]],
      ["Da verificare", ["d"]],
      ["Bloccate", ["c"]],
      ["A posto", ["a"]],
    ],
  );
  assert.deepEqual(stepTechKeys(list, [], new Map()), ["x.fuori"], "the key goes to «Dettagli tecnici», never in a row");
  assert.deepEqual(
    stepItemsByStatus(list, "cliente").map((g) => g.label),
    ["Da rispondere", "In verifica", "In attesa", "A posto"],
  );
  assert.equal(questionCountText(54), "54 domande");
  assert.equal(questionCountText(1), "1 domanda");
  assert.equal(questionCountText(1200), "1.200 domande");
});

test("edge labels show only on hover or focus of one of their steps, never for the selection alone", () => {
  const edge = { from: "n1", to: "n2", label: "priorità" };
  const at = (hover: string | null, focus: string | null) => ({ hover, focus });
  assert.equal(edgeLabelShown(edge, at(null, null)), false, "never at rest, nor once a step is only selected");
  assert.equal(edgeLabelShown(edge, at("n1", null)), true);
  assert.equal(edgeLabelShown(edge, at(null, "n2")), true);
  assert.equal(edgeLabelShown(edge, at("n3", "n3")), false);
  assert.equal(edgeLabelShown({ from: "n1", to: "n2", label: null }, at("n1", "n1")), false, "no label, nothing to show");
});

test("data cited by a step reach every row in words, never as keys; the keys are technical details", () => {
  const data = ["richiesta.canale", "Elenco dei turni", "dato libero (art. 5)"];
  assert.deepEqual(readableOtherData(data, "ls"), ["Elenco dei turni", "dato libero (art. 5)"], "no keys in a row, not even for Lateral Space");
  assert.deepEqual(readableOtherData(data, "cliente"), ["Elenco dei turni", "dato libero"]);
  for (const d of readableOtherData(data, "cliente")) assert.deepEqual(findForbidden(d, "cliente"), []);
  assert.deepEqual(stepTechKeys([], data, new Map()), ["richiesta.canale"]);
  assert.deepEqual(stepTechKeys([], data, new Map([["richiesta.canale", "Canale"]])), [], "a key with a title is read as the title");
});

test("what enters and leaves a step shows titles, and the client never sees a key", () => {
  const maps = buildMaps(parseMapRows(mapRows), { items, contacts, roleLabels: {}, roles: ["ls_lead"] });
  const titles = mapItemTitles(maps);
  assert.equal(titles.get("richiesta.canale"), "Canale");
  assert.equal(titles.has("x.non_esiste"), false, "a reference outside the catalogue has no title");
  const data = ["richiesta.canale", "kpi.servizio.tempo", "Email", "richiesta.canale"];
  assert.deepEqual(readableFlowData(data, titles, "ls"), ["Canale", "Email"]);
  assert.deepEqual(readableFlowData(data, titles, "cliente"), ["Canale", "Email"]);
  assert.deepEqual(stepTechKeys([], data, titles), ["kpi.servizio.tempo"], "Lateral Space finds the key among the technical details");
});

test("the step list follows the flow, then the order of the map", () => {
  const nodes = ["c", "a", "b", "d"].map((id) => ({ id }));
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ];
  assert.deepEqual(flowOrder(nodes, edges).map((n) => n.id), ["a", "d", "b", "c"], "inputs first (a and d), in map order");
  assert.deepEqual(flowOrder(nodes, []).map((n) => n.id), ["c", "a", "b", "d"], "without edges, the map order");
  assert.deepEqual(flowOrder([], edges), []);
});
