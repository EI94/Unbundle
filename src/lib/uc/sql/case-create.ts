/**
 * Istruzioni SQL della creazione di un caso dal template (PIANO §4.6).
 *
 * Un caso copia migliaia di voci e collegamenti: la creazione usa più batch con
 * l'esecutore unico, e il caso diventa visibile solo con l'ultimo
 * (`uc_cases.setup_completed_at`). Ogni batch è una transazione:
 *
 * | batch | contenuto |
 * |---|---|
 * | 1 | controlli (workspace, attore, template pubblicato e visibile, scheda di portafoglio), `uc_cases` con `setup_completed_at NULL`, `uc_case_members` (ls_lead), `uc_blockers`, evento `caso.creato` |
 * | 2…n | `uc_items` a blocchi di 500 righe (`jsonb_to_recordset`), parent prima dei figli |
 * | n+1… | `uc_item_links` a blocchi di 2.000, `uc_item_blockers`, `uc_maps` |
 * | ultimo | conteggi verificati con `uc_require`, `setup_completed_at = now()`, `readiness`, evento `voce.stato_importato` (aggregato) |
 *
 * Ogni batch dopo il primo controlla che il caso sia ancora «in creazione».
 * Modulo puro: solo costruttori `{ text, params }`.
 */
import { eventInsertSql } from "../../db/queries/uc-events.ts";
import type { Json } from "../types.ts";
import type { Lever } from "../vocab.ts";
import type { CaseBuild, CaseMapRow } from "../template/case-build.ts";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "./statement.ts";

/** Righe per istruzione (PIANO §1.1). */
export const CASE_CREATE_CHUNKS = { items: 500, links: 2000, itemBlockers: 2000 } as const;

/** Un caso incompleto più vecchio di così si può cancellare e ricreare. */
export const STALE_INCOMPLETE_CASE_MINUTES = 10;

