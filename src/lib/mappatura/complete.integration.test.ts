import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fakeAppClaude, installAppModules, message, recordLogs, refusal, THINKING, type Reply } from "../ai/claude-test-kit.ts";
import { connect, enabled, insertActivity, newFixture, opts, seed, unseed, type Connection, type Row } from "./integration-kit.ts";
import type { BoardStep, MappingBoard } from "./board-model.ts";
import type { BoardOp } from "./board-ops.ts";

// «Completa la mappatura» sul database del pacchetto (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.5, §8.2), con il
// classificatore e il match O*NET veri e il Claude finto:
// - lo stream e la confidenza nelle colonne di sempre; la proposta, il motivo e il potenziale sulla riga del passo;
// - una riga in `weekly_signals` alla prima chiusura, e solo allora (anche con due chiusure insieme);
// - il match O*NET solo sui passi dell'unità: un id di un'altra unità o di un altro workspace non si tocca;
// - la sintesi dell'assistente: la frase solo se manca, i punti al posto di quelli della chat non validati;
// - `recordClassifications` non scrive mai fuori dal suo workspace.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const f = newFixture();
let db: Connection;
let q: Connection["q"];
let store: typeof import("./board-store.ts");
let complete: typeof import("./complete.ts");

const scope = () => ({ workspaceId: f.ws, departmentId: f.unit });
const lead = () => ({ kind: "persona" as const, userId: f.lead, role: "transformation_lead" });
const FAR = () => Date.now() + 10 * 60_000;
const ids: Record<string, string> = {};
const op = <T extends Omit<BoardOp, "id">>(body: T) => ({ id: randomUUID(), ...body }) as BoardOp;

const answer = (classification: string, confidenceScore = 0.8) => ({ classification, confidenceScore, motivazione: `Motivo di prova: ${classification}.`, aiPotential: `Potenziale di prova: ${classification}.` });
const match = (activityId: string, exposure: number) => ({ activityId, suggestedOnetCode: "13-1023.00", occupationTitle: "Addetti agli acquisti", relevantTasks: [], aiExposureEstimate: exposure, augmentationVsAutomation: "mixed", motivazione: "Una motivazione." });
const json = (value: unknown) => message([THINKING, { type: "text", text: JSON.stringify(value) }])();
/** Risponde secondo quello che c'è nel prompt: così l'ordine delle chiamate in parallelo non conta. */
function replies(onet: unknown[], refuse?: string): Reply {
  return (init) => {
    const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
    if (prompt.includes("O*NET SOC")) return json({ matches: onet });
    if (refuse && prompt.includes(refuse)) return refusal([], "general_harms")();
    if (prompt.includes("Confronto delle offerte")) return json(answer("differentiate", 0.6));
    if (prompt.includes("Scelta del fornitore")) return json(answer("innovate", 0.9));
    return json(answer("automate"));
  };
}

