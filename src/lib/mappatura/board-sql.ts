/**
 * «Mappatura board»: le istruzioni SQL (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.5, §3.6, §4.3).
 *
 * Solo costruttori `{ text, params }`: li esegue `board-store.ts` con l'esecutore uc (`executor.batch`, una transazione
 * non interattiva: le istruzioni partono tutte insieme, nessuna può leggere l'esito di un'altra e decidere). Per questo
 * ogni operazione è **una** istruzione che fa da sé e dice com'è andata (`outcome`: `ok`, `conflict`, `gone`, `limit`,
 * `linked`), senza mai sollevare un errore per un bersaglio che non c'è più.
 *
 * Le regole (ognuna ha la sua prova in `board-sql.test.ts` e nelle suite sul database):
 * - **R1 scope.** Ogni istruzione nomina `workspace_id` e `department_id` sulla riga che tocca o sul genitore da cui
 *   legge. Un id di un'altra unità non tocca niente.
 * - **R2 niente errori su un bersaglio sparito.** Gli inserimenti sono `INSERT … SELECT … FROM <genitore> WHERE …`;
 *   aggiornamenti e cancellazioni portano scope e confronto nel `WHERE`. Chi non tocca righe risulta rifiutato, le
 *   altre operazioni vanno avanti.
 * - **R3 confronta e scrivi.** `<campo> IS NOT DISTINCT FROM prev OR <campo> IS NOT DISTINCT FROM next`: si applica se
 *   il campo ha ancora il valore che la persona ha visto, o ha già quello nuovo.
 * - **R4 una richiesta ripetuta non cambia niente.** Gli inserimenti sono `ON CONFLICT (id) DO NOTHING` e contano come
 *   fatti se la riga c'è, in questa unità; i voti sono assoluti; la seconda metà di R3 copre le modifiche.
 * - **R5 la coda di ogni salvataggio**: la copia di «Attriti» e «Dati e documenti» nelle loro colonne, la
 *   rinumerazione delle righe toccate, l'unità «in corso» al primo passo e, per ultima, la revisione.
 *
 * Il campo letto e il campo confrontato usano la stessa espressione (`STEP_FIELDS`): quello che il browser ha visto è
 * proprio quello con cui il database confronta.
 *
 * Modulo puro: importa il costruttore SQL dei comandi uc, il vocabolario e le operazioni.
 */
import { MAPPING_BOARD_PROBE_SQL } from "../db/mapping-board-ddl.ts";
import { cast, join, jsonb, raw, ref, toStatement, ucSql, type SqlFragment, type UcStatement } from "../uc/sql/statement.ts";
import { ACTOR_DEFAULTS, type ActorKind, type BoardOp, type StepField, type StepValue } from "./board-ops.ts";
import { STREAM_OF_CLASSIFICATION } from "./streams.ts";
import { BOARD_LANE, MAPPING_LIMITS, STREAMS, type Lane } from "./vocab.ts";

export interface BoardScope {
  workspaceId: string;
  departmentId: string;
}

export interface BoardActor {
  kind: ActorKind;
  userId: string;
  role: string;
}

/** Com'è andata un'operazione: il valore di `outcome` nella riga che ogni istruzione restituisce. */
export type OpOutcome = "ok" | "conflict" | "gone" | "limit" | "linked";

const L = MAPPING_LIMITS;
const U = (value: string | null | undefined) => cast(value ?? null, "uuid");
const T = (value: string | null | undefined) => cast(value ?? null, "text");
const N = (value: number) => cast(value, "int");

/** R1: la riga `alias` è di questa unità, in questo workspace. */
export function inUnit(alias: string, scope: BoardScope): SqlFragment {
  return ucSql`${ref(`${alias}.department_id`)} = ${U(scope.departmentId)} AND ${ref(`${alias}.workspace_id`)} = ${U(scope.workspaceId)}`;
}

/** L'unità stessa, come genitore di un inserimento. */
const unitRow = (scope: BoardScope) => ucSql`SELECT d.id AS department_id, d.workspace_id FROM departments d WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)}`;

const OUTCOME_SET = raw("SELECT CASE WHEN EXISTS (SELECT 1 FROM done) THEN 'ok' WHEN EXISTS (SELECT 1 FROM target) THEN 'conflict' ELSE 'gone' END AS outcome");
const OUTCOME_DONE = raw("SELECT CASE WHEN EXISTS (SELECT 1 FROM done) THEN 'ok' ELSE 'gone' END AS outcome");

// ─── Espressioni condivise da lettura e confronto ────────────────────

/** Un testo facoltativo: senza spazi ai bordi, NULL se vuoto. */
const textOrNull = (column: string) => raw(`nullif(btrim(${column}), '')`);
/** Una lista di testi in jsonb: `[]` se manca o non è una lista, senza le voci che non sono testi. */
const stringList = (column: string) =>
  raw(
    `coalesce((SELECT jsonb_agg(e.value ORDER BY e.ordinality) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, ordinality) WHERE jsonb_typeof(e.value) = 'string'), '[]'::jsonb)`,
  );
/** Lo stream di `activities.classification`, piegando i sei valori di prima come `streamOf`. */
export const streamFold = (column: string) =>
  raw(`CASE ${column}::text ${Object.entries(STREAM_OF_CLASSIFICATION).map(([stored, stream]) => `WHEN '${stored}' THEN '${stream}'`).join(" ")} END`);

interface FieldSpec {
  table: "activities" | "mapping_steps";
  column: string;
  /** Il campo com'è letto e confrontato (`a.` per activities, `s.` per mapping_steps). */
  current: SqlFragment;
  /** Un valore del campo come parametro, del tipo giusto per il confronto. */
  param(value: StepValue): SqlFragment;
  /** Il valore da scrivere nella colonna. */
  write(value: StepValue): SqlFragment;
}

const asText = (value: StepValue) => T(typeof value === "string" ? value : null);
const asList = (value: StepValue) => jsonb(Array.isArray(value) ? value : []);
const asNumber = (value: StepValue, type: "real" | "smallint") => ucSql`${typeof value === "number" ? value : null}::${raw(type)}`;

const textField = (table: FieldSpec["table"], column: string, current: SqlFragment): FieldSpec => ({ table, column, current, param: asText, write: asText });

/** I campi di un passo che `step.set` scrive: dove stanno, come si leggono, come si confrontano. */
export const STEP_FIELDS: Readonly<Record<StepField, FieldSpec>> = Object.freeze({
  title: textField("activities", "title", raw("btrim(a.title)")),
  description: textField("activities", "description", textOrNull("a.description")),
  // Una lista vuota si scrive NULL, come ha sempre fatto la chat: chi legge `tools_used` stampa «non specificati».
  tools: { table: "activities", column: "tools_used", current: stringList("a.tools_used"), param: asList, write: (value) => ucSql`nullif(${asList(value)}, '[]'::jsonb)` },
  input: textField("activities", "input_description", textOrNull("a.input_description")),
  output: textField("activities", "output_description", textOrNull("a.output_description")),
  decision: textField("activities", "decision_points", textOrNull("a.decision_points")),
  frequency: textField("activities", "frequency", textOrNull("a.frequency")),
  hoursWeek: { table: "activities", column: "time_spent_hours_week", current: raw("a.time_spent_hours_week"), param: (value) => asNumber(value, "real"), write: (value) => asNumber(value, "real") },
  quality: textField("activities", "quality_perceived", textOrNull("a.quality_perceived")),
  workType: { table: "activities", column: "work_type", current: raw("a.work_type::text"), param: asText, write: (value) => ucSql`${asText(value)}::work_type` },
  who: { table: "mapping_steps", column: "who", current: stringList("s.who"), param: asList, write: asList },
  decisionLabel: textField("mapping_steps", "decision_label", raw("s.decision_label")),
  exception: textField("mapping_steps", "exception_text", raw("s.exception_text")),
  friction: { table: "mapping_steps", column: "friction_level", current: raw("s.friction_level"), param: (value) => asNumber(value, "smallint"), write: (value) => asNumber(value, "smallint") },
  status: textField("mapping_steps", "status", raw("s.status")),
});

