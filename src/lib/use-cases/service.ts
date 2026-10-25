import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { useCases, users, workspaceConnectorConfigs } from "@/lib/db/schema";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { getUcUserContext, ucLsDomains } from "@/lib/db/queries/uc-access";
import { assignUseCaseCodeSafely } from "@/lib/db/queries/use-case-codes";
import { dossierStateForUseCase, type DossierState } from "@/lib/db/queries/use-case-dossiers";
import { insertUseCaseEventFrom, type ServiceEventAction } from "@/lib/db/queries/use-case-events";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import type { UseCaseEventField } from "@/lib/db/use-case-hub-ddl";
import { aiMayWriteSuggestion, deriveUseCasePortfolioMetrics, type DerivedUseCaseScores } from "@/lib/db/use-case-scoring";
import type { ConnectorStatus, UseCaseStatusInput } from "@/lib/connector/status";
import { logSafeError, summarizeError } from "@/lib/log/safe-error";
import { isLateralSpaceEmail as isLateralSpaceEmailUser } from "@/lib/uc/lateral-space";
import { isAllowedStatusTransition, type UseCaseCategoryValue, type UseCaseStatusValue } from "@/lib/use-case-lifecycle";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import {
  DECISION_MESSAGES,
  applyDecision,
  applyDecisionPatch,
  applyWhen,
  type DecisionCard,
  type DecisionContext,
  type DecisionPatch,
  type DecisionResult,
  type IntakeChange,
} from "./decisions";
import {
  CHANGE_EVENT_FIELD,
  NO_CHANGES_ERROR,
  TEXT_LIMITS,
  VALUE_AMOUNT_ERROR,
  VALUE_EUR_YEAR_MAX,
  costColumns,
  normalizeUseCaseCode,
  optionalTextSchema,
  parseCostInput,
  parseEuroAmount,
  titleSchema,
  useCaseChangesSchema,
  validateUseCaseChanges,
  validateValuation,
  valuationSchema,
  type UseCaseChanges,
} from "./inputs";
import { ANSWER_PENDING_INTAKE_KEY, ANSWER_TEXT, ANSWERS_INTAKE_KEY, answerRefusal, answerSignalTitle, parseAnswerText, sameQuestion, withAnswer } from "./answers";
import { portfolioKindOf } from "./labels";
import { abilitiesForUseCase, isHiddenFromSearch, isOwnProposal, type UseCaseAbilities } from "./permissions";
import { phaseOfUseCase, type UseCasePhase } from "./phase";
import { romeToday } from "./quarter";
import { isUseCaseHubWorkspace } from "./rollout";
import {
  KINDS,
  ORIGINS,
  USE_CASE_SOURCES,
  type Channel,
  type CostInput,
  type Decision,
  type NewUseCaseInput,
  type Origin,
  type ServiceError,
  type ServiceResult,
  type UseCaseKind,
  type UseCaseSource,
  type WhenInput,
} from "./types";
import type { Dimension, LegacyScoreColumns } from "./valuation";
import type { ValueModel } from "./value-model";

/**
 * Servizio unico di scrittura dell'area «Use case» (docs/use-case/DESIGN.md §9.1, §9.2,
 * §9.3; PIANO-LAVORI H2a).
 *
 * Ogni scrittura su `use_cases` dell'area passa da qui: server action delle pagine, rotte
 * REST, MCP del team, suggerimento dell'AI, script. Ogni funzione fa gli stessi passi:
 *
 * 1. **Permessi** (`abilitiesForUseCase`). Per una persona il ruolo si rilegge a ogni
 *    chiamata (`getCollaboratorAccess`) e «è di Lateral Space» pure (`getUcUserContext`,
 *    email verificata dalla tabella `users`): `ctx.actor.role` e `ctx.actor.isLateralSpace`
 *    non danno permessi, un token o una sessione non portano permessi salvati.
 *    Server action e MCP del team (canali `pagina` e `mcp_team`) vogliono l'area accesa per
 *    il workspace (`USE_CASE_HUB_WORKSPACES`), altrimenti `area_spenta`; la REST e gli altri
 *    canali no (D4 e le PATCH valgono in tutti i workspace, §9.3, §12.1).
 * 2. **Lettura** della scheda e della fase prima (`phaseOfUseCase`), con lo stato del dossier
 *    da `use-case-dossiers.ts`: sezione spenta o tabelle assenti, nessun dossier; lettura
 *    fallita, le decisioni che dipendono dal dossier rispondono `riprova` (lo decide
 *    `decisions.ts`), le altre scritture proseguono.
 * 3. **Regole**: `applyDecision` e `applyWhen` (§3.7), la validazione dei campi
 *    (`inputs.ts`, limiti di §6.2).
 * 4. **Un solo statement** (driver `neon-http`, niente transazioni interattive):
 *    `WITH upd AS (UPDATE … WHERE id AND workspace_id AND version RETURNING …) INSERT INTO
 *    use_case_events … SELECT … FROM upd`. La scheda e la sua riga di Storia vanno insieme
 *    o non vanno. `version` la alza il trigger della 0020, solo per le colonne che una
 *    persona modifica. Le scritture che ricalcolano gli aggregati (valutazione, suggerimento
 *    dell'AI) guardano anche `updated_at`: le colonne legacy dei punteggi e `ai_suggestion`
 *    non alzano `version`. Nessuna riga: si rilegge per distinguere `non_trovato` da
 *    `versione_superata`.
 * 5. **Codice** dopo una creazione: `assignUseCaseCodeSafely`. Non cambia `version`; la
 *    `version` restituita è quella riletta dopo il codice.
 * 6. **Dopo la risposta**: valutazione dell'AI e notifiche, solo per i canali che le
 *    prevedono (§8). Le regole sono in `creationFollowUps`; le programmano con `after()` i
 *    chiamanti (le action del modulo completo, il MCP del team), che hanno la richiesta in
 *    corso e i moduli dell'auto-ranking e delle notifiche.
 *
 * Nessuna scrittura salva testi nella Storia; nessuna lettura qui restituisce chi ha
 * proposto (art. 15.4: il proponente compare solo nella lista di colonne dell'INSERT di
 * `createUseCases`). Non esiste «Cancella».
 *
 * Un errore del database non esce dal servizio: l'errore di drizzle porta nel messaggio
 * l'SQL e i parametri, cioè i testi delle schede. Ogni funzione esportata risponde
 * `riprova` e registra solo nome, SQLSTATE e vincolo (`logSafeError`, DESIGN §11).
 */

// ─── Contesto, errori, risultato (§9.1) ──────────────────────────────

export type { Channel, ServiceError, ServiceResult } from "./types";

export type ActorKind = "persona" | "sistema" | "ai";

export interface WriteContext {
  workspaceId: string;
  actor: {
    userId: string | null;
    /** Il ruolo che il chiamante ha letto: il servizio lo rilegge e usa il suo. */
    role: string | null;
    /** Come il ruolo: il servizio lo rilegge dalla tabella `users`. */
    isLateralSpace: boolean;
    kind: ActorKind;
  };
  channel: Channel;
  /** Predefinito: adesso. «Oggi» e i trimestri si calcolano a Roma. */
  now?: Date;
}

export const SERVICE_MESSAGES = {
  permesso_mancante: "Non hai i permessi per farlo.",
  non_trovato: "Use case non trovato.",
  /** Testo esatto di §6.8 e §14.3 («Versione superata»). */
  versione_superata: "Qualcuno ha appena modificato questo use case. Ho ricaricato i dati: rifai la modifica.",
  transizione_non_ammessa: "In questa fase non si può.",
  dati_non_validi: "Controlla i campi evidenziati.",
  area_spenta: "L'area Use case non è attiva per questo workspace.",
  riprova: "Non riusciamo a salvare. Riprova.",
} as const satisfies Record<ServiceError, string>;

export const NOTHING_TO_REDACT_ERROR = "Non c'è testo da oscurare nei campi scelti.";
export const DOSSIER_NOT_LINKED_ERROR = "Il dossier non è collegato a questo use case.";
export const TOO_MANY_ITEMS_ERROR = "Al massimo 100 use case per volta.";

export type Failure = Extract<ServiceResult<never>, { ok: false }>;

/** Anche per `needs-service.ts`, che scrive le esigenze con gli stessi errori. */
export function fail(error: ServiceError, message: string = SERVICE_MESSAGES[error], fieldErrors?: Record<string, string>): Failure {
  return fieldErrors && Object.keys(fieldErrors).length
    ? { ok: false, error, message, fieldErrors }
    : { ok: false, error, message };
}

export function invalid(fieldErrors: Record<string, string>, message: string = SERVICE_MESSAGES.dati_non_validi): Failure {
  return fail("dati_non_validi", message, fieldErrors);
}

/**
 * Una funzione esportata del servizio che non lancia: un errore (database, rete) diventa
 * `riprova`. Nel log solo nome, SQLSTATE e vincolo: mai il messaggio di drizzle
 * (`Failed query: <sql> params: <testi>`), mai la causa intera. La usa anche `needs-service.ts`.
 */
export function guarded<A extends unknown[], T>(
  op: string,
  run: (...args: A) => Promise<ServiceResult<T>>,
): (...args: A) => Promise<ServiceResult<T>> {
  return async (...args: A) => {
    try {
      return await run(...args);
    } catch (error) {
      const cause = isRecord(error) && isRecord(error.cause) ? error.cause : null;
      logSafeError("use-case-service", `${op}_failed`, cause ?? error, cause ? { via: summarizeError(error).name } : {});
      return fail("riprova");
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ─── Scheda (Card) ───────────────────────────────────────────────────

/**
 * Le colonne che il servizio legge e restituisce. Mancano di proposito le colonne sul
 * proponente: la scheda restituita va a ogni revisore (REST, action, MCP del team).
 */
const CARD_COLUMNS = {
  id: useCases.id,
  workspaceId: useCases.workspaceId,
  code: useCases.code,
  title: useCases.title,
  description: useCases.description,
  flowDescription: useCases.flowDescription,
  humanInTheLoop: useCases.humanInTheLoop,
  guardrails: useCases.guardrails,
  businessCase: useCases.businessCase,
  dataRequirements: useCases.dataRequirements,
  sustainabilityImpact: useCases.sustainabilityImpact,
  portfolioKind: useCases.portfolioKind,
  origin: useCases.origin,
  aiLab: useCases.aiLab,
  source: useCases.source,
  status: useCases.status,
  portfolioReviewStatus: useCases.portfolioReviewStatus,
  targetQuarter: useCases.targetQuarter,
  reviewBy: useCases.reviewBy,
  publicNote: useCases.publicNote,
  intake: useCases.intake,
  customScores: useCases.customScores,
  aiSuggestion: useCases.aiSuggestion,
  valueEurYear: useCases.valueEurYear,
  costEurOnce: useCases.costEurOnce,
  costBand: useCases.costBand,
  valueModel: useCases.valueModel,
  impactEconomic: useCases.impactEconomic,
  impactTime: useCases.impactTime,
  impactQuality: useCases.impactQuality,
  impactCoordination: useCases.impactCoordination,
  impactSocial: useCases.impactSocial,
  feasibilityData: useCases.feasibilityData,
  feasibilityWorkflow: useCases.feasibilityWorkflow,
  feasibilityRisk: useCases.feasibilityRisk,
  feasibilityTech: useCases.feasibilityTech,
  feasibilityTeam: useCases.feasibilityTeam,
  esgEnvironmental: useCases.esgEnvironmental,
  esgSocial: useCases.esgSocial,
  esgGovernance: useCases.esgGovernance,
  overallEsgScore: useCases.overallEsgScore,
  overallImpactScore: useCases.overallImpactScore,
  overallFeasibilityScore: useCases.overallFeasibilityScore,
  overallScore: useCases.overallScore,
  category: useCases.category,
  impactFlag: useCases.impactFlag,
  reviewedBy: useCases.reviewedBy,
  reviewedAt: useCases.reviewedAt,
  reviewNotes: useCases.reviewNotes,
  submittedAt: useCases.submittedAt,
  timeline: useCases.timeline,
  requirements: useCases.requirements,
  dataDependencies: useCases.dataDependencies,
  relatedActivityIds: useCases.relatedActivityIds,
  sequenceOrder: useCases.sequenceOrder,
  statusChangedAt: useCases.statusChangedAt,
  version: useCases.version,
  createdAt: useCases.createdAt,
  updatedAt: useCases.updatedAt,
};

/**
 * `updated_at` come testo del database, con i microsecondi (un `Date` di JS li perde): le
 * scritture che ricalcolano gli aggregati lo confrontano uguale nel WHERE.
 */
const CARD_STAMP = sql<string | null>`${useCases.updatedAt}::text`;

async function selectCard(workspaceId: string, id: string) {
  const [found] = await db
    .select({ ...CARD_COLUMNS, stamp: CARD_STAMP })
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)))
    .limit(1);
  if (!found) return null;
  const { stamp, ...row } = found;
  return { row, stamp };
}

