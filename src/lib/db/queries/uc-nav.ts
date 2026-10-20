import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getUcUserContext, isUcEnabled, isUcEnabledFor, isUcLsConfigured, ucLsDomains } from "@/lib/db/queries/uc-access";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import type { DossierCardView, UseCaseRealization } from "@/lib/uc/views/realization";
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { readDossierCards, readRealization, type RealizationViewer } from "./uc-realization";
import { UUID } from "@/lib/uc/ids";

/**
 * Punti in cui il resto di Unbundle tocca i dossier (DESIGN §2.1): barra di
 * ripiego, scheda di oggi e, per la pagina Use case, il capitolo
 * «Realizzazione» e la colonna «In realizzazione».
 *
 * Ogni lettura controlla `UC_ENABLED`, l'accensione del workspace
 * (`UC_WORKSPACE_IDS`, P0-1) e che le tabelle uc esistano (`to_regclass`): il
 * self-heal uc parte solo dalle query uc, quindi qui non si crea nulla. Un
 * errore registra il motivo nel log e la pagina prosegue senza la parte del
 * dossier. Le letture vere stanno in `uc-realization.ts`.
 *
 * Nessun import dalla pagina Use case: chi la monta passa i dati ai componenti
 * di `components/uc/realization` e `shell/case-card.tsx` come props.
 */

/** Le tabelle uc, una volta trovate, si ricontrollano solo ogni 5 minuti: un giro in meno per pagina. */
const TABLES_TTL_MS = 5 * 60_000;
let tablesSeenAt = 0;

async function ucTablesPresent(): Promise<boolean> {
  if (tablesSeenAt > 0 && Date.now() - tablesSeenAt < TABLES_TTL_MS) return true;
  const { rows } = await db.execute(sql`SELECT to_regclass('public.uc_cases') IS NOT NULL AND to_regclass('public.uc_case_members') IS NOT NULL
    AND to_regclass('public.uc_roi_models') IS NOT NULL AND to_regclass('public.uc_items') IS NOT NULL AS ok`);
  const present = (rows[0] as { ok: boolean } | undefined)?.ok === true;
  tablesSeenAt = present ? Date.now() : 0;
  return present;
}

/**
 * La voce «Casi d'uso» nella barra laterale di ripiego: solo con la sezione
 * accesa per il workspace e mai per chi partecipa solo ai corsi. La vede chi
 * gestisce il workspace (vede i dossier in sola lettura), chi di Lateral Space
 * può avviarli e chi è membro di un dossier del workspace.
 */
export async function ucCasesNavVisible(i: { userId: string; workspaceId: string; role: string }): Promise<boolean> {
  if (!isUcEnabled() || i.role === "learner" || !UUID.test(i.workspaceId) || !UUID.test(i.userId)) return false;
  if (!isUcEnabledFor(i.workspaceId)) return false;
  if (canManageWorkspaceSettings(i.role)) return true;
  try {
    if (canReviewWorkspacePortfolio(i.role) && (await getUcUserContext(i.userId))?.isLateralSpace) return true;
    if (!(await ucTablesPresent())) return false;
    const { rows } = await db.execute(sql`SELECT EXISTS (
      SELECT 1 FROM uc_case_members m JOIN uc_cases c ON c.id = m.case_id
      WHERE m.user_id = ${i.userId}::uuid AND c.workspace_id = ${i.workspaceId}::uuid AND c.setup_completed_at IS NOT NULL
    ) AS ok`);
    return (rows[0] as { ok: boolean } | undefined)?.ok === true;
  } catch (error) {
    ucLogError({ area: "uc", op: "voce_di_menu", workspaceId: i.workspaceId }, error);
    return false;
  }
}

export interface PortfolioCaseLink {
  /** Caso già avviato da questa scheda, se chi guarda lo può aprire. */
  existing: { id: string; code: string } | null;
  /** La persona può avviare un caso da questa scheda (scheda «Da costruire» accettata, nessun caso, Lateral Space). */
  canStart: boolean;
}

/**
 * Il riquadro sulla scheda di oggi (`use-cases/[useCaseId]`): link al dossier
 * già avviato, oppure «Avvia la realizzazione» se la scheda è «Da costruire»,
 * accettata, e la persona può avviarlo (mai per una best practice). Null con la sezione spenta (anche solo per il
 * workspace) o senza le tabelle uc. La pagina Use case usa invece
 * `realizationForUseCase`.
 */