const read = async (): Promise<MappingBoard> => {
  const board = await store.readBoard(db.exec, scope(), lead());
  assert.ok(board);
  return board;
};
const step = (board: MappingBoard, id: string): BoardStep => {
  const found = board.processes.flatMap((process) => process.steps).find((item) => item.id === id);
  assert.ok(found, `manca il passo ${id}`);
  return found;
};
const signals = async (workspaceId = f.ws) => q(`SELECT signal_type, title, description, related_entity_type, related_entity_id, is_read FROM weekly_signals WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId]);
const activityRow = async (id: string): Promise<Row> => (await q(`SELECT classification::text AS classification, confidence_score, onet_task_id, ai_exposure_score FROM activities WHERE id = $1`, [id]))[0];

before(async () => {
  if (!enabled) return;
  await installAppModules({});
  db = await connect();
  q = db.q;
  store = await import("./board-store.ts");
  complete = await import("./complete.ts");
  await seed(q, f, "completa");
  // «Ufficio acquisti»: tre passi scritti sulla board, uno scritto dal codice di prima (entra con l'adozione).
  const process = randomUUID();
  Object.assign(ids, { process, richieste: randomUUID(), confronto: randomUUID(), scelta: randomUUID() });
  const saved = await store.saveBoardOps(db.exec, scope(), lead(), {
    baseRevision: 0,
    ops: [
      op({ t: "process.add", processId: process, name: "Dalla richiesta all'ordine" }),
      op({ t: "step.add", stepId: ids.richieste, processId: process, title: "Raccolta delle richieste" }),
      op({ t: "step.add", stepId: ids.confronto, processId: process, title: "Confronto delle offerte" }),
      op({ t: "step.add", stepId: ids.scelta, processId: process, title: "Scelta del fornitore" }),
      op({ t: "step.set", stepId: ids.richieste, field: "hoursWeek", prev: null, next: 6.5 }),
      op({ t: "step.set", stepId: ids.confronto, field: "hoursWeek", prev: null, next: 2 }),
    ],
  });
  assert.ok(saved.ok && saved.rejected.length === 0);
  ids.ordine = await insertActivity(q, f, { title: "Invio dell'ordine" });
  // Un'altra unità e un altro workspace, con un'attività ciascuno: il completamento non li tocca.
  ids.altrove = await insertActivity(q, { ws: f.ws, unit: f.otherUnit }, { title: "Controllo dei colli" });
  ids.fuori = await insertActivity(q, { ws: f.otherWs, unit: f.foreignUnit }, { title: "Attività di un altro workspace" });
});

after(async () => {
  if (!enabled) return;
  await unseed(q, f);
});

test("la prima chiusura: unità completa, una riga in campanella, stream e proposta scritti, O*NET solo sui passi dell'unità", opts, async (t) => {
  recordLogs(t);
  const before = await read();
  assert.deepEqual([before.unit.status, (await signals()).length], ["in_progress", 0]);
  // Il match O*NET restituisce anche un id di un'altra unità, uno di un altro workspace e uno inventato.
  const onet = [match(ids.richieste, 0.2), match(ids.confronto, 0.4), match(ids.altrove, 0.9), match(ids.fuori, 0.9), match(randomUUID(), 0.9), match(ids.scelta, 0.3), match(ids.ordine, 0.1)];
  const requests = fakeAppClaude(Array.from({ length: 5 }, () => replies(onet)));
  const outcome = await complete.completeUnitMapping(complete.appCompleteDeps(db.exec), {
    scope: scope(),
    deadline: FAR(),
    headline: "  Un terzo del tempo va a rincorrere richieste incomplete.  ",
    analysis: [
      { title: "Dove va il tempo", text: "Nei solleciti. Ogni ordine ne chiede tre." },
      { title: "", text: "Le richieste arrivano senza centro di costo." },
    ],
  });
  assert.deepEqual(outcome, { firstCompletion: true, total: 4, classified: 4, remaining: 0, counts: { automate: 2, differentiate: 1, innovate: 1 }, classification: "fatta", matched: 4, avgExposurePct: 25, onet: "fatto" });
  assert.equal(requests.length, 5);

  // L'unità: completa, con l'ora; la campanella: una riga per tutto il workspace, legata all'unità.
  const [unit] = await q(`SELECT d.mapping_status::text AS status, b.completed_at FROM departments d JOIN mapping_boards b ON b.department_id = d.id WHERE d.id = $1`, [f.unit]);
  assert.equal(unit.status, "mapped");
  assert.ok(unit.completed_at);
  assert.deepEqual(await signals(), [{ signal_type: "mapping_completed", title: "Mappatura completata: Ufficio acquisti", description: "4 passi, 8,5 ore a settimana.", related_entity_type: "department", related_entity_id: f.unit, is_read: false }]);

  // La board: lo stream, la proposta, la confidenza, il motivo, il potenziale, il codice, il titolo, l'esposizione.
  const board = await read();
  assert.equal(board.unit.status, "mapped");
  assert.ok(board.revision > before.revision, "chi ha la board aperta la rilegge");
  const c = step(board, ids.confronto);
  assert.deepEqual([c.stream, c.proposedStream, c.confidence, c.reason, c.aiPotential, c.onetCode, c.onetTitle, c.aiExposure], ["differentiate", "differentiate", 0.6, "Motivo di prova: differentiate.", "Potenziale di prova: differentiate.", "13-1023.00", "Addetti agli acquisti", 0.4]);
  assert.deepEqual(board.processes[0].steps.map((item) => [item.title, item.stream, item.aiExposure]), [["Raccolta delle richieste", "automate", 0.2], ["Confronto delle offerte", "differentiate", 0.4], ["Scelta del fornitore", "innovate", 0.3], ["Invio dell'ordine", "automate", 0.1]]);
  // Il passo scritto dal codice di prima è entrato nella board ed è stato classificato come gli altri.
  assert.deepEqual([step(board, ids.ordine).origin, step(board, ids.ordine).status, step(board, ids.ordine).proposedStream], ["prima", "da_validare", "automate"]);
  // Le colonne di sempre, dove le leggono gli altri: stream, confidenza, codice, esposizione.
  const row = await activityRow(ids.scelta);
  assert.deepEqual([row.classification, Number(row.confidence_score).toFixed(1), row.onet_task_id, Number(row.ai_exposure_score).toFixed(1)], ["innovate", "0.9", "13-1023.00", "0.3"]);
  // L'altra unità e l'altro workspace: niente codice, niente stream, nessuna riga in campanella.
  for (const id of [ids.altrove, ids.fuori]) assert.deepEqual(await activityRow(id), { classification: null, confidence_score: null, onet_task_id: null, ai_exposure_score: null });
  assert.equal((await signals(f.otherWs)).length, 0);
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM mapping_steps WHERE activity_id = ANY($1::uuid[])`, [[ids.altrove, ids.fuori]]))[0].n), 0);

  // La sintesi: la frase (la board non ne aveva una) e due punti, «da fonti · chat»; il titolo vuoto resta senza titolo.
  assert.equal(board.headline, "Un terzo del tempo va a rincorrere richieste incomplete.");
  assert.deepEqual(board.analysis.map((note) => [note.title, note.text, note.status, note.origin]), [
    ["Dove va il tempo", "Nei solleciti. Ogni ordine ne chiede tre.", "fonte", "chat"],
    [null, "Le richieste arrivano senza centro di costo.", "fonte", "chat"],
  ]);
});

