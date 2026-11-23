/**
 * «Cambia schema di partenza» di un dossier in Bozza (docs/dossier/SCHEMA-DI-PARTENZA.md, R3 e R4).
 *
 * Lo usano Impostazioni (`changeStartingSchemaAction`) e l'operatore
 * (`scripts/use-case-admin.ts reschema`): stessa funzione, stessi controlli.
 *
 * - Quando: dossier completo, in «Bozza», e nessuna voce dello schema attuale con risposte
 *   (escluse le risposte di sistema delle voci collegate a «Cosa serve», che restano là), misure
 *   dei KPI, file, voci in richieste al referente, assegnazioni o commenti. Altrimenti `bloccato`
 *   con l'elenco delle voci.
 * - Cosa ricostruisce: voci (entità e regole comprese), collegamenti tra voci, legami con i blocchi
 *   e mappa. I blocchi del dossier restano (con firme ed evidenze): si aggiungono solo quelli che il
 *   nuovo schema porta e il dossier non ha.
 * - Cosa resta: la riga del dossier (id, codice, nome, descrizione, scheda), persone, Progetto
 *   dell'agente, pacchetti e compiti (stanno sullo use case, non sul dossier), collegamento al
 *   repository, storico, fotografie del catalogo.
 * - Tutto in un batch (una transazione), con i controlli rifatti dentro (`uc_require`): se nel
 *   frattempo il dossier è cambiato non si scrive niente. Evento `caso.schema_cambiato` con chi e quando.
 * - Stesso schema di adesso: nessuna scrittura (`changed: false`).
 *
 * Modulo senza import dell'app, come `uc-templates.ts`.
 */