type CardRow = NonNullable<Awaited<ReturnType<typeof selectCard>>>["row"];

/**
 * Le chiavi di `intake` che la scheda restituita porta: i dati raccolti dal connettore e i
 * campi tecnici dell'area. Ogni altra chiave (anche future) resta fuori, così nella scheda
 * non arriva mai un recapito di chi ha proposto.
 */
const CARD_INTAKE_KEYS = [
  "contractVersion",
  "guideVersion",
  "area",
  "company",
  "tools",
  "toolsOther",
  "frequency",
  "beneficiaries",
  "timeSavedMinutesPerRun",
  "valuePerRunEur",
  "qualityGain",
  "developmentStatus",
  "proposerEstimate",
  "flags",
  "relatedAgent",
  "relatedCode",
  "relationType",
  "promptSnippet",
  "sourceConversation",
  "possibleDuplicateOf",
  "hiddenFromSearch",
  "archiveReason",
  "duplicateOfCode",
  // Le risposte di chi ha proposto a «Serve info» (D17): testo dei dati raccolti, senza chi le ha scritte.
  "risposte",
] as const;

function cardIntake(intake: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!intake) return null;
  const out: Record<string, unknown> = {};
  for (const key of CARD_INTAKE_KEYS) if (Object.prototype.hasOwnProperty.call(intake, key)) out[key] = intake[key];
  return out;
}

/** La fase della scheda, con il codice che la Storia salva (`da_valutare.nuova`). */
export interface CardPhase {
  phase: UseCasePhase["phase"];
  subState: UseCasePhase["subState"];
  label: string;
  tone: UseCasePhase["tone"];
  /** `<fase>.<sotto-stato>`, come `phase_before` e `phase_after` della Storia. */
  code: string;
  connector: ConnectorStatus;
}

/** Lo use case dopo una scrittura, per chi ha il permesso di scrivere (revisori). */
export type UseCaseCard = Omit<CardRow, "intake"> & {
  /** Solo le chiavi di `CARD_INTAKE_KEYS`. */
  intake: Record<string, unknown> | null;
  hiddenFromSearch: boolean;
  phase: CardPhase;
  /** Dossier completo collegato; null senza dossier, con la sezione spenta o se la lettura è fallita. */
  dossier: DossierState | null;
};

type PhaseColumns = Pick<
  CardRow,
  "status" | "portfolioReviewStatus" | "reviewedBy" | "publicNote" | "intake" | "reviewBy" | "portfolioKind" | "targetQuarter"
>;

function phaseOf(row: PhaseColumns, dossier: DossierState | null, today: string): UseCasePhase {
  const intake = row.intake ?? null;
  return phaseOfUseCase({
    status: row.status,
    portfolioReviewStatus: row.portfolioReviewStatus,
    reviewedBy: row.reviewedBy,
    publicNote: row.publicNote,
    intake: intake as UseCaseStatusInput["intake"],
    reviewBy: row.reviewBy,
    linkedCaseCode: dossier?.code ?? null,
    portfolioKind: row.portfolioKind,
    targetQuarter: row.targetQuarter,
    dossierStatus: dossier?.status ?? null,
    duplicateOfCode: typeof intake?.duplicateOfCode === "string" ? intake.duplicateOfCode : null,
    today,
  });
}

function phaseCode(p: UseCasePhase): string {
  return `${p.phase}.${p.subState}`;
}

function cardPhase(p: UseCasePhase): CardPhase {
  return { phase: p.phase, subState: p.subState, label: p.label, tone: p.tone, code: phaseCode(p), connector: p.connector };
}

function toCard(row: CardRow, dossier: DossierState | null, today: string): UseCaseCard {
  return {
    ...row,
    intake: cardIntake(row.intake),
    hiddenFromSearch: row.intake?.hiddenFromSearch === true,
    phase: cardPhase(phaseOf(row, dossier, today)),
    dossier,
  };
}

/** La scheda letta prima di scrivere, con il dossier e la fase. */
interface Loaded {
  row: CardRow;
  /** `updated_at` letto, come testo (`CARD_STAMP`). */
  stamp: string | null;
  dossier: DossierState | null;
  /** `spenta`: sezione Casi d'uso spenta o tabelle assenti; `errore`: lettura fallita. */
  dossierRead: "ok" | "spenta" | "errore";
  phase: UseCasePhase;
  today: string;
}

async function loadCard(workspaceId: string, id: string, now: Date): Promise<Loaded | null> {
  if (!isUuid(id)) return null;
  const found = await selectCard(workspaceId, id);
  if (!found) return null;
  const { row, stamp } = found;
  const read = await dossierStateForUseCase(workspaceId, id);
  const dossier = read.ok ? read.dossier : null;
  const today = romeToday(now);
  return { row, stamp, dossier, dossierRead: read.ok ? "ok" : read.motivo, phase: phaseOf(row, dossier, today), today };
}

/** Nessuna riga aggiornata: la scheda non c'è (o è di un altro workspace) oppure la versione è vecchia. */
async function missingOrStale(workspaceId: string, id: string): Promise<Failure> {
  const [row] = await db
    .select({ version: useCases.version })
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)))
    .limit(1);
  return row ? fail("versione_superata") : fail("non_trovato");
}

// ─── Chi scrive (passo 1) ────────────────────────────────────────────

interface Actor {
  kind: ActorKind;
  /** Solo per le persone. */
  userId: string | null;
  /** Solo per le persone: ruolo e «Lateral Space» riletti adesso. */
  abilities: UseCaseAbilities | null;
}

async function resolveActor(ctx: WriteContext): Promise<{ ok: true; actor: Actor } | Failure> {
  if (!isUuid(ctx.workspaceId)) return fail("non_trovato");
  if ((ctx.channel === "pagina" || ctx.channel === "mcp_team") && !isUseCaseHubWorkspace(ctx.workspaceId)) {
    return fail("area_spenta");
  }
  if (ctx.actor.kind !== "persona") return { ok: true, actor: { kind: ctx.actor.kind, userId: null, abilities: null } };
  const userId = ctx.actor.userId;
  if (!isUuid(userId)) return fail("permesso_mancante");
  const [access, isLateralSpace] = await Promise.all([
    getCollaboratorAccess(userId, ctx.workspaceId),
    getUcUserContext(userId).then((c) => c?.isLateralSpace ?? false),
  ]);
  const abilities = abilitiesForUseCase({
    userId,
    email: null,
    emailVerified: false,
    role: access?.role ?? null,
    isLateralSpace,
  });
  return { ok: true, actor: { kind: "persona", userId, abilities } };
}

/** Una persona con l'abilità richiesta; i sistemi e l'AI no. */
function personaCan(actor: Actor, ability: keyof UseCaseAbilities): boolean {
  return actor.kind === "persona" && actor.abilities?.[ability] === true;
}

/**
 * Passo 1 per le scritture fuori da `use_cases` (le esigenze di «Cosa serve», `needs-service.ts`):
 * schema, area accesa per i canali `pagina` e `mcp_team`, ruolo e «Lateral Space» riletti adesso,
 * e solo una persona con l'abilità richiesta. Restituisce l'id di chi scrive.
 */
export async function personaWriter(ctx: WriteContext, ability: keyof UseCaseAbilities): Promise<{ ok: true; userId: string } | Failure> {
  await ensureDbSchema();
  const resolved = await resolveActor(ctx);
  if (!resolved.ok) return resolved;
  if (!personaCan(resolved.actor, ability) || !resolved.actor.userId) return fail("permesso_mancante");
  return { ok: true, userId: resolved.actor.userId };
}

function decisionActor(actor: Actor): DecisionContext["actor"] {
  return {
    userId: actor.userId,
    isReviewer: actor.abilities?.isReviewer === true,
    isLateralSpace: actor.abilities?.isLateralSpace === true,
  };
}

// ─── Scrittura con la sua riga di Storia (passo 4) ───────────────────

type UpdateSet = PgUpdateSetSource<typeof useCases>;

interface CardWrite {
  set: UpdateSet;
  action: ServiceEventAction;
  fields: readonly UseCaseEventField[];
  /** Le colonne della fase dopo la scrittura. */
  after: PhaseColumns;
  /** Altre CTE nello stesso statement (es. i segnali della campanella di «Oscura testo»). */
  alsoWith?: SQL;
  /**
   * Chi ha agito, per la Storia, se non è chi scrive: la risposta di «Serve info» (D17) è di
   * chi ha proposto, e la Storia non dice mai chi propone (§10.3).
   */
  eventActor?: "proponente";
  /**
   * Scrive solo se `updated_at` è ancora quello letto (`Loaded.stamp`). Per le scritture che
   * ricalcolano gli aggregati: le colonne legacy dei punteggi, `reviewed_by` e
   * `ai_suggestion` cambiano senza alzare `version`.
   */
  sameStamp?: boolean;
}

function eventActor(ctx: WriteContext, actor: Actor) {
  return { actorUserId: actor.kind === "persona" ? actor.userId : null, actorKind: actor.kind };
}

/**
 * Aggiorna la scheda e scrive la sua riga di Storia nello stesso statement, solo se la
 * versione è ancora `expectedVersion`. Poi rilegge la scheda.
 */