test("la seconda chiusura non avvisa di nuovo e non ha niente da fare; un passo aggiunto dopo si classifica da solo", opts, async (t) => {
  recordLogs(t);
  const none = fakeAppClaude([]);
  const again = await complete.completeUnitMapping(complete.appCompleteDeps(db.exec), { scope: scope(), deadline: FAR() });
  assert.deepEqual(again, { firstCompletion: false, total: 4, classified: 0, remaining: 0, counts: { automate: 0, differentiate: 0, innovate: 0 }, classification: "niente_da_fare", matched: 0, avgExposurePct: null, onet: "niente_da_fare" });
  assert.equal(none.length, 0);
  assert.equal((await signals()).length, 1);

  // Un passo aggiunto sulla board dopo la chiusura: l'unità resta completa, il passo è «da classificare».
  ids.archivio = randomUUID();
  const added = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: 0, ops: [op({ t: "step.add", stepId: ids.archivio, processId: ids.process, title: "Archivio dell'ordine" })] });
  assert.ok(added.ok);
  assert.deepEqual([added.board.unit.status, step(added.board, ids.archivio).stream], ["mapped", null]);
  // «Classifica 1 passo»: una chiamata per quel passo, una per il suo codice. Nessuna riga nuova in campanella.
  const requests = fakeAppClaude([replies([match(ids.archivio, 0.5)]), replies([match(ids.archivio, 0.5)])]);
  const outcome = await complete.completeUnitMapping(complete.appCompleteDeps(db.exec), { scope: scope(), deadline: FAR() });
  assert.deepEqual([outcome?.firstCompletion, outcome?.total, outcome?.classified, outcome?.remaining, outcome?.classification, outcome?.matched, outcome?.avgExposurePct], [false, 5, 1, 0, "fatta", 1, 50]);
  assert.equal(requests.length, 2);
  assert.ok(JSON.stringify(requests[0].body.messages).includes("Archivio dell'ordine") && !JSON.stringify(requests[0].body.messages).includes("Raccolta delle richieste"));
  assert.equal((await signals()).length, 1);
  assert.deepEqual([step(await read(), ids.archivio).stream, step(await read(), ids.archivio).proposedStream], ["automate", "automate"]);
});