// ─── Il posto di una riga tra le sue sorelle ─────────────────────────

interface Siblings {
  table: "mapping_processes" | "mapping_steps" | "mapping_notes";
  idColumn: "id" | "activity_id";
  /** Le sorelle: le righe `alias` dello stesso gruppo (R1 dentro). */
  group(alias: string): SqlFragment;
  /** La riga che si sta spostando: non conta tra le sue vicine. */
  movingId?: string | null;
}

/**
 * La posizione di una riga: a metà tra `beforeId` e chi lo precede, oppure tra `afterId` e chi lo segue, oppure in
 * fondo. Due inserimenti di seguito prima della stessa riga finiscono in ordine, senza pari merito; la coda del
 * salvataggio rinumera poi da 1 a n.
 */
function placeAt(siblings: Siblings, where: { beforeId?: string | null; afterId?: string | null }): SqlFragment {
  const table = raw(siblings.table);
  const id = (alias: string) => ref(`${alias}.${siblings.idColumn}`);
  const others = (alias: string) => (siblings.movingId ? ucSql`${siblings.group(alias)} AND ${id(alias)} <> ${U(siblings.movingId)}` : siblings.group(alias));
  const neighbour = (anchorId: string, side: "before" | "after") =>
    side === "before"
      ? ucSql`(SELECT (b.position + coalesce((SELECT max(x.position) FROM ${table} x WHERE ${others("x")} AND x.position < b.position), b.position - 1)) / 2 FROM ${table} b WHERE ${id("b")} = ${U(anchorId)} AND ${siblings.group("b")})`
      : ucSql`(SELECT (b.position + coalesce((SELECT min(x.position) FROM ${table} x WHERE ${others("x")} AND x.position > b.position), b.position + 1)) / 2 FROM ${table} b WHERE ${id("b")} = ${U(anchorId)} AND ${siblings.group("b")})`;
  const last = ucSql`(SELECT coalesce(max(m.position), 0) + 1 FROM ${table} m WHERE ${others("m")})`;
  const choices = [where.beforeId ? neighbour(where.beforeId, "before") : null, where.afterId ? neighbour(where.afterId, "after") : null, last].filter((choice): choice is SqlFragment => choice !== null);
  return choices.length === 1 ? last : ucSql`coalesce(${join(choices)})`;
}

const processesOf = (scope: BoardScope, movingId?: string | null): Siblings => ({ table: "mapping_processes", idColumn: "id", group: (alias) => inUnit(alias, scope), movingId });
const stepsOf = (scope: BoardScope, processId: string, movingId?: string | null): Siblings => ({
  table: "mapping_steps",
  idColumn: "activity_id",
  group: (alias) => ucSql`${ref(`${alias}.process_id`)} = ${U(processId)} AND ${inUnit(alias, scope)}`,
  movingId,
});
const notesOf = (scope: BoardScope, stepId: string | null, lane: Lane): Siblings => ({
  table: "mapping_notes",
  idColumn: "id",
  group: (alias) => ucSql`${ref(`${alias}.activity_id`)} IS NOT DISTINCT FROM ${U(stepId)} AND ${ref(`${alias}.lane`)} = ${T(lane)} AND ${inUnit(alias, scope)}`,
});

// ─── Le operazioni, una istruzione ciascuna ──────────────────────────

type Op<K extends BoardOp["t"]> = Extract<BoardOp, { t: K }>;

function processAdd(scope: BoardScope, op: Op<"process.add">): SqlFragment {
  return ucSql`WITH unit AS (${unitRow(scope)}),
was AS (SELECT 1 FROM mapping_processes p WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}),
room AS (SELECT count(*)::int AS n FROM mapping_processes p WHERE ${inUnit("p", scope)}),
done AS (
  INSERT INTO mapping_processes (id, workspace_id, department_id, name, position)
  SELECT ${U(op.processId)}, unit.workspace_id, unit.department_id, ${T(op.name)}, ${placeAt(processesOf(scope), { beforeId: op.beforeId })}
  FROM unit, room WHERE room.n < ${N(L.processes)}
  ON CONFLICT (id) DO NOTHING RETURNING 1)
SELECT CASE WHEN EXISTS (SELECT 1 FROM done) OR EXISTS (SELECT 1 FROM was) THEN 'ok' WHEN (SELECT n FROM room) >= ${N(L.processes)} THEN 'limit' ELSE 'gone' END AS outcome`;
}

function processSet(scope: BoardScope, op: Op<"process.set">): SqlFragment {
  const column = raw(op.field === "name" ? "name" : "owner");
  return ucSql`WITH target AS (SELECT 1 FROM mapping_processes p WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}),
done AS (
  UPDATE mapping_processes p SET ${column} = ${T(op.next)}, updated_at = now()
  WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)} AND (p.${column} IS NOT DISTINCT FROM ${T(op.prev)} OR p.${column} IS NOT DISTINCT FROM ${T(op.next)})
  RETURNING 1)
${OUTCOME_SET}`;
}

function processMove(scope: BoardScope, op: Op<"process.move">): SqlFragment {
  return ucSql`WITH done AS (
  UPDATE mapping_processes p SET position = ${placeAt(processesOf(scope, op.processId), { beforeId: op.beforeId })}, updated_at = now()
  WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}
  RETURNING 1)
${OUTCOME_DONE}`;
}

/** Solo un processo senza passi: con dei passi resta dov'è, e l'operazione risulta `gone`. */
function processRemove(scope: BoardScope, op: Op<"process.remove">): SqlFragment {
  return ucSql`WITH done AS (
  DELETE FROM mapping_processes p
  WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}
    AND NOT EXISTS (SELECT 1 FROM mapping_steps s WHERE s.process_id = p.id AND s.department_id = p.department_id AND s.workspace_id = p.workspace_id)
  RETURNING 1)
${OUTCOME_DONE}`;
}