import { fail, ok, type Json, type Result } from "../../uc/types.ts";
import { cast, jsonb, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { buildCaseRows, resolveGatePolicy, type CaseBuild, type CaseGatePolicy } from "../../uc/template/case-build.ts";
import { FROM_USE_CASE_ALIAS, buildCaseRowsFromNeeds, isFromUseCaseTemplateKey } from "../../uc/template/from-use-case.ts";
import { needItemsUpdateSql } from "../../uc/sql/need-items.ts";
import { eventInsertSql } from "./uc-events.ts";
import { ensureFromUseCaseTemplate, findFromUseCaseTemplate, getTemplateForCase, readNeedsForCase, type VisibleTemplate } from "./uc-templates.ts";
import { refreshReadinessCache } from "./uc-cases.ts";
import { runUcBatch, type UcExecutor } from "../uc-executor.ts";
import { isUuid } from "../../uc/ids.ts";

export type ReschemaTarget = { templateId: string } | typeof FROM_USE_CASE_ALIAS;

export type ReschemaBlockReason = "risposte" | "file" | "richieste" | "assegnazione" | "commenti";

export interface ReschemaBlocker {
  itemId: string;
  key: string;
  title: string;
  reasons: ReschemaBlockReason[];
}

export interface ReschemaPlan {
  caseId: string;
  code: string;
  status: string;
  from: { id: string; key: string; version: string; name: string };
  to: { id: string; key: string; version: string; name: string };
  /** Lo schema scelto è già quello del dossier. */
  same: boolean;
  blockers: ReschemaBlocker[];
  /** Voci del dossier adesso (non cancellate). */
  itemsNow: number;
  /** Voci dopo il cambio. */
  itemsAfter: number;
}

/** Al massimo tante voci che bloccano, nell'elenco. */
export const RESCHEMA_BLOCKERS_MAX = 200;

export const RESCHEMA_MESSAGES = {
  caso_non_trovato: "Realizzazione non trovata.",
  non_in_bozza: "Lo schema di partenza si cambia solo in «Bozza».",
  bloccato: "Non si può cambiare lo schema: alcune domande hanno già risposte, file, richieste o assegnazioni.",
  scheda_mancante: "Lo schema «Dal caso d'uso» parte da uno use case: questa realizzazione non ne ha.",
  template_non_trovato: "Schema di partenza non trovato.",
} as const;

const uuid = (v: string) => cast(v.toLowerCase(), "uuid");

function caseRowSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.code, c.status, c.setup_completed_at IS NOT NULL AS complete, c.portfolio_use_case_id, c.settings,
  c.template_id, t.key AS template_key, c.template_version, t.name AS template_name,
  (SELECT count(*) FROM uc_items i WHERE i.case_id = c.id AND i.deleted_at IS NULL)::int AS items
FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.id = ${uuid(caseId)} AND c.workspace_id = ${uuid(workspaceId)}`);
}

/**
 * Le voci che fermano il cambio, con il perché. Le risposte di sistema delle voci collegate
 * (`source_kind = 'import'`, `source_ref = 'use_case_need:…'`) non contano: la risposta vera sta
 * in «Cosa serve» e resta.
 */
function blockersFragment(c: SqlFragment): SqlFragment {
  return ucSql`WITH a AS (
  SELECT DISTINCT item_id FROM uc_answers WHERE case_id = ${c} AND NOT (source_kind = 'import' AND coalesce(source_ref, '') LIKE 'use_case_need:%')
  UNION SELECT DISTINCT item_id FROM uc_kpi_measurements WHERE case_id = ${c}
), f AS (
  SELECT DISTINCT item_id FROM uc_files WHERE case_id = ${c} AND item_id IS NOT NULL
), r AS (
  SELECT DISTINCT item_id FROM uc_request_items WHERE case_id = ${c}
), m AS (
  SELECT DISTINCT item_id FROM uc_comments WHERE case_id = ${c} AND item_id IS NOT NULL
)
SELECT i.id, i.key, i.title, i.sort_order,
  a.item_id IS NOT NULL AS has_answers, f.item_id IS NOT NULL AS has_files, r.item_id IS NOT NULL AS in_requests,
  (i.assignee_contact_id IS NOT NULL OR i.ls_owner_user_id IS NOT NULL) AS assigned, m.item_id IS NOT NULL AS has_comments
FROM uc_items i
LEFT JOIN a ON a.item_id = i.id LEFT JOIN f ON f.item_id = i.id LEFT JOIN r ON r.item_id = i.id LEFT JOIN m ON m.item_id = i.id
WHERE i.case_id = ${c}
  AND (a.item_id IS NOT NULL OR f.item_id IS NOT NULL OR r.item_id IS NOT NULL OR m.item_id IS NOT NULL
    OR i.assignee_contact_id IS NOT NULL OR i.ls_owner_user_id IS NOT NULL)`;
}

function blockersSql(caseId: string): UcStatement {
  return toStatement(ucSql`${blockersFragment(uuid(caseId))}
ORDER BY i.sort_order, i.key
LIMIT ${cast(RESCHEMA_BLOCKERS_MAX, "int")}`);
}

interface Loaded {
  plan: ReschemaPlan;
  template: VisibleTemplate;
  portfolioUseCaseId: string | null;
  settings: Record<string, Json>;
}

/** Id segnaposto dello schema «Dal caso d'uso» non ancora creato (solo nella prova a secco). */
export const NOT_YET_CREATED_TEMPLATE_ID = "00000000-0000-0000-0000-000000000000";

async function load(executor: UcExecutor, i: { workspaceId: string; caseId: string; to: ReschemaTarget; readOnly?: boolean }): Promise<Result<Loaded>> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return fail("caso_non_trovato", RESCHEMA_MESSAGES.caso_non_trovato);
  let templateId: string | null = null;
  let virtual: VisibleTemplate | null = null;
  if (i.to === FROM_USE_CASE_ALIAS) {
    if (i.readOnly) {
      // A secco niente INSERT: la riga si legge se c'è, altrimenti vale la definizione fissa.
      const found = await findFromUseCaseTemplate(executor);
      if (found.id) templateId = found.id;
      else virtual = { ...found, id: NOT_YET_CREATED_TEMPLATE_ID };
    } else {
      const ensured = await ensureFromUseCaseTemplate(executor);
      if (!ensured.ok) return ensured;
      templateId = ensured.value.id;
    }
  } else if (typeof i.to === "object" && i.to && isUuid(i.to.templateId)) {
    templateId = i.to.templateId;
  } else {
    return fail("template_non_trovato", RESCHEMA_MESSAGES.template_non_trovato);
  }
  const [[row], blockerRows] = await executor.batch([caseRowSql(i.workspaceId, i.caseId), blockersSql(i.caseId)]);
  if (!row || row.complete !== true) return fail("caso_non_trovato", RESCHEMA_MESSAGES.caso_non_trovato);
  const template = virtual ? ok(virtual) : await getTemplateForCase(executor, i.workspaceId, { templateId: templateId! });
  if (!template.ok) return fail("template_non_trovato", RESCHEMA_MESSAGES.template_non_trovato);
  const portfolioUseCaseId = isUuid(row.portfolio_use_case_id) ? String(row.portfolio_use_case_id).toLowerCase() : null;
  const fromUseCase = isFromUseCaseTemplateKey(template.value.key);
  const itemsAfter = fromUseCase
    ? portfolioUseCaseId
      ? (await readNeedsForCase(executor, i.workspaceId, portfolioUseCaseId)).length
      : 0
    : template.value.definition.items.length;
  const blockers: ReschemaBlocker[] = blockerRows.map((b) => ({
    itemId: String(b.id),
    key: String(b.key),
    title: String(b.title ?? ""),
    reasons: [
      ...(b.has_answers === true ? (["risposte"] as const) : []),
      ...(b.has_files === true ? (["file"] as const) : []),
      ...(b.in_requests === true ? (["richieste"] as const) : []),
      ...(b.assigned === true ? (["assegnazione"] as const) : []),
      ...(b.has_comments === true ? (["commenti"] as const) : []),
    ],
  }));
  const settings = (typeof row.settings === "string" ? JSON.parse(row.settings) : (row.settings ?? {})) as Record<string, Json>;
  return ok({
    plan: {
      caseId: String(row.id),
      code: String(row.code),
      status: String(row.status),
      from: { id: String(row.template_id), key: String(row.template_key), version: String(row.template_version ?? ""), name: String(row.template_name ?? "") },
      to: { id: template.value.id, key: template.value.key, version: template.value.version, name: String(template.value.definition.name ?? "") },
      same: String(row.template_id).toLowerCase() === template.value.id.toLowerCase(),
      blockers,
      itemsNow: Number(row.items ?? 0),
      itemsAfter,
    },
    template: template.value,
    portfolioUseCaseId,
    settings,
  });
}

/** Il piano del cambio, senza scrivere: schema di adesso e di dopo, voci che bloccano, conteggi. */
export async function planReschema(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; to: ReschemaTarget; readOnly?: boolean },
): Promise<Result<ReschemaPlan>> {
  const loaded = await load(executor, i);
  return loaded.ok ? ok(loaded.value.plan) : loaded;
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let k = 0; k < rows.length; k += size) out.push(rows.slice(k, k + size));
  return out;
}

const ITEM_COLUMNS =
  "id uuid, key text, template_item_key text, kind text, section text, parent_item_id uuid, title text, explanation text, why text, example text, help text, spec jsonb, priority text, serves_for jsonb, privacy_class text, availability jsonb, perimeter text, levers jsonb, response_type text, response_config jsonb, request_module_key text, in_gate_scope boolean, status text, owner_role_key text, requires_validity_period boolean, freshness_days integer, source_refs jsonb, sort_order integer, shared_item_id uuid";

/** Le istruzioni del cambio, in ordine, per un batch solo. */
function reschemaStatements(i: {
  workspaceId: string;
  caseId: string;
  actorUserId: string;
  fromTemplateId: string;
  template: VisibleTemplate;
  build: CaseBuild;
  policy: CaseGatePolicy;
  fromKey: string;
  itemsBefore: number;
  fromUseCase: boolean;
}): UcStatement[] {
  const c = uuid(i.caseId);
  const ws = uuid(i.workspaceId);
  const actor = uuid(i.actorUserId);
  const b = i.build;
  const out: UcStatement[] = [
    // Il dossier è ancora quello del piano: in bozza, con lo stesso schema.
    toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_cases WHERE id = ${c} AND workspace_id = ${ws} AND status = 'bozza' AND setup_completed_at IS NOT NULL AND template_id = ${uuid(i.fromTemplateId)}
), 'conflitto') AS ok`),
    // Nessuna voce ha preso risposte, file, richieste, assegnazioni o commenti nel frattempo.
    toStatement(ucSql`SELECT uc_require(NOT EXISTS (${blockersFragment(c)}), 'bloccato') AS ok`),
    toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_templates t WHERE t.id = ${uuid(i.template.id)} AND t.status = 'pubblicato' AND t.definition_hash = ${cast(i.template.hash, "text")}
    AND (t.restricted_to_workspace_id IS NULL OR t.restricted_to_workspace_id = ${ws})
), 'template_non_disponibile') AS ok`),
    // Via voci (con collegamenti, legami con i blocchi e risposte di sistema) e mappe dello schema di prima.
    toStatement(ucSql`DELETE FROM uc_item_links WHERE case_id = ${c}`),
    toStatement(ucSql`DELETE FROM uc_items WHERE case_id = ${c}`),
    toStatement(ucSql`DELETE FROM uc_maps WHERE case_id = ${c}`),
    // I blocchi che il dossier non ha ancora (per chiave); quelli che ha restano, con firme ed evidenze.
    toStatement(ucSql`INSERT INTO uc_blockers (id, workspace_id, case_id, key, label, status, scope, fallback_allowed)