async function commitWrite(
  ctx: WriteContext,
  actor: Actor,
  loaded: Loaded,
  expectedVersion: number,
  write: CardWrite,
): Promise<ServiceResult<UseCaseCard>> {
  const id = loaded.row.id;
  const update = db
    .update(useCases)
    .set({ ...write.set, updatedAt: sql`now()` })
    .where(
      and(
        eq(useCases.id, id),
        eq(useCases.workspaceId, ctx.workspaceId),
        eq(useCases.version, expectedVersion),
        write.sameStamp ? sql`${CARD_STAMP} IS NOT DISTINCT FROM ${loaded.stamp}::text` : undefined,
      ),
    )
    .returning({ id: useCases.id, workspaceId: useCases.workspaceId, version: useCases.version });
  const ctes = write.alsoWith ? sql`WITH upd AS (${update.getSQL()}), ${write.alsoWith}` : sql`WITH upd AS (${update.getSQL()})`;
  const event = insertUseCaseEventFrom("upd", {
    ...(write.eventActor === "proponente" ? { actorUserId: null, actorKind: "proponente" as const } : eventActor(ctx, actor)),
    channel: ctx.channel,
    action: write.action,
    fields: write.fields,
    phaseBefore: phaseCode(loaded.phase),
    phaseAfter: phaseCode(phaseOf(write.after, loaded.dossier, loaded.today)),
  });
  const { rows } = await db.execute(sql`${ctes} ${event} RETURNING (SELECT version FROM upd) AS version`);
  if (rows.length === 0) return missingOrStale(ctx.workspaceId, id);
  return reloadCard(ctx.workspaceId, loaded);
}

async function reloadCard(workspaceId: string, loaded: Loaded): Promise<ServiceResult<UseCaseCard>> {
  const found = await selectCard(workspaceId, loaded.row.id);
  if (!found) return fail("non_trovato");
  return { ok: true, value: toCard(found.row, loaded.dossier, loaded.today) };
}

/** La scheda senza scrivere: una modifica che non cambia niente non tocca la scheda né la Storia. */
function unchanged(loaded: Loaded): ServiceResult<UseCaseCard> {
  return { ok: true, value: toCard(loaded.row, loaded.dossier, loaded.today) };
}

/**
 * Passi 1-2 comuni: chi scrive, abilità richiesta, scheda letta, versione attesa. La
 * versione si controlla subito dopo la lettura (le regole valgono sulla scheda che la
 * persona ha visto) e di nuovo nello statement (scritture concorrenti).
 */
async function prepare(
  ctx: WriteContext,
  id: string,
  expectedVersion: number | null,
  ability: keyof UseCaseAbilities,
): Promise<{ ok: true; actor: Actor; loaded: Loaded; now: Date } | Failure> {
  await ensureDbSchema();
  const resolved = await resolveActor(ctx);
  if (!resolved.ok) return resolved;
  if (!personaCan(resolved.actor, ability)) return fail("permesso_mancante");
  const now = ctx.now ?? new Date();
  const loaded = await loadCard(ctx.workspaceId, id, now);
  if (!loaded) return fail("non_trovato");
  if (expectedVersion !== null) {
    if (!Number.isSafeInteger(expectedVersion)) return invalid({ expectedVersion: "Versione non valida." });
    if (loaded.row.version !== expectedVersion) return fail("versione_superata");
  }
  return { ok: true, actor: resolved.actor, loaded, now };
}

// ─── Colonne di `intake` ─────────────────────────────────────────────

/** `intake = (coalesce(intake, '{}') - remove) || set`, sulla riga che si aggiorna. */
function intakeMerge(change: IntakeChange): SQL {
  return sql`(coalesce(${useCases.intake}, '{}'::jsonb) - ${sql.param([...change.remove])}::text[]) || ${JSON.stringify(change.set)}::jsonb`;
}

function withIntakeChange(row: PhaseColumns, change: IntakeChange): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(row.intake ?? {}) };
  for (const key of change.remove) delete next[key];
  return Object.assign(next, change.set);
}

function decisionPatchSet(patch: DecisionPatch): UpdateSet {
  const set: UpdateSet = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.portfolioReviewStatus !== undefined) set.portfolioReviewStatus = patch.portfolioReviewStatus;
  if (patch.targetQuarter !== undefined) set.targetQuarter = patch.targetQuarter;
  if (patch.reviewBy !== undefined) set.reviewBy = patch.reviewBy;
  if (patch.reviewedBy !== undefined) set.reviewedBy = patch.reviewedBy;
  if (patch.publicNote !== undefined) set.publicNote = patch.publicNote;
  if (patch.intake) set.intake = intakeMerge(patch.intake);
  return set;
}

function decisionCardOf(loaded: Loaded): DecisionCard {
  const { row } = loaded;
  return {
    id: row.id,
    code: row.code,
    phase: loaded.phase.phase,
    portfolioKind: row.portfolioKind,
    dossierStatus: loaded.dossier?.status ?? null,
    status: row.status,
    portfolioReviewStatus: row.portfolioReviewStatus,
    targetQuarter: row.targetQuarter,
    reviewBy: row.reviewBy,
    reviewedBy: row.reviewedBy,
    publicNote: row.publicNote,
    intake: row.intake ?? null,
    customScores: row.customScores ?? null,
    valueEurYear: row.valueEurYear,
    costEurOnce: row.costEurOnce,
    costBand: row.costBand,
    valueModel: row.valueModel,
  };
}

function decisionContext(actor: Actor, loaded: Loaded, now: Date, duplicateTarget?: { id: string; code: string } | null): DecisionContext {
  return {
    now,
    actor: decisionActor(actor),
    ucSectionEnabled: loaded.dossierRead !== "spenta",
    dossierReadFailed: loaded.dossierRead === "errore",
    duplicateTarget,
  };
}

function decisionFailure(result: Extract<DecisionResult, { ok: false }>): Failure {
  return fail(result.error, result.message, result.fieldErrors);
}

// ─── Modello di valutazione del workspace ────────────────────────────

async function workspaceModel(workspaceId: string) {
  const [workspace, model] = await Promise.all([getWorkspaceById(workspaceId), getOrCreateWorkspaceScoringModel(workspaceId)]);
  const esgEnabled = workspace?.esgEnabled === true;
  const config = model.resolvedConfig;
  return {
    esgEnabled,
    kpiIds: {
      impact: config.dimensions.impact.map((k) => k.id),
      feasibility: config.dimensions.feasibility.map((k) => k.id),
      esg: esgEnabled ? config.dimensions.esg.map((k) => k.id) : [],
    } satisfies Record<Dimension, string[]>,
    derive: (source: Parameters<typeof deriveUseCasePortfolioMetrics>[0]): DerivedUseCaseScores =>
      deriveUseCasePortfolioMetrics(source, {
        model: { impactFlagEnabled: model.impactFlagEnabled, config },
        esgEnabled,
      }),
  };
}

function derivedSet(derived: DerivedUseCaseScores): UpdateSet {
  return {
    overallEsgScore: derived.overallEsgScore,
    overallImpactScore: derived.overallImpactScore,
    overallFeasibilityScore: derived.overallFeasibilityScore,
    overallScore: derived.overallScore,
    category: derived.category,
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]),
  );
}

// ═══ createUseCases ══════════════════════════════════════════════════

/** Colonne legacy dei punteggi del generatore di Activity mapping (fonte «AI», §8). */
const LEGACY_SCORE_KEYS = [
  "impactEconomic",
  "impactTime",
  "impactQuality",
  "impactCoordination",
  "impactSocial",
  "feasibilityData",
  "feasibilityWorkflow",
  "feasibilityRisk",
  "feasibilityTech",
  "feasibilityTeam",
  "esgEnvironmental",
  "esgSocial",
  "esgGovernance",
] as const satisfies readonly (keyof LegacyScoreColumns)[];

type LegacyScoreKey = (typeof LEGACY_SCORE_KEYS)[number];

/**
 * Una scheda nuova. In più di `NewUseCaseInput`, solo per Activity mapping (§8.5): i
 * punteggi e i dettagli che il generatore produce oggi (`generateUseCasesAction`).
 */
export type NewUseCaseItem = NewUseCaseInput & {
  generatorScores?: Partial<Record<LegacyScoreKey, number | null>>;
  generatorDetails?: {
    requirements?: string[] | null;
    dataDependencies?: string[] | null;
    relatedActivityIds?: string[] | null;
    timeline?: string | null;
    sequenceOrder?: number | null;
  };
};

export interface CreatedUseCase {
  id: string;
  code: string | null;
  version: number;
}

/** Al massimo tante schede per chiamata (il MCP del team ne manda fino a 25). */
export const MAX_CREATE_ITEMS = 100;

/** Le fonti che una persona può usare, con l'abilità che servono. */
const PERSONA_SOURCES: Partial<Record<UseCaseSource, keyof UseCaseAbilities>> = {
  manual: "canOpenArea",
  web_proposed: "canOpenArea",
  team_mcp: "canUseTeamMcp",
  activity_mapping: "canProposeFromActivityMapping",
};

/** Fonti che vogliono una persona: un sistema non le usa. */
const PERSONA_ONLY_SOURCES: readonly UseCaseSource[] = ["manual", "web_proposed", "team_mcp"];

/**
 * Origine predefinita per canale e per chi scrive (§5.2, §5.3, §8, §9.4): «AI
 * Transformation» per il pannello rapido e Activity mapping; per il modulo completo e il
 * MCP del team «AI Transformation» se scrive una persona di Lateral Space con ruolo da
 * revisore, altrimenti «AI Adoption»; «AI Adoption» per ogni altro canale.
 */
export function defaultOrigin(source: UseCaseSource, writer: { isLateralSpace: boolean; isReviewer: boolean }): Origin {
  if (source === "manual" || source === "activity_mapping") return "transformation";
  if (source === "web_proposed" || source === "team_mcp") {
    return writer.isLateralSpace && writer.isReviewer ? "transformation" : "adoption";
  }
  return "adoption";
}

export interface CreationFollowUps {
  /** Valutazione automatica dell'AI dopo la risposta. */
  aiValuation: boolean;
  /** Campanella, Slack e webhook della nuova proposta. */
  notifications: boolean;
}

/**
 * Passo 6 (§8, §1.2 punti 6 e 13): cosa si fa dopo la risposta, per canale. Pannello rapido,
 * Activity mapping, AI Readiness e corsi: niente. Modulo completo, connettore, REST e Slack:
 * valutazione dell'AI e notifiche. MCP del team: niente valutazione, notifiche solo se chi
 * scrive non è di Lateral Space. Lo programma il chiamante con `after()`.
 */
export function creationFollowUps(source: UseCaseSource, writer: { isLateralSpace: boolean }): CreationFollowUps {
  switch (source) {
    case "web_proposed":
    case "claude_connector":
    case "claude_mcp":
    case "slack_proposed":
      return { aiValuation: true, notifications: true };
    case "team_mcp":
      return { aiValuation: false, notifications: !writer.isLateralSpace };
    default:
      return { aiValuation: false, notifications: false };
  }
}

const euroValue = (max: number, message: string) =>
  z.unknown().transform((raw, ctx) => {
    const parsed = parseEuroAmount(raw, max);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return parsed.value;
  });

const costValue = z.unknown().transform((raw, ctx): CostInput => {
  const parsed = parseCostInput(raw);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
    return z.NEVER;
  }
  return parsed.value;
});

const generatorScore = z.number().finite().min(0).max(5).nullable().optional();

/** «Urgenza» (colonna `timeline`, varchar 255). */
const TIMELINE_MAX = 255;