test("uno stream scelto da una persona mentre il classificatore lavora resta: la proposta si registra, la colonna no", opts, async () => {
  const deps = complete.appCompleteDeps(db.exec);
  await q(`UPDATE activities SET classification = 'innovate' WHERE id = $1`, [ids.richieste]);
  const revision = (await read()).revision;
  await deps.saveClassifications(scope(), new Map([[ids.richieste, { classification: "differentiate", confidenceScore: 0.4, reasoning: "Un altro motivo.", aiPotential: "Un altro potenziale." }]]));
  const board = await read();
  const s = step(board, ids.richieste);
  assert.deepEqual([s.stream, s.proposedStream, s.reason, s.confidence], ["innovate", "differentiate", "Un altro motivo.", 0.8], "lo stream e la confidenza di prima restano");
  assert.equal(board.revision, revision + 1);
  // Un id di un'altra unità o di un altro workspace: niente, neanche la proposta.
  await deps.saveClassifications(scope(), new Map([[ids.altrove, { classification: "automate", confidenceScore: 1, reasoning: "x", aiPotential: "x" }], [ids.fuori, { classification: "automate", confidenceScore: 1, reasoning: "x", aiPotential: "x" }]]));
  for (const id of [ids.altrove, ids.fuori]) assert.equal((await activityRow(id)).classification, null);
  // Il codice O*NET non copre quello che c'è già, e non esce dall'unità.
  assert.equal(await deps.saveOnetMatches(scope(), [{ activityId: ids.richieste, suggestedOnetCode: "99-9999.99", occupationTitle: "Altro", aiExposureEstimate: 1 }, { activityId: ids.altrove, suggestedOnetCode: "99-9999.99", occupationTitle: "Altro", aiExposureEstimate: 1 }]), 0);
  assert.deepEqual([(await activityRow(ids.richieste)).onet_task_id, (await activityRow(ids.altrove)).onet_task_id], ["13-1023.00", null]);
});