/** I voti di chi salva, valore assoluto: ognuno scrive solo la sua riga; zero la toglie. */
function processVote(scope: BoardScope, actor: BoardActor, op: Op<"process.vote">): SqlFragment {
  return ucSql`WITH target AS (
  SELECT p.id AS process_id, p.workspace_id, p.department_id, u.id AS user_id
  FROM mapping_processes p JOIN users u ON u.id = ${U(actor.userId)}
  WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}),
cleared AS (
  DELETE FROM mapping_votes v USING target
  WHERE ${N(op.mine)} = 0 AND v.process_id = target.process_id AND v.user_id = target.user_id AND v.department_id = target.department_id AND v.workspace_id = target.workspace_id
  RETURNING 1),
done AS (
  INSERT INTO mapping_votes (process_id, user_id, workspace_id, department_id, votes)
  SELECT target.process_id, target.user_id, target.workspace_id, target.department_id, ${N(op.mine)} FROM target WHERE ${N(op.mine)} > 0
  ON CONFLICT (process_id, user_id) DO UPDATE SET votes = EXCLUDED.votes, updated_at = now()
  RETURNING 1)
SELECT CASE WHEN EXISTS (SELECT 1 FROM target) THEN 'ok' ELSE 'gone' END AS outcome`;
}

function stepAdd(scope: BoardScope, actor: BoardActor, op: Op<"step.add">): SqlFragment {
  const defaults = ACTOR_DEFAULTS[actor.kind];
  return ucSql`WITH proc AS (SELECT p.id, p.department_id, p.workspace_id FROM mapping_processes p WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}),
was AS (SELECT 1 FROM mapping_steps s WHERE s.activity_id = ${U(op.stepId)} AND ${inUnit("s", scope)}),
room AS (
  SELECT (SELECT count(*) FROM mapping_steps s WHERE ${inUnit("s", scope)})::int AS in_unit,
         (SELECT count(*) FROM mapping_steps s WHERE s.process_id = ${U(op.processId)} AND ${inUnit("s", scope)})::int AS in_process),
act AS (
  INSERT INTO activities (id, department_id, workspace_id, title)
  SELECT ${U(op.stepId)}, proc.department_id, proc.workspace_id, ${T(op.title)}
  FROM proc, room WHERE room.in_unit < ${N(L.stepsPerUnit)} AND room.in_process < ${N(L.stepsPerProcess)}
  ON CONFLICT (id) DO NOTHING RETURNING id, department_id, workspace_id),
done AS (
  INSERT INTO mapping_steps (activity_id, workspace_id, department_id, process_id, position, status, origin)
  SELECT act.id, act.workspace_id, act.department_id, ${U(op.processId)}, ${placeAt(stepsOf(scope, op.processId), { beforeId: op.beforeId, afterId: op.afterId })}, ${T(defaults.stepStatus)}, ${T(defaults.origin)}
  FROM act
  ON CONFLICT (activity_id) DO NOTHING RETURNING 1)
SELECT CASE WHEN EXISTS (SELECT 1 FROM done) OR EXISTS (SELECT 1 FROM was) THEN 'ok'
            WHEN NOT EXISTS (SELECT 1 FROM proc) THEN 'gone'
            WHEN (SELECT in_unit >= ${N(L.stepsPerUnit)} OR in_process >= ${N(L.stepsPerProcess)} FROM room) THEN 'limit'
            ELSE 'gone' END AS outcome`;
}

function stepSet(scope: BoardScope, op: Op<"step.set">): SqlFragment {
  const spec = STEP_FIELDS[op.field];
  const alias = spec.table === "activities" ? "a" : "s";
  const row = ucSql`${ref(`${alias}.${spec.table === "activities" ? "id" : "activity_id"}`)} = ${U(op.stepId)} AND ${inUnit(alias, scope)}`;
  const table = ucSql`${raw(spec.table)} ${raw(alias)}`;
  return ucSql`WITH target AS (SELECT 1 FROM ${table} WHERE ${row}),
done AS (
  UPDATE ${table} SET ${raw(spec.column)} = ${spec.write(op.next)}, updated_at = now()
  WHERE ${row} AND (${spec.current} IS NOT DISTINCT FROM ${spec.param(op.prev)} OR ${spec.current} IS NOT DISTINCT FROM ${spec.param(op.next)})
  RETURNING 1)
${OUTCOME_SET}`;
}

function stepMove(scope: BoardScope, op: Op<"step.move">): SqlFragment {
  return ucSql`WITH step AS (SELECT 1 FROM mapping_steps s WHERE s.activity_id = ${U(op.stepId)} AND ${inUnit("s", scope)}),
proc AS (SELECT 1 FROM mapping_processes p WHERE p.id = ${U(op.processId)} AND ${inUnit("p", scope)}),
room AS (SELECT count(*)::int AS n FROM mapping_steps s WHERE s.process_id = ${U(op.processId)} AND ${inUnit("s", scope)} AND s.activity_id <> ${U(op.stepId)}),
done AS (
  UPDATE mapping_steps s SET process_id = ${U(op.processId)}, position = ${placeAt(stepsOf(scope, op.processId, op.stepId), { beforeId: op.beforeId })}, updated_at = now()
  WHERE s.activity_id = ${U(op.stepId)} AND ${inUnit("s", scope)} AND EXISTS (SELECT 1 FROM proc) AND (SELECT n FROM room) < ${N(L.stepsPerProcess)}
  RETURNING 1)
SELECT CASE WHEN EXISTS (SELECT 1 FROM done) THEN 'ok' WHEN NOT EXISTS (SELECT 1 FROM step) OR NOT EXISTS (SELECT 1 FROM proc) THEN 'gone' ELSE 'limit' END AS outcome`;
}

/**
 * Elimina l'attività: la riga del passo, le note, le dipendenze e il nodo della value map vanno con lei (ON DELETE
 * CASCADE). Rifiutata (`linked`) se uno use case del workspace la elenca in `related_activity_ids`, visibile o no a
 * chi chiede.
 */
function stepRemove(scope: BoardScope, op: Op<"step.remove">): SqlFragment {
  return ucSql`WITH target AS (SELECT 1 FROM activities a WHERE a.id = ${U(op.stepId)} AND ${inUnit("a", scope)}),
linked AS (
  SELECT 1 FROM use_cases u
  WHERE u.workspace_id = ${U(scope.workspaceId)} AND jsonb_typeof(u.related_activity_ids) = 'array' AND u.related_activity_ids @> jsonb_build_array(${T(op.stepId)})
  LIMIT 1),
done AS (
  DELETE FROM activities a
  WHERE a.id = ${U(op.stepId)} AND ${inUnit("a", scope)} AND NOT EXISTS (SELECT 1 FROM linked)
  RETURNING 1)
SELECT CASE WHEN EXISTS (SELECT 1 FROM done) THEN 'ok' WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'gone' ELSE 'linked' END AS outcome`;
}

/** Lo stream di un passo, scelto da un revisore. La confidenza resta: descrive la proposta del classificatore. */
function stepStream(scope: BoardScope, op: Op<"step.stream">): SqlFragment {
  const current = streamFold("a.classification");
  return ucSql`WITH target AS (SELECT 1 FROM activities a WHERE a.id = ${U(op.stepId)} AND ${inUnit("a", scope)}),
done AS (
  UPDATE activities a SET classification = ${T(op.next)}::classification, updated_at = now()
  WHERE a.id = ${U(op.stepId)} AND ${inUnit("a", scope)} AND (${current} IS NOT DISTINCT FROM ${T(op.prev)} OR ${current} IS NOT DISTINCT FROM ${T(op.next)})
  RETURNING 1)
${OUTCOME_SET}`;
}

