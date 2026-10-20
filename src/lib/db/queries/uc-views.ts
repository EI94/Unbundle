/**
 * Letture delle pagine interne del caso costruite da WP9 (PIANO §5.1) che
 * l'app usa ancora: il contesto del caso con le parti del template
 * (`caseViewContextReader`), il dettaglio della voce (Domande) e la selezione
 * «tutti i risultati». Catalogo, coda di verifica, ROI, Regole, Modello dati,
 * KPI, Documenti e Mappa sono passati alle letture di area (`uc-questions.ts`,
 * `uc-solution.ts`, `uc-value.ts`) e qui non ci sono più (DESIGN §8.3 WP13).
 *
 * Solo letture, in un batch per pagina (una transazione: righe coerenti tra
 * loro). L'accesso al workspace (`requireWorkspacePage`) e al caso
 * (`requireCaseRole`) lo controlla la pagina prima di chiamare queste funzioni;
 * qui ogni SELECT è filtrata per caso, i valori personali e sanitari non escono
 * dal database e la visibilità per ruolo si applica prima di restituire.
 *
 * Ruoli, moduli, gate e conto del template arrivano dalla memoria per impronta
 * (`caseViewContextReader`, DESIGN §7.1 P0-5 b): la definizione si legge una
 * volta per processo. Tutte le letture del dossier che vogliono il contesto
 * del caso passano da qui.
 *
 * Modulo senza import dell'app, come `uc-cases.ts`: l'esecutore arriva da fuori.
 */
import { caseBlockersSql, caseCoreSql, parseCaseCore, rowToCaseBlocker, type CaseCore } from "../../uc/sql/readiness.ts";
import { templatePartsReader, type TemplateParts } from "../../uc/sql/template-parts.ts";
import { itemSnapshotsSql, rowToLoadedItem, type LoadedItem } from "../../uc/sql/transitions.ts";
import type { Json, UserContext } from "../../uc/types.ts";
import type { CaseRole, ItemStatus } from "../../uc/vocab.ts";
import type { UcStatement } from "../../uc/sql/statement.ts";
import { catalogWhereSql, type CatalogFilter } from "../../uc/views/catalog-filter.ts";
import {
  itemActions,
  itemBlockers,
  itemNotes,
  parseItemDetailRow,
  rowsToAnswers,
  rowsToComments,
  rowsToEvents,
  rowsToFiles,
  rowsToLinkGroups,
  rowsToValidations,
  specEntries,
  type AnswerVersionView,
  type CommentView,
  type EventView,
  type FileView,
  type ItemActions,
  type ItemBlockerView,
  type ItemDetailHeader,
  type LinkGroup,
  type SpecEntry,
  type ValidationView,
} from "../../uc/views/item-detail.ts";
import { isClientViewer, seesInternalComments, seesPersonalZoneMetadata, seesValidatedOnly } from "../../uc/views/page-access.ts";
import { parseCaseViewContext, rowToContact, rowsToSelection, type CaseViewContext, type ContactOption } from "../../uc/views/rows.ts";
import {
  caseViewContextSql,
  CATALOG_SELECTION_MAX,
  catalogSelectionSql,
  contactsSql,
  itemAnswersSql,
  itemCommentsSql,
  itemDetailSql,
  itemEventsSql,
  itemFilesSql,
  itemLinksSql,
  itemValidationsSql,
  roleGroupItemsSql,
} from "../../uc/views/sql.ts";
import type { UcExecutor, UcRow } from "../uc-executor.ts";

/** Chi guarda: ruoli che valgono adesso (da `requireCaseRole`) e contesto utente. */
export interface UcViewer {
  workspaceId: string;
  caseId: string;
  roles: readonly CaseRole[];
  user: UserContext;
  readOnly: boolean;
}

export interface CaseViewBase {
  ctx: CaseViewContext;
  contacts: ContactOption[];
  contactMap: Map<string, ContactOption>;
}

export interface CaseViewContextReader {
  /** La riga del caso con il template (impronta e, se nuova, le parti). */
  statement: UcStatement;
  /** Il contesto dalle righe di `statement`, con ruoli e moduli rimessi dalle parti (dalla riga o dalla memoria). */
  parse(rows: readonly UcRow[] | undefined): CaseViewContext | null;
  /** Il conto dello schema di partenza (`definition.roi`) dalle stesse righe: null senza caso o senza conto. */
  templateRoi(rows: readonly UcRow[] | undefined): Json | null;
  /** Le parti del template dalle stesse righe (gate compresi): null senza caso. */
  parts(rows: readonly UcRow[] | undefined): TemplateParts | null;
}

/**
 * Il contesto del caso (`caseViewContextSql`) con ruoli, moduli, gate e conto
 * del template letti una volta per impronta (DESIGN §7.1 P0-5 b). Uno per
 * giro: lo statement va nel batch della pagina, `parse` (e `templateRoi`,
 * `parts`) sulle sue righe. È l'unico modo di leggere il contesto del caso:
 * `caseViewContextSql` vuole le colonne delle parti.
 */
export function caseViewContextReader(workspaceId: string, caseId: string): CaseViewContextReader {
  const parts = templatePartsReader();
  return {
    statement: caseViewContextSql(workspaceId, caseId, parts.columns),
    parse(rows) {
      const r = rows?.[0];
      if (!r) return null;
      const p = parts.read(r);
      return parseCaseViewContext({ ...r, template_roles: p?.roles ?? [], modules: p?.modules ?? [] });
    },
    templateRoi: (rows) => parts.read(rows?.[0])?.roi ?? null,
    parts: (rows) => parts.read(rows?.[0]),
  };
}