test("la sintesi dell'assistente: la frase solo se manca; i punti al posto di quelli della chat non validati, mai oltre sei", opts, async () => {
  const deps = complete.appCompleteDeps(db.exec);
  const before = await read();
  // Una persona valida il primo punto e ne scrive uno suo.
  const mine = randomUUID();
  const saved = await store.saveBoardOps(db.exec, scope(), lead(), {
    baseRevision: before.revision,
    ops: [op({ t: "note.set", noteId: before.analysis[0].id, field: "status", prev: "fonte", next: "validato" }), op({ t: "note.add", noteId: mine, stepId: null, lane: "analisi", title: "Un punto di una persona", text: "Scritto sulla board." })],
  });
  assert.ok(saved.ok && saved.rejected.length === 0);
  await deps.saveSummary(scope(), {
    headline: "Una frase nuova dell'assistente.",
    analysis: Array.from({ length: 8 }, (_, index) => ({ title: `Punto ${index + 1} ${"x".repeat(200)}`, text: index === 1 ? "   " : `Testo del punto ${index + 1}.` })),
  });
  const board = await read();
  assert.equal(board.headline, before.headline, "la frase c'era già: resta");
  // Restano il punto validato e quello della persona; il punto della chat non validato è sostituito; in tutto sei.
  assert.equal(board.analysis.length, 6);
  assert.deepEqual(board.analysis.slice(0, 2).map((note) => [note.title, note.status, note.origin]), [["Dove va il tempo", "validato", "chat"], ["Un punto di una persona", "validato", "board"]]);
  assert.deepEqual(board.analysis.slice(2).map((note) => [note.text, note.status, note.origin, note.title?.length]), [
    ["Testo del punto 1.", "fonte", "chat", 120],
    ["Testo del punto 3.", "fonte", "chat", 120],
    ["Testo del punto 4.", "fonte", "chat", 120],
    ["Testo del punto 5.", "fonte", "chat", 120],
  ]);
  assert.ok(!board.analysis.some((note) => note.text === "Le richieste arrivano senza centro di costo."));
  assert.ok(board.revision > saved.revision);
  // Una board senza frase la prende; solo i punti, o solo la frase: si tocca quello che c'è.
  await q(`UPDATE mapping_boards SET headline = NULL WHERE department_id = $1`, [f.unit]);
  await deps.saveSummary(scope(), { headline: "Una frase nuova dell'assistente." });
  const after = await read();
  assert.equal(after.headline, "Una frase nuova dell'assistente.");
  assert.equal(after.analysis.length, 6, "senza punti dati, quelli che ci sono restano");
});

test("due chiusure insieme: una sola riga in campanella", opts, async (t) => {
  recordLogs(t);
  const g = newFixture();
  await seed(q, g, "insieme");
  try {
    const where = { workspaceId: g.ws, departmentId: g.unit };
    await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Raccolta delle richieste", classification: "automate", onet_task_id: "13-1023.00" });
    fakeAppClaude([]);
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => complete.completeUnitMapping(complete.appCompleteDeps(db.exec), { scope: where, deadline: FAR() })));
    assert.equal(outcomes.filter((outcome) => outcome?.firstCompletion).length, 1);
    assert.equal((await signals(g.ws)).length, 1);
    // Un'unità di un altro workspace, o senza la 0039: null, niente segnato.
    assert.equal(await complete.completeUnitMapping(complete.appCompleteDeps(db.exec), { scope: { workspaceId: g.otherWs, departmentId: g.unit }, deadline: FAR() }), null);
    assert.equal(await complete.completeUnitMapping(complete.appCompleteDeps(db.exec), { scope: { workspaceId: g.ws, departmentId: g.foreignUnit }, deadline: FAR() }), null);
    assert.equal((await q(`SELECT mapping_status::text AS s FROM departments WHERE id = $1`, [g.foreignUnit]))[0].s, "not_started");
  } finally {
    await unseed(q, g);
  }
});

test("un rifiuto su un passo: gli altri si scrivono, quello resta da classificare", opts, async (t) => {
  recordLogs(t);
  const g = newFixture();
  await seed(q, g, "rifiuto");
  try {
    const where = { workspaceId: g.ws, departmentId: g.unit };
    const kept = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Raccolta delle richieste", minutesAgo: 2 });
    const refused = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Confronto delle offerte", minutesAgo: 1 });
    fakeAppClaude(Array.from({ length: 3 }, () => replies([match(kept, 0.3)], "Confronto delle offerte")));
    const outcome = await complete.completeUnitMapping(complete.appCompleteDeps(db.exec), { scope: where, deadline: FAR() });
    assert.deepEqual([outcome?.classification, outcome?.classified, outcome?.remaining, outcome?.matched], ["parziale", 1, 1, 1]);
    assert.deepEqual([(await activityRow(kept)).classification, (await activityRow(refused)).classification], ["automate", null]);
    const board = await store.readBoard(db.exec, where, { userId: g.lead, role: "analyst" });
    assert.deepEqual(board?.processes[0].steps.map((item) => [item.stream, item.proposedStream]), [["automate", "automate"], [null, null]]);
  } finally {
    await unseed(q, g);
  }
});

