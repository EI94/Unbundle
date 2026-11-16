import test from "node:test";
import assert from "node:assert/strict";
import { toStatement, type UcStatement } from "../uc/sql/statement.ts";
import type { BoardOp, StepField } from "./board-ops.ts";
import {
  STEP_FIELDS,
  activitiesOnlyReads,
  adoptionReads,
  adoptionWrites,
  boardReads,
  bumpRevision,
  completionReads,
  ensureBoardRow,
  forgetOldOps,
  linkDependencyStatement,
  markMapped,
  noteLanes,
  opStatement,
  preflight,
  processNames,
  projectLane,
  renumberNotes,
  renumberProcesses,
  renumberSteps,
  revisionRead,
  saveBatch,
  saveClassifications,
  saveOnetMatches,
  saveSummary,
  startUnit,
  storeProbe,
  streamFold,
  unitBoards,
  unitDocuments,
  unitsToAdopt,
  type BoardActor,
  type BoardScope,
} from "./board-sql.ts";
import { STREAM_OF_CLASSIFICATION } from "./streams.ts";
import { MAPPING_LIMITS, OP_MEMORY, OP_OUTCOMES } from "./vocab.ts";

// Le istruzioni SQL della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.3, §6): le regole che si leggono dal testo,
// senza database. Quelle che servono un database stanno in board-store.integration.test.ts.
// - R1: ogni istruzione nomina `workspace_id` e `department_id`, e li lega ai valori dello scope;
// - R2: nessun `INSERT … VALUES`: ogni inserimento legge da un genitore; niente solleva errori;
// - R3: ogni modifica di un campo ha il confronto «com'era, o com'è già»;
// - R4: un'operazione già applicata non scrive di nuovo: risponde con l'esito di allora;
// - R5: la coda viene dopo tutte le operazioni, la revisione per ultima.

const WS = "11111111-aaaa-4aaa-8aaa-111111111111";
const UNIT = "22222222-bbbb-4bbb-8bbb-222222222222";
const USER = "33333333-cccc-4ccc-8ccc-333333333333";
const scope: BoardScope = { workspaceId: WS, departmentId: UNIT };
const actor: BoardActor = { kind: "persona", userId: USER, role: "analyst" };
let seq = 0;
const id = () => `44444444-dddd-4ddd-8ddd-${String(++seq).padStart(12, "0")}`;
/** Un testo che, incollato in un'istruzione, la romperebbe: deve restare un parametro. */
const NASTY = "O'Brien'); DROP TABLE activities; --";

const STEP_SETS: Array<[StepField, unknown, unknown]> = [
  ["title", "Prima", NASTY],
  ["description", null, NASTY],
  ["tools", [], [NASTY]],
  ["input", null, NASTY],
  ["output", null, NASTY],
  ["decision", null, NASTY],
  ["frequency", null, "mensile"],
  ["hoursWeek", null, 3.5],
  ["quality", null, NASTY],
  ["workType", null, "delivery"],
  ["who", [], [NASTY]],
  ["decisionLabel", null, NASTY],
  ["exception", null, NASTY],
  ["friction", null, 2],
  ["status", "da_validare", "confermato"],
];

const op = (body: Record<string, unknown>) => ({ id: id(), ...body }) as BoardOp;
const OPS: Record<string, BoardOp> = {
  "process.add": op({ t: "process.add", processId: id(), name: NASTY, beforeId: id() }),
  "process.add (in fondo)": op({ t: "process.add", processId: id(), name: NASTY }),
  "process.set name": op({ t: "process.set", processId: id(), field: "name", prev: "Prima", next: NASTY }),
  "process.set owner": op({ t: "process.set", processId: id(), field: "owner", prev: null, next: NASTY }),
  "process.move": op({ t: "process.move", processId: id(), beforeId: id() }),
  "process.remove": op({ t: "process.remove", processId: id() }),
  "process.vote": op({ t: "process.vote", processId: id(), mine: 3 }),
  "process.vote (zero)": op({ t: "process.vote", processId: id(), mine: 0 }),
  "step.add": op({ t: "step.add", stepId: id(), processId: id(), title: NASTY, beforeId: id() }),
  "step.add (dopo)": op({ t: "step.add", stepId: id(), processId: id(), title: NASTY, afterId: id() }),
  "step.add (in fondo)": op({ t: "step.add", stepId: id(), processId: id(), title: NASTY }),
  ...Object.fromEntries(STEP_SETS.map(([field, prev, next]) => [`step.set ${field}`, op({ t: "step.set", stepId: id(), field, prev, next })])),
  "step.move": op({ t: "step.move", stepId: id(), processId: id(), beforeId: id() }),
  "step.remove": op({ t: "step.remove", stepId: id() }),
  "step.stream": op({ t: "step.stream", stepId: id(), prev: null, next: "innovate" }),
  "streams.reset": op({ t: "streams.reset" }),
  "note.add": op({ t: "note.add", noteId: id(), stepId: id(), lane: "attriti", text: NASTY, beforeId: id() }),
  "note.add (analisi)": op({ t: "note.add", noteId: id(), stepId: null, lane: "analisi", title: NASTY, text: NASTY }),
  "note.set text": op({ t: "note.set", noteId: id(), field: "text", prev: "Prima", next: NASTY }),
  "note.set title": op({ t: "note.set", noteId: id(), field: "title", prev: null, next: NASTY }),
  "note.set status": op({ t: "note.set", noteId: id(), field: "status", prev: "fonte", next: "validato" }),
  "note.remove": op({ t: "note.remove", noteId: id() }),
  "board.set": op({ t: "board.set", field: "headline", prev: null, next: NASTY }),
};
const opStatements: Record<string, UcStatement> = Object.fromEntries(Object.entries(OPS).map(([name, item]) => [name, opStatement(scope, actor, item)]));
/** Le stesse operazioni scritte dall'assistente: un passo che cambia torna «da validare» nella stessa istruzione. */
const assistant: BoardActor = { kind: "assistente", userId: USER, role: "analyst" };
const assistantStatements: Record<string, UcStatement> = Object.fromEntries(Object.entries(OPS).map(([name, item]) => [`${name} (assistente)`, opStatement(scope, assistant, item)]));

