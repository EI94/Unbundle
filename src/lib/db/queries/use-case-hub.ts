import "server-only";
import { and, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { useCases, users, type UseCase } from "@/lib/db/schema";
import { getWorkspaceScoringModel, normalizeScoringConfig } from "@/lib/db/queries/scoring-model";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { dossierSummaries, type DossierSummary } from "@/lib/db/queries/use-case-dossiers";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { isLateralSpaceEmail } from "@/lib/uc/lateral-space";
import { pendingAnswer, type InfoAnswer } from "@/lib/use-cases/answers";
import { resolveCostBands, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import {
  abilitiesForUseCase,
  isOwnReceipt,
  type ContributorUseCase,
  type UseCaseViewer,
} from "@/lib/use-cases/permissions";
import { romeToday } from "@/lib/use-cases/quarter";
import type { IsoDate } from "@/lib/use-cases/types";
import type { ValuationModel } from "@/lib/use-cases/valuation";
import {
  compareWaiting,
  exportRow,
  projectContributorRow,
  projectHubItem,
  projectUseCaseDetail,
  romeDay,
  waitingStart,
  workspaceValuationModel,
  type ExportRow,
  type HubContext,
  type HubDossier,
  type HubItem,
  type UseCaseDetail,
} from "@/lib/use-cases/views";

/**
 * Letture dell'area «Use case», proiettate per ruolo sul server (docs/use-case/DESIGN.md
 * §4.10, §6.7, §6.9, §9.3, §11; PIANO-LAVORI H2b). D4 e D13 valgono già qui, in tutti i
 * workspace (le GET REST e l'export non guardano l'interruttore dell'area).
 *
 * - **Contributori**: `ContributorUseCase` di `permissions.ts`. Delle proposte altrui
 *   titolo, fase e «Quando»; delle proprie anche codice e nota pubblica. Le schede nascoste
 *   alla ricerca e non proprie non escono: la lista le salta, la scheda risponde `null`
 *   (404). Le GET REST rispondono solo a chi valuta. Le query non guardano chi ha proposto: passano la riga a
 *   `isOwnProposal` e il filtro si applica dopo, qui sul server.
 * - **Revisori**: `HubItem` e `UseCaseDetail` di `views.ts`, senza il proponente.
 * - **Chi gestisce il workspace**: come i revisori, più `projectForManager`, l'unica
 *   funzione dell'area che nomina il proponente (art. 15.4, `art15-4.source.test.ts`).
 *   Nella lista, nell'export e nella REST di oggi non compare mai: solo nella scheda
 *   («Proposto da», «Email indicata»).
 *
 * Una query per la lista: la riga intera della scheda più due sottoquery sulla Storia
 * (ultimo «Riapri» e ultimo passaggio a «Realizzato»), mai per persona. Le letture del
 * dossier passano da `use-case-dossiers.ts` e non rompono l'area: sezione spenta o tabelle
 * assenti, nessun dossier; errore, nessun dossier e una riga di log.
 *
 * Valore, costo e zone usano il modello del workspace e le sue fasce (`resolveCostBands`,
 * D15), restituite anche a chi disegna matrice, righe ed export.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Chi guarda, dalla sessione e dal ruolo appena riletto (`getCollaboratorAccess`). */
export function viewerFromSession(
  user: { id: string; email: string | null; emailVerified: boolean },
  role: string | null,
): UseCaseViewer {
  return {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified === true,
    role,
    isLateralSpace: isLateralSpaceEmail({ email: user.email, emailVerified: user.emailVerified === true }, ucLsDomains()),
  };
}

// ─── Workspace e dossier ─────────────────────────────────────────────

interface ReadContext extends HubContext {
  /** Le fasce del costo del workspace (D15), già risolte. */
  costBands: readonly CostBandInfo[];
}

/** Il modello di valutazione del workspace (senza crearlo: è una lettura), ESG e oggi a Roma. */
async function readContext(workspaceId: string, now: Date): Promise<ReadContext> {
  const [workspace, scoring] = await Promise.all([getWorkspaceById(workspaceId), getWorkspaceScoringModel(workspaceId)]);
  const resolved = scoring?.resolvedConfig ?? normalizeScoringConfig(null);
  const model = workspaceValuationModel(resolved, scoring?.config ?? null);
  return { model, esgEnabled: workspace?.esgEnabled === true, today: romeToday(now), costBands: resolveCostBands(model) };
}

/** Come è andata la lettura del dossier: «spenta» e «errore» lasciano l'area senza dossier. */
export type DossierReadStatus = "ok" | "spenta" | "errore";

interface DossierLookup {
  status: DossierReadStatus;
  of(useCaseId: string): HubDossier | null;
}

async function readDossiers(workspaceId: string, useCaseIds: readonly string[]): Promise<DossierLookup> {
  const read = await dossierSummaries(workspaceId, useCaseIds);
  const found: ReadonlyMap<string, DossierSummary> = read.ok ? read.summaries : new Map();
  return {
    status: read.ok ? "ok" : read.motivo,
    of: (useCaseId) => found.get(useCaseId.toLowerCase()) ?? null,
  };
}

// ─── Righe ───────────────────────────────────────────────────────────
//
// Le due sottoquery nominano `use_cases.id` per esteso: nella lista del SELECT Drizzle
// scrive le colonne senza la tabella, e un `"id"` lì dentro sarebbe quello della Storia.

/** Ultimo «Riapri»: riga `decisione` della Storia con la fase di prima in «Chiuso» (§4.3). Giorno a Roma. */
const REOPENED_ON: SQL<string | null> = sql`(SELECT to_char(max(e.at) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD')
  FROM use_case_events e
  WHERE e.use_case_id = use_cases.id AND e.action = 'decisione' AND e.phase_before LIKE 'chiuso.%')`;

/** Ultimo passaggio a «Realizzato» (mese di «Fatti»). Giorno a Roma. */
const REALIZED_ON: SQL<string | null> = sql`(SELECT to_char(max(e.at) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD')
  FROM use_case_events e
  WHERE e.use_case_id = use_cases.id AND e.action = 'decisione' AND e.phase_after LIKE 'realizzato.%')`;

/** Le schede del workspace (o una sola), intere, con i due giorni letti dalla Storia. */
async function selectHubRows(workspaceId: string, useCaseId?: string) {
  return db
    .select({ ...getTableColumns(useCases), reopenedOn: REOPENED_ON, realizedOn: REALIZED_ON })
    .from(useCases)
    .where(useCaseId ? and(eq(useCases.workspaceId, workspaceId), eq(useCases.id, useCaseId)) : eq(useCases.workspaceId, workspaceId));
}

type HubRow = Awaited<ReturnType<typeof selectHubRows>>[number];

// ─── Chi gestisce il workspace ───────────────────────────────────────

/** «Proposto da» per una persona di Slack (DESIGN §6.2). */
const SLACK_PERSON = "persona su Slack";
/** «Proposto da» per un id utente senza più l'account: mai l'id, che è una chiave interna. */
const FORMER_PERSON = "persona non più su Unbundle";
const SLACK_USER_ID = /^[UW][A-Z0-9]{6,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * La proiezione di chi gestisce il workspace (DESIGN §4.10, §6.2, §9.3, §11): l'unico posto
 * dell'area che nomina chi ha proposto.
 * - `proposer`: «Proposto da» ed «Email indicata» della scheda, sotto «Dettagli». Un id
 *   utente si risolve in un nome con `personName` (senza più l'account, «persona non più
 *   su Unbundle», mai l'id); un'email resta l'email; un id Slack diventa «persona su
 *   Slack»; ogni altro testo resta com'è.
 * Non entra mai in liste, filtri, ordinamenti, conteggi, export o REST.
 */
function projectForManager(row: UseCase) {
  const proposedBy = typeof row.proposedBy === "string" && row.proposedBy.trim() ? row.proposedBy.trim() : null;
  const submitterEmail = typeof row.intake?.submitterEmail === "string" && row.intake.submitterEmail.trim() ? row.intake.submitterEmail.trim() : null;
  let label: string | null = proposedBy;
  let userId: string | null = null;
  if (proposedBy !== null && isUuid(proposedBy)) {
    userId = proposedBy.toLowerCase();
    label = FORMER_PERSON;
  } else if (proposedBy !== null && !EMAIL.test(proposedBy) && (row.source === "slack_proposed" || SLACK_USER_ID.test(proposedBy))) {
    label = SLACK_PERSON;
  }
  return {
    proposer: { label, email: submitterEmail, userId },
  };
}

/** «Proposto da» ed «Email indicata» (solo per chi gestisce il workspace). */
export interface ProposerDetails {
  label: string | null;
  email: string | null;
}

/** Il nome di una persona (o la sua email se non ha nome); null se non c'è più. */
async function personName(userId: string): Promise<string | null> {
  const [person] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!person) return null;
  return person.name?.trim() || person.email || null;
}

async function proposerDetails(row: UseCase): Promise<ProposerDetails> {
  const { proposer } = projectForManager(row);
  const label = proposer.userId ? ((await personName(proposer.userId)) ?? proposer.label) : proposer.label;
  return { label, email: proposer.email };
}

// ═══ Lista della pagina (§4) ═════════════════════════════════════════

/** La ricevuta in cima alla pagina (§5.5): solo a chi ha appena proposto. */
export interface HubReceipt {
  id: string;
  title: string;
  code: string | null;
}

interface HubListBase {
  today: IsoDate;
  dossierRead: DossierReadStatus;
  receipt: HubReceipt | null;
}

export type HubList =
  | (HubListBase & { projection: "contributore"; items: ContributorUseCase[] })
  | (HubListBase & {
      projection: "revisore" | "gestore";
      items: HubItem[];
      model: ValuationModel;
      /** Le fasce del costo del workspace (D15), per matrice, righe, pannello e card. */
      costBands: readonly CostBandInfo[];
      esgEnabled: boolean;
    });

export interface HubReadOptions {
  /** `?created=<id>`: la ricevuta, se la scheda è di chi guarda (`isOwnReceipt`). */
  createdId?: string | null;
  now?: Date;
}

function receiptOf(viewer: UseCaseViewer, rows: readonly HubRow[], createdId: string | null | undefined): HubReceipt | null {
  if (!isUuid(createdId)) return null;
  const row = rows.find((item) => item.id.toLowerCase() === createdId.toLowerCase());
  return row && isOwnReceipt(viewer, row) ? { id: row.id, title: row.title, code: row.code ?? null } : null;
}

/**
 * Tutti gli use case del workspace per la pagina, già proiettati per chi guarda (§4.10, §11).
 * null per chi non entra nell'area (`learner`, nessun ruolo). L'ordine è quello di «Da
 * decidere»: chi aspetta da più giorni prima (D8); le viste lo rifanno per sé.
 */
export async function listHubItems(workspaceId: string, viewer: UseCaseViewer, opts: HubReadOptions = {}): Promise<HubList | null> {
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea || !abilities.projection || !isUuid(workspaceId)) return null;
  await ensureDbSchema();
  const [rows, ctx] = await Promise.all([selectHubRows(workspaceId), readContext(workspaceId, opts.now ?? new Date())]);
  const dossiers = await readDossiers(
    workspaceId,
    rows.map((row) => row.id),
  );
  const base: HubListBase = { today: ctx.today as IsoDate, dossierRead: dossiers.status, receipt: receiptOf(viewer, rows, opts.createdId) };

  if (abilities.projection === "contributore") {
    const visible: Array<{ item: ContributorUseCase; since: string; arrivedOn: string }> = [];
    for (const row of rows) {
      const item = projectContributorRow(viewer, row, dossiers.of(row.id), ctx.today);
      if (!item) continue;
      const arrivedOn = romeDay(row.submittedAt ?? row.createdAt) ?? ctx.today;
      visible.push({ item, arrivedOn, since: waitingStart({ subState: item.subState, reviewBy: row.reviewBy, reopenedOn: row.reopenedOn, arrivedOn }) });
    }
    visible.sort((a, b) => a.since.localeCompare(b.since) || a.arrivedOn.localeCompare(b.arrivedOn) || a.item.id.localeCompare(b.item.id));
    return { ...base, projection: "contributore", items: visible.map((entry) => entry.item) };
  }

  const items = rows.map((row) => projectHubItem(row, ctx, dossiers.of(row.id))).sort(compareWaiting);
  return { ...base, projection: abilities.projection, items, model: ctx.model, costBands: ctx.costBands, esgEnabled: ctx.esgEnabled };
}

// ═══ Scheda (§6) ═════════════════════════════════════════════════════

interface DetailBase {
  today: IsoDate;
  dossierRead: DossierReadStatus;
}

export type UseCaseDetailResult =
  | (DetailBase & {
      projection: "contributore";
      useCase: ContributorUseCase;
      /**
       * Di una propria proposta, la propria risposta a «Serve info» finché nessuno ha deciso (D17,
       * `pendingAnswer`): chi ha proposto la rilegge sotto la domanda. null altrimenti. Fuori dalla
       * proiezione (lista, REST, MCP): la porta solo la scheda e il pannello aperto.
       */
      answer: InfoAnswer | null;
    })
  | (DetailBase & {
      projection: "revisore";
      useCase: UseCaseDetail;
      model: ValuationModel;
      costBands: readonly CostBandInfo[];
      esgEnabled: boolean;
    })
  | (DetailBase & {
      projection: "gestore";
      useCase: UseCaseDetail & { proposer: ProposerDetails };
      model: ValuationModel;
      costBands: readonly CostBandInfo[];
      esgEnabled: boolean;
    });

/**
 * Una scheda del workspace, proiettata per chi guarda (§6.7, §6.9). null se non c'è, è di un
 * altro workspace, chi guarda non entra nell'area, oppure è nascosta alla ricerca e il
 * contributore non l'ha proposta (la pagina «Use case non trovato», la REST 404).
 */
export async function getUseCaseDetail(
  workspaceId: string,
  useCaseId: string,
  viewer: UseCaseViewer,
  opts: Pick<HubReadOptions, "now"> = {},
): Promise<UseCaseDetailResult | null> {
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea || !abilities.projection || !isUuid(workspaceId) || !isUuid(useCaseId)) return null;
  await ensureDbSchema();
  const [[row], ctx] = await Promise.all([selectHubRows(workspaceId, useCaseId), readContext(workspaceId, opts.now ?? new Date())]);
  if (!row) return null;
  const dossiers = await readDossiers(workspaceId, [row.id]);
  const dossier = dossiers.of(row.id);
  const base: DetailBase = { today: ctx.today as IsoDate, dossierRead: dossiers.status };

  if (abilities.projection === "contributore") {
    const item = projectContributorRow(viewer, row, dossier, ctx.today);
    if (!item) return null;
    const answer = item.own ? pendingAnswer({ intake: row.intake, phase: item.phase, subState: item.subState }) : null;
    return { ...base, projection: "contributore", useCase: item, answer };
  }
  const detail = projectUseCaseDetail(row, ctx, dossier);
  const figures = { model: ctx.model, costBands: ctx.costBands, esgEnabled: ctx.esgEnabled };
  if (abilities.projection === "gestore") {
    return { ...base, ...figures, projection: "gestore", useCase: { ...detail, proposer: await proposerDetails(row) } };
  }
  return { ...base, ...figures, projection: "revisore", useCase: detail };
}

// ═══ REST di oggi (§9.3) ═════════════════════════════════════════════

/**
 * Le GET REST rispondono solo a chi valuta, come i PATCH di stato, quadrante e punteggi (in
 * tutti i workspace, area accesa o no): i contributori vedono gli use case nella pagina, con
 * la loro proiezione, mai dalla REST. Le route mandano la riga attraverso l'allowlist di
 * `toUseCaseApiRow` (`src/lib/portfolio/use-case-client-rows.ts`): niente proponente, niente
 * `reviewedBy`, niente intake, nemmeno a chi gestisce il workspace.
 */
function readsRest(viewer: UseCaseViewer): boolean {
  const { projection } = abilitiesForUseCase(viewer);
  return projection === "revisore" || projection === "gestore";
}

/**
 * `GET /api/workspaces/[id]/use-cases`: le righe del workspace per punteggio, come oggi. null
 * per chi non valuta o con un workspace che non è un UUID.
 */
export async function listUseCasesForRest(workspaceId: string, viewer: UseCaseViewer): Promise<UseCase[] | null> {
  if (!readsRest(viewer) || !isUuid(workspaceId)) return null;
  await ensureDbSchema();
  return db.select().from(useCases).where(eq(useCases.workspaceId, workspaceId)).orderBy(desc(useCases.overallScore));
}

/** `GET /api/workspaces/[id]/use-cases/[useCaseId]`: la riga, solo a chi valuta. null → 404. */
export async function getUseCaseForRest(workspaceId: string, useCaseId: string, viewer: UseCaseViewer): Promise<UseCase | null> {
  if (!readsRest(viewer) || !isUuid(workspaceId) || !isUuid(useCaseId)) return null;
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), eq(useCases.id, useCaseId)))
    .limit(1);
  return row ?? null;
}

