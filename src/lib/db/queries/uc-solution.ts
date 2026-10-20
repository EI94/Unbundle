/**
 * Letture di Soluzione (DESIGN §3.7, WP4): Descrizione, Mappa, Regole e Dati.
 *
 * Un giro per pagina (una transazione). Regole e Dati sono cercati, filtrati e
 * paginati nel database (P0-5 d): al client arrivano le righe di una pagina,
 * mai gli array dei collegamenti, che si leggono solo per la voce aperta nel
 * pannello (`?apri=`). La Descrizione non calcola la prontezza dal vivo: legge
 * solo descrizione, cronologia, autori e la frase del perimetro.
 *
 * L'accesso al workspace e al caso lo controlla la pagina prima di chiamare
 * queste funzioni (`requireWorkspacePage(` e `requireDossierRole`); qui ogni
 * SELECT è filtrata per caso (e per workspace dove serve). Mai valori delle
 * risposte. Le vecchie letture di `uc-views.ts` non ci sono più (DESIGN §8.3
 * WP13).
 *
 * Modulo senza import dell'app, come `uc-views.ts`: l'esecutore arriva da fuori.
 */
import { rowJson, rowNumber, rowObject, rowString, type Row } from "../../uc/sql/readiness.ts";
import { cast, join, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { templateKeyListSql } from "../../uc/sql/template-parts.ts";
import type { Json } from "../../uc/types.ts";
import { parseDescriptionHistory, type DescriptionHistoryEntry } from "../../uc/views/description.ts";
import { buildMaps, parseMapRows, type MapsView } from "../../uc/views/map.ts";
import {
  CONSTRAINT_KINDS,
  DATA_VIEW_KINDS,
  RULE_KINDS,
  SOLUTION_PAGE_SIZE,
  buildModelItems,
  pageCount,
  pageOffset,
  ruleConfirmations,
  ruleGroups,
  ruleKindsFor,
  rowsToDataRows,
  rowsToFields,
  rowsToRuleGroupCounts,
  rowsToRuleRows,
  rowsToTestCases,
  statusesOfGroup,
  type DataQuery,
  type DataRow,
  type DataView,
  type FieldView,
  type ItemRef,
  type ModelItemView,
  type RuleConfirmation,
  type RuleGroup,
  type RulesQuery,
  type TestCaseView,
} from "../../uc/views/model.ts";
import { rowToContact, type CaseViewContext } from "../../uc/views/rows.ts";
import { contactsSql, currentMapsSql } from "../../uc/views/sql.ts";
import { audienceFor, isLsViewer } from "../../uc/views/status-groups.ts";
import type { ItemKind } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";
import { caseViewContextReader, type UcViewer } from "./uc-views.ts";

const uuid = (v: string) => cast(v, "uuid");
const kindsParam = (kinds: readonly ItemKind[]) => cast([...kinds], "text[]");

/**
 * La voce si apre dopo la scheda privacy: ha il blocco `a8` attivo, oppure è
 * disponibile solo dopo la scheda privacy e il blocco del caso è ancora
 * attivo. Alias interni (`i` o `f`), mai input.
 */
function lockedSql(alias: "i" | "f"): SqlFragment {
  return raw(`(EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
    WHERE ib.item_id = ${alias}.id AND b.key = 'a8' AND b.status IN ('attivo', 'permanente'))
  OR (${alias}.availability @> '["dopo_a8"]'::jsonb AND EXISTS (SELECT 1 FROM uc_blockers b
    WHERE b.case_id = ${alias}.case_id AND b.key = 'a8' AND b.status IN ('attivo', 'permanente'))))`);
}

/** Ricerca nel database (come quella di Domande): titolo e chiave, più la spiegazione dove serve. */
function searchSql(q: string | null, withExplanation: boolean): SqlFragment | null {
  if (!q) return null;
  const needle = cast(q.toLowerCase(), "text");
  return withExplanation
    ? ucSql`(strpos(lower(i.title), ${needle}) > 0 OR strpos(lower(i.key), ${needle}) > 0 OR strpos(lower(coalesce(i.explanation, '')), ${needle}) > 0)`
    : ucSql`(strpos(lower(i.title), ${needle}) > 0 OR strpos(lower(i.key), ${needle}) > 0)`;
}

function andAll(parts: readonly (SqlFragment | null)[]): SqlFragment {
  return join(
    parts.filter((p): p is SqlFragment => p !== null),
    " AND ",
  );
}

/** Una voce del caso per id o per chiave (`?apri=`). */
function refSql(alias: "i" | "x", ref: ItemRef): SqlFragment {
  return "id" in ref ? ucSql`${raw(alias)}.id = ${uuid(ref.id)}` : ucSql`${raw(alias)}.key = ${cast(ref.key, "text")}`;
}

// ── Descrizione ───────────────────────────────────────────────────────

export interface SolutionDescriptionData {
  description: Record<string, Json>;
  history: DescriptionHistoryEntry[];
  /** Nomi degli autori delle versioni (id utente → nome). */
  authors: Map<string, string>;
  /** Etichetta del perimetro del contratto (`uc_cases.perimeter_label`). */
  perimeterLabel: string | null;
}

export function solutionDescriptionSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.description, c.description_history, c.perimeter_label,
  (SELECT coalesce(jsonb_object_agg(u.id::text, coalesce(u.name, u.email)), '{}'::jsonb) FROM users u
   WHERE u.id::text IN (SELECT h ->> 'by_user_id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.description_history) = 'array' THEN c.description_history ELSE '[]'::jsonb END) h)) AS authors
FROM uc_cases c
WHERE c.id = ${uuid(caseId)} AND c.workspace_id = ${uuid(workspaceId)} AND c.setup_completed_at IS NOT NULL`);
}

/** La Descrizione in un giro: testo, versioni con gli autori, perimetro. */
export async function loadSolutionDescription(executor: UcExecutor, i: { workspaceId: string; caseId: string }): Promise<SolutionDescriptionData | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return null;
  const [rows] = await executor.batch([solutionDescriptionSql(i.workspaceId, i.caseId)]);
  const row = rows[0];
  if (!row) return null;
  const authors = new Map<string, string>();
  for (const [k, v] of Object.entries(rowObject(row.authors))) if (typeof v === "string") authors.set(k, v);
  return {
    description: rowObject(row.description),
    history: parseDescriptionHistory(rowJson(row.description_history)),
    authors,
    perimeterLabel: rowString(row.perimeter_label),
  };
}

// ── Mappa ─────────────────────────────────────────────────────────────

/** Le voci citate dalle mappe correnti: chiavi lette dal grafo nel database, così basta un giro. */
export function mapItemsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.title, i.kind, i.status, i.priority, i.owner_role_key, i.assignee_contact_id
FROM uc_items i
WHERE i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.key IN (
  SELECT k.key
  FROM uc_maps m
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.graph -> 'nodes') = 'array' THEN m.graph -> 'nodes' ELSE '[]'::jsonb END) n(node)
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(n.node -> 'items') = 'array' THEN n.node -> 'items' ELSE '[]'::jsonb END) k(key)
  WHERE m.case_id = ${uuid(caseId)} AND m.is_current)
LIMIT 5000`);
}

export interface SolutionMapData {
  ctx: CaseViewContext;
  maps: MapsView;
}

/**
 * Le mappe del caso in un giro: contesto, referenti (solo per Lateral Space:
 * il cliente vede il ruolo, mai il nome di chi risponde), mappe correnti e
 * voci citate.
 */
export async function loadSolutionMap(executor: UcExecutor, v: UcViewer): Promise<SolutionMapData | null> {
  const ls = isLsViewer(v.roles);
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const statements = [context.statement, currentMapsSql(v.caseId), mapItemsSql(v.caseId), ...(ls ? [contactsSql(v.workspaceId)] : [])];
  const rows = await executor.batch(statements);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const contacts = new Map((ls ? rows[3] : []).map(rowToContact).map((c) => [c.id, c]));
  const items = new Map(rows[2].map((r) => [String(r.key), r]));
  return { ctx, maps: buildMaps(parseMapRows(rows[1]), { items, contacts, roleLabels: ctx.roleLabels, roles: v.roles }) };
}

// ── Voce aperta nel pannello ──────────────────────────────────────────

/** Una voce con i testi e la classificazione (stesse colonne di `itemsOfKindsSql`), più il lucchetto. */
export function solutionItemSql(caseId: string, ref: ItemRef, kinds: readonly ItemKind[]): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.kind, i.title, i.explanation, i.why, i.example, i.help, i.spec, i.status, i.status_reason, i.priority,
  i.perimeter, i.serves_for, i.levers, i.privacy_class, i.availability, i.owner_role_key, i.response_type, i.source_refs,
  i.parent_item_id, i.assignee_contact_id, va.text_hash AS confirmed_text_hash,
  coalesce((SELECT jsonb_agg(b.key ORDER BY b.key) FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
    WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente')), '[]'::jsonb) AS active_blockers,
  ${lockedSql("i")} AS locked
FROM uc_items i
LEFT JOIN uc_answers va ON va.id = i.validated_answer_id
WHERE i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.kind = ANY(${kindsParam(kinds)}) AND ${refSql("i", ref)}
LIMIT 1`);
}

/** L'id della voce aperta, per le letture che le stanno attorno. */
function refIdSql(caseId: string, ref: ItemRef, kinds: readonly ItemKind[]): SqlFragment {
  return ucSql`(SELECT x.id FROM uc_items x WHERE x.case_id = ${uuid(caseId)} AND x.deleted_at IS NULL AND x.kind = ANY(${kindsParam(kinds)}) AND ${refSql("x", ref)} LIMIT 1)`;
}

/** I collegamenti della sola voce aperta, con le due voci (stesse colonne di `linksTouchingKindsSql`). */
export function solutionItemLinksSql(caseId: string, ref: ItemRef, kinds: readonly ItemKind[]): UcStatement {
  const target = refIdSql(caseId, ref, kinds);
  return toStatement(ucSql`SELECT l.from_item_id, l.to_item_id, l.relation, l.cardinality, l.note,
  f.key AS f_key, f.title AS f_title, f.kind AS f_kind, f.status AS f_status, f.availability AS f_availability, f.response_type AS f_response_type,
  t.key AS t_key, t.title AS t_title, t.kind AS t_kind, t.status AS t_status, t.availability AS t_availability, t.response_type AS t_response_type,
  (SELECT x.text_hash FROM uc_answers x WHERE x.id = f.validated_answer_id) AS f_confirmed_hash
FROM uc_item_links l
JOIN uc_items f ON f.id = l.from_item_id
JOIN uc_items t ON t.id = l.to_item_id
WHERE l.case_id = ${uuid(caseId)} AND f.deleted_at IS NULL AND t.deleted_at IS NULL
  AND (l.from_item_id = ${target} OR l.to_item_id = ${target})
ORDER BY l.relation, f.key, t.key
LIMIT 500`);
}

/** I campi di un'entità aperta: titolo, stato, lucchetto e le fonti con il loro titolo. */
export function solutionEntityFieldsSql(caseId: string, ref: ItemRef): UcStatement {
  const target = refIdSql(caseId, ref, ["entita"]);
  return toStatement(ucSql`SELECT f.id, f.key, f.title, f.explanation, f.example, f.spec, f.status, f.priority, f.privacy_class, f.availability,
  f.response_type, f.response_config, f.perimeter,
  coalesce((SELECT jsonb_agg(s.title ORDER BY s.key) FROM uc_item_links l JOIN uc_items s ON s.id = l.to_item_id
    WHERE l.from_item_id = f.id AND l.relation = 'alimentato_da' AND s.deleted_at IS NULL), '[]'::jsonb) AS sources,
  ${lockedSql("f")} AS locked
FROM uc_items f
WHERE f.case_id = ${uuid(caseId)} AND f.deleted_at IS NULL AND f.parent_item_id = ${target}
ORDER BY f.sort_order, f.key
LIMIT 500`);
}

// ── Regole ────────────────────────────────────────────────────────────

const ALL_RULE_KINDS: readonly ItemKind[] = [...RULE_KINDS, ...CONSTRAINT_KINDS];

function rulesWhere(caseId: string, q: RulesQuery): SqlFragment {
  return andAll([
    ucSql`i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.kind = ANY(${kindsParam(ruleKindsFor(q))})`,
    searchSql(q.q, true),
    q.stato ? ucSql`i.status = ANY(${cast(statusesOfGroup(q.stato), "text[]")})` : null,
    q.perimetro ? ucSql`i.perimeter = ${cast(q.perimetro, "text")}` : null,
  ]);
}

/** Quante regole e quanti vincoli ha il caso, senza filtri (per lo stato vuoto e per «Mostra anche i vincoli»). */
export function rulePresenceSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT count(*) FILTER (WHERE i.kind = ANY(${kindsParam(RULE_KINDS)}))::int AS rules,
  count(*) FILTER (WHERE i.kind = ANY(${kindsParam(CONSTRAINT_KINDS)}))::int AS constraints
FROM uc_items i
WHERE i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.kind = ANY(${kindsParam(ALL_RULE_KINDS)})`);
}

/** Per ogni «Chi la conferma»: quante regole e quante confermate, con gli stessi filtri della lista. */
export function ruleGroupCountsSql(caseId: string, q: RulesQuery): UcStatement {
  return toStatement(ucSql`SELECT i.owner_role_key, count(*)::int AS total, count(*) FILTER (WHERE i.status = 'validata')::int AS confirmed
FROM uc_items i
WHERE ${rulesWhere(caseId, q)}
GROUP BY i.owner_role_key`);
}

/**
 * Una pagina di regole, nell'ordine dei ruoli dello schema («Chi la conferma»),
 * poi l'ordine del catalogo. Solo le colonne della riga.
 */
export function rulesPageSql(caseId: string, q: RulesQuery): UcStatement {
  return toStatement(ucSql`WITH roles AS (
  SELECT r.elem ->> 'key' AS key, min(r.ord) AS ord
  FROM uc_cases c
  JOIN uc_templates t ON t.id = c.template_id
  CROSS JOIN LATERAL jsonb_array_elements(${templateKeyListSql("roles")}) WITH ORDINALITY AS r(elem, ord)
  WHERE c.id = ${uuid(caseId)}
  GROUP BY 1
)
SELECT i.id, i.title, i.status, i.kind, i.owner_role_key
FROM uc_items i
LEFT JOIN roles ro ON ro.key = i.owner_role_key
WHERE ${rulesWhere(caseId, q)}
ORDER BY (i.owner_role_key IS NULL), ro.ord NULLS LAST, i.owner_role_key, i.sort_order, i.key
LIMIT ${cast(SOLUTION_PAGE_SIZE, "int")} OFFSET ${cast(pageOffset(q.pagina), "int")}`);
}

export interface SolutionRulesData {
  ctx: CaseViewContext;
  /** Il caso ha regole (senza filtri). */
  hasRules: boolean;
  /** Il caso ha vincoli: solo allora c'è «Mostra anche i vincoli». */
  hasConstraints: boolean;
  /** Regole che corrispondono a ricerca e filtri, su tutte le pagine. */
  total: number;
  page: number;
  pages: number;
  groups: RuleGroup[];
  /** La regola aperta nel pannello, con i collegamenti e la domanda di conferma. */
  open: (ModelItemView & { confirmation: RuleConfirmation; locked: boolean }) | null;
}

/** Regole in un giro: contesto, presenza, conteggi per gruppo, una pagina e la regola aperta. */
export async function loadSolutionRules(executor: UcExecutor, v: UcViewer, q: RulesQuery): Promise<SolutionRulesData | null> {
  const open: ItemRef | null = q.apri ? { id: q.apri } : null;
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const statements = [context.statement, rulePresenceSql(v.caseId), ruleGroupCountsSql(v.caseId, q), rulesPageSql(v.caseId, q)];
  if (open) statements.push(solutionItemSql(v.caseId, open, ALL_RULE_KINDS), solutionItemLinksSql(v.caseId, open, ALL_RULE_KINDS));
  const rows = await executor.batch(statements);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const presence = rows[1][0] ?? {};
  const counts = rowsToRuleGroupCounts(rows[2]);
  const total = counts.reduce((sum, c) => sum + c.total, 0);
  const groups = ruleGroups(rowsToRuleRows(rows[3], audienceFor(v.roles)), counts, ctx.roleLabels);
  let opened: SolutionRulesData["open"] = null;
  if (open && rows[4]?.[0]) {
    const [item] = buildModelItems(rows[4], rows[5] ?? [], { roles: v.roles, roleLabels: ctx.roleLabels });
    const confirmation = ruleConfirmations(rows[5] ?? [], [item]).get(item.id) ?? { question: null, textHash: null };
    opened = { ...item, confirmation, locked: rows[4][0].locked === true || rows[4][0].locked === "t" };
  }
  return {
    ctx,
    hasRules: (rowNumber(presence.rules) ?? 0) > 0,
    hasConstraints: (rowNumber(presence.constraints) ?? 0) > 0,
    total,
    page: q.pagina,
    pages: pageCount(total),
    groups,
    open: opened,
  };
}

// ── Dati ──────────────────────────────────────────────────────────────

type ItemDataView = Exclude<DataView, "prova">;

function dataWhere(caseId: string, view: ItemDataView, q: string | null): SqlFragment {
  return andAll([ucSql`i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.kind = ANY(${kindsParam(DATA_VIEW_KINDS[view])})`, searchSql(q, false)]);
}

function dataOrder(view: ItemDataView): SqlFragment {
  if (view === "entita") return raw("(nullif(trim(i.spec ->> 'dominio'), '') IS NULL), lower(nullif(trim(i.spec ->> 'dominio'), '')), i.sort_order, i.key");
  if (view === "variabili") return ucSql`array_position(${kindsParam(DATA_VIEW_KINDS.variabili)}, i.kind::text), i.sort_order, i.key`;
  return raw("i.sort_order, i.key");
}

/** Una pagina di una vista di Dati: titolo, stato, una riga di testo, dominio e lucchetto. */
export function dataPageSql(caseId: string, view: ItemDataView, q: string | null, page: number): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.kind, i.title, i.explanation, i.status,
  i.spec ->> 'formula' AS formula, i.spec ->> 'controllo' AS controllo, nullif(trim(i.spec ->> 'dominio'), '') AS domain,
  ${lockedSql("i")} AS locked
FROM uc_items i
WHERE ${dataWhere(caseId, view, q)}
ORDER BY ${dataOrder(view)}
LIMIT ${cast(SOLUTION_PAGE_SIZE, "int")} OFFSET ${cast(pageOffset(page), "int")}`);
}

export function dataCountSql(caseId: string, view: ItemDataView, q: string | null): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n FROM uc_items i WHERE ${dataWhere(caseId, view, q)}`);
}