/** Ogni passo dell'unità che ha una proposta torna allo stream proposto. */
function streamsReset(scope: BoardScope): SqlFragment {
  return ucSql`WITH done AS (
  UPDATE activities a SET classification = s.proposed_stream::classification, updated_at = now()
  FROM mapping_steps s
  WHERE s.activity_id = a.id AND s.department_id = a.department_id AND s.workspace_id = a.workspace_id AND ${inUnit("a", scope)}
    AND s.proposed_stream IS NOT NULL AND ${streamFold("a.classification")} IS DISTINCT FROM s.proposed_stream
  RETURNING 1)
SELECT 'ok' AS outcome`;
}

function noteAdd(scope: BoardScope, actor: BoardActor, op: Op<"note.add">): SqlFragment {
  const defaults = ACTOR_DEFAULTS[actor.kind];
  const ofBoard = op.stepId === null;
  const max = ofBoard ? L.analysisPoints : L.notesPerLane;
  // Il genitore: l'unità per un punto di analisi, l'attività (di questa unità) per una nota di un passo.
  const parent = ofBoard
    ? ucSql`SELECT NULL::uuid AS activity_id, d.id AS department_id, d.workspace_id FROM departments d WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)}`
    : ucSql`SELECT a.id AS activity_id, a.department_id, a.workspace_id FROM activities a WHERE a.id = ${U(op.stepId)} AND ${inUnit("a", scope)}`;
  return ucSql`WITH parent AS (${parent}),
was AS (SELECT 1 FROM mapping_notes n WHERE n.id = ${U(op.noteId)} AND ${inUnit("n", scope)}),
room AS (SELECT count(*)::int AS n FROM mapping_notes n WHERE ${notesOf(scope, op.stepId, op.lane).group("n")}),
done AS (
  INSERT INTO mapping_notes (id, workspace_id, department_id, activity_id, lane, title, body, status, origin, position)
  SELECT ${U(op.noteId)}, parent.workspace_id, parent.department_id, parent.activity_id, ${T(op.lane)}, ${T(ofBoard ? (op.title ?? null) : null)}, ${T(op.text)}, ${T(defaults.noteStatus)}, ${T(defaults.origin)},
         ${placeAt(notesOf(scope, op.stepId, op.lane), { beforeId: op.beforeId })}
  FROM parent, room WHERE room.n < ${N(max)}
  ON CONFLICT (id) DO NOTHING RETURNING 1)
SELECT CASE WHEN EXISTS (SELECT 1 FROM done) OR EXISTS (SELECT 1 FROM was) THEN 'ok' WHEN NOT EXISTS (SELECT 1 FROM parent) THEN 'gone' WHEN (SELECT n FROM room) >= ${N(max)} THEN 'limit' ELSE 'gone' END AS outcome`;
}

function noteSet(scope: BoardScope, op: Op<"note.set">): SqlFragment {
  const column = raw(op.field === "text" ? "body" : op.field === "title" ? "title" : "status");
  // Solo un punto di analisi ha un titolo (CHECK mapping_notes_title_lane_check): sulle altre note non si scrive.
  const onlyAnalysis = op.field === "title" ? raw(` AND n.lane = '${BOARD_LANE}'`) : raw("");
  return ucSql`WITH target AS (SELECT 1 FROM mapping_notes n WHERE n.id = ${U(op.noteId)} AND ${inUnit("n", scope)}),
done AS (
  UPDATE mapping_notes n SET ${column} = ${T(op.next)}, updated_at = now()
  WHERE n.id = ${U(op.noteId)} AND ${inUnit("n", scope)}${onlyAnalysis} AND (n.${column} IS NOT DISTINCT FROM ${T(op.prev)} OR n.${column} IS NOT DISTINCT FROM ${T(op.next)})
  RETURNING 1)
${OUTCOME_SET}`;
}

/** Una nota già sparita conta come eliminata. */
function noteRemove(scope: BoardScope, op: Op<"note.remove">): SqlFragment {
  return ucSql`WITH done AS (DELETE FROM mapping_notes n WHERE n.id = ${U(op.noteId)} AND ${inUnit("n", scope)} RETURNING 1)
SELECT 'ok' AS outcome`;
}

function boardSet(scope: BoardScope, op: Op<"board.set">): SqlFragment {
  return ucSql`WITH target AS (SELECT 1 FROM mapping_boards b WHERE ${inUnit("b", scope)}),
done AS (
  UPDATE mapping_boards b SET headline = ${T(op.next)}
  WHERE ${inUnit("b", scope)} AND (b.headline IS NOT DISTINCT FROM ${T(op.prev)} OR b.headline IS NOT DISTINCT FROM ${T(op.next)})
  RETURNING 1)
${OUTCOME_SET}`;
}

/** L'istruzione di un'operazione: una sola, che restituisce una riga con `outcome`. */
export function opStatement(scope: BoardScope, actor: BoardActor, op: BoardOp): UcStatement {
  switch (op.t) {
    case "process.add":
      return toStatement(processAdd(scope, op));
    case "process.set":
      return toStatement(processSet(scope, op));
    case "process.move":
      return toStatement(processMove(scope, op));
    case "process.remove":
      return toStatement(processRemove(scope, op));
    case "process.vote":
      return toStatement(processVote(scope, actor, op));
    case "step.add":
      return toStatement(stepAdd(scope, actor, op));
    case "step.set":
      return toStatement(stepSet(scope, op));
    case "step.move":
      return toStatement(stepMove(scope, op));
    case "step.remove":
      return toStatement(stepRemove(scope, op));
    case "step.stream":
      return toStatement(stepStream(scope, op));
    case "streams.reset":
      return toStatement(streamsReset(scope));
    case "note.add":
      return toStatement(noteAdd(scope, actor, op));
    case "note.set":
      return toStatement(noteSet(scope, op));
    case "note.remove":
      return toStatement(noteRemove(scope, op));
    case "board.set":
      return toStatement(boardSet(scope, op));
  }
}

// ─── Testa e coda di un salvataggio (R5) ─────────────────────────────

/** La riga della board, se manca (un'unità senza passi non ne ha ancora una). */
export function ensureBoardRow(scope: BoardScope): UcStatement {
  return toStatement(ucSql`INSERT INTO mapping_boards (department_id, workspace_id)
SELECT unit.department_id, unit.workspace_id FROM (${unitRow(scope)}) unit
ON CONFLICT (department_id) DO NOTHING`);
}

/** Le due corsie che hanno una colonna di sempre in `activities` (§3.6). */
export const PROJECTED_LANES = Object.freeze({ attriti: "pain_points", dati: "data_required" } as const);
export type ProjectedLane = keyof typeof PROJECTED_LANES;

/**
 * La copia di una corsia nella sua colonna di sempre: le note unite da un a capo, in ordine; senza note, NULL. Così il
 * classificatore, i report e il generatore di use case leggono quello che la board mostra. Solo dove il testo cambia.
 */
export function projectLane(scope: BoardScope, lane: ProjectedLane, stepIds: readonly string[]): UcStatement {
  const column = raw(PROJECTED_LANES[lane]);
  return toStatement(ucSql`UPDATE activities a SET ${column} = agg.body, updated_at = now()
FROM (
  SELECT x.id, (SELECT string_agg(n.body, chr(10) ORDER BY n.position, n.created_at, n.id) FROM mapping_notes n
                 WHERE n.activity_id = x.id AND n.department_id = x.department_id AND n.workspace_id = x.workspace_id AND n.lane = ${T(lane)}) AS body
  FROM activities x WHERE x.id = ANY(${cast([...stepIds], "uuid[]")}) AND ${inUnit("x", scope)}
) agg
WHERE a.id = agg.id AND ${inUnit("a", scope)} AND a.${column} IS DISTINCT FROM agg.body`);
}

