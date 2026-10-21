import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { useCases, workspaceConnectorConfigs } from "@/lib/db/schema";
import { isUcEnabled } from "@/lib/db/queries/uc-access";
import type { DossierColumn } from "@/lib/db/queries/uc-nav";
import { isUcWorkspaceEnabled } from "@/lib/uc/rollout";
import type { UseCaseRealization } from "@/lib/uc/views/realization";
import { CASE_STATUSES, isVocab, type CaseStatus } from "@/lib/uc/vocab";
import { realizationPrefill, type RealizationPrefill } from "@/lib/use-cases/realization-prefill";

/**
 * Letture del dossier per l'area «Use case» (docs/use-case/DESIGN.md §9.1, §10.4;
 * PIANO-LAVORI H1d). Ogni lettura uc dell'area passa da qui: il servizio (H2a) calcola
 * la fase con lo stato del dossier, le letture (H2b) ci aggiungono il riepilogo minimo,
 * H6a quello ricco dei Casi d'uso.
 *
 * - La sezione Casi d'uso può essere spenta per tutti (`UC_ENABLED`) o per il workspace
 *   (`UC_WORKSPACE_IDS`, casi-duso P0-1), e le tabelle uc possono non esserci: il
 *   self-heal uc parte solo dalle rotte uc con la sezione accesa, e qui non parte mai.
 *   Quindi prima `isUcEnabled()`, poi `isUcWorkspaceEnabled()`, poi `ucTablesPresent()`
 *   (`to_regclass`), poi la lettura. Nei primi tre casi la risposta è
 *   `{ ok: false, motivo: "spenta" }`, senza log: nessun dossier, e va bene. Così il
 *   servizio costruisce `ucSectionEnabled` (`decisions.ts`) da questa sola risposta.
 *   Un workspace che non è un UUID non è nell'elenco: anche lui ha la sezione spenta.
 * - Ogni altro guasto è `{ ok: false, motivo: "errore" }`, con una riga di log che ha il
 *   solo nome dell'errore (mai messaggio, query, parametri o id). Il servizio rifiuta
 *   allora con `riprova` le decisioni che dipendono dal dossier (§9.1 passo 2).
 * - Un dossier conta solo se completo: `setup_completed_at IS NOT NULL` (§10.4 punto 5).
 *
 * `ucTablesPresent` è locale: quella di `uc-nav.ts` non è esportata e il file è dei Casi
 * d'uso. Il riepilogo ricco (capitolo «Realizzazione» e card della Roadmap, H6a) lo
 * calcolano `realizationForUseCase` e `casesForUseCases` di `uc-nav.ts`, con le stesse
 * guardie (`UC_ENABLED`, `UC_WORKSPACE_IDS`, `to_regclass`) e il log dei Casi d'uso: qui
 * si importano solo quando servono, così le altre pagine non caricano la parte uc.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nome dell'indice unico tra dossier e scheda (0020 e, con C11b, DDL uc; DESIGN §10.4), scritto uguale nella query. */
export const DOSSIER_LINK_UNIQUE_INDEX = "uc_cases_portfolio_use_case_unique_idx";

/** Perché una lettura del dossier non ha una risposta. */
export type DossierReadMotivo = "spenta" | "errore";

export type DossierReadFailure = { ok: false; motivo: DossierReadMotivo };

/** `{ ok: true, ... }` oppure `{ ok: false, motivo }` (DESIGN §9.1). */
export type DossierRead<T extends object> = ({ ok: true } & T) | DossierReadFailure;

/** Il dossier completo collegato a uno use case. */
export interface DossierState {
  caseId: string;
  /** Codice del dossier (`uc_cases.code`). */
  code: string;
  status: CaseStatus;
}

const SPENTA: DossierReadFailure = Object.freeze({ ok: false, motivo: "spenta" });
const ERRORE: DossierReadFailure = Object.freeze({ ok: false, motivo: "errore" });

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** La sezione è accesa per il workspace (`UC_ENABLED` e `UC_WORKSPACE_IDS`)? */
function sectionOn(workspaceId: string): boolean {
  if (!isUcEnabled()) return false;
  const { UC_WORKSPACE_IDS, VERCEL_ENV } = process.env;
  return isUcWorkspaceEnabled(workspaceId, { UC_WORKSPACE_IDS, VERCEL_ENV });
}

/** Le tabelle uc lette qui ci sono? Con la sezione accesa possono ancora mancare. */
async function ucTablesPresent(): Promise<boolean> {
  const { rows } = await db.execute(sql`SELECT to_regclass('public.uc_cases') IS NOT NULL AS ok`);
  return (rows[0] as { ok: boolean } | undefined)?.ok === true;
}

const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

/** Il nome di un errore, senza il messaggio: `error.name`, o la classe se il nome è quello generico. */
function errorName(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const name = error.name && error.name !== "Error" ? error.name : error.constructor?.name;
  return typeof name === "string" && ERROR_NAME.test(name) ? name : "Error";
}

/**
 * Una riga di log con il solo nome dell'errore (e della sua causa, se c'è): i messaggi del
 * database contengono la query e i parametri.
 */