test("recordClassifications («Classifica attività» del workspace): solo attività di quel workspace, con la proposta sulla board", opts, async () => {
  const g = newFixture();
  await seed(q, g, "workspace");
  try {
    const a = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Raccolta delle richieste" });
    const b = await insertActivity(q, { ws: g.ws, unit: g.otherUnit }, { title: "Controllo dei colli" });
    const done = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Già classificata", classification: "innovate", confidence_score: 0.5 });
    const elsewhere = await insertActivity(q, { ws: g.otherWs, unit: g.foreignUnit }, { title: "Attività di un altro workspace" });
    const result = (classification: "automate" | "differentiate" | "innovate") => ({ classification, confidenceScore: 0.7, reasoning: `Motivo ${classification}.`, aiPotential: `Potenziale ${classification}.` });
    const written = await complete.recordClassifications(db.exec, g.ws, new Map([[a, result("automate")], [b, result("differentiate")], [done, result("automate")], [elsewhere, result("innovate")], ["non-un-id", result("automate")]]));
    assert.equal(written, 2, "le due attività senza stream di questo workspace");
    assert.deepEqual([(await activityRow(a)).classification, (await activityRow(b)).classification, (await activityRow(done)).classification, (await activityRow(elsewhere)).classification], ["automate", "differentiate", "innovate", null]);
    // Le attività non erano ancora sulla board: ci entrano, e la proposta ha dove stare. Anche per quella già classificata.
    const proposals = await q(`SELECT s.activity_id, s.proposed_stream, s.classification_reason, s.ai_potential, s.department_id FROM mapping_steps s WHERE s.workspace_id = $1 ORDER BY s.proposed_stream`, [g.ws]);
    assert.deepEqual(proposals.map((r: Row) => [r.activity_id, r.proposed_stream, r.classification_reason, r.department_id]).sort(), [[a, "automate", "Motivo automate.", g.unit], [b, "differentiate", "Motivo differentiate.", g.otherUnit], [done, "automate", "Motivo automate.", g.unit]].sort());
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM mapping_steps WHERE workspace_id = $1`, [g.otherWs]))[0].n), 0);
    const board = await store.readBoard(db.exec, { workspaceId: g.ws, departmentId: g.unit }, { userId: g.lead, role: "analyst" });
    assert.deepEqual(board?.processes[0].steps.map((item) => [item.title, item.stream, item.proposedStream, item.confidence]), [["Raccolta delle richieste", "automate", "automate", 0.7], ["Già classificata", "innovate", "automate", 0.5]]);
    assert.ok((board?.revision ?? 0) > 0, "chi ha la board aperta la rilegge");
    // Niente da scrivere: zero, senza toccare il database. Un workspace che non è un id: zero.
    assert.equal(await complete.recordClassifications(db.exec, g.ws, new Map()), 0);
    assert.equal(await complete.recordClassifications(db.exec, "non-un-id", new Map([[a, result("innovate")]])), 0);
    // Senza la 0039 scrive le sole colonne di sempre.
    const late = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Arrivata senza la 0039" });
    await q(`DROP INDEX mapping_votes_user_idx`);
    try {
      assert.equal(await complete.recordClassifications(db.exec, g.ws, new Map([[late, result("innovate")]])), 1);
    } finally {
      await db.ensure.runMappingBoardDdl();
    }
    assert.equal((await activityRow(late)).classification, "innovate");
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM mapping_steps WHERE activity_id = $1`, [late]))[0].n), 0);
  } finally {
    await unseed(q, g);
  }
});