/** I campi di una scheda nuova (non stretto: le chiavi che non servono qui si ignorano). */
const newItemSchema = z.object({
  id: z.string().regex(UUID, { message: "Id non valido." }).optional(),
  source: z.enum(USE_CASE_SOURCES, { message: "Canale non previsto." }),
  kind: z.enum(KINDS, { message: "Scegli Da costruire o Da diffondere." }),
  origin: z.enum(ORIGINS, { message: "Scegli AI Adoption o AI Transformation." }).optional(),
  title: titleSchema,
  description: optionalTextSchema(TEXT_LIMITS.description).optional(),
  flowDescription: optionalTextSchema(TEXT_LIMITS.flowDescription).optional(),
  humanInTheLoop: optionalTextSchema(TEXT_LIMITS.humanInTheLoop).optional(),
  guardrails: optionalTextSchema(TEXT_LIMITS.guardrails).optional(),
  businessCase: optionalTextSchema(TEXT_LIMITS.businessCase).optional(),
  dataRequirements: optionalTextSchema(TEXT_LIMITS.dataRequirements).optional(),
  sustainabilityImpact: optionalTextSchema(TEXT_LIMITS.sustainabilityImpact).optional(),
  aiLab: optionalTextSchema(TEXT_LIMITS.aiLab).optional(),
  area: optionalTextSchema(TEXT_LIMITS.area).optional(),
  timeline: optionalTextSchema(TIMELINE_MAX).optional(),
  status: z.enum(["draft", "proposed"], { message: "Una scheda nuova è una bozza o una proposta." }).optional(),
  hiddenFromSearch: z.boolean({ message: "Vero o falso." }).optional(),
  valueEurYear: euroValue(VALUE_EUR_YEAR_MAX, VALUE_AMOUNT_ERROR).optional(),
  cost: costValue.optional(),
  generatorScores: z.object(Object.fromEntries(LEGACY_SCORE_KEYS.map((k) => [k, generatorScore]))).strict().optional(),
  generatorDetails: z
    .object({
      requirements: z.array(z.string().max(1000)).max(50).nullable().optional(),
      dataDependencies: z.array(z.string().max(1000)).max(50).nullable().optional(),
      relatedActivityIds: z.array(z.string().max(100)).max(200).nullable().optional(),
      timeline: z.string().max(TIMELINE_MAX).nullable().optional(),
      sequenceOrder: z.number().int().min(0).max(100000).nullable().optional(),
    })
    .strict()
    .optional(),
});

type ParsedItem = z.output<typeof newItemSchema>;

function itemErrors(error: z.ZodError, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = `${prefix}${issue.path.join(".") || "item"}`;
    out[key] ??= issue.message;
  }
  return out;
}

/** Una scheda dall'alto non nasce visibile (§8.6): si mostra dopo, a mano. */
export const HIDDEN_TRANSFORMATION_ERROR =
  "Una scheda AI Transformation nasce nascosta ai colleghi: la mostri dopo, con «Mostra ai colleghi».";

/**
 * Le aree della guida del connettore del workspace (gli id), oppure null se la guida non ha
 * un elenco: allora l'area è un testo libero (§6.2). Stessa lettura tollerante di
 * `guideRestrictions` del connettore: elenco di stringhe o di oggetti con `id`.
 */
async function guideAreas(workspaceId: string): Promise<string[] | null> {
  const [config] = await db
    .select({ guide: workspaceConnectorConfigs.guide })
    .from(workspaceConnectorConfigs)
    .where(eq(workspaceConnectorConfigs.workspaceId, workspaceId))
    .limit(1);
  const areas = config?.guide?.areas;
  if (!Array.isArray(areas)) return null;
  const ids = areas.flatMap((entry: unknown) => {
    if (typeof entry === "string") return [entry];
    return isRecord(entry) && typeof entry.id === "string" ? [entry.id] : [];
  });
  return ids.length ? ids : null;
}

/** L'errore dell'area fuori dalla guida, con il testo di `validateUseCaseChanges`; null se va bene. */
function areaOutsideGuide(area: string, areas: readonly string[]): string | null {
  const checked = validateUseCaseChanges({ area }, { areaOptions: areas });
  return checked.ok ? null : (checked.fieldErrors.area ?? SERVICE_MESSAGES.dati_non_validi);
}

/** Chi scrive può creare questa scheda con questi campi? */
function canCreate(actor: Actor, item: ParsedItem): boolean {
  if (actor.kind === "ai") return false;
  if (actor.kind === "sistema") return !PERSONA_ONLY_SOURCES.includes(item.source);
  const abilities = actor.abilities;
  const needed = PERSONA_SOURCES[item.source];
  if (!abilities || !needed || abilities[needed] !== true) return false;
  // Pannello rapido: solo Lateral Space con ruolo da revisore (§5.1).
  if (item.source === "manual" && abilities.newUseCase !== "pannello_rapido") return false;
  // Origine, visibilità e valutazione iniziale li sceglie solo chi valuta (§5.3).
  const reviewerOnly =
    item.origin !== undefined || item.hiddenFromSearch !== undefined || item.valueEurYear != null || item.cost != null;
  return !reviewerOnly || abilities.isReviewer;
}

/**
 * Crea una o più schede (passi 1-5), con un solo INSERT per il lotto. Con gli `id` decisi
 * prima (MCP del team, `reserved_ids`) una ripresa ritrova le stesse schede e gli stessi
 * codici, senza doppioni (`ON CONFLICT (id) DO NOTHING`). La riga «creato» della Storia la
 * scrive il trigger della 0020, col canale dedotto da `source`.
 *
 * Una scheda «AI Transformation» nasce nascosta ai colleghi, qualunque sia il canale (§8.6):
 * `hiddenFromSearch: false` con quell'origine è `dati_non_validi`. L'area, se la guida del
 * connettore ha un elenco, deve essere una di quelle (§6.2).
 */
export const createUseCases = guarded("create_use_cases", async function createUseCases(
  ctx: WriteContext,
  items: readonly NewUseCaseItem[],
): Promise<ServiceResult<CreatedUseCase[]>> {
  await ensureDbSchema();
  const resolved = await resolveActor(ctx);
  if (!resolved.ok) return resolved;
  const { actor } = resolved;
  if (actor.kind === "ai" || (actor.kind === "persona" && !actor.abilities?.canOpenArea)) return fail("permesso_mancante");
  if (!Array.isArray(items) || items.length === 0) return invalid({ items: NO_CHANGES_ERROR });
  if (items.length > MAX_CREATE_ITEMS) return invalid({ items: TOO_MANY_ITEMS_ERROR });

  const parsed: ParsedItem[] = [];
  const fieldErrors: Record<string, string> = {};
  items.forEach((item, index) => {
    const result = newItemSchema.safeParse(item);
    const prefix = items.length > 1 ? `items.${index}.` : "";
    if (!result.success) {
      Object.assign(fieldErrors, itemErrors(result.error, prefix));
      return;
    }
    const value = result.data;
    if ((value.generatorScores || value.generatorDetails) && value.source !== "activity_mapping") {
      fieldErrors[`${prefix}generatorScores`] = "Solo per le proposte da Activity mapping.";
    }
    parsed.push(value);
  });
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);
  if (parsed.some((item) => !canCreate(actor, item))) return fail("permesso_mancante");
  const ids = parsed.map((item) => item.id ?? crypto.randomUUID());
  if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) return invalid({ items: "Id ripetuto nel lotto." });

  const writer = {
    isLateralSpace: actor.abilities?.isLateralSpace === true,
    isReviewer: actor.abilities?.isReviewer === true,
  };
  const origins = parsed.map((item) => item.origin ?? defaultOrigin(item.source, writer));
  const areas = parsed.some((item) => item.area) ? await guideAreas(ctx.workspaceId) : null;
  parsed.forEach((item, index) => {
    const prefix = parsed.length > 1 ? `items.${index}.` : "";
    if (origins[index] === "transformation" && item.hiddenFromSearch === false) {
      fieldErrors[`${prefix}hiddenFromSearch`] = HIDDEN_TRANSFORMATION_ERROR;
    }
    const areaError = item.area && areas ? areaOutsideGuide(item.area, areas) : null;
    if (areaError) fieldErrors[`${prefix}area`] = areaError;
  });
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);

  const model = await workspaceModel(ctx.workspaceId);
  const now = ctx.now ?? new Date();
  const rows = parsed.map((item, index) => {
    const origin = origins[index];
    // §8.6: dall'alto sempre nascosta; dal basso solo se chi valuta lo chiede.
    const hidden = origin === "transformation" || item.hiddenFromSearch === true;
    const intake: Record<string, unknown> = {};
    if (hidden) intake.hiddenFromSearch = true;
    if (item.area) intake.area = item.area;
    const status = item.status ?? (item.source === "activity_mapping" ? "draft" : "proposed");
    const scores = item.generatorScores ?? {};
    const details = item.generatorDetails ?? {};
    const cost = costColumns(item.cost ?? null);
    return {
      id: ids[index],
      workspaceId: ctx.workspaceId,
      title: item.title,
      description: item.description ?? null,
      flowDescription: item.flowDescription ?? null,
      humanInTheLoop: item.humanInTheLoop ?? null,
      guardrails: item.guardrails ?? null,
      businessCase: item.businessCase ?? null,
      dataRequirements: item.dataRequirements ?? null,
      sustainabilityImpact: item.sustainabilityImpact ?? null,
      portfolioKind: portfolioKindOf(item.kind),
      origin,
      aiLab: item.aiLab ?? null,
      source: item.source,
      status,
      portfolioReviewStatus: "needs_inputs" as const,
      submittedAt: status === "proposed" ? now : null,
      intake: Object.keys(intake).length ? intake : null,
      valueEurYear: item.valueEurYear ?? null,
      costEurOnce: cost.costEurOnce,
      costBand: cost.costBand,
      requirements: details.requirements ?? null,
      dataDependencies: details.dataDependencies ?? null,
      relatedActivityIds: details.relatedActivityIds ?? null,
      timeline: item.timeline ?? details.timeline ?? null,
      sequenceOrder: details.sequenceOrder ?? null,
      ...Object.fromEntries(LEGACY_SCORE_KEYS.map((key) => [key, scores[key] ?? null])),
      ...model.derive(scores),
    };
  });

  await db
    .insert(useCases)
    .values(
      rows.map((row, index) => ({
        ...row,
        proposedBy: typeof items[index].proposedBy === "string" ? items[index].proposedBy.trim().slice(0, 255) || null : null,
      })),
    )
    .onConflictDoNothing({ target: useCases.id });

  // Passo 5: il codice dove manca (anche su una ripresa), nell'ordine del lotto.
  for (const id of ids) await assignUseCaseCodeSafely(ctx.workspaceId, id);
  const saved = await db
    .select({ id: useCases.id, code: useCases.code, version: useCases.version })
    .from(useCases)
    .where(and(eq(useCases.workspaceId, ctx.workspaceId), inArray(useCases.id, ids)));
  const byId = new Map(saved.map((row) => [row.id.toLowerCase(), row]));
  const created: CreatedUseCase[] = [];
  for (const id of ids) {
    const row = byId.get(id.toLowerCase());
    // Un id già usato da una scheda di un altro workspace.
    if (!row) return invalid({ items: "Id già usato." });
    created.push({ id: row.id, code: row.code, version: row.version });
  }
  return { ok: true, value: created };
});