const ids = [id(), id(), id()];
/** Le istruzioni legate a un'unità: ognuna deve nominare workspace e unità. */
const UNIT_STATEMENTS: Record<string, UcStatement> = {
  ...opStatements,
  ...assistantStatements,
  ensureBoardRow: ensureBoardRow(scope),
  "projectLane attriti": projectLane(scope, "attriti", ids),
  "projectLane dati": projectLane(scope, "dati", ids),
  renumberProcesses: renumberProcesses(scope),
  renumberSteps: renumberSteps(scope),
  renumberNotes: renumberNotes(scope),
  startUnit: startUnit(scope),
  forgetOldOps: forgetOldOps(scope),
  bumpRevision: bumpRevision(scope),
  "preflight unità": preflight(scope)[1],
  noteLanes: noteLanes(scope, ids),
  revisionRead: revisionRead(scope),
  processNames: processNames(scope),
  ...Object.fromEntries(boardReads(scope, USER).map((statement, index) => [`boardReads ${index}`, statement])),
  ...Object.fromEntries(activitiesOnlyReads(scope).map((statement, index) => [`activitiesOnlyReads ${index}`, statement])),
  ...Object.fromEntries(adoptionReads(scope).map((statement, index) => [`adoptionReads ${index}`, statement])),
  ...Object.fromEntries(adoptionWrites(scope, ids, NASTY).map((statement, index) => [`adoptionWrites ${index}`, statement])),
  ...Object.fromEntries(adoptionWrites(scope, ids, NASTY, [{ id: ids[0], lane: "attriti", parts: [NASTY, NASTY] }]).map((statement, index) => [`adoptionWrites (testi lunghi) ${index}`, statement])),
  "completionReads unità": completionReads(scope)[0],
  "completionReads attività": completionReads(scope)[2],
  markMapped: markMapped(scope, { type: "mapping_completed", title: NASTY, description: NASTY }),
  ...Object.fromEntries(saveSummary(scope, { headline: NASTY, points: [{ id: id(), title: NASTY, text: NASTY }] }).map((statement, index) => [`saveSummary ${index}`, statement])),
  "saveClassifications (unità)": saveClassifications(scope, [{ id: id(), stream: "automate", confidence: 0.8, reason: NASTY, potential: NASTY }], true),
  saveOnetMatches: saveOnetMatches(scope, [{ id: id(), code: "13-1023.00", title: NASTY, exposure: 0.3 }], 200),
  unitDocuments: unitDocuments(scope),
  linkDependency: linkDependencyStatement(scope, id(), id(), "input"),
};
/** Le istruzioni di tutto un workspace, per definizione: l'elenco delle unità e «Classifica attività». */
const WORKSPACE_STATEMENTS: Record<string, UcStatement> = {
  "unitBoards (con la board)": unitBoards(WS, true),
  "unitBoards (senza la 0039)": unitBoards(WS, false),
  "saveClassifications (workspace)": saveClassifications({ workspaceId: WS }, [{ id: id(), stream: "automate", confidence: 0.8, reason: NASTY, potential: NASTY }], true),
  "saveClassifications (workspace, senza la 0039)": saveClassifications({ workspaceId: WS }, [{ id: id(), stream: "automate", confidence: 0.8, reason: NASTY, potential: NASTY }], false),
  unitsToAdopt: unitsToAdopt(WS, ids),
  "completionReads obiettivi": completionReads(scope)[1],
};
const ALL = { ...UNIT_STATEMENTS, ...WORKSPACE_STATEMENTS, storeProbe: storeProbe() };