export interface CaseCreateHeader {
  caseId: string;
  workspaceId: string;
  templateId: string;
  templateHash: string;
  templateKey: string;
  templateVersion: string;
  code: string;
  title: string;
  oneLiner: string | null;
  perimeterLabel: string | null;
  levers: Lever[];
  portfolioUseCaseId: string | null;
  description: Record<string, Json>;
  settings: Record<string, Json>;
  actorUserId: string;
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const staleInterval = raw(`interval '${STALE_INCOMPLETE_CASE_MINUTES} minutes'`);

/** Stato del codice nel workspace: assente, caso completo, incompleto recente o incompleto vecchio. */
export function caseCodeStateSql(workspaceId: string, code: string): UcStatement {
  return toStatement(ucSql`SELECT id, setup_completed_at IS NOT NULL AS complete, created_at < now() - ${staleInterval} AS stale
FROM uc_cases WHERE workspace_id = ${cast(workspaceId, "uuid")} AND code = ${cast(code, "text")}`);
}

/** Cancella un caso rimasto incompleto da più di 10 minuti (non ha ancora risposte né richieste). */
export function deleteStaleIncompleteCaseSql(workspaceId: string, code: string, caseId: string): UcStatement {
  return toStatement(
    requireRows(
      ucSql`DELETE FROM uc_cases
WHERE id = ${cast(caseId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")} AND code = ${cast(code, "text")}
  AND setup_completed_at IS NULL AND created_at < now() - ${staleInterval}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Pulizia dopo un batch fallito: solo il caso appena iniziato e ancora incompleto. */
export function deleteOwnIncompleteCaseSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`DELETE FROM uc_cases
WHERE id = ${cast(caseId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")} AND setup_completed_at IS NULL`);
}

function stillCreating(caseId: string): SqlFragment {
  return ucSql`SELECT uc_require(EXISTS (SELECT 1 FROM uc_cases WHERE id = ${cast(caseId, "uuid")} AND setup_completed_at IS NULL), 'caso_non_in_creazione') AS ok`;
}

function firstBatch(h: CaseCreateHeader, build: CaseBuild): UcStatement[] {
  const ws = cast(h.workspaceId, "uuid");
  const caseId = cast(h.caseId, "uuid");
  const actor = cast(h.actorUserId, "uuid");
  const portfolio = cast(h.portfolioUseCaseId, "uuid");
  return [
    toStatement(ucSql`SELECT uc_require(EXISTS (SELECT 1 FROM workspaces WHERE id = ${ws}), 'workspace_non_trovato') AS ok`),
    toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM workspaces w WHERE w.id = ${ws} AND (
    EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${actor})
    OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${actor}))
), 'attore_non_membro') AS ok`),
    toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_templates t
  WHERE t.id = ${cast(h.templateId, "uuid")} AND t.status = 'pubblicato' AND t.definition_hash = ${cast(h.templateHash, "text")}
    AND (t.restricted_to_workspace_id IS NULL OR t.restricted_to_workspace_id = ${ws})
), 'template_non_disponibile') AS ok`),
    toStatement(ucSql`SELECT uc_require(${portfolio} IS NULL OR EXISTS (
  SELECT 1 FROM use_cases u WHERE u.id = ${portfolio} AND u.workspace_id = ${ws}
), 'scheda_non_trovata') AS ok`),
    toStatement(
      requireRows(
        ucSql`INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version,
  code, title, one_liner, description, perimeter_label, levers, ls_lead_user_id, settings, created_by_user_id)
SELECT ${caseId}, w.id, w.organization_id, ${portfolio}, ${cast(h.templateId, "uuid")}, ${cast(h.templateVersion, "text")},
  ${cast(h.code, "text")}, ${cast(h.title, "text")}, ${cast(h.oneLiner, "text")}, ${jsonb(h.description)}, ${cast(h.perimeterLabel, "text")},
  ${jsonb(h.levers)}, ${actor}, ${jsonb(h.settings)}, ${actor}
FROM workspaces w WHERE w.id = ${ws}
ON CONFLICT (workspace_id, code) DO NOTHING
RETURNING id`,
        1,
        "codice_in_uso",
      ),
    ),
    toStatement(ucSql`INSERT INTO uc_case_members (case_id, user_id, role, added_by_user_id) VALUES (${caseId}, ${actor}, 'ls_lead', ${actor})`),
    toStatement(ucSql`INSERT INTO uc_blockers (id, workspace_id, case_id, key, label, status, scope, fallback_allowed)
SELECT r.id, ${ws}, ${caseId}, r.key, r.label, r.status, r.scope, r.fallback_allowed
FROM jsonb_to_recordset(${jsonb(build.blockers)}) AS r(id uuid, key text, label text, status text, scope jsonb, fallback_allowed text)`),
    toStatement(
      eventInsertSql({
        type: "caso.creato",
        workspaceId: h.workspaceId,
        caseId: h.caseId,
        actor: { type: "utente", userId: h.actorUserId },
        targetType: "caso",
        targetId: h.caseId,
        toState: "bozza",
        payload: {
          code: h.code,
          template_key: h.templateKey,
          template_version: h.templateVersion,
          items: build.counts.items,
          links: build.counts.links,
          blockers: build.counts.blockers,
        },
      }),
    ),
  ];
}

const ITEM_COLUMNS =
  "id uuid, key text, template_item_key text, kind text, section text, parent_item_id uuid, title text, explanation text, why text, example text, help text, spec jsonb, priority text, serves_for jsonb, privacy_class text, availability jsonb, perimeter text, levers jsonb, response_type text, response_config jsonb, request_module_key text, in_gate_scope boolean, status text, owner_role_key text, requires_validity_period boolean, freshness_days integer, source_refs jsonb, sort_order integer";

function itemsInsert(caseId: string, actorUserId: string, rows: CaseBuild["items"]): UcStatement {
  return toStatement(ucSql`INSERT INTO uc_items (id, case_id, key, template_item_key, kind, section, parent_item_id, title, explanation, why,
  example, help, spec, priority, serves_for, privacy_class, availability, perimeter, levers, response_type, response_config,
  request_module_key, in_gate_scope, status, owner_role_key, requires_validity_period, freshness_days, source_refs, sort_order,
  created_by_user_id)
SELECT r.id, ${cast(caseId, "uuid")}, r.key, r.template_item_key, r.kind, r.section, r.parent_item_id, r.title, r.explanation, r.why,
  r.example, r.help, r.spec, r.priority, r.serves_for, r.privacy_class, r.availability, r.perimeter, r.levers, r.response_type,
  r.response_config, r.request_module_key, r.in_gate_scope, r.status, r.owner_role_key, r.requires_validity_period,
  r.freshness_days, r.source_refs, r.sort_order, ${cast(actorUserId, "uuid")}
FROM jsonb_to_recordset(${jsonb(rows)}) AS r(${raw(ITEM_COLUMNS)})`);
}