SELECT r.id, ${ws}, ${c}, r.key, r.label, r.status, r.scope, r.fallback_allowed
FROM jsonb_to_recordset(${jsonb(b.blockers as unknown as Json)}) AS r(id uuid, key text, label text, status text, scope jsonb, fallback_allowed text)
WHERE NOT EXISTS (SELECT 1 FROM uc_blockers x WHERE x.case_id = ${c} AND x.key = r.key)`),
  ];
  for (const rows of chunks(b.items, 500)) {
    out.push(
      toStatement(ucSql`INSERT INTO uc_items (id, case_id, key, template_item_key, kind, section, parent_item_id, title, explanation, why,
  example, help, spec, priority, serves_for, privacy_class, availability, perimeter, levers, response_type, response_config,
  request_module_key, in_gate_scope, status, owner_role_key, requires_validity_period, freshness_days, source_refs, sort_order,
  shared_item_id, created_by_user_id)
SELECT r.id, ${c}, r.key, r.template_item_key, r.kind, r.section, r.parent_item_id, r.title, r.explanation, r.why,
  r.example, r.help, r.spec, r.priority, r.serves_for, r.privacy_class, r.availability, r.perimeter, r.levers, r.response_type,
  r.response_config, r.request_module_key, r.in_gate_scope, r.status, r.owner_role_key, r.requires_validity_period,
  r.freshness_days, r.source_refs, r.sort_order, r.shared_item_id, ${actor}