test("R1: ogni istruzione di un'unità nomina workspace_id e department_id, e li lega ai valori dello scope", () => {
  assert.ok(Object.keys(opStatements).length >= 15 + STEP_SETS.length - 1);
  for (const [name, statement] of Object.entries(UNIT_STATEMENTS)) {
    assert.match(statement.text, /\bworkspace_id\b/, `${name}: workspace_id`);
    assert.match(statement.text, /\bdepartment_id\b|\bdepartments d\b[\s\S]*\bd\.id = \$\d+::uuid/, `${name}: department_id`);
    assert.ok(statement.params.includes(WS), `${name}: il workspace dello scope è un parametro`);
    assert.ok(statement.params.includes(UNIT), `${name}: l'unità dello scope è un parametro`);
    // I due valori stanno in un confronto di uguaglianza con la colonna, non in un elenco di valori da scrivere.
    const ws = statement.params.indexOf(WS) + 1;
    const unit = statement.params.indexOf(UNIT) + 1;
    assert.match(statement.text, new RegExp(`\\bworkspace_id = \\$${ws}::uuid\\b`), `${name}: workspace_id = $${ws}`);
    assert.match(statement.text, new RegExp(`\\b(department_id|d\\.id) = \\$${unit}::uuid\\b`), `${name}: department_id = $${unit}`);
  }
  // Le sole istruzioni di tutto un workspace: l'elenco delle unità e «Classifica attività». Ogni riga è del workspace.
  for (const [name, statement] of Object.entries(WORKSPACE_STATEMENTS)) {
    assert.match(statement.text, /\bworkspace_id = \$\d+::uuid/, `${name}: workspace_id`);
    assert.ok(statement.params.includes(WS), name);
  }
  assert.deepEqual(Object.keys(WORKSPACE_STATEMENTS).length, 6);
  // Ogni tabella della board che un'istruzione tocca compare con il suo scope: nessun alias resta senza.
  for (const [name, statement] of Object.entries(opStatements)) {
    for (const match of statement.text.matchAll(/\b(?:FROM|UPDATE|JOIN|USING)\s+(mapping_[a-z_]+|activities)\s+([a-z]+)\b/g)) {
      const alias = match[2];
      assert.match(statement.text, new RegExp(`\\b${alias}\\.workspace_id\\b`), `${name}: ${match[1]} ${alias} senza workspace_id`);
      assert.match(statement.text, new RegExp(`\\b${alias}\\.department_id\\b`), `${name}: ${match[1]} ${alias} senza department_id`);
    }
  }
});

test("chi non è una persona non conferma: il passo che l'assistente cambia torna «da validare» nella stessa istruzione", () => {
  const revalidate = (ids: string) =>
    new RegExp(
      `,\\nrevalidate AS \\(\\n  UPDATE mapping_steps s SET status = 'da_validare', updated_at = now\\(\\)\\n  WHERE s\\.activity_id IN \\(${ids}\\) AND s\\.department_id = \\$\\d+::uuid AND s\\.workspace_id = \\$\\d+::uuid AND s\\.status <> 'da_validare' AND EXISTS \\(SELECT 1 FROM done\\)\\n  RETURNING 1\\)`,
    );
  const inSet = /\ndone AS \(\n  UPDATE mapping_steps s SET [^\n]*status = 'da_validare', updated_at = now\(\)/;
  const activityFields = STEP_SETS.map(([field]) => field).filter((field) => !["who", "decisionLabel", "exception", "friction", "status"].includes(field));
  // Un campo di activities, una nota del passo: la CTE `revalidate`, dopo la scrittura e solo se è avvenuta.
  for (const name of [...activityFields.map((field) => `step.set ${field}`), "note.add"]) assert.match(assistantStatements[`${name} (assistente)`].text, revalidate("\\$\\d+::uuid"), name);
  for (const name of ["note.set text", "note.set title", "note.set status", "note.remove"]) assert.match(assistantStatements[`${name} (assistente)`].text, revalidate("SELECT done\\.activity_id FROM done"), name);
  // Un campo della riga del passo, lo spostamento: nella stessa UPDATE della riga.
  for (const name of ["step.set who", "step.set decisionLabel", "step.set exception", "step.set friction", "step.move"]) {
    assert.match(assistantStatements[`${name} (assistente)`].text, inSet, name);
    assert.doesNotMatch(assistantStatements[`${name} (assistente)`].text, /\nrevalidate AS/, name);
  }
  // Lo stato stesso, un passo nuovo, i processi, i punti di analisi, gli stream: nessun ritorno a «da validare».
  for (const name of ["step.set status", "step.add", "step.remove", "step.stream", "streams.reset", "note.add (analisi)", "process.add", "process.set name", "process.move", "process.vote", "board.set"]) {
    assert.doesNotMatch(assistantStatements[`${name} (assistente)`].text, /'da_validare'/, name);
  }
  // Le stesse operazioni di una persona non toccano lo stato del passo.
  for (const [name, statement] of Object.entries(opStatements)) assert.doesNotMatch(statement.text, /'da_validare'/, name);
  // Ogni tabella che le istruzioni dell'assistente toccano ha il suo scope.
  for (const [name, statement] of Object.entries(assistantStatements)) {
    for (const match of statement.text.matchAll(/\b(?:FROM|UPDATE|JOIN|USING)\s+(mapping_[a-z_]+|activities)\s+([a-z]+)\b/g)) {
      assert.match(statement.text, new RegExp(`\\b${match[2]}\\.workspace_id\\b`), `${name}: ${match[1]} ${match[2]} senza workspace_id`);
      assert.match(statement.text, new RegExp(`\\b${match[2]}\\.department_id\\b`), `${name}: ${match[1]} ${match[2]} senza department_id`);
    }
  }
});

test("R2: nessun INSERT … VALUES, ogni inserimento legge da un genitore; niente solleva errori; ogni valore è un parametro", () => {
  for (const [name, statement] of Object.entries(ALL)) {
    assert.doesNotMatch(statement.text, /\bVALUES\b/i, `${name}: INSERT … VALUES`);
    for (const insert of statement.text.matchAll(/INSERT INTO ([a-z_]+) \([^)]*\)\s+(\S+)/g)) assert.equal(insert[2], "SELECT", `${name}: l'inserimento in ${insert[1]} legge da un genitore`);
    assert.doesNotMatch(statement.text, /\bRAISE\b|uc_require|\bASSERT\b/i, `${name}: non solleva errori`);
    assert.doesNotMatch(statement.text, /;/, `${name}: una sola istruzione`);
    // Mai un valore incollato nel testo: né un id, né un testo scritto da una persona o da un modello.
    assert.ok(!statement.text.includes("O'Brien") && !statement.text.includes("DROP TABLE"), `${name}: un testo nel SQL`);
    assert.doesNotMatch(statement.text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, `${name}: un id nel SQL`);
    assert.equal(statement.params.length, (statement.text.match(/\$\d+/g) ?? []).length, `${name}: un segnaposto per parametro`);
  }
  // Ogni operazione che inserisce è anche ripetibile (R4): ON CONFLICT … DO NOTHING, o l'aggiornamento dei voti.
  for (const name of ["process.add", "step.add", "step.add (dopo)", "note.add", "note.add (analisi)", "process.vote"]) {
    const inserts = (opStatements[name].text.match(/INSERT INTO/g) ?? []).length;
    assert.equal((opStatements[name].text.match(/ON CONFLICT \([a-z_, ]+\) DO (NOTHING|UPDATE)/g) ?? []).length, inserts, name);
  }
  // Ogni operazione restituisce una riga con il suo esito, e gli esiti sono quelli che il server conosce.
  for (const [name, statement] of Object.entries(opStatements)) {
    assert.match(statement.text, /AS outcome$/, `${name}: l'esito`);
    const result = statement.text.slice(statement.text.indexOf("\nresult AS (SELECT "), statement.text.indexOf("\nmark AS ("));
    const outcomes = [...result.matchAll(/(?:THEN|ELSE|SELECT) '([a-z]+)'/g)].map((match) => match[1]);
    assert.ok(outcomes.length > 0 && outcomes[0] === "ok", `${name}: il primo esito è «ok»`);
    for (const outcome of outcomes) assert.ok((OP_OUTCOMES as readonly string[]).includes(outcome), `${name}: ${outcome}`);
  }
});