function linksInsert(caseId: string, rows: CaseBuild["links"]): UcStatement {
  return toStatement(ucSql`INSERT INTO uc_item_links (case_id, from_item_id, to_item_id, relation, cardinality, note)
SELECT ${cast(caseId, "uuid")}, r.from_item_id, r.to_item_id, r.relation, r.cardinality, r.note
FROM jsonb_to_recordset(${jsonb(rows)}) AS r(from_item_id uuid, to_item_id uuid, relation text, cardinality text, note text)`);
}

function itemBlockersInsert(rows: CaseBuild["itemBlockers"]): UcStatement {
  return toStatement(ucSql`INSERT INTO uc_item_blockers (item_id, blocker_id, origin)
SELECT r.item_id, r.blocker_id, r.origin
FROM jsonb_to_recordset(${jsonb(rows)}) AS r(item_id uuid, blocker_id uuid, origin text)`);
}

function mapInsert(caseId: string, actorUserId: string, map: CaseMapRow): UcStatement {
  return toStatement(ucSql`INSERT INTO uc_maps (case_id, version, kind, title, graph, source, is_current, created_by_user_id)
VALUES (${cast(caseId, "uuid")}, 1, ${cast(map.kind, "text")}, ${cast(map.title.slice(0, 255), "text")}, ${jsonb(map.graph)}, 'template', true, ${cast(actorUserId, "uuid")})`);
}

function finalBatch(h: CaseCreateHeader, build: CaseBuild, readiness: Record<string, Json>): UcStatement[] {
  const caseId = cast(h.caseId, "uuid");
  const c = build.counts;
  return [
    toStatement(ucSql`SELECT uc_require(
  (SELECT count(*) FROM uc_items WHERE case_id = ${caseId}) = ${cast(c.items, "int")}
  AND (SELECT count(*) FROM uc_item_links WHERE case_id = ${caseId}) = ${cast(c.links, "int")}
  AND (SELECT count(*) FROM uc_blockers WHERE case_id = ${caseId}) = ${cast(c.blockers, "int")}
  AND (SELECT count(*) FROM uc_item_blockers ib JOIN uc_items i ON i.id = ib.item_id WHERE i.case_id = ${caseId}) = ${cast(c.itemBlockers, "int")}
  AND (SELECT count(*) FROM uc_maps WHERE case_id = ${caseId}) = ${cast(build.maps.length, "int")},
  'creazione_incompleta') AS ok`),
    toStatement(
      requireRows(
        ucSql`UPDATE uc_cases SET setup_completed_at = now(), readiness = ${jsonb(readiness)}, updated_at = now()
WHERE id = ${caseId} AND setup_completed_at IS NULL
RETURNING id`,
        1,
        "conflitto",
      ),
    ),
    toStatement(
      eventInsertSql({
        type: "voce.stato_importato",
        workspaceId: h.workspaceId,
        caseId: h.caseId,
        actor: { type: "sistema" },
        targetType: "caso",
        targetId: h.caseId,
        payload: { count: c.items, counts: { ...c.byStatus } },
      }),
    ),
  ];
}

/**
 * Tutti i batch della creazione, nell'ordine. Il chiamante li esegue uno alla
 * volta e, se uno fallisce, prova `deleteOwnIncompleteCaseSql`.
 */
export function caseCreateBatches(h: CaseCreateHeader, build: CaseBuild, readiness: Record<string, Json>): UcStatement[][] {
  const batches: UcStatement[][] = [firstBatch(h, build)];
  const guard = () => toStatement(stillCreating(h.caseId));
  for (const rows of chunks(build.items, CASE_CREATE_CHUNKS.items)) batches.push([guard(), itemsInsert(h.caseId, h.actorUserId, rows)]);
  for (const rows of chunks(build.links, CASE_CREATE_CHUNKS.links)) batches.push([guard(), linksInsert(h.caseId, rows)]);
  const blockerChunks = chunks(build.itemBlockers, CASE_CREATE_CHUNKS.itemBlockers);
  const maps = build.maps.map((m) => mapInsert(h.caseId, h.actorUserId, m));
  if (blockerChunks.length === 0) batches.push([guard(), ...maps]);
  blockerChunks.forEach((rows, i) => {
    const last = i === blockerChunks.length - 1;
    batches.push([guard(), itemBlockersInsert(rows), ...(last ? maps : [])]);
  });
  batches.push(finalBatch(h, build, readiness));
  return batches;
}