function baseFrom(context: CaseViewContextReader, ctxRows: readonly UcRow[], contactRows: readonly UcRow[]): CaseViewBase | null {
  const ctx = context.parse(ctxRows);
  if (!ctx) return null;
  const contacts = contactRows.map(rowToContact);
  return { ctx, contacts, contactMap: new Map(contacts.map((c) => [c.id, c])) };
}

function baseStatements(v: UcViewer, context: CaseViewContextReader) {
  return [context.statement, contactsSql(v.workspaceId)];
}

// ── Selezione del catalogo ────────────────────────────────────────

export type CatalogSelectionSpec = { kind: "filtro"; filter: CatalogFilter } | { kind: "ruolo"; roleKey: string; includeAssigned: boolean };

export interface CatalogSelection {
  /** Voci selezionate (al massimo `CATALOG_SELECTION_MAX`). */
  total: number;
  /** Le voci erano di più: si selezionano solo le prime. */
  truncated: boolean;
  /** Id per stato: chi agisce tiene solo gli stati che l'azione ammette. */
  byStatus: Partial<Record<ItemStatus, string[]>>;
}

/**
 * «Seleziona tutti i risultati»: id e stato delle voci che corrispondono ai
 * filtri (gli stessi della pagina, compresa la vista dello sviluppatore),
 * oppure di un gruppo per ruolo da assegnare. Solo letture: i comandi
 * ricontrollano ogni voce.
 */
export async function loadCatalogSelection(executor: UcExecutor, v: UcViewer, spec: CatalogSelectionSpec): Promise<CatalogSelection> {
  const validatedOnly = seesValidatedOnly(v.roles);
  if (spec.kind === "ruolo" && validatedOnly) return { total: 0, truncated: false, byStatus: {} };
  const statement =
    spec.kind === "filtro"
      ? catalogSelectionSql(catalogWhereSql(v.caseId, spec.filter, { userId: v.user.userId, validatedOnly }))
      : roleGroupItemsSql(v.caseId, spec.roleKey, spec.includeAssigned);
  const [rows] = await executor.batch([statement]);
  return rowsToSelection(rows, CATALOG_SELECTION_MAX);
}

// ── Dettaglio della voce ──────────────────────────────────────────────

export interface ItemDetailData extends CaseViewBase {
  core: CaseCore;
  loaded: LoadedItem;
  header: ItemDetailHeader;
  spec: SpecEntry[];
  notes: { label: string; text: string }[];
  moduleTitle: string | null;
  ownerRoleLabel: string | null;
  assigneeName: string | null;
  blockers: ItemBlockerView[];
  answers: AnswerVersionView[];
  files: FileView[];
  validations: ValidationView[];
  comments: CommentView[];
  links: LinkGroup[];
  events: EventView[];
  actions: ItemActions;
  clientViewer: boolean;
}

export async function loadItemDetail(executor: UcExecutor, v: UcViewer, itemId: string): Promise<ItemDetailData | null> {
  const clientViewer = isClientViewer(v.roles);
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const rows = await executor.batch([
    ...baseStatements(v, context),
    caseCoreSql(v.workspaceId, v.caseId),
    itemSnapshotsSql(v.caseId, { itemIds: [itemId] }),
    itemDetailSql(v.caseId, itemId),
    itemAnswersSql(v.caseId, itemId),
    itemFilesSql(v.caseId, itemId, seesPersonalZoneMetadata(v.roles)),
    itemValidationsSql(v.caseId, itemId),
    itemCommentsSql(v.caseId, itemId, seesInternalComments(v.roles)),
    itemLinksSql(v.caseId, itemId),
    itemEventsSql(v.caseId, itemId, clientViewer),
    caseBlockersSql(v.caseId),
  ]);
  const base = baseFrom(context, rows[0], rows[1]);
  const core = parseCaseCore(rows[2][0]);
  const loadedRow = rows[3][0];
  const header = parseItemDetailRow(rows[4][0], v.roles);
  if (!base || !core || !loadedRow || !header) return null;
  const loaded = rowToLoadedItem(loadedRow);
  const s = loaded.snapshot;
  const labels = new Map(rows[11].map(rowToCaseBlocker).map((b) => [b.key, b.label]));
  const roleLabel = (k: string | null) => (k ? (base.ctx.roleLabels[k] ?? k) : null);
  return {
    ...base,
    core,
    loaded,
    header,
    spec: specEntries(loaded.extra.spec),
    notes: itemNotes(loaded.extra.spec),
    moduleTitle: loaded.extra.requestModuleKey ? (base.ctx.modules.find((m) => m.key === loaded.extra.requestModuleKey)?.title ?? loaded.extra.requestModuleKey) : null,
    ownerRoleLabel: roleLabel(s.ownerRoleKey),
    assigneeName: s.assigneeContactId ? (base.contactMap.get(s.assigneeContactId)?.name ?? "Referente") : null,
    blockers: itemBlockers(loaded, labels),
    answers: rowsToAnswers(rows[5], {
      privacyClass: s.privacyClass,
      valueVisibility: loaded.extra.valueVisibility,
      roles: v.roles,
      currentAnswerId: s.currentAnswer?.id ?? null,
      validatedAnswerId: loaded.extra.validatedAnswerId,
      roleLabels: base.ctx.roleLabels,
    }),
    files: rowsToFiles(rows[6], v.roles),
    validations: rowsToValidations(rows[7], s.currentAnswer?.id ?? null),
    comments: rowsToComments(rows[8], v.roles),
    links: rowsToLinkGroups(rows[9]),
    events: rowsToEvents(rows[10], v.roles),
    actions: itemActions({ loaded, roles: v.roles, user: v.user, readOnly: v.readOnly, caseStatus: core.status, designatedOwnerContactId: core.designated.owner }),
    clientViewer,
  };
}