/** Casi di prova, una pagina: solo chiave, tipo, copertura ed esito (mai il contenuto). */
export function testCasesPageSql(caseId: string, q: string | null, page: number): UcStatement {
  const search = q ? ucSql` AND strpos(lower(tc.key), ${cast(q.toLowerCase(), "text")}) > 0` : raw("");
  return toStatement(ucSql`SELECT tc.id, tc.key, tc.kind, tc.covers, tc.serve_per, tc.last_result, tc.approved_at IS NOT NULL AS approved
FROM uc_test_cases tc WHERE tc.case_id = ${uuid(caseId)}${search}
ORDER BY tc.key
LIMIT ${cast(SOLUTION_PAGE_SIZE, "int")} OFFSET ${cast(pageOffset(page), "int")}`);
}

export function testCasesCountSql(caseId: string, q: string | null): UcStatement {
  const search = q ? ucSql` AND strpos(lower(tc.key), ${cast(q.toLowerCase(), "text")}) > 0` : raw("");
  return toStatement(ucSql`SELECT count(*)::int AS n FROM uc_test_cases tc WHERE tc.case_id = ${uuid(caseId)}${search}`);
}

export interface SolutionDataData {
  ctx: CaseViewContext;
  view: DataView;
  /** Righe che corrispondono alla ricerca, su tutte le pagine. */
  total: number;
  page: number;
  pages: number;
  rows: DataRow[];
  testCases: TestCaseView[];
  /** La voce aperta nel pannello, con i collegamenti; per un'entità anche i campi. */
  open: { item: ModelItemView; locked: boolean; fields: FieldView[] | null } | null;
}