function logReadError(op: string, error: unknown): void {
  const cause = error instanceof Error ? errorName(error.cause) : null;
  const payload = { op, error: errorName(error) ?? typeof error, ...(cause ? { cause } : {}) };
  console.error("[use-case-hub] lettura del dossier non riuscita", JSON.stringify(payload));
}

/**
 * Il riepilogo minimo di un dossier per la Roadmap (colonna «In realizzazione», DESIGN §4.5;
 * PIANO-LAVORI H2b): stato e codice, più l'avanzamento dalla cache `uc_cases.readiness`
 * («0 di 245 indispensabili a posto»). La prossima tappa, il conto del ROI e il link per chi
 * può aprirlo sono il riepilogo ricco dei Casi d'uso (C10), che arriva con H6a.
 */
export interface DossierSummary extends DossierState {
  /** G1 della cache: indispensabili richiesti e a posto. null senza cache o con numeri non validi. */
  readiness: { required: number; ok: number } | null;
}

type DossierRow = { useCaseId: unknown; caseId: unknown; code: unknown; status: unknown; required?: unknown; readyOk?: unknown };

/** Un conteggio della cache: intero non negativo, altrimenti null. */
function count(value: unknown): number | null {
  const n = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * I dossier completi collegati agli use case della lista, in una sola lettura, con le guardie
 * di testa (sezione, tabelle) e il log del solo nome dell'errore. Gli use case senza dossier
 * completo (nessun dossier, o solo uno incompleto) non compaiono. Se una scheda ha più
 * dossier completi (prima dell'indice unico) vale il più vecchio, come in `uc-nav.ts`.
 * Solo i dossier del workspace indicato; gli id che non sono UUID si ignorano; le chiavi
 * della mappa sono gli id degli use case in minuscolo.
 */
async function readDossiers(
  op: string,
  workspaceId: string,
  useCaseIds: readonly string[],
): Promise<DossierRead<{ found: ReadonlyMap<string, DossierSummary> }>> {
  if (!sectionOn(workspaceId)) return SPENTA;
  const ids = [...new Set(useCaseIds.filter(isUuid).map((id) => id.toLowerCase()))];
  try {
    if (!(await ucTablesPresent())) return SPENTA;
    const found = new Map<string, DossierSummary>();
    if (ids.length === 0) return { ok: true, found };
    const { rows } = await db.execute(sql`SELECT DISTINCT ON (c.portfolio_use_case_id)
        c.portfolio_use_case_id AS "useCaseId", c.id AS "caseId", c.code, c.status,
        c.readiness -> 'G1' ->> 'required' AS "required", c.readiness -> 'G1' ->> 'ok' AS "readyOk"
      FROM uc_cases c
      WHERE c.workspace_id = ${workspaceId}::uuid
        AND c.portfolio_use_case_id = ANY(${sql.param(ids)}::uuid[])
        AND c.setup_completed_at IS NOT NULL
      ORDER BY c.portfolio_use_case_id, c.created_at, c.id`);
    for (const row of rows as DossierRow[]) {
      if (!isVocab(CASE_STATUSES, row.status)) throw new TypeError("Stato del dossier fuori vocabolario");
      const required = count(row.required);
      const ok = count(row.readyOk);
      found.set(String(row.useCaseId).toLowerCase(), {
        caseId: String(row.caseId),
        code: String(row.code),
        status: row.status,
        readiness: required !== null && ok !== null && ok <= required ? { required, ok } : null,
      });
    }
    return { ok: true, found };
  } catch (error) {
    logReadError(op, error);
    return ERRORE;
  }
}

/**
 * Stato e codice del dossier completo collegato a ogni use case della lista, in una sola
 * lettura. Gli use case senza dossier completo (nessun dossier, o solo uno incompleto)
 * non compaiono nella mappa. Se una scheda ha più dossier completi (prima dell'indice
 * unico) vale il più vecchio, come in `uc-nav.ts`.
 *
 * Solo i dossier del workspace indicato. Gli id di use case che non sono UUID si ignorano;
 * le chiavi della mappa sono gli id degli use case in minuscolo.
 */
export async function dossierStates(
  workspaceId: string,
  useCaseIds: readonly string[],
): Promise<DossierRead<{ states: ReadonlyMap<string, DossierState> }>> {
  const read = await readDossiers("dossier_states", workspaceId, useCaseIds);
  if (!read.ok) return read;
  const states = new Map<string, DossierState>();
  for (const [useCaseId, { caseId, code, status }] of read.found) states.set(useCaseId, { caseId, code, status });
  return { ok: true, states };
}

/**
 * Il riepilogo minimo della Roadmap (`DossierSummary`) per ogni use case della lista, in una
 * sola lettura, con le stesse guardie e le stesse risposte di `dossierStates`: «spenta»
 * senza log, «errore» con una riga di log col solo nome dell'errore. Così l'area si apre
 * anche senza la parte del dossier (DESIGN §4.9).
 */
export async function dossierSummaries(
  workspaceId: string,
  useCaseIds: readonly string[],
): Promise<DossierRead<{ summaries: ReadonlyMap<string, DossierSummary> }>> {
  const read = await readDossiers("dossier_summaries", workspaceId, useCaseIds);
  return read.ok ? { ok: true, summaries: read.found } : read;
}

/** Il dossier completo di un solo use case: `dossier: null` se non c'è (§9.1 passo 2). */
export async function dossierStateForUseCase(
  workspaceId: string,
  useCaseId: string,
): Promise<DossierRead<{ dossier: DossierState | null }>> {
  const result = await dossierStates(workspaceId, [useCaseId]);
  if (!result.ok) return result;
  const dossier = isUuid(useCaseId) ? (result.states.get(useCaseId.toLowerCase()) ?? null) : null;
  return { ok: true, dossier };
}

/**
 * I dossier del workspace sono tutti collegati a una scheda (DESIGN §10.4 punto 6): vero se
 * l'indice unico esiste e nessun dossier completo del workspace ha `portfolio_use_case_id`
 * nullo. I dossier incompleti non contano. Decide il redirect di `/casi-duso` (§2.3, H6a):
 * chi la chiama reindirizza solo con `{ ok: true, ready: true }`.
 */
export async function dossierLinksReady(workspaceId: string): Promise<DossierRead<{ ready: boolean }>> {
  if (!sectionOn(workspaceId)) return SPENTA;
  try {
    if (!(await ucTablesPresent())) return SPENTA;
    const { rows } = await db.execute(sql`SELECT
        to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM uc_cases c
          WHERE c.workspace_id = ${workspaceId}::uuid
            AND c.setup_completed_at IS NOT NULL
            AND c.portfolio_use_case_id IS NULL
        ) AS ready`);
    return { ok: true, ready: (rows[0] as { ready: boolean } | undefined)?.ready === true };
  } catch (error) {
    logReadError("dossier_links_ready", error);
    return ERRORE;
  }
}

// ═══ Riepilogo ricco (H6a) ═══════════════════════════════════════════

/** Chi guarda, per le letture che dipendono da lui (membro del dossier, chi gestisce). */
export interface DossierViewer {
  userId: string;
  role: string;
}

/**
 * Il capitolo «Realizzazione» della scheda (DESIGN §6.5) per chi guarda: delega a
 * `realizationForUseCase` di `uc-nav.ts` (stato, avanzamento, prossima tappa, le tre cifre
 * del ROI dai totali di `uc_roi_models`, «Apri il dossier» solo a chi lo apre). I
 * contributori ricevono `nascosta`; sezione spenta o tabelle assenti `spenta`; un guasto
 * `errore` (il log lo scrive `uc-nav.ts`, col solo nome dell'errore). null se lo use case
 * non è del workspace.
 */
export async function realizationOfUseCase(workspaceId: string, viewer: DossierViewer, useCaseId: string): Promise<UseCaseRealization | null> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(viewer.userId)) return null;
  if (!sectionOn(workspaceId)) return { state: "spenta" };
  const { realizationForUseCase } = await import("@/lib/db/queries/uc-nav");
  return realizationForUseCase({ userId: viewer.userId, workspaceId, role: viewer.role, useCaseId });
}

