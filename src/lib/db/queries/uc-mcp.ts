/**
 * Letture MCP in sola lettura dei casi d'uso (PIANO §5.8) e token Claude del caso.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`:
 * l'esecutore arriva da fuori (rotte: `getAppUcExecutor()` dopo
 * `ensureUcAvailable()`; test di integrazione: `createUcExecutor(neon(url))`).
 * Token, scope e caso del token li controlla il chiamante
 * (`checkMcpToolAccess` di `src/lib/uc/mcp-access.ts`); qui il caso si rilegge
 * sempre con il workspace del token.
 *
 * Regole:
 * - `get_validated_catalog` legge solo una versione congelata
 *   (`uc_catalog_versions`), mai la bozza: solo voci validate o non applicabili
 *   firmate, più l'elenco `excluded`.
 * - Tutte le viste passano da `mcp-view.ts`: valori personali mai, valori
 *   `riservato_azienda` e testi del cliente nascosti finché l'ambiente AI del caso
 *   non è approvato.
 * - Nessun nome, email o tempo per persona: ruoli ed etichette di ruolo soltanto.
 * - Ogni lettura riuscita scrive `catalogo.letto_mcp` (attore `mcp`, con il token)
 *   prima della risposta: senza evento la rotta non risponde con i dati.
 */
import { listGateReviews } from "./uc-gates.ts";
import { isUuid, loadCaseReadiness } from "./uc-cases.ts";
import { eventInsertSql } from "./uc-events.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { caseListView, dataDictionaryView, gateStatusView, openItemsView, validatedCatalogView, type DictionaryItemInput, type McpViewOptions, type OpenItemInput } from "../../uc/mcp-view.ts";
import { caseScopeMarker, clientTextFromSettings, grantedCaseScopes, parseStoredSnapshot, roleLabelsFrom, type GrantableCaseScope, type McpCaseTool } from "../../uc/mcp-access.ts";
import { snapshotForViewer } from "../../uc/snapshot.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowVocab } from "../../uc/sql/readiness.ts";
import { cast, toStatement, ucSql } from "../../uc/sql/statement.ts";
import { templatePartsReader } from "../../uc/sql/template-parts.ts";
import type { Json } from "../../uc/types.ts";
import { CASE_STATUSES, ITEM_KINDS, ITEM_STATUSES, PRIORITIES, PRIVACY_CLASSES, type CaseStatus, type ItemKind } from "../../uc/vocab.ts";

// ── Caso del token ────────────────────────────────────────────────────

export interface McpCase {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  status: CaseStatus;
  catalogVersion: number;
  options: McpViewOptions;
}

/**
 * Il caso del token: dello stesso workspace, creato del tutto e non chiuso.
 * Un caso chiuso non si legge anche se il token non fosse stato revocato.
 */
export async function loadMcpCase(executor: UcExecutor, workspaceId: string, caseId: string): Promise<McpCase | null> {
  if (!isUuid(workspaceId) || !isUuid(caseId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT c.id, c.workspace_id, c.code, c.title, c.status, c.catalog_version, c.ai_environment_approved, c.settings
FROM uc_cases c
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")}
  AND c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso'`),
  ]);
  if (!row) return null;
  const status = rowVocab(CASE_STATUSES, row.status);
  if (!status || status === "chiuso") return null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    code: String(row.code),
    title: String(row.title),
    status,
    catalogVersion: rowNumber(row.catalog_version) ?? 0,
    options: { aiEnvironmentApproved: rowBool(row.ai_environment_approved), clientText: clientTextFromSettings(rowObject(row.settings)) },
  };
}

// ── Letture ───────────────────────────────────────────────────────────

/** Esito di una lettura: il corpo della risposta e i conteggi per l'evento. */
export type McpRead =
  | { ok: true; body: Record<string, unknown>; event: { version?: number; items: number } }
  | { ok: false; code: string; message: string };

function readFailure(code: string, message: string): McpRead {
  return { ok: false, code, message };
}

const CASE_MISSING = readFailure("caso_non_trovato", "Caso non trovato, chiuso, oppure il token è per un altro caso.");

/** `list_cases` (alias `list_use_cases`): il caso del token con stato e prontezza dal vivo. */
export async function readCases(executor: UcExecutor, mcase: McpCase, now = new Date()): Promise<McpRead> {
  const live = await loadCaseReadiness(executor, mcase.workspaceId, mcase.id, now);
  if (!live) return CASE_MISSING;
  const r = live.readiness;
  const view = caseListView([
    {
      id: mcase.id,
      code: mcase.code,
      title: mcase.title,
      status: mcase.status,
      catalogVersion: mcase.catalogVersion,
      readiness: { green_pct: r.green_pct, scope_total: r.scope_total, G1: { required: r.G1.required, ok: r.G1.ok, ready: r.G1.ready } },
      options: mcase.options,
    },
  ]);
  return { ok: true, body: { ok: true, ...view }, event: { items: view.cases.length } };
}

/**
 * `get_validated_catalog`: l'ultima versione congelata (o quella chiesta), solo
 * voci verdi o blu. Il token legge come uno sviluppatore Lateral Space
 * (`ls_sviluppatore`): la visibilità dei valori resta quella della fotografia.
 */