/** I processi dell'unità da 1 a n, nell'ordine in cui sono. */
export function renumberProcesses(scope: BoardScope): UcStatement {
  return toStatement(ucSql`UPDATE mapping_processes p SET position = o.rn
FROM (SELECT x.id, row_number() OVER (ORDER BY x.position, x.created_at, x.id) AS rn FROM mapping_processes x WHERE ${inUnit("x", scope)}) o
WHERE p.id = o.id AND ${inUnit("p", scope)} AND p.position IS DISTINCT FROM o.rn`);
}

/** I passi di ogni processo dell'unità da 1 a n. */
export function renumberSteps(scope: BoardScope): UcStatement {
  return toStatement(ucSql`UPDATE mapping_steps s SET position = o.rn
FROM (SELECT x.activity_id, row_number() OVER (PARTITION BY x.process_id ORDER BY x.position, x.created_at, x.activity_id) AS rn FROM mapping_steps x WHERE ${inUnit("x", scope)}) o
WHERE s.activity_id = o.activity_id AND ${inUnit("s", scope)} AND s.position IS DISTINCT FROM o.rn`);
}

/** Le note di ogni corsia (e i punti di analisi) da 1 a n. */
export function renumberNotes(scope: BoardScope): UcStatement {
  return toStatement(ucSql`UPDATE mapping_notes n SET position = o.rn
FROM (SELECT x.id, row_number() OVER (PARTITION BY x.activity_id, x.lane ORDER BY x.position, x.created_at, x.id) AS rn FROM mapping_notes x WHERE ${inUnit("x", scope)}) o
WHERE n.id = o.id AND ${inUnit("n", scope)} AND n.position IS DISTINCT FROM o.rn`);
}

/** L'unità va «in corso» da sola quando ha il primo passo. Niente la riporta indietro. */
export function startUnit(scope: BoardScope): UcStatement {
  return toStatement(ucSql`UPDATE departments d SET mapping_status = 'in_progress'
WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)} AND d.mapping_status = 'not_started'
  AND EXISTS (SELECT 1 FROM mapping_steps s WHERE s.department_id = d.id AND s.workspace_id = d.workspace_id)`);
}

/** L'ultima istruzione di ogni salvataggio: la revisione sale di uno. Restituisce revisione e ora. */
export function bumpRevision(scope: BoardScope): UcStatement {
  return toStatement(ucSql`UPDATE mapping_boards b SET revision = b.revision + 1, updated_at = now()
WHERE ${inUnit("b", scope)}
RETURNING b.revision, b.updated_at`);
}

export interface SaveBatch {
  statements: UcStatement[];
  /** Per ogni operazione, il posto della sua istruzione in `statements`. */
  opAt: number[];
  /** Il posto dell'istruzione della revisione: l'ultima. */
  revisionAt: number;
}

/**
 * Tutte le istruzioni di un salvataggio, in ordine: la riga della board, un'istruzione per operazione, poi la coda
 * (R5). `touched`: i passi le cui note di «Attriti» e di «Dati e documenti» cambiano in questo salvataggio, oltre a
 * quelli che si leggono dalle `note.add` (per una nota modificata o eliminata il passo lo sa solo il database:
 * `noteLanes`).
 */
export function saveBatch(scope: BoardScope, actor: BoardActor, ops: readonly BoardOp[], touched: Readonly<Record<ProjectedLane, readonly string[]>> = { attriti: [], dati: [] }): SaveBatch {
  const statements: UcStatement[] = [ensureBoardRow(scope)];
  const opAt: number[] = [];
  const project: Record<ProjectedLane, Set<string>> = { attriti: new Set(touched.attriti), dati: new Set(touched.dati) };
  const kinds = new Set<string>();
  for (const op of ops) {
    opAt.push(statements.push(opStatement(scope, actor, op)) - 1);
    kinds.add(op.t);
    if (op.t === "note.add" && op.stepId && (op.lane === "attriti" || op.lane === "dati")) project[op.lane].add(op.stepId);
  }
  for (const lane of Object.keys(PROJECTED_LANES) as ProjectedLane[]) {
    if (project[lane].size > 0) statements.push(projectLane(scope, lane, [...project[lane]]));
  }
  if (kinds.has("process.add") || kinds.has("process.move") || kinds.has("process.remove")) statements.push(renumberProcesses(scope));
  if (kinds.has("step.add") || kinds.has("step.move") || kinds.has("step.remove")) statements.push(renumberSteps(scope));
  if (kinds.has("note.add") || kinds.has("note.remove")) statements.push(renumberNotes(scope));
  statements.push(startUnit(scope));
  const revisionAt = statements.push(bumpRevision(scope)) - 1;
  return { statements, opAt, revisionAt };
}

// ─── Letture ─────────────────────────────────────────────────────────

/** La 0039 c'è tutta? (La stessa sonda di `ensureDbSchema`.) */
export function storeProbe(): UcStatement {
  return toStatement(ucSql`SELECT ${raw(MAPPING_BOARD_PROBE_SQL)} AS ready`);
}

/** Prima di tutto: la 0039 c'è? L'unità è di quel workspace? Due istruzioni che non toccano le tabelle nuove. */
export function preflight(scope: BoardScope): UcStatement[] {
  return [storeProbe(), toStatement(ucSql`SELECT d.id FROM departments d WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)}`)];
}

/** In quale passo e corsia stanno queste note (per sapere quali colonne di sempre ricopiare). */
export function noteLanes(scope: BoardScope, noteIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT n.id, n.activity_id, n.lane FROM mapping_notes n
WHERE n.id = ANY(${cast([...noteIds], "uuid[]")}) AND ${inUnit("n", scope)} AND n.activity_id IS NOT NULL AND n.lane IN ('attriti', 'dati')`);
}

/** La revisione della board, senza leggere altro. */
export function revisionRead(scope: BoardScope): UcStatement {
  return toStatement(ucSql`SELECT coalesce((SELECT b.revision FROM mapping_boards b WHERE ${inUnit("b", scope)}), 0) AS revision`);
}

/** Le colonne di un passo come le legge la board: le stesse espressioni che `step.set` confronta. */
const STEP_READ_COLUMNS = ucSql`a.id, ${STEP_FIELDS.title.current} AS title, ${STEP_FIELDS.description.current} AS description, ${STEP_FIELDS.tools.current} AS tools,
  ${STEP_FIELDS.input.current} AS input, ${STEP_FIELDS.output.current} AS output, ${STEP_FIELDS.decision.current} AS decision,
  ${STEP_FIELDS.frequency.current} AS frequency, ${STEP_FIELDS.hoursWeek.current} AS hours_week, ${STEP_FIELDS.quality.current} AS quality, ${STEP_FIELDS.workType.current} AS work_type,
  a.classification::text AS classification, a.confidence_score, a.onet_task_id, a.ai_exposure_score`;

/**
 * Tutto quello che serve a una board, in cinque letture: l'unità con la riga della board, i processi con i voti, i
 * passi, le note, le dipendenze tra passi dell'unità. `viewerId`: per «i tuoi» voti.
 */
export function boardReads(scope: BoardScope, viewerId: string | null): UcStatement[] {
  return [
    toStatement(ucSql`SELECT d.id, d.name, d.description, d.team_size, d.mapping_status::text AS mapping_status, b.revision, b.headline, b.updated_at AS saved_at
FROM departments d LEFT JOIN mapping_boards b ON b.department_id = d.id AND b.workspace_id = d.workspace_id
WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)}`),
    toStatement(ucSql`SELECT p.id, p.name, p.owner,
  coalesce((SELECT sum(v.votes) FROM mapping_votes v WHERE v.process_id = p.id AND v.department_id = p.department_id AND v.workspace_id = p.workspace_id), 0)::int AS votes,
  coalesce((SELECT sum(v.votes) FROM mapping_votes v WHERE v.process_id = p.id AND v.department_id = p.department_id AND v.workspace_id = p.workspace_id AND v.user_id = ${U(viewerId)}), 0)::int AS my_votes