// ═══ updateUseCase ═══════════════════════════════════════════════════

export type UseCaseChangesInput = z.input<typeof useCaseChangesSchema>;

/** Le colonne di «Cosa è» e della nota pubblica (le altre modifiche toccano `intake` o il tipo). */
const CHANGE_COLUMN = {
  title: "title",
  description: "description",
  flowDescription: "flowDescription",
  humanInTheLoop: "humanInTheLoop",
  guardrails: "guardrails",
  businessCase: "businessCase",
  dataRequirements: "dataRequirements",
  sustainabilityImpact: "sustainabilityImpact",
  aiLab: "aiLab",
  origin: "origin",
  publicNote: "publicNote",
} as const satisfies Partial<Record<keyof UseCaseChanges, keyof CardRow>>;

/** Le chiavi di `intake` che «Cosa è» modifica (§6.2): area e «Possibile doppione di». */
const CHANGE_INTAKE_KEY = { area: "area", possibleDuplicateOf: "possibleDuplicateOf" } as const;

/**
 * Modifica i testi di «Cosa è», area, AI Lab, origine, tipo, nota pubblica e «Possibile
 * doppione di» (revisori, §6.2, §6.4). Cambiare l'origine non cambia «nascosta alla
 * ricerca» (§8.6). Una modifica che non cambia niente non scrive. Un'area nuova, se la guida
 * del connettore ha un elenco, deve essere una di quelle (§6.2); quella già salvata resta.
 */
export const updateUseCase = guarded("update_use_case", async function updateUseCase(
  ctx: WriteContext,
  id: string,
  expectedVersion: number,
  changes: UseCaseChangesInput,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, expectedVersion, "canEditWhat");
  if (!prep.ok) return prep;
  const { actor, loaded } = prep;
  const validated = validateUseCaseChanges(changes);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const { row } = loaded;
  const area = validated.changes.area;
  if (typeof area === "string" && area !== row.intake?.area) {
    const areas = await guideAreas(ctx.workspaceId);
    const areaError = areas ? areaOutsideGuide(area, areas) : null;
    if (areaError) return invalid({ area: areaError });
  }

  const set: UpdateSet = {};
  const after: Record<string, unknown> = { ...row };
  const fields = new Set<UseCaseEventField>();
  const intakeChange: IntakeChange = { set: {}, remove: [] };
  for (const [key, value] of Object.entries(validated.changes) as Array<[keyof UseCaseChanges, unknown]>) {
    if (value === undefined) continue;
    if (key === "kind") {
      const kind = portfolioKindOf(value as UseCaseKind);
      if (kind === row.portfolioKind) continue;
      set.portfolioKind = kind;
      after.portfolioKind = kind;
    } else if (key === "area" || key === "possibleDuplicateOf") {
      const intakeKey = CHANGE_INTAKE_KEY[key];
      if ((row.intake?.[intakeKey] ?? null) === value) continue;
      if (value === null) intakeChange.remove.push(intakeKey);
      else intakeChange.set[intakeKey] = value;
    } else {
      const column = CHANGE_COLUMN[key];
      if (row[column] === value) continue;
      (set as Record<string, unknown>)[column] = value;
      after[column] = value;
    }
    const field = CHANGE_EVENT_FIELD[key];
    if (field) fields.add(field);
  }
  const intakeChanged = intakeChange.remove.length > 0 || Object.keys(intakeChange.set).length > 0;
  if (intakeChanged) {
    set.intake = intakeMerge(intakeChange);
    after.intake = withIntakeChange(row, intakeChange);
  }
  if (Object.keys(set).length === 0) return unchanged(loaded);
  return commitWrite(ctx, actor, loaded, expectedVersion, {
    set,
    action: "modificato",
    fields: [...fields],
    after: after as PhaseColumns,
  });
});

// ═══ saveValuation ═══════════════════════════════════════════════════

export type ValuationInputRaw = z.input<typeof valuationSchema>;

type KpiMap = Record<string, number>;
type KpiScores = Partial<Record<Dimension, KpiMap>>;

/** I KPI inseriti (numero) o tolti («Nessun valore», null) sopra quelli salvati. */
function mergeKpis(current: KpiScores | null | undefined, input: Partial<Record<Dimension, Record<string, number | null>>>): KpiScores {
  const next: KpiScores = {};
  for (const [dimension, scores] of Object.entries(current ?? {}) as Array<[Dimension, KpiMap | undefined]>) {
    if (scores && typeof scores === "object") next[dimension] = { ...scores };
  }
  for (const [dimension, scores] of Object.entries(input) as Array<[Dimension, Record<string, number | null> | undefined]>) {
    if (!scores) continue;
    const target: KpiMap = { ...(next[dimension] ?? {}) };
    for (const [kpi, value] of Object.entries(scores)) {
      if (value === null) delete target[kpi];
      else target[kpi] = value;
    }
    next[dimension] = target;
  }
  return next;
}

interface ValuationChange {
  kpis?: Partial<Record<Dimension, Record<string, number | null>>>;
  valueEurYear?: number | null;
  cost?: CostInput;
  /** «Benefici e costi», già validato (`valueModelSchema`); null lo toglie. */
  model?: ValueModel | null;
  legacy?: Partial<Record<LegacyScoreKey, number>>;
}

/** Tentativi di una valutazione quando cambia qualcosa che non alza `version`. */
const VALUATION_ATTEMPTS = 3;

/** Le colonne di «Salva la valutazione» calcolate sulla scheda letta; null se non cambia niente. */
function valuationWrite(
  actor: Actor,
  loaded: Loaded,
  change: ValuationChange,
  model: Awaited<ReturnType<typeof workspaceModel>>,
): CardWrite | null {
  const { row } = loaded;
  const set: UpdateSet = {};
  const fields = new Set<UseCaseEventField>();
  let customScores = row.customScores;
  if (change.kpis) {
    const merged = mergeKpis(row.customScores, change.kpis);
    if (!sameJson(merged, row.customScores ?? {})) {
      customScores = merged;
      set.customScores = merged;
      fields.add("kpi");
    }
  }
  const legacy: Partial<Record<LegacyScoreKey, number>> = {};
  for (const [key, value] of Object.entries(change.legacy ?? {}) as Array<[LegacyScoreKey, number]>) {
    if (row[key] === value) continue;
    legacy[key] = value;
    fields.add("kpi");
  }
  Object.assign(set, legacy);
  if (change.valueEurYear !== undefined && change.valueEurYear !== row.valueEurYear) {
    set.valueEurYear = change.valueEurYear;
    fields.add("valore");
  }
  if (change.cost !== undefined) {
    const cost = costColumns(change.cost);
    if (cost.costEurOnce !== row.costEurOnce || cost.costBand !== row.costBand) {
      set.costEurOnce = cost.costEurOnce;
      set.costBand = cost.costBand;
      fields.add("costo");
    }
  }
  // «Benefici e costi»: il trigger della 0022 alza `version` quando `value_model` cambia. Nella
  // Storia solo i nomi: «valore», e «costo» se cambiano i costi del modello.
  if (change.model !== undefined && !sameJson(change.model, row.valueModel)) {
    set.valueModel = change.model;
    fields.add("valore");
    if (!sameJson(change.model?.costs ?? null, row.valueModel?.costs ?? null)) fields.add("costo");
  }
  const nextReview = row.portfolioReviewStatus === "archived" ? "archived" : "scored";
  if (fields.size === 0 && nextReview === row.portfolioReviewStatus) return null;
  set.portfolioReviewStatus = nextReview;
  set.reviewedBy = actor.userId;
  set.reviewedAt = sql`now()`;
  Object.assign(set, derivedSet(model.derive({ ...row, ...legacy, customScores })));
  return {
    set,
    action: "valutato",
    fields: [...fields],
    after: { ...row, portfolioReviewStatus: nextReview },
    // Gli aggregati vengono dalle colonne lette: le legacy e `ai_suggestion` non alzano `version`.
    sameStamp: true,
  };
}

/**
 * La scrittura di «Salva la valutazione»: KPI delle persone, valore all'anno, costo,
 * `portfolio_review_status = scored` (salvo le archiviate), chi ha valutato e quando, e gli
 * aggregati ricalcolati col modello del workspace. Se nel frattempo è cambiato qualcosa che
 * non alza `version` (suggerimento dell'AI, colonne legacy) si rilegge e si ricalcola. Con
 * `expectedVersion` null (PATCH di oggi, senza versione) vale la versione riletta.
 */
async function writeValuation(
  ctx: WriteContext,
  prep: { actor: Actor; loaded: Loaded; now: Date },
  expectedVersion: number | null,
  change: ValuationChange,
  model: Awaited<ReturnType<typeof workspaceModel>>,
): Promise<ServiceResult<UseCaseCard>> {
  const { actor, now } = prep;
  let loaded = prep.loaded;
  for (let attempt = 1; ; attempt++) {
    const version = expectedVersion ?? loaded.row.version;
    if (loaded.row.version !== version) return fail("versione_superata");
    const write = valuationWrite(actor, loaded, change, model);
    if (!write) return unchanged(loaded);
    const result = await commitWrite(ctx, actor, loaded, version, write);
    if (result.ok || result.error !== "versione_superata" || attempt >= VALUATION_ATTEMPTS) return result;
    const reloaded = await loadCard(ctx.workspaceId, loaded.row.id, now);
    if (!reloaded) return fail("non_trovato");
    loaded = reloaded;
  }
}

/**
 * «Salva la valutazione» (§6.3) e la valutazione di `update_use_case` del MCP del team: KPI
 * da 1 a 5 o vuoti (un KPI vuoto non conta zero, §7.6), valore all'anno, costo come importo
 * o fascia (mai entrambi, D5), «Benefici e costi» (`model`, lo schema di `value-model.ts`; null
 * lo toglie). Ogni KPI deve stare nel modello del workspace.
 */
export const saveValuation = guarded("save_valuation", async function saveValuation(
  ctx: WriteContext,
  id: string,
  expectedVersion: number,
  valuation: ValuationInputRaw,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, expectedVersion, "canEditValuation");
  if (!prep.ok) return prep;
  const model = await workspaceModel(ctx.workspaceId);
  const validated = validateValuation(valuation, { kpiIds: model.kpiIds });
  if (!validated.ok) return invalid(validated.fieldErrors);
  const { kpis, valueEurYear, cost, model: valueModel } = validated.valuation;
  return writeValuation(ctx, prep, expectedVersion, { kpis, valueEurYear, cost, model: valueModel }, model);
});

// ═══ decideUseCase, setWhen, setHiddenFromSearch ═════════════════════

/**
 * Una decisione di §3.7 (Approva, Rimanda, Serve info, Non avviare, Doppione di…, Archivia,
 * Riapri, Segna come diffusa, Segna come realizzato, Segna come in realizzazione), con le
 * stesse regole per pagina, REST e MCP del team (`applyDecision`).
 */