export async function readValidatedCatalog(
  executor: UcExecutor,
  mcase: McpCase,
  params: { version: number | null; kinds: readonly ItemKind[] | null },
): Promise<McpRead> {
  const versionFilter = params.version === null ? ucSql`` : ucSql` AND version = ${cast(params.version, "int")}`;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT version, snapshot FROM uc_catalog_versions WHERE case_id = ${cast(mcase.id, "uuid")}${versionFilter} ORDER BY version DESC LIMIT 1`),
  ]);
  if (!row) {
    return params.version === null
      ? readFailure("nessuna_versione_congelata", "Il catalogo non è ancora congelato: serve l'approvazione del gate G1.")
      : readFailure("versione_non_trovata", "Questa versione del catalogo non esiste.");
  }
  const snapshot = parseStoredSnapshot(rowJson(row.snapshot), mcase.id);
  if (!snapshot || snapshot.version !== rowNumber(row.version)) return readFailure("errore", "La versione congelata non si può leggere.");
  const view = validatedCatalogView(snapshotForViewer(snapshot, { roles: ["ls_sviluppatore"] }), { ...mcase.options, kinds: params.kinds ?? undefined });
  if (!view.ok) return readFailure(view.error, "Il catalogo non è ancora congelato: serve l'approvazione del gate G1.");
  return { ok: true, body: { ...view, case_id: mcase.id }, event: { version: view.version, items: view.items.length } };
}

/**
 * `get_open_items`: voci del gate G1 non ancora a posto, con modulo, etichetta del
 * ruolo che le deve dare e scadenza. Mai nomi, email o tempi per persona.
 */
export async function readOpenItems(executor: UcExecutor, mcase: McpCase, now = new Date()): Promise<McpRead> {
  const live = await loadCaseReadiness(executor, mcase.workspaceId, mcase.id, now);
  if (!live) return CASE_MISSING;
  const missing = live.g1.missing;
  const ids = missing.map((m) => m.itemId);
  // I ruoli dalle parti del template, lette una volta per impronta (DESIGN §7.1 P0-5 b).
  const template = templatePartsReader();
  const [itemRows, [caseRow]] = await executor.batch([
    toStatement(ucSql`SELECT i.id, i.title, i.due_at, i.due_is_proposal FROM uc_items i
WHERE i.case_id = ${cast(mcase.id, "uuid")} AND i.id = ANY(${cast(ids, "uuid[]")}) AND i.deleted_at IS NULL`),
    toStatement(ucSql`SELECT ${template.columns}, c.settings FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.id = ${cast(mcase.id, "uuid")} AND c.workspace_id = ${cast(mcase.workspaceId, "uuid")}`),
  ]);
  const byId = new Map(itemRows.map((r) => [String(r.id), r]));
  const items: OpenItemInput[] = missing.map((m) => {
    const r = byId.get(m.itemId);
    return {
      key: m.key,
      title: r ? rowString(r.title) : null,
      status: m.status,
      moduleKey: m.moduleKey,
      roleKey: m.roleKey,
      dueAt: r ? rowDate(r.due_at) : null,
      dueIsProposal: r ? rowBool(r.due_is_proposal) : false,
    };
  });
  const roleLabels = caseRow ? roleLabelsFrom(template.read(caseRow)?.roles ?? null, rowObject(caseRow.settings)) : {};
  const view = openItemsView({ gate: "G1", items, roleLabels }, mcase.options);
  return {
    ok: true,
    body: { ok: true, case_id: mcase.id, case_code: mcase.code, catalog_version: mcase.catalogVersion > 0 ? mcase.catalogVersion : null, ...view },
    event: { items: view.count },
  };
}

/** `get_data_dictionary`: entità e campi con tipi, unità e classi privacy. Struttura, mai valori. */
export async function readDataDictionary(executor: UcExecutor, mcase: McpCase): Promise<McpRead> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT i.key, i.kind, p.key AS parent_key, i.title, i.explanation, i.spec, i.privacy_class, i.priority, i.status
FROM uc_items i LEFT JOIN uc_items p ON p.id = i.parent_item_id
WHERE i.case_id = ${cast(mcase.id, "uuid")} AND i.deleted_at IS NULL AND i.kind IN ('entita', 'campo')
ORDER BY i.key`),
  ]);
  const items: DictionaryItemInput[] = rows.flatMap((r) => {
    const kind = rowVocab(ITEM_KINDS, r.kind);
    const status = rowVocab(ITEM_STATUSES, r.status);
    if (!kind || !status) return [];
    return [
      {
        key: String(r.key),
        kind,
        parentKey: rowString(r.parent_key),
        title: String(r.title ?? ""),
        explanation: rowString(r.explanation),
        spec: rowObject(r.spec),
        privacyClass: rowVocab(PRIVACY_CLASSES, r.privacy_class) ?? "riservato_azienda",
        priority: rowVocab(PRIORITIES, r.priority),
        status,
      },
    ];
  });
  const view = dataDictionaryView(items, mcase.options);
  const count = view.entities.reduce((n, e) => n + 1 + e.fields.length, 0);
  return { ok: true, body: { ok: true, case_id: mcase.id, case_code: mcase.code, ...view }, event: { items: count } };
}