FROM mapping_processes p WHERE ${inUnit("p", scope)}
ORDER BY p.position, p.created_at, p.id`),
    toStatement(ucSql`SELECT ${STEP_READ_COLUMNS},
  s.process_id, ${STEP_FIELDS.who.current} AS who, s.exception_text, s.decision_label, s.friction_level, s.status, s.origin, s.proposed_stream, s.classification_reason, s.ai_potential, s.onet_title
FROM activities a JOIN mapping_steps s ON s.activity_id = a.id AND s.department_id = a.department_id AND s.workspace_id = a.workspace_id
WHERE ${inUnit("a", scope)}
ORDER BY s.position, s.created_at, a.id`),
    toStatement(ucSql`SELECT n.id, n.activity_id, n.lane, n.title, n.body, n.status, n.origin FROM mapping_notes n
WHERE ${inUnit("n", scope)}
ORDER BY n.position, n.created_at, n.id`),
    dependencyRead(scope),
  ];
}

/** Le dipendenze tra due attività di questa unità (`source` dipende da `target`). */
function dependencyRead(scope: BoardScope): UcStatement {
  return toStatement(ucSql`SELECT dep.source_activity_id, dep.target_activity_id
FROM activity_dependencies dep
JOIN activities a ON a.id = dep.source_activity_id
JOIN activities t ON t.id = dep.target_activity_id
WHERE ${inUnit("a", scope)} AND t.department_id = a.department_id AND t.workspace_id = a.workspace_id`);
}

/**
 * Senza la 0039: l'unità, le sue attività nell'ordine di creazione e le dipendenze. Nessuna tabella nuova. Le note di
 * «Attriti» e «Dati e documenti» si leggono dalle colonne di sempre.
 */
export function activitiesOnlyReads(scope: BoardScope): UcStatement[] {
  return [
    toStatement(ucSql`SELECT d.id, d.name, d.description, d.team_size, d.mapping_status::text AS mapping_status
FROM departments d WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)}`),
    toStatement(ucSql`SELECT ${STEP_READ_COLUMNS}, ${textOrNull("a.pain_points")} AS pain_points, ${textOrNull("a.data_required")} AS data_required, a.created_at
FROM activities a WHERE ${inUnit("a", scope)}
ORDER BY a.created_at, a.id`),
    dependencyRead(scope),
  ];
}

// ─── Adozione (§3.5) ─────────────────────────────────────────────────

/** L'id del processo «Processo principale» di un'unità: sempre lo stesso, così due adozioni insieme ne creano uno. */
export const defaultProcessIdSql = (department: string) => raw(`md5(${department}::text || ':processo')::uuid`);

/** Che cosa c'è da adottare: le attività senza riga del passo, i passi rimasti senza processo, le dipendenze. */
export function adoptionReads(scope: BoardScope): UcStatement[] {
  return [
    toStatement(ucSql`SELECT a.id, a.created_at FROM activities a
WHERE ${inUnit("a", scope)} AND NOT EXISTS (SELECT 1 FROM mapping_steps s WHERE s.activity_id = a.id)
ORDER BY a.created_at, a.id`),
    toStatement(ucSql`SELECT count(*)::int AS loose FROM mapping_steps s WHERE ${inUnit("s", scope)} AND s.process_id IS NULL`),
    dependencyRead(scope),
  ];
}

const firstProcess = (scope: BoardScope) => ucSql`(SELECT p.id FROM mapping_processes p WHERE ${inUnit("p", scope)} ORDER BY p.position, p.created_at, p.id LIMIT 1)`;

/**
 * L'adozione in una transazione: la riga della board; «Processo principale» se l'unità non ha processi; i passi rimasti
 * senza processo nel primo; una riga del passo per ogni attività di `orderedIds`, nel loro ordine, in fondo al primo
 * processo; una nota di «Attriti» e una di «Dati e documenti» dalle colonne di sempre, con un id che dipende solo
 * dall'attività e dalla corsia. Non cambia nessuna colonna di `activities` e non alza la revisione.
 * L'ultima istruzione restituisce le righe dei passi inserite.
 */
export function adoptionWrites(scope: BoardScope, orderedIds: readonly string[], defaultProcessName: string): UcStatement[] {
  const ids = cast([...orderedIds], "uuid[]");
  const note = (lane: ProjectedLane) =>
    toStatement(ucSql`INSERT INTO mapping_notes (id, workspace_id, department_id, activity_id, lane, body, status, origin, position)
SELECT md5(a.id::text || ${T(`:${lane}`)})::uuid, a.workspace_id, a.department_id, a.id, ${T(lane)}, left(btrim(a.${raw(PROJECTED_LANES[lane])}), ${N(L.note)}), 'fonte', 'prima', 1
FROM activities a
WHERE a.id = ANY(${ids}) AND ${inUnit("a", scope)} AND btrim(coalesce(a.${raw(PROJECTED_LANES[lane])}, '')) <> ''
ON CONFLICT (id) DO NOTHING`);
  return [
    ensureBoardRow(scope),
    toStatement(ucSql`INSERT INTO mapping_processes (id, workspace_id, department_id, name, position)
SELECT ${defaultProcessIdSql("unit.department_id")}, unit.workspace_id, unit.department_id, ${T(defaultProcessName)}, 1
FROM (${unitRow(scope)}) unit
WHERE NOT EXISTS (SELECT 1 FROM mapping_processes p WHERE p.department_id = unit.department_id AND p.workspace_id = unit.workspace_id)
ON CONFLICT (id) DO NOTHING`),
    toStatement(ucSql`UPDATE mapping_steps s SET process_id = ${firstProcess(scope)}, position = o.place, updated_at = now()
FROM (
  SELECT x.activity_id,
         coalesce((SELECT max(m.position) FROM mapping_steps m WHERE ${inUnit("m", scope)} AND m.process_id = ${firstProcess(scope)}), 0)
           + row_number() OVER (ORDER BY x.position, x.created_at, x.activity_id) AS place
  FROM mapping_steps x WHERE ${inUnit("x", scope)} AND x.process_id IS NULL
) o
WHERE s.activity_id = o.activity_id AND ${inUnit("s", scope)} AND s.process_id IS NULL`),
    note("attriti"),
    note("dati"),
    toStatement(ucSql`INSERT INTO mapping_steps (activity_id, workspace_id, department_id, process_id, position, status, origin)