export const decideUseCase = guarded("decide_use_case", async function decideUseCase(
  ctx: WriteContext,
  id: string,
  expectedVersion: number,
  decision: Decision,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, expectedVersion, "canDecide");
  if (!prep.ok) return prep;
  const { actor, loaded, now } = prep;
  let duplicateTarget: { id: string; code: string } | null | undefined;
  if (decision?.type === "doppione") {
    const code = normalizeUseCaseCode(decision.ofCode);
    if (code) {
      const [target] = await db
        .select({ id: useCases.id, code: useCases.code })
        .from(useCases)
        .where(and(eq(useCases.workspaceId, ctx.workspaceId), eq(useCases.code, code)))
        .limit(1);
      duplicateTarget = target?.code ? { id: target.id, code: target.code } : null;
    }
  }
  const card = decisionCardOf(loaded);
  const result = applyDecision(card, decision, decisionContext(actor, loaded, now, duplicateTarget));
  if (!result.ok) return decisionFailure(result);
  return commitWrite(ctx, actor, loaded, expectedVersion, {
    set: decisionPatchSet(result.patch),
    action: result.action,
    fields: result.fields,
    after: applyDecisionPatch({ ...loaded.row, intake: loaded.row.intake ?? null }, result.patch),
  });
});

/** «Quando» di uno use case approvato: questo trimestre, il prossimo, più avanti o un trimestre esplicito. */
export const setWhen = guarded("set_when", async function setWhen(
  ctx: WriteContext,
  id: string,
  expectedVersion: number,
  when: WhenInput,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, expectedVersion, "canDecide");
  if (!prep.ok) return prep;
  const { actor, loaded, now } = prep;
  const result = applyWhen(decisionCardOf(loaded), when, decisionContext(actor, loaded, now));
  if (!result.ok) return decisionFailure(result);
  if (result.fields.length === 0) return unchanged(loaded);
  return commitWrite(ctx, actor, loaded, expectedVersion, {
    set: decisionPatchSet(result.patch),
    action: result.action,
    fields: result.fields,
    after: applyDecisionPatch({ ...loaded.row, intake: loaded.row.intake ?? null }, result.patch),
  });
});

// ═══ answerInfoRequest («Rispondi» su «Serve info», D17) ═════════════

/**
 * Chi ha proposto risponde alla domanda del team (D17, `answers.ts`). Solo una persona che entra
 * nell'area, solo sulle proprie proposte (`isOwnProposal`: id utente, o email verificata riletta
 * ora dalla tabella `users`) e solo in «Serve info». Nello stesso statement: la risposta in
 * `intake.risposte` con la sua data in `intake.rispostaInAttesa` (in attesa fino alla prossima
 * decisione), `portfolio_review_status` da `needs_inputs` a `in_review` (per il connettore
 * IN_VALUTAZIONE), la riga di Storia senza testo e senza persona (`proponente`, campo `intake`) e
 * il segnale della campanella dei revisori (`new_portfolio_item`, che solo i revisori vedono).
 *
 * La risposta vale per la domanda che chi risponde ha letto (§6.8): `seenQuestion` è la nota
 * pubblica che la pagina mostrava (`null` se non ce n'era). Se ora la domanda è un'altra (una
 * nuova «Serve info», o la nota cambiata nel frattempo), niente si salva: `versione_superata`,
 * e la pagina si rilegge con la domanda di adesso. Il contributore non riceve `version`: la
 * domanda è il segno della scheda che ha visto, senza dati in più nella sua proiezione.
 *
 * Una scheda nascosta alla ricerca e non propria, per chi non vede le nascoste, «non esiste»
 * (§1.2 punto 3, §6.9): `non_trovato`, come un id che non c'è.
 *
 * Restituisce solo la versione e lo stato per il cliente: chi risponde può essere un
 * contributore, che non riceve la scheda dei revisori.
 */
export const answerInfoRequest = guarded("answer_info_request", async function answerInfoRequest(
  ctx: WriteContext,
  id: string,
  text: unknown,
  seenQuestion: unknown,
): Promise<ServiceResult<{ version: number; connector: ConnectorStatus }>> {
  const prep = await prepare(ctx, id, null, "canOpenArea");
  if (!prep.ok) return prep;
  const { actor, loaded, now } = prep;
  const parsed = parseAnswerText(text);
  if (!parsed.ok) return invalid({ risposta: parsed.error });
  if (seenQuestion !== null && typeof seenQuestion !== "string") return invalid({ domanda: "Testo o null." });
  // La riga intera, solo per dire se è propria: il proponente non esce di qui (art. 15.4).
  const [[full], [person]] = await Promise.all([
    db
      .select()
      .from(useCases)
      .where(and(eq(useCases.id, loaded.row.id), eq(useCases.workspaceId, ctx.workspaceId)))
      .limit(1),
    db.select({ email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, actor.userId!)).limit(1),
  ]);
  if (!full) return fail("non_trovato");
  const own = isOwnProposal({ userId: actor.userId, email: person?.email ?? null, emailVerified: person?.emailVerified != null }, full);
  // Una nascosta altrui non si rivela a chi non vede le nascoste: come se non ci fosse.
  if (!own && isHiddenFromSearch(full.intake) && actor.abilities?.canSeeHidden !== true) return fail("non_trovato");
  const refusal = answerRefusal({ own, phase: loaded.phase.phase, subState: loaded.phase.subState });
  if (refusal === "non_propria") return fail("permesso_mancante", ANSWER_TEXT.notOwn);
  if (refusal === "non_richiesta") return fail("transizione_non_ammessa", ANSWER_TEXT.notAsked);
  // La domanda che ha letto chi risponde è ancora quella di adesso (§6.8).
  if (!sameQuestion(seenQuestion, loaded.row.publicNote)) return fail("versione_superata");

  const at = now.toISOString();
  const answers = withAnswer(loaded.row.intake, { at, text: parsed.value });
  // In attesa di una decisione fino alla prossima decisione del team (`applyDecision` la toglie).
  const change: IntakeChange = { set: { [ANSWERS_INTAKE_KEY]: answers, [ANSWER_PENDING_INTAKE_KEY]: at }, remove: [] };
  const signal = sql`sig AS (INSERT INTO weekly_signals (workspace_id, signal_type, title, description, related_entity_type, related_entity_id)
      SELECT workspace_id, 'new_portfolio_item', ${answerSignalTitle({ code: loaded.row.code, title: loaded.row.title })},
        ${ANSWER_TEXT.signalDescription}, 'use_case', id
      FROM upd
      RETURNING id)`;
  const written = await commitWrite(ctx, actor, loaded, loaded.row.version, {
    set: { portfolioReviewStatus: "in_review", intake: intakeMerge(change) },
    action: "modificato",
    fields: ["intake"],
    after: { ...loaded.row, portfolioReviewStatus: "in_review", intake: withIntakeChange(loaded.row, change) },
    alsoWith: signal,
    eventActor: "proponente",
  });
  if (!written.ok) return written;
  return { ok: true, value: { version: written.value.version, connector: written.value.phase.connector } };
});

/** «Nascondi dalla ricerca» e «Mostra ai colleghi» (§8.6). */
export const setHiddenFromSearch = guarded("set_hidden_from_search", async function setHiddenFromSearch(
  ctx: WriteContext,
  id: string,
  expectedVersion: number,
  hidden: boolean,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, expectedVersion, "canSetHiddenFromSearch");
  if (!prep.ok) return prep;
  if (typeof hidden !== "boolean") return invalid({ hidden: "Vero o falso." });
  const { actor, loaded } = prep;
  if ((loaded.row.intake?.hiddenFromSearch === true) === hidden) return unchanged(loaded);
  const change: IntakeChange = { set: { hiddenFromSearch: hidden }, remove: [] };
  return commitWrite(ctx, actor, loaded, expectedVersion, {
    set: { intake: intakeMerge(change) },
    action: "visibilita",
    fields: ["visibilita"],
    after: { ...loaded.row, intake: withIntakeChange(loaded.row, change) },
  });
});

// ═══ redactText («Oscura testo», §6.8) ═══════════════════════════════

/** Il segnaposto di «Oscura testo» (§1.2 punto 10). */
export const REDACTED_TEXT = "[testo rimosso]";

/**
 * I testi che «Oscura testo» può sostituire: titolo, i testi di «Cosa è», nota pubblica,
 * campi di testo di `intake` (dati raccolti da Claude) e motivazione dell'AI.
 */
export const REDACTABLE_FIELDS = [
  "titolo",
  "problema",
  "come_funziona",
  "chi_controlla",
  "limiti",
  "impatto_atteso",
  "dati",
  "impatto_ambientale",
  "area",
  "ai_lab",
  "nota_pubblica",
  "intake",
  "motivazione_ai",
] as const;
export type RedactableField = (typeof REDACTABLE_FIELDS)[number];

const REDACT_COLUMN = {
  titolo: "title",
  problema: "description",
  come_funziona: "flowDescription",
  chi_controlla: "humanInTheLoop",
  limiti: "guardrails",
  impatto_atteso: "businessCase",
  dati: "dataRequirements",
  impatto_ambientale: "sustainabilityImpact",
  ai_lab: "aiLab",
  nota_pubblica: "publicNote",
} as const satisfies Partial<Record<RedactableField, keyof CardRow>>;

/**
 * Il campo della Storia di ogni testo oscurato. «Impatto ambientale e sociale» e la
 * motivazione dell'AI non hanno un nome nell'elenco chiuso della 0020 (§10.3): la riga
 * «oscurato» c'è, senza quel nome (come `CHANGE_EVENT_FIELD` di `inputs.ts`).
 */
const REDACT_EVENT_FIELD: Readonly<Record<RedactableField, UseCaseEventField | null>> = {
  titolo: "titolo",
  problema: "problema",
  come_funziona: "come_funziona",
  chi_controlla: "chi_controlla",
  limiti: "limiti",
  impatto_atteso: "impatto_atteso",
  dati: "dati",
  impatto_ambientale: null,
  area: "area",
  ai_lab: "ai_lab",
  nota_pubblica: "nota_pubblica",
  intake: "intake",
  motivazione_ai: null,
};

/** I testi liberi di `intake` scritti dal connettore (contratto v2). */
const INTAKE_TEXT_KEYS = ["toolsOther", "promptSnippet", "sourceConversation"] as const;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value !== REDACTED_TEXT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * La motivazione dell'AI della v1 sta anche nelle note, in blocchi etichettati: in
 * `review_notes` (v1) e nella copia `ai_suggestion.v1Backup.reviewNotes` (`scoring-v2
 * --apply`, §7.6). Stessa espressione regolare di `replaceAiRationale` (ai-ranking.ts): un
 * blocco va dall'etichetta al blocco dell'AI dopo, o alla fine.
 */
const AI_NOTE_LABELS = ["Auto-ranking AI", "Suggerimento AI", "Ricalibrazione AI"] as const;
const AI_NOTE_LABEL_GROUP = AI_NOTE_LABELS.join("|");
const AI_NOTE_BLOCK = new RegExp(`(^|\\n\\n)(${AI_NOTE_LABEL_GROUP}):[\\s\\S]*?(?=\\n\\n(?:${AI_NOTE_LABEL_GROUP}):|$)`, "g");
/**
 * La stessa per Postgres: `.` prende anche gli a capo e `$` è la fine del testo. `{1,1}?`
 * rende pigra tutta l'espressione (in Postgres la decide il primo quantificatore): senza,
 * un blocco si mangerebbe le etichette dei blocchi dopo.
 */