/** Dati in un giro: contesto, una pagina della vista con il totale, la voce aperta. */
export async function loadSolutionData(executor: UcExecutor, v: UcViewer, q: DataQuery): Promise<SolutionDataData | null> {
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const statements = [context.statement];
  const view = q.vista;
  if (view === "prova") {
    statements.push(testCasesPageSql(v.caseId, q.q, q.pagina), testCasesCountSql(v.caseId, q.q));
  } else {
    statements.push(dataPageSql(v.caseId, view, q.q, q.pagina), dataCountSql(v.caseId, view, q.q));
    if (q.apri) {
      const kinds = DATA_VIEW_KINDS[view];
      statements.push(solutionItemSql(v.caseId, q.apri, kinds), solutionItemLinksSql(v.caseId, q.apri, kinds));
      if (view === "entita") statements.push(solutionEntityFieldsSql(v.caseId, q.apri));
    }
  }
  const rows = await executor.batch(statements);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const total = rowNumber(rows[2][0]?.n) ?? 0;
  const base = { ctx, view, total, page: q.pagina, pages: pageCount(total) };
  if (view === "prova") return { ...base, rows: [], testCases: rowsToTestCases(rows[1]), open: null };
  let open: SolutionDataData["open"] = null;
  const itemRow: Row | undefined = rows[3]?.[0];
  if (q.apri && itemRow) {
    const [item] = buildModelItems([itemRow], rows[4] ?? [], { roles: v.roles, roleLabels: ctx.roleLabels });
    open = { item, locked: itemRow.locked === true || itemRow.locked === "t", fields: view === "entita" ? rowsToFields(rows[5] ?? [], v.roles) : null };
  }
  return { ...base, rows: rowsToDataRows(rows[1], view, audienceFor(v.roles)), testCases: [], open };
}