SELECT a.id, a.workspace_id, a.department_id, ${firstProcess(scope)},
       coalesce((SELECT max(m.position) FROM mapping_steps m WHERE ${inUnit("m", scope)} AND m.process_id = ${firstProcess(scope)}), 0) + o.ord,
       'da_validare', 'prima'
FROM unnest(${ids}) WITH ORDINALITY AS o(id, ord)
JOIN activities a ON a.id = o.id AND ${inUnit("a", scope)}
ON CONFLICT (activity_id) DO NOTHING
RETURNING activity_id`),
  ];
}

// ─── Processi per nome ───────────────────────────────────────────────

/** I processi dell'unità, in ordine, con il nome. */
export function processNames(scope: BoardScope): UcStatement {
  return toStatement(ucSql`SELECT p.id, p.name FROM mapping_processes p WHERE ${inUnit("p", scope)} ORDER BY p.position, p.created_at, p.id`);
}

// ─── Le unità di un workspace (S1) ───────────────────────────────────

/**
 * Una riga per unità, con i numeri della sua board, in una lettura sola. Non adotta: conta con un LEFT JOIN, e
 * un'attività senza riga del passo conta come «da validare». `withBoard` falso: senza la 0039, dalle sole attività.
 */
export function unitBoards(workspaceId: string, withBoard: boolean): UcStatement {
  const fold = streamFold("a.classification");
  const streams = join(STREAMS.map((stream) => ucSql`(count(a.id) FILTER (WHERE ${fold} = ${T(stream)}))::int AS ${raw(stream)}`));
  const toValidate = withBoard ? raw("(count(a.id) FILTER (WHERE s.status IS DISTINCT FROM 'confermato'))::int") : raw("count(a.id)::int");
  const processes = withBoard
    ? raw("(SELECT count(*) FROM mapping_processes p WHERE p.department_id = d.id AND p.workspace_id = d.workspace_id)::int")
    : raw("0");
  const stepJoin = withBoard ? raw("LEFT JOIN mapping_steps s ON s.activity_id = a.id AND s.department_id = a.department_id AND s.workspace_id = a.workspace_id") : raw("");
  return toStatement(ucSql`SELECT d.id, d.name, d.description, d.team_size, d.mapping_status::text AS mapping_status,
  ${processes} AS processes, count(a.id)::int AS steps, coalesce(sum(a.time_spent_hours_week), 0)::float8 AS hours_week,
  ${toValidate} AS to_validate, (count(a.id) FILTER (WHERE ${fold} IS NULL))::int AS unclassified, ${streams}
FROM departments d
LEFT JOIN activities a ON a.department_id = d.id AND a.workspace_id = d.workspace_id
${stepJoin}
WHERE d.workspace_id = ${U(workspaceId)}
GROUP BY d.id
ORDER BY d.name, d.id`);
}

/** L'unità ha almeno un documento caricato? (La pagina mostra «Proponi passi dai documenti».) */
export function unitDocuments(scope: BoardScope): UcStatement {
  return toStatement(ucSql`SELECT EXISTS (SELECT 1 FROM uploaded_documents u WHERE ${inUnit("u", scope)}) AS has`);
}

// ─── Le dipendenze tra passi (il tool `linkActivityDependency`, §5.1) ─────

/**
 * Una dipendenza tra due passi, in un'istruzione: si scrive solo se le due attività sono di questo workspace e quella
 * che dipende è di questa unità (quella da cui dipende può stare in un'altra unità dello stesso workspace); una coppia
 * già presente non cambia niente; un passo non dipende da sé. Se la coppia è nuova la board sale di revisione, così la
 * rilettura dalla board aperta la porta. `linked`: le due attività ci sono, e sono due.
 */
export function linkDependencyStatement(scope: BoardScope, sourceId: string, targetId: string, type: string | null): UcStatement {
  const ws = cast(scope.workspaceId, "uuid");
  const unit = cast(scope.departmentId, "uuid");
  return toStatement(ucSql`WITH src AS (SELECT a.id FROM activities a WHERE a.id = ${cast(sourceId, "uuid")} AND a.department_id = ${unit} AND a.workspace_id = ${ws}),
tgt AS (SELECT a.id FROM activities a WHERE a.id = ${cast(targetId, "uuid")} AND a.workspace_id = ${ws}),
done AS (
  INSERT INTO activity_dependencies (source_activity_id, target_activity_id, dependency_type)
  SELECT src.id, tgt.id, ${cast(type, "text")} FROM src, tgt WHERE src.id <> tgt.id
  ON CONFLICT (source_activity_id, target_activity_id) DO NOTHING
  RETURNING 1),
board AS (
  UPDATE mapping_boards b SET revision = b.revision + 1, updated_at = now()
  WHERE b.department_id = ${unit} AND b.workspace_id = ${ws} AND EXISTS (SELECT 1 FROM done)
  RETURNING 1)
SELECT EXISTS (SELECT 1 FROM src, tgt WHERE src.id <> tgt.id) AS linked`);
}

// ─── Completamento (§4.5) ────────────────────────────────────────────

/** L'unità e quello che serve al classificatore: il nome, la value thesis dell'organizzazione, gli obiettivi, le attività. */
export function completionReads(scope: BoardScope): UcStatement[] {
  return [
    toStatement(ucSql`SELECT d.name, o.company_value_thesis
FROM departments d JOIN workspaces w ON w.id = d.workspace_id LEFT JOIN organizations o ON o.id = w.organization_id
WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)}`),
    toStatement(ucSql`SELECT g.* FROM strategic_goals g WHERE g.workspace_id = ${U(scope.workspaceId)} ORDER BY g.created_at, g.id`),
    toStatement(ucSql`SELECT a.* FROM activities a JOIN mapping_steps s ON s.activity_id = a.id AND s.department_id = a.department_id AND s.workspace_id = a.workspace_id
WHERE ${inUnit("a", scope)}
ORDER BY s.position, a.created_at, a.id`),
  ];
}

/**
 * «Mappatura completa», una volta sola: l'unità passa a `mapped` se era da iniziare o in corso; solo allora la board
 * prende l'ora, la revisione sale e nasce la riga della campanella per il workspace. `first` dice se è successo.
 */
export function markMapped(scope: BoardScope, signal: { type: string; title: string; description: string }): UcStatement {
  return toStatement(ucSql`WITH done AS (
  UPDATE departments d SET mapping_status = 'mapped'
  WHERE d.id = ${U(scope.departmentId)} AND d.workspace_id = ${U(scope.workspaceId)} AND d.mapping_status IN ('not_started', 'in_progress')
  RETURNING d.id AS department_id, d.workspace_id),
board AS (
  INSERT INTO mapping_boards (department_id, workspace_id, completed_at, revision)
  SELECT done.department_id, done.workspace_id, now(), 1 FROM done
  ON CONFLICT (department_id) DO UPDATE SET completed_at = now(), revision = mapping_boards.revision + 1, updated_at = now()
  RETURNING 1),
bell AS (
  INSERT INTO weekly_signals (workspace_id, signal_type, title, description, related_entity_type, related_entity_id)
  SELECT done.workspace_id, ${T(signal.type)}, left(${T(signal.title)}, 500), ${T(signal.description)}, 'department', done.department_id FROM done
  RETURNING 1)