export async function portfolioCaseLink(i: { userId: string; workspaceId: string; role: string; useCaseId: string; useCaseStatus: string }): Promise<PortfolioCaseLink | null> {
  if (!isUcEnabled() || i.role === "learner" || !UUID.test(i.workspaceId) || !UUID.test(i.useCaseId) || !UUID.test(i.userId)) return null;
  if (!isUcEnabledFor(i.workspaceId)) return null;
  try {
    if (!(await ucTablesPresent())) return null;
    const { rows } = await db.execute(sql`SELECT coalesce(u.portfolio_kind, 'use_case_ai') AS kind, d.id, d.code, d.member
      FROM use_cases u
      LEFT JOIN LATERAL (
        SELECT c.id, c.code, EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${i.userId}::uuid) AS member
        FROM uc_cases c
        WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NOT NULL
        ORDER BY c.created_at, c.id LIMIT 1
      ) d ON true
      WHERE u.id = ${i.useCaseId}::uuid AND u.workspace_id = ${i.workspaceId}::uuid`);
    const row = rows[0] as { kind: string; id: string | null; code: string | null; member: boolean | null } | undefined;
    if (row?.id) {
      // Il collegamento solo a chi il caso lo vede (membro, o chi gestisce il workspace in sola lettura).
      const visible = row.member === true || canManageWorkspaceSettings(i.role);
      return { existing: visible ? { id: String(row.id), code: String(row.code) } : null, canStart: false };
    }
    // Si avvia solo da uno use case «Da costruire» approvato: una best practice non ha un dossier.
    if (!row || row.kind !== "use_case_ai" || i.useCaseStatus !== "accepted" || !canReviewWorkspacePortfolio(i.role)) return { existing: null, canStart: false };
    const user = await getUcUserContext(i.userId);
    return { existing: null, canStart: user?.isLateralSpace === true };
  } catch (error) {
    ucLogError({ area: "uc", op: "collegamento_scheda", workspaceId: i.workspaceId }, error);
    return null;
  }
}

function viewerFor(userId: string, role: string): RealizationViewer {
  return { userId, canReview: canReviewWorkspacePortfolio(role), canManage: canManageWorkspaceSettings(role) };
}

/**
 * Il capitolo «Realizzazione» della scheda dello use case (DESIGN §2.1
 * ingresso 1; `docs/use-case/DESIGN.md` §6.5), per chi guarda. Il nome non
 * inizia con `use` (D16). Al massimo 2 giri, più il controllo delle tabelle
 * ogni 5 minuti. Null se lo use case non è del workspace.
 */
export async function realizationForUseCase(i: { userId: string; workspaceId: string; role: string; useCaseId: string }): Promise<UseCaseRealization | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.useCaseId) || !UUID.test(i.userId)) return null;
  if (i.role === "learner" || !canReviewWorkspacePortfolio(i.role)) return { state: "nascosta" };
  if (!isUcEnabledFor(i.workspaceId)) return { state: "spenta" };
  try {
    if (!(await ucTablesPresent())) return { state: "spenta" };
    const executor = await getAppUcExecutor();
    return await readRealization(executor, { workspaceId: i.workspaceId, useCaseId: i.useCaseId, viewer: viewerFor(i.userId, i.role), lsDomains: ucLsDomains() });
  } catch (error) {
    ucLogError({ area: "uc", op: "capitolo_realizzazione", workspaceId: i.workspaceId }, error);
    return { state: "errore" };
  }
}

export type DossierColumn =
  | { state: "nascosta" | "spenta" | "errore" }
  | {
      state: "pronta";
      /** In ordine: prima quelli in cui tocca a chi guarda, poi per ultima modifica. */
      cards: DossierCardView[];
      /** Card per use case (id in minuscolo), per la colonna della Roadmap. */
      byUseCase: Map<string, DossierCardView>;
      /** «Configurazione da completare…»: una volta sopra la colonna, solo per chi gestisce il workspace. */
      readOnlyNotice: boolean;
    };

/**
 * La colonna «In realizzazione» della Roadmap (DESIGN §2.1 ingresso 2, §3.1):
 * le card dei dossier di questi use case, in blocco. I contributori non
 * ricevono la parte del dossier (`nascosta`). Un giro: dossier, chi guarda e il
 * prossimo passo di tutti, più il controllo delle tabelle ogni 5 minuti.
 */
export async function casesForUseCases(i: { workspaceId: string; userId: string; role: string; useCaseIds: readonly string[] }): Promise<DossierColumn> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.userId) || i.role === "learner" || !canReviewWorkspacePortfolio(i.role)) return { state: "nascosta" };
  if (!isUcEnabledFor(i.workspaceId)) return { state: "spenta" };
  try {
    if (!(await ucTablesPresent())) return { state: "spenta" };
    const executor = await getAppUcExecutor();
    const read = await readDossierCards(executor, { workspaceId: i.workspaceId, useCaseIds: i.useCaseIds, viewer: viewerFor(i.userId, i.role), lsDomains: ucLsDomains() });
    return { state: "pronta", ...read, readOnlyNotice: canManageWorkspaceSettings(i.role) && !isUcLsConfigured() };
  } catch (error) {
    ucLogError({ area: "uc", op: "colonna_realizzazione", workspaceId: i.workspaceId }, error);
    return { state: "errore" };
  }
}

/**
 * Le card dei dossier che chi guarda apre, per la lista di ripiego
 * `/casi-duso` (DESIGN §3.1, «La pagina /casi-duso di oggi»). La pagina ha già
 * controllato la sezione con `ensureUcAvailable(workspaceId)`: un errore qui si
 * propaga alla sua pagina d'errore.
 */
export async function dossierCardsForWorkspace(i: { workspaceId: string; userId: string; role: string }): Promise<DossierCardView[]> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.userId) || i.role === "learner") return [];
  const executor = await getAppUcExecutor();
  const read = await readDossierCards(executor, { workspaceId: i.workspaceId, useCaseIds: null, viewer: viewerFor(i.userId, i.role), lsDomains: ucLsDomains() });
  return read.cards;
}