const AI_NOTE_BLOCK_PG = `(^|\\n\\n){1,1}?(${AI_NOTE_LABEL_GROUP}):.*?(?=\\n\\n(?:${AI_NOTE_LABEL_GROUP}):|$)`;
/** Ogni blocco tiene la sua etichetta e perde il testo. */
const AI_NOTE_REPLACEMENT_PG = `\\1\\2:\n${REDACTED_TEXT}`;

/** Le note hanno almeno un blocco dell'AI con del testo ancora da oscurare? */
function hasAiNoteText(notes: unknown): boolean {
  if (typeof notes !== "string") return false;
  for (const match of notes.matchAll(AI_NOTE_BLOCK)) {
    if (hasText(match[0].slice(match[1].length + match[2].length + 1).trim())) return true;
  }
  return false;
}

/** `regexp_replace` dei blocchi dell'AI in un testo SQL. */
function redactAiNotesSql(text: SQL): SQL {
  return sql`regexp_replace(${text}, ${AI_NOTE_BLOCK_PG}::text, ${AI_NOTE_REPLACEMENT_PG}::text, 'g')`;
}

/** `intake` con i testi scelti sostituiti; `changed` falso se non c'era niente da oscurare. */
function redactIntake(
  intake: Record<string, unknown> | null,
  opts: { area: boolean; texts: boolean },
): { next: Record<string, unknown>; changed: boolean } {
  const next = structuredClone(intake ?? {}) as Record<string, unknown>;
  let changed = false;
  if (opts.area && hasText(next.area)) {
    next.area = REDACTED_TEXT;
    changed = true;
  }
  if (opts.texts) {
    for (const key of INTAKE_TEXT_KEYS) {
      if (hasText(next[key])) {
        next[key] = REDACTED_TEXT;
        changed = true;
      }
    }
    // Le motivazioni della stima di chi propone (efficienza, sforzo, semaforo).
    if (isRecord(next.proposerEstimate)) {
      for (const part of Object.values(next.proposerEstimate)) {
        if (isRecord(part) && hasText(part.reasoning)) {
          part.reasoning = REDACTED_TEXT;
          changed = true;
        }
      }
    }
    // Le risposte di chi ha proposto a «Serve info» (D17): resta la data, il testo no.
    if (Array.isArray(next[ANSWERS_INTAKE_KEY])) {
      for (const answer of next[ANSWERS_INTAKE_KEY] as unknown[]) {
        if (isRecord(answer) && hasText(answer.text)) {
          answer.text = REDACTED_TEXT;
          changed = true;
        }
      }
    }
  }
  return { next, changed };
}

/**
 * «Oscura testo»: i testi scelti diventano «[testo rimosso]» e non restano in Unbundle.
 * Nello stesso statement: la scheda, i segnali della campanella della scheda (se si oscura
 * il titolo o il problema, titolo e descrizione del segnale) e la riga di Storia, che
 * registra solo i nomi dei campi. Il dossier e il questionario AI Readiness hanno una loro
 * copia e non cambiano (lo dice il dialogo). Non esiste via MCP.
 */