FROM jsonb_to_recordset(${jsonb(rows as unknown as Json)}) AS r(${raw(ITEM_COLUMNS)})`),
    );
  }
  for (const rows of chunks(b.links, 2000)) {
    out.push(
      toStatement(ucSql`INSERT INTO uc_item_links (case_id, from_item_id, to_item_id, relation, cardinality, note)
SELECT ${c}, r.from_item_id, r.to_item_id, r.relation, r.cardinality, r.note
FROM jsonb_to_recordset(${jsonb(rows as unknown as Json)}) AS r(from_item_id uuid, to_item_id uuid, relation text, cardinality text, note text)`),
    );
  }
  // I legami con i blocchi vanno sul blocco del dossier con la stessa chiave (vecchio o appena aggiunto).
  const blockerKey = new Map(b.blockers.map((x) => [x.id, x.key]));
  const links = b.itemBlockers.map((x) => ({ item_id: x.item_id, key: blockerKey.get(x.blocker_id) ?? "", origin: x.origin }));
  for (const rows of chunks(links, 2000)) {
    out.push(
      toStatement(ucSql`INSERT INTO uc_item_blockers (item_id, blocker_id, origin)
SELECT r.item_id, x.id, r.origin
FROM jsonb_to_recordset(${jsonb(rows as unknown as Json)}) AS r(item_id uuid, key text, origin text)
JOIN uc_blockers x ON x.case_id = ${c} AND x.key = r.key
ON CONFLICT DO NOTHING`),
    );
  }
  for (const map of b.maps) {
    out.push(
      toStatement(ucSql`INSERT INTO uc_maps (case_id, version, kind, title, graph, source, is_current, created_by_user_id)