/** `get_gate_status`: il calcolo di G1 dal vivo e lo storico delle decisioni (date e ruoli). */
export async function readGateStatus(executor: UcExecutor, mcase: McpCase, now = new Date()): Promise<McpRead> {
  const live = await loadCaseReadiness(executor, mcase.workspaceId, mcase.id, now);
  if (!live) return CASE_MISSING;
  const reviews = await listGateReviews(executor, mcase.id);
  const view = gateStatusView(
    {
      computation: live.g1,
      reviews: reviews.map((r) => ({
        gateKey: r.gate,
        decision: r.decision,
        proposedAt: r.proposedAt,
        decidedAt: r.decidedAt,
        catalogVersion: r.catalogVersion,
        approvals: r.signatures,
      })),
    },
    mcase.options,
  );
  const version = mcase.catalogVersion > 0 ? mcase.catalogVersion : undefined;
  // La vista ha un campo `ok` (voci a posto): resta annidata per non coprire l'esito.
  return {
    ok: true,
    body: {
      ok: true,
      case_id: mcase.id,
      case_code: mcase.code,
      catalog_version: version ?? null,
      gate_reconfirm: live.readiness.gate_reconfirm,
      ...(view.text_hidden ? { text_hidden: view.text_hidden } : {}),
      gate_status: view,
    },
    event: { version, items: view.required },
  };
}

// ── Audit ─────────────────────────────────────────────────────────────

export interface McpReadEvent {
  workspaceId: string;
  caseId: string;
  integrationTokenId: string;
  tool: McpCaseTool;
  version?: number;
  items: number;
  ipHash?: string | null;
  userAgent?: string | null;
}

/** `catalogo.letto_mcp`: strumento, versione e numero di voci. Mai valori né testi. */
export function mcpReadEventStatement(e: McpReadEvent) {
  return toStatement(
    eventInsertSql({
      type: "catalogo.letto_mcp",
      workspaceId: e.workspaceId,
      caseId: e.caseId,
      actor: { type: "mcp", integrationTokenId: e.integrationTokenId },
      targetType: "caso",
      targetId: e.caseId,
      payload: { tool: e.tool, ...(e.version !== undefined ? { version: e.version } : {}), items: e.items },
      ipHash: e.ipHash ?? null,
      userAgent: e.userAgent ?? null,
    }),
  );
}

export async function recordMcpRead(executor: UcExecutor, e: McpReadEvent): Promise<void> {
  await executor.batch([mcpReadEventStatement(e)]);
}

// ── Token Claude del caso ─────────────────────────────────────────────

export interface CaseReadTokenItem {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: GrantableCaseScope[];
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

/**
 * Token Claude limitati a questo caso (mai il segreto né l'hash).
 * `workspace_integration_tokens` usa `timestamp` senza fuso scritto in UTC (come
 * Drizzle): le date si leggono con `AT TIME ZONE 'UTC'`, così non dipendono dal
 * fuso del processo né da quello della sessione.
 */
export async function listCaseReadTokens(executor: UcExecutor, workspaceId: string, caseId: string): Promise<CaseReadTokenItem[]> {
  if (!isUuid(workspaceId) || !isUuid(caseId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, label, token_prefix, scopes,
  created_at AT TIME ZONE 'UTC' AS created_at, expires_at AT TIME ZONE 'UTC' AS expires_at,
  last_used_at AT TIME ZONE 'UTC' AS last_used_at, revoked_at AT TIME ZONE 'UTC' AS revoked_at,
  revoked_at IS NULL AND (expires_at IS NULL OR expires_at > (now() AT TIME ZONE 'UTC')) AS active
FROM workspace_integration_tokens
WHERE workspace_id = ${cast(workspaceId, "uuid")} AND scopes ? ${cast(caseScopeMarker(caseId), "text")}
ORDER BY created_at DESC`),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    tokenPrefix: String(r.token_prefix),
    scopes: grantedCaseScopes(rowJson<Json>(r.scopes)),
    createdAt: rowDate(r.created_at)?.toISOString() ?? null,
    expiresAt: rowDate(r.expires_at)?.toISOString() ?? null,
    lastUsedAt: rowDate(r.last_used_at)?.toISOString() ?? null,
    revokedAt: rowDate(r.revoked_at)?.toISOString() ?? null,
    active: rowBool(r.active),
  }));
}

/** Revoca un solo token del caso; false se non c'è, è di un altro caso o è già revocato. */
export async function revokeCaseReadToken(executor: UcExecutor, i: { workspaceId: string; caseId: string; tokenId: string }): Promise<boolean> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId) || !isUuid(i.tokenId)) return false;
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
WHERE id = ${cast(i.tokenId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")}
  AND scopes ? ${cast(caseScopeMarker(i.caseId), "text")} AND revoked_at IS NULL
RETURNING id`),
  ]);
  return rows.length === 1;
}