SELECT EXISTS (SELECT 1 FROM done) AS first`);
}

/**
 * La sintesi scritta dall'assistente alla fine: la frase solo se la board non ne ha una; i punti di analisi al posto di
 * quelli venuti dalla chat che nessuno ha validato, mai oltre il massimo, mai toccando un punto validato o scritto da
 * una persona. `points` porta l'id di ogni punto, già deciso da chi chiama.
 */
export function saveSummary(scope: BoardScope, summary: { headline: string | null; points: ReadonlyArray<{ id: string; title: string | null; text: string }> | null }): UcStatement[] {
  const statements: UcStatement[] = [ensureBoardRow(scope)];
  if (summary.headline) {
    statements.push(toStatement(ucSql`UPDATE mapping_boards b SET headline = ${T(summary.headline)} WHERE ${inUnit("b", scope)} AND b.headline IS NULL`));
  }
  if (summary.points) {
    statements.push(
      toStatement(ucSql`DELETE FROM mapping_notes n WHERE ${inUnit("n", scope)} AND n.activity_id IS NULL AND n.lane = ${T(BOARD_LANE)} AND n.origin = 'chat' AND n.status <> 'validato'`),
    );
    if (summary.points.length > 0) {
      statements.push(
        toStatement(ucSql`INSERT INTO mapping_notes (id, workspace_id, department_id, activity_id, lane, title, body, status, origin, position)
SELECT i.id, unit.workspace_id, unit.department_id, NULL, ${T(BOARD_LANE)}, i.title, i.body, 'fonte', 'chat', kept.last + i.ord
FROM (${unitRow(scope)}) unit,
     (SELECT count(*)::int AS n, coalesce(max(n.position), 0) AS last FROM mapping_notes n WHERE ${inUnit("n", scope)} AND n.activity_id IS NULL AND n.lane = ${T(BOARD_LANE)}) kept,
     jsonb_to_recordset(${jsonb(summary.points.map((point, index) => ({ id: point.id, title: point.title, body: point.text, ord: index + 1 })))}) AS i(id uuid, title text, body text, ord int)
WHERE kept.n + i.ord <= ${N(L.analysisPoints)}
ON CONFLICT (id) DO NOTHING`),
      );
    }
  }
  statements.push(bumpRevision(scope));
  return statements;
}

export interface ClassificationRow {
  id: string;
  stream: string;
  confidence: number;
  reason: string;
  potential: string;
}

/**
 * Scrive le classificazioni: lo stream e la confidenza nelle colonne di sempre (solo dove lo stream manca ancora: una
 * scelta fatta nel frattempo da una persona resta), e sulla riga del passo la proposta, il motivo e il potenziale.
 * Solo attività di quel workspace; con `departmentId`, solo di quell'unità. `withBoard` falso: senza la 0039, le sole
 * colonne di sempre. Restituisce `n`, le attività scritte.
 */
export function saveClassifications(scope: { workspaceId: string; departmentId?: string | null }, rows: readonly ClassificationRow[], withBoard: boolean): UcStatement {
  const inScope = (alias: string) =>
    scope.departmentId
      ? ucSql`${ref(`${alias}.department_id`)} = ${U(scope.departmentId)} AND ${ref(`${alias}.workspace_id`)} = ${U(scope.workspaceId)}`
      : ucSql`${ref(`${alias}.workspace_id`)} = ${U(scope.workspaceId)}`;
  const input = ucSql`input AS (SELECT * FROM jsonb_to_recordset(${jsonb(rows)}) AS i(id uuid, stream text, confidence real, reason text, potential text) WHERE i.stream IN (${raw(STREAMS.map((stream) => `'${stream}'`).join(", "))}))`;
  const activity = ucSql`act AS (
  UPDATE activities a SET classification = input.stream::classification, confidence_score = input.confidence, updated_at = now()
  FROM input WHERE a.id = input.id AND ${inScope("a")} AND a.classification IS NULL
  RETURNING a.id)`;
  if (!withBoard) return toStatement(ucSql`WITH ${input}, ${activity} SELECT count(*)::int AS n FROM act`);
  return toStatement(ucSql`WITH ${input}, ${activity},
step AS (
  UPDATE mapping_steps s SET proposed_stream = input.stream, classification_reason = left(input.reason, ${N(L.description)}), ai_potential = left(input.potential, ${N(L.description)}), updated_at = now()
  FROM input WHERE s.activity_id = input.id AND ${inScope("s")}
  RETURNING 1),
board AS (
  UPDATE mapping_boards b SET revision = b.revision + 1, updated_at = now()
  WHERE b.workspace_id = ${U(scope.workspaceId)} AND b.department_id IN (SELECT s.department_id FROM mapping_steps s JOIN input ON input.id = s.activity_id WHERE ${inScope("s")})
  RETURNING 1)
SELECT count(*)::int AS n FROM act`);
}

/** Le unità che hanno, tra queste attività del workspace, almeno una senza riga del passo (da adottare prima di scrivere). */
export function unitsToAdopt(workspaceId: string, activityIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT a.department_id FROM activities a
JOIN departments d ON d.id = a.department_id AND d.workspace_id = a.workspace_id
WHERE a.workspace_id = ${U(workspaceId)} AND a.id = ANY(${cast([...activityIds], "uuid[]")})
  AND NOT EXISTS (SELECT 1 FROM mapping_steps s WHERE s.activity_id = a.id)`);
}

export interface OnetRow {
  id: string;
  code: string;
  title: string;
  exposure: number;
}

/**
 * Scrive il match O*NET: codice ed esposizione nelle colonne di sempre, il titolo dell'occupazione sulla riga del
 * passo. Solo per gli id che sono passi di questa unità e che non hanno ancora un codice: un id inventato dal modello
 * non tocca niente. Restituisce `n`, i passi scritti.
 */
export function saveOnetMatches(scope: BoardScope, rows: readonly OnetRow[], onetTitleMax: number): UcStatement {
  return toStatement(ucSql`WITH input AS (SELECT * FROM jsonb_to_recordset(${jsonb(rows)}) AS i(id uuid, code text, title text, exposure real)),
act AS (
  UPDATE activities a SET onet_task_id = left(input.code, 50), ai_exposure_score = least(1, greatest(0, input.exposure)), updated_at = now()
  FROM input WHERE a.id = input.id AND ${inUnit("a", scope)} AND a.onet_task_id IS NULL AND btrim(coalesce(input.code, '')) <> ''
    AND EXISTS (SELECT 1 FROM mapping_steps s WHERE s.activity_id = a.id AND s.department_id = a.department_id AND s.workspace_id = a.workspace_id)
  RETURNING a.id),
step AS (
  UPDATE mapping_steps s SET onet_title = nullif(left(btrim(input.title), ${N(onetTitleMax)}), ''), updated_at = now()
  FROM input WHERE s.activity_id = input.id AND ${inUnit("s", scope)} AND s.activity_id IN (SELECT id FROM act)
  RETURNING 1),
board AS (UPDATE mapping_boards b SET revision = b.revision + 1, updated_at = now() WHERE ${inUnit("b", scope)} AND EXISTS (SELECT 1 FROM act) RETURNING 1)
SELECT count(*)::int AS n FROM act`);
}