// ═══ Export «Use case» (§4.1) ════════════════════════════════════════

export interface UseCaseExport {
  rows: ExportRow[];
  costBands: readonly CostBandInfo[];
}

function byCode(a: HubItem, b: HubItem): number {
  if (a.code && b.code) return a.code.localeCompare(b.code, "it-IT", { numeric: true });
  if (a.code || b.code) return a.code ? -1 : 1;
  return a.title.localeCompare(b.title, "it-IT") || a.id.localeCompare(b.id);
}

/**
 * Le righe del foglio «Use case» dell'export con l'area accesa (§4.1): solo per i revisori
 * (null agli altri, la rotta risponde 403), con le fasce del workspace e senza colonne sul
 * proponente. In ordine di codice.
 */
export async function exportUseCaseRows(workspaceId: string, viewer: UseCaseViewer, opts: Pick<HubReadOptions, "now"> = {}): Promise<UseCaseExport | null> {
  if (!abilitiesForUseCase(viewer).canExport || !isUuid(workspaceId)) return null;
  await ensureDbSchema();
  const [rows, ctx] = await Promise.all([selectHubRows(workspaceId), readContext(workspaceId, opts.now ?? new Date())]);
  const dossiers = await readDossiers(
    workspaceId,
    rows.map((row) => row.id),
  );
  const items = rows.map((row) => ({ row, item: projectHubItem(row, ctx, dossiers.of(row.id)) }));
  items.sort((a, b) => byCode(a.item, b.item));
  return {
    rows: items.map(({ row, item }) => exportRow(item, row, ctx.costBands)),
    costBands: ctx.costBands,
  };
}
