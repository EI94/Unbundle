/**
 * Export del catalogo (PIANO §5.9, WP12b).
 *
 * - `loadExportSnapshot`: l'ultima versione congelata, una versione precisa, o
 *   la bozza costruita dal vivo (ruoli Lateral Space, e il responsabile del
 *   cliente prima del via: la route chiede `requireBeforeVia` e la bozza si
 *   rifiuta se nello stesso giro il caso ha già una versione congelata). I
 *   valori personali e sanitari non escono mai: la SQL della fotografia li
 *   lascia nel DB e `parseStoredSnapshot` li toglie di nuovo.
 * - `recordCatalogExport`: evento `catalogo.esportato` `{format, version}` per
 *   ogni download.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`:
 * l'esecutore arriva da fuori; l'accesso al workspace e al caso lo controlla il
 * chiamante (route handler: `requireWorkspaceAccess` e `openUcCase`).
 */
import { DRAFT_AFTER_VIA_MESSAGE, type ExportFormat, type ExportVersion } from "../../uc/export/request.ts";
import { parseStoredSnapshot } from "../../uc/export/render.ts";
import { buildCatalogSnapshot, type CatalogSnapshot } from "../../uc/snapshot.ts";
import {
  computeCaseReadiness,
  parseReadinessRows,
  readinessReadStatements,
  rowNumber,
  rowString,
  rowToSnapshotItem,
  rowToSnapshotLink,
  snapshotCaseSql,
  snapshotItemsSql,
  snapshotLinksSql,
} from "../../uc/sql/readiness.ts";
import { cast, raw, toStatement, ucSql } from "../../uc/sql/statement.ts";
import { fail, type Result } from "../../uc/types.ts";
import { eventInsertSql, type EventActor } from "./uc-events.ts";
import { isUuid } from "./uc-cases.ts";
import type { UcExecutor } from "../uc-executor.ts";

const CASE_NOT_FOUND = "Caso non trovato.";

// ── Export ────────────────────────────────────────────────────────────

/** Versione congelata del caso: l'ultima, oppure quella chiesta. Solo righe di un caso completo del workspace. */
async function loadFrozenSnapshot(executor: UcExecutor, workspaceId: string, caseId: string, version: number | null): Promise<Result<CatalogSnapshot>> {
  const versionFilter = version === null ? raw("") : ucSql` AND v.version = ${cast(version, "int")}`;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT v.version, v.snapshot
FROM uc_catalog_versions v
JOIN uc_cases c ON c.id = v.case_id
WHERE v.case_id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL${versionFilter}
ORDER BY v.version DESC
LIMIT 1`),
  ]);
  const row = rows[0];
  if (!row) {
    return version === null
      ? fail("nessuna_versione", "Il catalogo non ha ancora una versione congelata: nasce con l'approvazione del gate.")
      : fail("versione_assente", "Questa versione del catalogo non esiste.");
  }
  const found = rowNumber(row.version);
  if (found === null) return fail("versione_illeggibile", "La versione salvata del catalogo non si legge. Avvisa Lateral Space.");
  return parseStoredSnapshot(row.snapshot, { caseId, workspaceId, version: found });
}

/**
 * Bozza dal vivo, in una sola transazione: prontezza (per il riquadro del gate)
 * e voci con testi, risposte validate e correnti, collegamenti. Nella bozza ogni
 * voce non a posto esce come «non validata».
 *
 * Con `requireBeforeVia` (il responsabile del cliente) la bozza c'è solo se il
 * caso non ha ancora una versione congelata: `catalog_version` arriva nello
 * stesso giro delle voci, così un via che arriva a metà non lascia passare la
 * bozza di dopo il via.
 */
async function loadDraftSnapshot(executor: UcExecutor, workspaceId: string, caseId: string, now: Date, requireBeforeVia: boolean): Promise<Result<CatalogSnapshot>> {
  const readinessStatements = readinessReadStatements(workspaceId, caseId);
  const rows = await executor.batch([...readinessStatements, snapshotCaseSql(workspaceId, caseId), snapshotItemsSql(caseId), snapshotLinksSql(caseId)]);
  const input = parseReadinessRows(rows.slice(0, readinessStatements.length));
  const n = readinessStatements.length;
  const caseRow = rows[n]?.[0];
  if (!input || !caseRow) return fail("non_trovato", CASE_NOT_FOUND);
  if (requireBeforeVia && input.core.catalogVersion > 0) return fail("bozza_non_ammessa", DRAFT_AFTER_VIA_MESSAGE);
  const { g1 } = computeCaseReadiness(input, now);
  const core = input.core;
  return buildCatalogSnapshot({
    case: {
      id: core.id,
      workspaceId: core.workspaceId,
      code: core.code,
      title: core.title,
      perimeterLabel: rowString(caseRow.perimeter_label),
      contractRefs: core.contractRefs,
      dataControllerLabel: rowString(caseRow.data_controller_label),
    },
    template: { key: String(caseRow.template_key), version: String(caseRow.template_version), hash: String(caseRow.template_hash) },
    version: "bozza",
    frozenAt: null,
    // Riquadro del gate dal calcolo dal vivo: nessuna proposta, nessuna decisione, nessuna impronta firmata.
    gate: {
      key: "G1",
      reviewId: null,
      decision: null,
      policyScope: core.policy.scope,
      required: g1.required,
      ok: g1.ok,
      summaryTextHash: null,
      waiverKeys: g1.waivers.keys,
    },
    items: (rows[n + 1] ?? []).map(rowToSnapshotItem),
    links: (rows[n + 2] ?? []).map(rowToSnapshotLink),
  });
}

/**
 * La fotografia da esportare, non ancora filtrata per il ruolo (`snapshotForViewer`
 * lo fa la route). `requireBeforeVia`: la bozza solo prima del via allo
 * sviluppo, altrimenti `bozza_non_ammessa`.
 */
export async function loadExportSnapshot(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; version: ExportVersion; now?: Date; requireBeforeVia?: boolean },
): Promise<Result<CatalogSnapshot>> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return fail("non_trovato", CASE_NOT_FOUND);
  if (i.version.kind === "bozza") return loadDraftSnapshot(executor, i.workspaceId, i.caseId, i.now ?? new Date(), i.requireBeforeVia === true);
  return loadFrozenSnapshot(executor, i.workspaceId, i.caseId, i.version.kind === "numero" ? i.version.version : null);
}

/** Evento di audit del download: formato e versione, nient'altro. */
export async function recordCatalogExport(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; actor: EventActor; format: ExportFormat; version: number | "bozza" },
): Promise<void> {
  await executor.batch([
    toStatement(
      eventInsertSql({
        type: "catalogo.esportato",
        workspaceId: i.workspaceId,
        caseId: i.caseId,
        actor: i.actor,
        targetType: "catalogo",
        targetId: i.caseId,
        payload: { format: i.format, version: i.version },
      }),
    ),
  ]);
}