VALUES (${c}, 1, ${cast(map.kind, "text")}, ${cast(map.title.slice(0, 255), "text")}, ${jsonb(map.graph as unknown as Json)}, 'template', true, ${actor})`),
    );
  }
  const gatePolicy: Json = { scope: i.policy.scope, default_serves_for: [...i.policy.default_serves_for], default_perimeter: i.policy.default_perimeter, confirmed: null };
  out.push(
    toStatement(ucSql`UPDATE uc_cases SET template_id = ${uuid(i.template.id)}, template_version = ${cast(i.template.version, "text")},
  settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{gate_policy}', ${jsonb(gatePolicy)}),
  catalog_revision = catalog_revision + 1, updated_at = now()
WHERE id = ${c} AND workspace_id = ${ws}`),
  );
  if (i.fromUseCase) out.push(needItemsUpdateSql({ workspaceId: i.workspaceId, caseId: i.caseId, actorUserId: i.actorUserId }));
  out.push(
    toStatement(
      eventInsertSql({
        type: "caso.schema_cambiato",
        workspaceId: i.workspaceId,
        caseId: i.caseId,
        actor: { type: "utente", userId: i.actorUserId },
        targetType: "caso",
        targetId: i.caseId,
        payload: {
          from: i.fromKey.replace(/[^a-z0-9_]/g, "_").slice(0, 60),
          template_key: i.template.key,
          template_version: i.template.version,
          items: b.counts.items,
          links: b.counts.links,
          blockers: b.counts.blockers,
        },
      }),
    ),
  );
  return out;
}

/**
 * Cambia lo schema di partenza di un dossier in Bozza (R3). Stesso schema: `changed: false`, niente
 * scritto. Voci che bloccano: `bloccato` (il piano le elenca: `planReschema`).
 */
export async function reschemaCase(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; actorUserId: string; to: ReschemaTarget; newId?: () => string; now?: Date },
): Promise<Result<{ changed: boolean; plan: ReschemaPlan }>> {
  if (!isUuid(i.actorUserId)) return fail("attore_non_valido", "L'id di chi cambia lo schema non è valido.");
  const loaded = await load(executor, i);
  if (!loaded.ok) return loaded;
  const { plan, template, portfolioUseCaseId } = loaded.value;
  if (plan.status !== "bozza") return fail("non_in_bozza", RESCHEMA_MESSAGES.non_in_bozza);
  if (plan.same) return ok({ changed: false, plan });
  if (plan.blockers.length > 0) return fail("bloccato", RESCHEMA_MESSAGES.bloccato);
  const newId = i.newId ?? (() => crypto.randomUUID());
  const fromUseCase = isFromUseCaseTemplateKey(template.key);
  const current = loaded.value.settings.gate_policy as { scope?: string } | undefined;
  const policy = resolveGatePolicy(template.definition, fromUseCase ? undefined : current?.scope ? { scope: current.scope as CaseGatePolicy["scope"] } : undefined);
  let build: CaseBuild;
  if (fromUseCase) {
    if (!portfolioUseCaseId) return fail("scheda_mancante", RESCHEMA_MESSAGES.scheda_mancante);
    build = buildCaseRowsFromNeeds(await readNeedsForCase(executor, i.workspaceId, portfolioUseCaseId), { newId, policy });
  } else {
    build = buildCaseRows(template.definition, { newId, policy });
  }
  const result = await runUcBatch(
    executor,
    reschemaStatements({
      workspaceId: i.workspaceId,
      caseId: plan.caseId,
      actorUserId: i.actorUserId,
      fromTemplateId: plan.from.id,
      template,
      build,
      policy,
      fromKey: plan.from.key,
      itemsBefore: plan.itemsNow,
      fromUseCase,
    }),
  );
  if (!result.ok) {
    if (result.code === "bloccato") return fail("bloccato", RESCHEMA_MESSAGES.bloccato);
    return fail(result.code, result.message);
  }
  try {
    await refreshReadinessCache(executor, i.workspaceId, plan.caseId, i.now);
  } catch {
    // La cache resta vecchia (revisione alzata): la testata la ricalcola dal vivo, la notte la riscrive.
  }
  return ok({ changed: true, plan: { ...plan, itemsAfter: build.counts.items } });
}