test("R3: ogni modifica di un campo si applica solo se il campo è com'era, o è già com'è", () => {
  const sets = Object.keys(opStatements).filter((name) => /^(step\.set|process\.set|note\.set|board\.set|step\.stream)/.test(name));
  assert.equal(sets.length, STEP_SETS.length + 2 + 3 + 1 + 1);
  for (const name of sets) {
    const { text } = opStatements[name];
    // L'ultima condizione dell'UPDATE: «(campo IS NOT DISTINCT FROM $prima OR campo IS NOT DISTINCT FROM $dopo)».
    const where = text.slice(text.indexOf("UPDATE"), text.indexOf("RETURNING")).trimEnd();
    const last = where.slice(where.lastIndexOf(" AND (") + " AND (".length);
    assert.ok(where.includes(" AND (") && last.endsWith(")"), `${name}: manca il confronto`);
    const halves = last.slice(0, -1).split(" OR ");
    assert.equal(halves.length, 2, `${name}: due confronti`);
    const [was, is] = halves.map((half) => half.split(" IS NOT DISTINCT FROM "));
    assert.deepEqual([was.length, is.length], [2, 2], `${name}: IS NOT DISTINCT FROM`);
    assert.equal(was[0], is[0], `${name}: lo stesso campo nei due confronti`);
    assert.match(was[1], /^\$\d+(::[a-z_]+)*$/, `${name}: il valore di prima è un parametro`);
    assert.match(is[1], /^\$\d+(::[a-z_]+)*$/, `${name}: il valore nuovo è un parametro`);
    assert.notEqual(was[1], is[1], `${name}: prima e dopo sono due parametri`);
    // Chi non passa il confronto risulta «conflict» se il bersaglio c'è, «gone» se non c'è.
    assert.match(text, /\nresult AS \(SELECT CASE WHEN EXISTS \(SELECT 1 FROM done\) THEN 'ok' WHEN EXISTS \(SELECT 1 FROM target\) THEN 'conflict' ELSE 'gone' END AS outcome\),\nmark AS/, name);
  }
  // Gli altri UPDATE e DELETE delle operazioni: spostamenti, eliminazioni, i voti (la riga di chi salva), il ritorno alla proposta.
  const others = Object.keys(opStatements).filter((name) => !sets.includes(name) && /\b(UPDATE|DELETE FROM)\b/.test(opStatements[name].text));
  assert.deepEqual(others.sort(), ["note.remove", "process.move", "process.remove", "process.vote", "process.vote (zero)", "step.move", "step.remove", "streams.reset"]);
  // I voti: solo la riga di chi salva.
  for (const name of ["process.vote", "process.vote (zero)"]) {
    assert.ok(opStatements[name].params.includes(USER), name);
    assert.match(opStatements[name].text, /v\.user_id = target\.user_id/, name);
    assert.match(opStatements[name].text, /JOIN users u ON u\.id = \$\d+::uuid/, name);
  }
  // Un processo si elimina solo vuoto; un passo solo se nessuno use case del workspace lo elenca.
  assert.match(opStatements["process.remove"].text, /NOT EXISTS \(SELECT 1 FROM mapping_steps s WHERE s\.process_id = p\.id/);
  assert.match(opStatements["step.remove"].text, /FROM use_cases u\s+WHERE u\.workspace_id = \$\d+::uuid AND jsonb_typeof\(u\.related_activity_ids\) = 'array' AND u\.related_activity_ids @> jsonb_build_array\(\$\d+::text\)/);
  assert.match(opStatements["step.remove"].text, /AND NOT EXISTS \(SELECT 1 FROM linked\)/);
  // Il titolo di una nota: solo su un punto di analisi.
  assert.match(opStatements["note.set title"].text, /AND n\.lane = 'analisi' AND \(n\.title IS NOT DISTINCT FROM/);
  assert.doesNotMatch(opStatements["note.set text"].text, /n\.lane = 'analisi'/);
});

test("R4: un'operazione già applicata non scrive di nuovo: risponde con l'esito di allora; ogni operazione lascia il suo id e il suo esito", () => {
  for (const [name, statement] of Object.entries(opStatements)) {
    const opId = OPS[name].id;
    const { text } = statement;
    // Prima di tutto: l'operazione è già stata applicata in questa unità?
    assert.match(text, /^WITH seen AS \(SELECT o\.outcome FROM mapping_applied_ops o WHERE o\.op_id = \$(\d+)::uuid AND o\.department_id = \$\d+::uuid AND o\.workspace_id = \$\d+::uuid\),\n/, name);
    const at = Number(text.match(/o\.op_id = \$(\d+)::uuid/)![1]);
    assert.equal(statement.params[at - 1], opId, `${name}: l'id dell'operazione`);
    // Ogni scrittura dell'operazione aspetta che non lo sia (le scritture che leggono da un'altra scrittura la seguono).
    const writes = [...text.matchAll(/\n([a-z]+) AS \(\s*(INSERT INTO|UPDATE|DELETE FROM) ([a-z_]+)/g)].map((match) => ({ cte: match[1], table: match[3] }));
    assert.ok(writes.length > 0, `${name}: scrive`);
    for (const { cte, table } of writes) {
      const body = text.slice(text.indexOf(`\n${cte} AS (`), text.indexOf("RETURNING", text.indexOf(`\n${cte} AS (`)));
      if (table === "mapping_applied_ops") continue;
      if (/\bFROM act\b/.test(body)) continue;
      assert.match(body, /NOT EXISTS \(SELECT 1 FROM seen\)/, `${name}: ${cte} scrive anche se l'operazione è già stata applicata`);
    }
    // L'id e l'esito si ricordano, una volta, solo se l'operazione non c'era; la risposta è l'esito di allora, o quello di adesso.
    assert.match(text, /\nmark AS \(\n  INSERT INTO mapping_applied_ops \(op_id, workspace_id, department_id, outcome\)\n  SELECT \$\d+::uuid, d\.workspace_id, d\.id, result\.outcome FROM departments d, result\n  WHERE d\.id = \$\d+::uuid AND d\.workspace_id = \$\d+::uuid AND NOT EXISTS \(SELECT 1 FROM seen\)\n  ON CONFLICT \(op_id\) DO NOTHING\n  RETURNING 1\)\nSELECT coalesce\(\(SELECT seen\.outcome FROM seen\), \(SELECT result\.outcome FROM result\)\) AS outcome$/, name);
    assert.equal(statement.params.filter((param) => param === opId).length, 2, `${name}: l'id letto e scritto`);
  }
  // Gli id si dimenticano dopo 30 giorni (la bozza ne vive 7), nell'unità di chi salva.
  assert.match(forgetOldOps(scope).text, /^DELETE FROM mapping_applied_ops o WHERE o\.department_id = \$\d+::uuid AND o\.workspace_id = \$\d+::uuid AND o\.created_at < now\(\) - make_interval\(days => \$\d+::int\)$/);
  assert.ok(forgetOldOps(scope).params.includes(OP_MEMORY.appliedDays));
  assert.ok(OP_MEMORY.appliedDays > OP_MEMORY.draftDays);
});

test("il campo letto e il campo confrontato sono la stessa espressione", () => {
  const read = boardReads(scope, USER)[2].text;
  const alias: Record<StepField, string> = {
    title: "title",
    description: "description",
    tools: "tools",
    input: "input",
    output: "output",
    decision: "decision",
    frequency: "frequency",
    hoursWeek: "hours_week",
    quality: "quality",
    workType: "work_type",
    who: "who",
    decisionLabel: "",
    exception: "",
    friction: "",
    status: "",
  };
  for (const [field, , next] of STEP_SETS) {
    const current = toStatement(STEP_FIELDS[field].current).text;
    const statement = opStatements[`step.set ${field}`].text;
    assert.equal(statement.split(`${current} IS NOT DISTINCT FROM`).length, 3, `${field}: confrontato due volte`);
    if (alias[field]) assert.ok(read.includes(`${current} AS ${alias[field]}`), `${field}: letto con la stessa espressione`);
    else assert.ok(read.includes(current), `${field}: letto com'è`);
    assert.match(statement, new RegExp(`UPDATE ${STEP_FIELDS[field].table} [as] SET ${STEP_FIELDS[field].column} = `), `${field}: la sua colonna`);
    assert.ok(next !== undefined);
  }
  assert.equal(Object.keys(STEP_FIELDS).length, STEP_SETS.length);
  // Dieci campi sono colonne di activities, cinque di mapping_steps.
  assert.deepEqual(Object.values(STEP_FIELDS).filter((spec) => spec.table === "activities").length, 10);
  // Lo stream si confronta piegando i valori di prima, come `streamOf`.
  const fold = toStatement(streamFold("a.classification")).text;
  for (const [stored, stream] of Object.entries(STREAM_OF_CLASSIFICATION)) assert.ok(fold.includes(`WHEN '${stored}' THEN '${stream}'`), stored);
  assert.equal(opStatements["step.stream"].text.split(`${fold} IS NOT DISTINCT FROM`).length, 3);
  // Una lista vuota di strumenti si scrive NULL, come ha sempre fatto la chat.
  assert.match(opStatements["step.set tools"].text, /SET tools_used = nullif\(\$\d+::jsonb, '\[\]'::jsonb\)/);
});

test("i limiti stanno nelle istruzioni: 26 processi, 40 passi per processo, 200 per unità, 30 note per corsia, 6 punti di analisi", () => {
  const L = MAPPING_LIMITS;
  const has = (name: string, limit: number) => assert.ok(opStatements[name].params.includes(limit), `${name}: ${limit}`);
  has("process.add", L.processes);
  has("step.add", L.stepsPerProcess);
  has("step.add", L.stepsPerUnit);
  has("step.move", L.stepsPerProcess);
  has("note.add", L.notesPerLane);
  has("note.add (analisi)", L.analysisPoints);
  assert.ok(!opStatements["note.add (analisi)"].params.includes(L.notesPerLane));
  for (const name of ["process.add", "step.add", "step.move", "note.add"]) assert.match(opStatements[name].text, /'limit'/, name);
  // Il passo che sta spostando non conta tra i passi della riga in cui entra.
  assert.match(opStatements["step.move"].text, /AND s\.activity_id <> \$\d+::uuid\)/);
});

test("R5: la riga della board per prima, un'istruzione per operazione, poi la coda; la revisione per ultima", () => {
  const stepId = id();
  const ops = [OPS["process.add"], OPS["step.add"], OPS["step.set title"], op({ t: "note.add", noteId: id(), stepId, lane: "attriti", text: "Una nota" }), op({ t: "note.add", noteId: id(), stepId, lane: "dati", text: "Un dato" }), OPS["note.remove"], OPS["process.vote"]];
  const other = id();
  const batch = saveBatch(scope, actor, ops, { attriti: [other], dati: [] });
  const text = (statement: UcStatement) => statement.text;
  assert.equal(text(batch.statements[0]), text(ensureBoardRow(scope)));
  assert.deepEqual(batch.opAt, [1, 2, 3, 4, 5, 6, 7]);
  ops.forEach((item, index) => assert.deepEqual(batch.statements[batch.opAt[index]], opStatement(scope, actor, item)));
  const tail = batch.statements.slice(8);
  assert.deepEqual(tail.map(text), [
    text(projectLane(scope, "attriti", [])),
    text(projectLane(scope, "dati", [])),
    text(renumberProcesses(scope)),
    text(renumberSteps(scope)),
    text(renumberNotes(scope)),
    text(forgetOldOps(scope)),
    text(startUnit(scope)),
    text(bumpRevision(scope)),
  ]);
  assert.equal(batch.revisionAt, batch.statements.length - 1);
  assert.match(text(batch.statements[batch.revisionAt]), /SET revision = b\.revision \+ 1, updated_at = now\(\)[\s\S]*RETURNING b\.revision, b\.updated_at$/);
  // La copia di «Attriti»: i passi delle note aggiunte qui e quelli che chi chiama ha letto dal database.
  const projected = tail[0].params.find((param) => Array.isArray(param)) as string[];
  assert.deepEqual([...projected].sort(), [other, stepId].sort());
  assert.deepEqual(tail[1].params.find((param) => Array.isArray(param)), [stepId]);

  // Solo quello che serve: una modifica di un campo non rinumera e non ricopia niente.
  const small = saveBatch(scope, actor, [OPS["step.set title"]]);
  assert.deepEqual(small.statements.map(text), [text(ensureBoardRow(scope)), text(opStatement(scope, actor, OPS["step.set title"])), text(forgetOldOps(scope)), text(startUnit(scope)), text(bumpRevision(scope))]);
  assert.deepEqual([small.opAt, small.revisionAt], [[1], 4]);
  const move = saveBatch(scope, actor, [OPS["step.move"]]);
  assert.deepEqual(move.statements.slice(2).map(text), [text(renumberSteps(scope)), text(forgetOldOps(scope)), text(startUnit(scope)), text(bumpRevision(scope))]);
  const process = saveBatch(scope, actor, [OPS["process.remove"]]);
  assert.deepEqual(process.statements.slice(2).map(text), [text(renumberProcesses(scope)), text(forgetOldOps(scope)), text(startUnit(scope)), text(bumpRevision(scope))]);
  // Una nota di una corsia senza colonna di sempre («Tempi e volumi») non ricopia niente.
  const tempi = saveBatch(scope, actor, [op({ t: "note.add", noteId: id(), stepId, lane: "tempi", text: "Un volume" })]);
  assert.deepEqual(tempi.statements.slice(2).map(text), [text(renumberNotes(scope)), text(forgetOldOps(scope)), text(startUnit(scope)), text(bumpRevision(scope))]);
});

test("la coda: la copia nelle colonne di sempre scrive solo dove il testo cambia, la rinumerazione solo dove il posto cambia", () => {
  const pain = projectLane(scope, "attriti", ids).text;
  assert.match(pain, /UPDATE activities a SET pain_points = agg\.body, updated_at = now\(\)/);
  assert.match(pain, /string_agg\(n\.body, chr\(10\) ORDER BY n\.position, n\.created_at, n\.id\)/);
  assert.match(pain, /AND a\.pain_points IS DISTINCT FROM agg\.body$/);
  assert.match(projectLane(scope, "dati", ids).text, /UPDATE activities a SET data_required = agg\.body[\s\S]*AND a\.data_required IS DISTINCT FROM agg\.body$/);
  for (const statement of [renumberProcesses(scope), renumberSteps(scope), renumberNotes(scope)]) {
    assert.match(statement.text, /row_number\(\) OVER \(/);
    assert.match(statement.text, /position IS DISTINCT FROM o\.rn$/);
  }
  assert.match(renumberSteps(scope).text, /PARTITION BY x\.process_id ORDER BY x\.position, x\.created_at, x\.activity_id/);
  assert.match(renumberNotes(scope).text, /PARTITION BY x\.activity_id, x\.lane ORDER BY x\.position, x\.created_at, x\.id/);
  // «In corso» solo da «da iniziare», solo con un passo; niente riporta indietro un'unità.
  assert.match(startUnit(scope).text, /SET mapping_status = 'in_progress'[\s\S]*d\.mapping_status = 'not_started'\s+AND EXISTS \(SELECT 1 FROM mapping_steps s/);
});

test("l'adozione non scrive in activities e non alza la revisione; il completamento segna una volta sola", () => {
  const writes = adoptionWrites(scope, ids, "Processo principale");
  for (const statement of writes) {
    assert.doesNotMatch(statement.text, /UPDATE activities|INSERT INTO activities|DELETE FROM activities/);
    assert.doesNotMatch(statement.text, /revision/);
    assert.doesNotMatch(statement.text, /UPDATE departments/);
  }
  assert.match(writes[writes.length - 1].text, /INSERT INTO mapping_steps[\s\S]*'da_validare', 'prima'[\s\S]*ON CONFLICT \(activity_id\) DO NOTHING\s+RETURNING activity_id$/);
  // Le note dalle colonne di sempre: un id che dipende solo da attività e corsia, «da fonti», «prima della board».
  const notes = writes.filter((statement) => statement.text.includes("INSERT INTO mapping_notes"));
  assert.equal(notes.length, 2);
  for (const statement of notes) assert.match(statement.text, /SELECT md5\(a\.id::text \|\| \$\d+::text\)::uuid[\s\S]*'fonte', 'prima', 1[\s\S]*ON CONFLICT \(id\) DO NOTHING$/);
  assert.deepEqual(notes.map((statement) => statement.params.filter((param) => typeof param === "string" && param.startsWith(":"))), [[":attriti"], [":dati"]]);
  // Un testo più lungo di una nota non si taglia: la nota di sempre lo salta, le sue parti entrano una per nota, la
  // prima con l'id di sempre, le altre con il numero della parte, nella loro posizione.
  for (const statement of notes) {
    assert.doesNotMatch(statement.text, /\bleft\(/, "nessun taglio");
    assert.match(statement.text, /AND length\(btrim\(a\.(pain_points|data_required)\)\) <= \$\d+::int\nON CONFLICT/);
    assert.ok(statement.params.includes(MAPPING_LIMITS.note));
  }
  const long = adoptionWrites(scope, ids, "Processo principale", [{ id: ids[0], lane: "dati", parts: ["Una parte.", "Un'altra parte."] }]);
  assert.equal(long.length, writes.length + 1);
  assert.equal(long.at(-1)?.text, writes.at(-1)?.text, "l'ultima istruzione resta l'inserimento dei passi");
  const parts = long.filter((statement) => statement.text.includes("jsonb_to_recordset"));
  assert.equal(parts.length, 1);
  assert.match(parts[0].text, /^INSERT INTO mapping_notes \(id, workspace_id, department_id, activity_id, lane, body, status, origin, position\)\nSELECT md5\(a\.id::text \|\| ':' \|\| i\.lane \|\| CASE WHEN i\.part = 1 THEN '' ELSE ':' \|\| i\.part END\)::uuid, [\s\S]*'fonte', 'prima', i\.part\n/);
  assert.match(parts[0].text, /WHERE a\.id = ANY\(\$\d+::uuid\[\]\) AND i\.lane IN \('attriti', 'dati'\) AND length\(btrim\(i\.body\)\) BETWEEN 1 AND \$\d+::int\nON CONFLICT \(id\) DO NOTHING$/);
  assert.deepEqual(JSON.parse(String(parts[0].params.find((param) => typeof param === "string" && param.startsWith("[{")))), [
    { id: ids[0], lane: "dati", part: 1, body: "Una parte." },
    { id: ids[0], lane: "dati", part: 2, body: "Un'altra parte." },
  ]);
  // Senza testi lunghi, nessuna istruzione in più.
  assert.equal(adoptionWrites(scope, ids, "Processo principale", []).length, writes.length);
  // «Processo principale» solo se l'unità non ha processi, con l'id che dipende solo dall'unità.
  assert.match(writes[1].text, /md5\(unit\.department_id::text \|\| ':processo'\)::uuid[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM mapping_processes p[\s\S]*ON CONFLICT \(id\) DO NOTHING$/);

  const mapped = markMapped(scope, { type: "mapping_completed", title: "Titolo", description: "Descrizione" }).text;
  assert.match(mapped, /SET mapping_status = 'mapped'[\s\S]*d\.mapping_status IN \('not_started', 'in_progress'\)/);
  // Solo con almeno un passo dell'unità: senza, niente «mapped» e niente campanella, nella stessa istruzione.
  assert.match(mapped, /d\.mapping_status IN \('not_started', 'in_progress'\)\s+AND EXISTS \(SELECT 1 FROM activities a WHERE a\.department_id = d\.id AND a\.workspace_id = d\.workspace_id\)\s+RETURNING/);
  // La riga della campanella nasce solo dalla riga che è appena passata a «mapped».
  assert.match(mapped, /INSERT INTO weekly_signals \(workspace_id, signal_type, title, description, related_entity_type, related_entity_id\)\s+SELECT done\.workspace_id, \$\d+::text, left\(\$\d+::text, 500\), \$\d+::text, 'department', done\.department_id FROM done/);
  assert.match(mapped, /SELECT EXISTS \(SELECT 1 FROM done\) AS first$/);

  // La classificazione non copre lo stream scelto nel frattempo da una persona; il match O*NET solo sui passi dell'unità.
  assert.match(UNIT_STATEMENTS["saveClassifications (unità)"].text, /AND a\.classification IS NULL/);
  assert.match(UNIT_STATEMENTS.saveOnetMatches.text, /AND a\.onet_task_id IS NULL/);
  assert.match(UNIT_STATEMENTS.saveOnetMatches.text, /AND EXISTS \(SELECT 1 FROM mapping_steps s WHERE s\.activity_id = a\.id AND s\.department_id = a\.department_id AND s\.workspace_id = a\.workspace_id\)/);
  // La sintesi: la frase solo se manca; si tolgono solo i punti venuti dalla chat e non validati.
  const summary = saveSummary(scope, { headline: "Una frase", points: [{ id: id(), title: null, text: "Un punto" }] }).map((statement) => statement.text);
  assert.ok(summary.some((text) => /SET headline = \$\d+::text WHERE [\s\S]*AND b\.headline IS NULL$/.test(text)));
  assert.ok(summary.some((text) => /DELETE FROM mapping_notes n WHERE [\s\S]*n\.activity_id IS NULL AND n\.lane = \$\d+::text AND n\.origin = 'chat' AND n\.status <> 'validato'$/.test(text)));
  assert.equal(summary.at(-1), bumpRevision(scope).text);
  assert.deepEqual(saveSummary(scope, { headline: null, points: null }).map((statement) => statement.text), [ensureBoardRow(scope).text, bumpRevision(scope).text]);
});

test("senza la 0039 le letture non toccano le tabelle nuove", () => {
  for (const statement of [...activitiesOnlyReads(scope), preflight(scope)[1], unitBoards(WS, false), saveClassifications({ workspaceId: WS }, [], false)]) {
    assert.doesNotMatch(statement.text, /\bmapping_(boards|processes|steps|notes|votes|applied_ops)\b/, statement.text.slice(0, 60));
  }
  assert.match(storeProbe().text, /to_regclass\('public\.mapping_boards'\) IS NOT NULL/);
  assert.equal(preflight(scope)[0].text, storeProbe().text);
  // L'elenco delle unità conta con un LEFT JOIN: un'attività senza riga del passo è «da validare».
  const units = unitBoards(WS, true).text;
  assert.match(units, /LEFT JOIN activities a ON a\.department_id = d\.id AND a\.workspace_id = d\.workspace_id\s+LEFT JOIN mapping_steps s ON s\.activity_id = a\.id AND s\.department_id = a\.department_id AND s\.workspace_id = a\.workspace_id/);
  assert.match(units, /FILTER \(WHERE s\.status IS DISTINCT FROM 'confermato'\)/);
});