export const redactText = guarded("redact_text", async function redactText(
  ctx: WriteContext,
  id: string,
  expectedVersion: number,
  fields: readonly RedactableField[],
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, expectedVersion, "canRedact");
  if (!prep.ok) return prep;
  const { actor, loaded } = prep;
  const { row } = loaded;
  const chosen = new Set<RedactableField>();
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!(REDACTABLE_FIELDS as readonly string[]).includes(field)) return invalid({ fields: "Campo non previsto." });
    chosen.add(field);
  }
  if (chosen.size === 0) return invalid({ fields: "Scegli almeno un testo." });

  const set: UpdateSet = {};
  const after: Record<string, unknown> = { ...row };
  const done = new Set<RedactableField>();
  for (const field of chosen) {
    if (!(field in REDACT_COLUMN)) continue;
    const column = REDACT_COLUMN[field as keyof typeof REDACT_COLUMN];
    if (!hasText(row[column])) continue;
    (set as Record<string, unknown>)[column] = REDACTED_TEXT;
    after[column] = REDACTED_TEXT;
    done.add(field);
  }
  const intake = redactIntake(row.intake, { area: chosen.has("area"), texts: chosen.has("intake") });
  if (intake.changed) {
    set.intake = intake.next;
    after.intake = intake.next;
    if (chosen.has("area") && hasText(row.intake?.area)) done.add("area");
    if (chosen.has("intake")) done.add("intake");
  }
  const suggestion: unknown = row.aiSuggestion;
  const backup = isRecord(suggestion) && isRecord(suggestion.v1Backup) ? suggestion.v1Backup : null;
  const aiText =
    (isRecord(suggestion) && hasText(suggestion.rationale)) || hasAiNoteText(backup?.reviewNotes) || hasAiNoteText(row.reviewNotes);
  if (chosen.has("motivazione_ai") && aiText) {
    // Ogni copia della motivazione dell'AI: `ai_suggestion.rationale`, i blocchi dell'AI della
    // copia `v1Backup.reviewNotes` e quelli di `review_notes` (v1). Né `ai_suggestion` né
    // `review_notes` sono nella versione: si cambiano sui valori della riga di adesso.
    const rationale = sql`CASE WHEN jsonb_typeof(${useCases.aiSuggestion} -> 'rationale') = 'string'
      THEN jsonb_set(${useCases.aiSuggestion}, '{rationale}', to_jsonb(${REDACTED_TEXT}::text))
      ELSE ${useCases.aiSuggestion} END`;
    set.aiSuggestion = sql`(SELECT CASE WHEN jsonb_typeof(s.v #> '{v1Backup,reviewNotes}') = 'string'
        THEN jsonb_set(s.v, '{v1Backup,reviewNotes}', to_jsonb(${redactAiNotesSql(sql`s.v #>> '{v1Backup,reviewNotes}'`)}))
        ELSE s.v END
      FROM (SELECT ${rationale} AS v) s)`;
    set.reviewNotes = redactAiNotesSql(sql`${useCases.reviewNotes}`);
    done.add("motivazione_ai");
  }
  if (done.size === 0) return invalid({ fields: NOTHING_TO_REDACT_ERROR }, NOTHING_TO_REDACT_ERROR);

  // Segnali della campanella della scheda (portfolio-dispatch: titolo e 220 caratteri del problema).
  const alsoWith =
    done.has("titolo") || done.has("problema")
      ? sql`sig AS (UPDATE weekly_signals SET title = ${REDACTED_TEXT}, description = ${REDACTED_TEXT}
          WHERE related_entity_type = 'use_case'
            AND related_entity_id IN (SELECT id FROM upd)
            AND workspace_id IN (SELECT workspace_id FROM upd)
          RETURNING id)`
      : undefined;
  const eventFields = [...done].map((field) => REDACT_EVENT_FIELD[field]).filter((f): f is UseCaseEventField => f !== null);
  return commitWrite(ctx, actor, loaded, expectedVersion, {
    set,
    action: "oscurato",
    fields: eventFields,
    after: after as PhaseColumns,
    alsoWith,
  });
});

// ═══ recordAiSuggestion ══════════════════════════════════════════════

export type AiSuggestionKind = "auto" | "suggerimento" | "ricalibrazione";

/** Punteggi e motivazione dell'AI (§7.6 regola 3). `at` lo scrive il servizio. */
export interface AiSuggestion {
  scores?: Partial<Record<Dimension, Record<string, number | null>>> | null;
  rationale?: string | null;
  model?: string | null;
  kind: AiSuggestionKind;
}

const aiScoreMap = z.record(z.string().min(1).max(80), z.number().finite().min(1).max(5).nullable());
const aiSuggestionSchema = z
  .object({
    scores: z
      .object({ impact: aiScoreMap.optional(), feasibility: aiScoreMap.optional(), esg: aiScoreMap.optional() })
      .strict()
      .nullable()
      .optional(),
    rationale: z.string().trim().max(8000).nullable().optional(),
    model: z.string().trim().max(120).nullable().optional(),
    kind: z.enum(["auto", "suggerimento", "ricalibrazione"]),
  })
  .strict();

const AI_SUGGESTION_ATTEMPTS = 3;

/** La scheda che l'AI ha letto prima di chiamare il modello (v2): vedi `recordAiSuggestion`. */
export interface AiSuggestionGuard {
  /** `version` della scheda letta prima della chiamata al modello. */
  expectedVersion: number;
}

/**
 * Scrive `ai_suggestion` e gli aggregati ricalcolati: mai `custom_scores`, `reviewed_by`,
 * `reviewed_at`, `review_notes` (§7.6 regola 3). La copia `v1Backup` resta.
 *
 * Stato della revisione (§7.6 regola 4): con `auto` e `ricalibrazione` una scheda
 * `needs_inputs` senza persona (`reviewed_by` NULL, RICEVUTA per il contratto) passa a
 * `in_review`; ogni altra scheda (con persona, `in_review`, `scored`, `archived`) resta com'è.
 * Quel passaggio alza `version`. Con `suggerimento` («Chiedi un suggerimento» di chi valuta)
 * lo stato non cambia mai, e nemmeno `version` (trigger della 0020): «Chiedi un nuovo
 * suggerimento» e poi «Salva la valutazione» con la versione di prima vanno a buon fine.
 * Chi salta le archiviate nella ricalibrazione è chi chiama.
 *
 * Con `guard` (l'AI della v2, che legge la scheda prima di chiamare il modello) la scrittura
 * vale solo per la scheda che l'AI ha letto: se `version` non è più `guard.expectedVersion`, o
 * se la scheda riletta non è più tra quelle che l'AI può scrivere (`aiMayWriteSuggestion`: una
 * persona l'ha valutata o archiviata mentre il modello rispondeva), non si scrive niente e il
 * risultato è `{ written: false }`. Il controllo è sulla riga riletta a ogni tentativo, e lo
 * statement scrive solo se `version` e `updated_at` sono ancora quelli: §7.6 regola 4 anche con
 * scritture concorrenti.
 *
 * Lo scrivono l'AI e gli script; una persona solo se valuta.
 */
export const recordAiSuggestion = guarded("record_ai_suggestion", async function recordAiSuggestion(
  ctx: WriteContext,
  id: string,
  suggestion: AiSuggestion,
  guard?: AiSuggestionGuard,
): Promise<ServiceResult<{ written: boolean }>> {
  await ensureDbSchema();
  const resolved = await resolveActor(ctx);
  if (!resolved.ok) return resolved;
  const { actor } = resolved;
  if (actor.kind === "persona" && !personaCan(actor, "canEditValuation")) return fail("permesso_mancante");
  const parsed = aiSuggestionSchema.safeParse(suggestion);
  if (!parsed.success) return invalid(itemErrors(parsed.error, ""));
  const now = ctx.now ?? new Date();
  const scores: KpiScores = {};
  for (const [dimension, map] of Object.entries(parsed.data.scores ?? {}) as Array<[Dimension, Record<string, number | null> | undefined]>) {
    if (!map) continue;
    const kept = Object.fromEntries(Object.entries(map).filter((entry): entry is [string, number] => entry[1] !== null));
    if (Object.keys(kept).length) scores[dimension] = kept;
  }
  const stored = {
    ...(Object.keys(scores).length ? { scores } : {}),
    rationale: parsed.data.rationale || null,
    model: parsed.data.model || null,
    at: now.toISOString(),
    kind: parsed.data.kind,
  };
  const model = await workspaceModel(ctx.workspaceId);
  // L'AI agisce da sé: nella Storia è «ai» (o «sistema» per gli script), mai una persona.
  const writer: Actor = { kind: actor.kind === "sistema" ? "sistema" : "ai", userId: null, abilities: null };

  for (let attempt = 0; attempt < AI_SUGGESTION_ATTEMPTS; attempt++) {
    const loaded = await loadCard(ctx.workspaceId, id, now);
    if (!loaded) return fail("non_trovato");
    if (guard && (loaded.row.version !== guard.expectedVersion || !aiMayWriteSuggestion(loaded.row, parsed.data.kind))) {
      return { ok: true, value: { written: false } };
    }
    const derived = model.derive({ ...loaded.row, aiSuggestion: stored } as Parameters<typeof model.derive>[0]);
    const set: UpdateSet = {
      aiSuggestion: sql`${JSON.stringify(stored)}::jsonb || CASE WHEN ${useCases.aiSuggestion} -> 'v1Backup' IS NOT NULL
        THEN jsonb_build_object('v1Backup', ${useCases.aiSuggestion} -> 'v1Backup') ELSE '{}'::jsonb END`,
      ...derivedSet(derived),
    };
    const promote =
      parsed.data.kind !== "suggerimento" && loaded.row.portfolioReviewStatus === "needs_inputs" && loaded.row.reviewedBy === null;
    if (promote) {
      set.portfolioReviewStatus = sql`CASE WHEN ${useCases.portfolioReviewStatus} = 'needs_inputs' AND ${useCases.reviewedBy} IS NULL
        THEN 'in_review'::portfolio_review_status ELSE ${useCases.portfolioReviewStatus} END`;
    }
    // Gli aggregati si calcolano sulle colonne lette adesso (anche quelle che non alzano
    // `version`): con una scrittura arrivata nel frattempo si rilegge.
    const result = await commitWrite(ctx, writer, loaded, loaded.row.version, {
      set,
      action: "suggerimento_ai",
      fields: [],
      after: promote ? { ...loaded.row, portfolioReviewStatus: "in_review" } : loaded.row,
      sameStamp: true,
    });
    if (result.ok) return { ok: true, value: { written: true } };
    if (result.error !== "versione_superata") return result;
  }
  return fail("riprova");
});

// ═══ recordRealizationStarted ════════════════════════════════════════

/**
 * «Avvia la realizzazione» (§6.5): dopo la creazione del dossier scrive la riga di Storia
 * «realizzazione avviata». `status` resta `accepted`: la fase la dà il collegamento. Solo
 * Lateral Space con ruolo da revisore, con la sezione Casi d'uso accesa e il dossier
 * completo collegato a questa scheda. Una seconda chiamata non scrive un'altra riga.
 */
export const recordRealizationStarted = guarded("record_realization_started", async function recordRealizationStarted(
  ctx: WriteContext,
  id: string,
  caseId: string,
): Promise<ServiceResult<void>> {
  const prep = await prepare(ctx, id, null, "canStartRealization");
  if (!prep.ok) return prep;
  const { actor, loaded } = prep;
  if (loaded.dossierRead === "errore") return fail("riprova", DECISION_MESSAGES.dossierUnreadable);
  if (loaded.dossierRead === "spenta") return fail("transizione_non_ammessa", DOSSIER_NOT_LINKED_ERROR);
  if (!isUuid(caseId) || loaded.dossier?.caseId.toLowerCase() !== caseId.toLowerCase()) {
    return fail("transizione_non_ammessa", DOSSIER_NOT_LINKED_ERROR);
  }
  const before = phaseOf(loaded.row, null, loaded.today);
  const event = insertUseCaseEventFrom("card", {
    ...eventActor(ctx, actor),
    channel: ctx.channel,
    action: "realizzazione_avviata",
    fields: [],
    phaseBefore: phaseCode(before),
    phaseAfter: phaseCode(loaded.phase),
  });
  await db.execute(sql`WITH card AS (
      SELECT u.id, u.workspace_id FROM use_cases u
      WHERE u.id = ${loaded.row.id}::uuid AND u.workspace_id = ${ctx.workspaceId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM use_case_events e
          WHERE e.use_case_id = u.id AND e.action = 'realizzazione_avviata'
        )
    ) ${event}`);
  return { ok: true, value: undefined };
});

// ═══ REST di oggi (§9.3) ═════════════════════════════════════════════

/** Il contesto di una PATCH REST: la persona della sessione, canale `rest`. */
export function restWriteContext(
  user: { id: string; email: string | null; emailVerified: boolean },
  workspaceId: string,
  role: string | null,
): WriteContext {
  return {
    workspaceId,
    actor: {
      userId: user.id,
      role,
      isLateralSpace: isLateralSpaceEmailUser({ email: user.email, emailVerified: user.emailVerified }, ucLsDomains()),
      kind: "persona",
    },
    channel: "rest",
  };
}

/**
 * La decisione di una PATCH `status` di oggi (§9.3): `accepted` vale «Approva · Più
 * avanti», `rejected` «Non avviare» senza nota (modo `legacy`), `implemented` «Segna come
 * diffusa» per una best practice approvata e altrimenti «Segna come realizzato»,
 * `in_progress` «Segna come in realizzazione». `draft` e `proposed` non sono decisioni.
 */
export function legacyStatusDecision(
  card: { status: string; portfolioKind: string | null; phase: string },
  next: UseCaseStatusValue,
): Decision | null {
  switch (next) {
    case "accepted":
      return { type: "approva", quando: "piu_avanti" };
    case "rejected":
      return { type: "non_avviare", publicNote: null, legacy: true };
    case "implemented":
      return card.portfolioKind === "best_practice" && card.phase === "approvato"
        ? { type: "segna_diffusa" }
        : { type: "segna_realizzato" };
    case "in_progress":
      return { type: "segna_in_realizzazione" };
    default:
      return null;
  }
}

/** Il messaggio di oggi per un passaggio fuori dalla mappa di `use-case-lifecycle.ts`. */
function legacyTransitionError(from: string, next: string): Failure {
  return fail("transizione_non_ammessa", `Transizione non consentita: da "${from}" a "${next}".`);
}

/**
 * PATCH `…/status` con il corpo di oggi (`{ status }`), canale `rest`, in tutti i workspace.
 * Lo stesso stato di adesso non scrive niente, come oggi. I passaggi ammessi li decide
 * sempre la mappa di oggi (`isAllowedStatusTransition`, §3.7). Poi:
 * - area spenta per il workspace: come oggi, cambia solo `status` (nei workspace spenti
 *   nulla deve cambiare, §3.7), con la sua riga di Storia «decisione»;
 * - area accesa: la decisione di §3.7 che corrisponde (`legacyStatusDecision`), con le
 *   regole della pagina (fase, dossier, «Segna come in realizzazione» solo Lateral Space).
 */
export const applyLegacyStatus = guarded("apply_legacy_status", async function applyLegacyStatus(
  ctx: WriteContext,
  id: string,
  next: UseCaseStatusValue,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, null, "canDecide");
  if (!prep.ok) return prep;
  const { actor, loaded } = prep;
  const from = loaded.row.status;
  if (from === next) return unchanged(loaded);
  if (!isAllowedStatusTransition(from, next)) return legacyTransitionError(from, next);
  if (!isUseCaseHubWorkspace(ctx.workspaceId)) {
    return commitWrite(ctx, actor, loaded, loaded.row.version, {
      set: { status: next },
      action: "decisione",
      fields: [],
      after: { ...loaded.row, status: next },
    });
  }
  const decision = legacyStatusDecision({ ...loaded.row, phase: loaded.phase.phase }, next);
  if (!decision) return legacyTransitionError(from, next);
  return decideUseCase(ctx, id, loaded.row.version, decision);
});

export type LegacyScoresInput = Partial<Record<LegacyScoreKey, number>>;

/**
 * PATCH `…/scores` con il corpo di oggi (colonne legacy da 1 a 5): passa da «Salva la
 * valutazione», quindi scheda `scored`, chi ha valutato, aggregati ricalcolati e riga di
 * Storia «valutato» (KPI). Senza versione nel corpo: se nel frattempo un'altra scrittura
 * cambia la scheda, si rilegge e si ricalcola.
 */
export const saveLegacyScores = guarded("save_legacy_scores", async function saveLegacyScores(
  ctx: WriteContext,
  id: string,
  scores: LegacyScoresInput,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, null, "canEditValuation");
  if (!prep.ok) return prep;
  const legacy: LegacyScoresInput = {};
  const fieldErrors: Record<string, string> = {};
  for (const [key, value] of Object.entries(scores ?? {})) {
    if (value === undefined) continue;
    if (!(LEGACY_SCORE_KEYS as readonly string[]).includes(key)) fieldErrors[key] = "Campo non previsto.";
    else if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) {
      fieldErrors[key] = "Il punteggio deve essere tra 1 e 5.";
    } else legacy[key as LegacyScoreKey] = value;
  }
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);
  if (Object.keys(legacy).length === 0) return invalid({ payload: "Includi almeno un punteggio da aggiornare." });
  const model = await workspaceModel(ctx.workspaceId);
  return writeValuation(ctx, prep, null, { legacy }, model);
});

/**
 * PATCH `…/wave` (deprecata, §9.3): il quadrante a mano, per i soli revisori. `category`
 * non si mostra più e non fa salire la versione. Come ogni scrittura ha la sua riga di
 * Storia, «modificato» senza campi (la categoria non ha un nome nell'elenco chiuso, §10.3).
 * La stessa categoria non scrive niente. Si toglie con la pulizia (fase 6).
 */
export const setLegacyCategory = guarded("set_legacy_category", async function setLegacyCategory(
  ctx: WriteContext,
  id: string,
  category: UseCaseCategoryValue,
): Promise<ServiceResult<UseCaseCard>> {
  const prep = await prepare(ctx, id, null, "canEditValuation");
  if (!prep.ok) return prep;
  const { actor, loaded } = prep;
  if (loaded.row.category === category) return unchanged(loaded);
  return commitWrite(ctx, actor, loaded, loaded.row.version, {
    set: { category },
    action: "modificato",
    fields: [],
    after: loaded.row,
  });
});

/** Lo stato HTTP di un errore del servizio nelle rotte REST. */
export function restStatusOf(error: ServiceError): number {
  switch (error) {
    case "permesso_mancante":
      return 403;
    case "non_trovato":
    case "area_spenta":
      return 404;
    case "versione_superata":
      return 409;
    case "riprova":
      return 503;
    case "transizione_non_ammessa":
    case "dati_non_validi":
      return 400;
  }
}

/**
 * La risposta REST di un errore del servizio: `{ error, code, fieldErrors? }` con lo stato di
 * `restStatusOf`. Solo errori: la scheda di un successo porta `reviewedBy` e l'intake dei
 * revisori, quindi le rotte rispondono `{ useCase: toUseCaseApiRow(result.value) }`
 * (`src/lib/portfolio/use-case-client-rows.ts`) e non passano mai da qui.
 */
export function restResponse(result: Extract<ServiceResult<unknown>, { ok: false }>): Response {
  const body: Record<string, unknown> = { error: result.message, code: result.error };
  if (result.fieldErrors) body.fieldErrors = result.fieldErrors;
  return Response.json(body, { status: restStatusOf(result.error) });
}