/**
 * Le card della colonna «In realizzazione» della Roadmap (DESIGN §4.5; casi-duso DESIGN §3.1),
 * in blocco: delega a `casesForUseCases` di `uc-nav.ts`. Contributori `nascosta`; sezione
 * spenta `spenta`; guasto `errore` (la colonna mostra allora le card dello use case).
 */
export async function dossierColumnOf(workspaceId: string, viewer: DossierViewer, useCaseIds: readonly string[]): Promise<DossierColumn> {
  if (!isUuid(workspaceId) || !isUuid(viewer.userId)) return { state: "nascosta" };
  if (!sectionOn(workspaceId)) return { state: "spenta" };
  const ids = [...new Set(useCaseIds.filter(isUuid).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return { state: "pronta", cards: [], byUseCase: new Map(), readOnlyNotice: false };
  const { casesForUseCases } = await import("@/lib/db/queries/uc-nav");
  return casesForUseCases({ workspaceId, userId: viewer.userId, role: viewer.role, useCaseIds: ids });
}

/**
 * Il dossier precompilato di una scheda arrivata dal connettore (decisione del 19/10/2026,
 * `realization-prefill.ts`): null per ogni altra scheda, per una scheda di un altro workspace
 * o che non c'è. Legge solo problema, soluzione, `intake` e la guida del connettore, mai il
 * proponente. Non è una lettura uc: la usa la pagina di avvio e l'action, sul server.
 */
export async function realizationPrefillOf(workspaceId: string, useCaseId: string): Promise<RealizationPrefill | null> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId)) return null;
  const [row] = await db
    .select({ problem: useCases.description, flow: useCases.flowDescription, intake: useCases.intake, guide: workspaceConnectorConfigs.guide })
    .from(useCases)
    .leftJoin(workspaceConnectorConfigs, eq(workspaceConnectorConfigs.workspaceId, useCases.workspaceId))
    .where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, workspaceId)))
    .limit(1);
  return row ? realizationPrefill(row) : null;
}
