/**
 * Chi vede e chi fa in «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §5): una funzione sola dice
 * che cosa può fare chi guarda (`contextAbilities`), una sola dice se vede una riga (`visibleTo`). Le usano le pagine,
 * le rotte, le azioni e ogni funzione di `src/lib/db/queries/context-*.ts`, che rifà il controllo da sé.
 *
 * - **Lateral Space**: e-mail verificata in `UC_LS_EMAIL_DOMAINS` e un ruolo nel workspace diverso da `learner`. Vede
 *   tutto e scrive: appunti, proposte, fatti, impegni, domande, Granola.
 * - **Cliente**: legge i fatti, gli impegni, le domande e i documenti «Per tutti», fa domande, carica documenti. Mai
 *   gli appunti, le citazioni, la storia, chi ha confermato.
 * - **Solo formazione** (`learner`): niente.
 * Senza `UC_LS_EMAIL_DOMAINS` nessuno è Lateral Space: la pagina si legge e basta.
 * Modulo puro.
 */
import { PORTFOLIO_REVIEWER_ROLES, canManageWorkspaceSettings } from "../workspace-permissions.ts";
import type { ContextChannel, ContextVisibility } from "./vocab.ts";

/** Chi agisce, con il ruolo appena riletto. `isLateralSpace`: e-mail verificata in `UC_LS_EMAIL_DOMAINS`. */
export interface ContextActor {
  workspaceId: string;
  userId: string;
  role: string | null;
  isLateralSpace: boolean;
  channel: ContextChannel;
}

export interface ContextAbilities {
  /** Membro del workspace, non «learner». */
  canOpen: boolean;
  /** Fatti `ls`, appunti, proposte, citazioni, chi ha confermato. */
  seesLateralSpace: boolean;
  canAddNotes: boolean;
  canConfirm: boolean;
  /** Scrivere, modificare, ritirare un fatto; chiudere impegni e domande. */
  canEditMemory: boolean;
  canAsk: boolean;
  canAddQuestion: boolean;
  canUploadDocuments: boolean;
  /** Dipendenti e ricavo: i revisori, come «Programma». */
  canSeeCompanyFigures: boolean;
  /** Risposte dei referenti e decisioni in «Chiedi»: i revisori. */
  canSeeReviewerSources: boolean;
  canUseGranola: boolean;
}

/** I ruoli di chi lavora nel workspace: tutti tranne chi segue solo un corso. Un ruolo sconosciuto non apre niente. */
const COLLABORATOR_ROLES: readonly string[] = Object.freeze(["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor"]);

const NOTHING: ContextAbilities = Object.freeze({
  canOpen: false,
  seesLateralSpace: false,
  canAddNotes: false,
  canConfirm: false,
  canEditMemory: false,
  canAsk: false,
  canAddQuestion: false,
  canUploadDocuments: false,
  canSeeCompanyFigures: false,
  canSeeReviewerSources: false,
  canUseGranola: false,
});

/**
 * La persona del token dell'MCP del team, canale «claude» (§3.3): ruolo e Lateral Space sono quelli riletti per la
 * richiesta (`authenticateTeamRequest`). Qui, nel modulo puro, così il MCP la usa senza caricare la sessione delle
 * pagine; src/lib/context/server/actor.ts la riesporta.
 */
export function contextActorFromPrincipal(principal: {
  workspaceId: string;
  userId: string;
  viewer: { role: string | null; isLateralSpace: boolean };
}): ContextActor {
  return {
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    role: principal.viewer.role,
    isLateralSpace: principal.viewer.isLateralSpace === true,
    channel: "claude",
  };
}

/** Che cosa può fare chi guarda: la tabella del §5.1. */
export function contextAbilities(viewer: Pick<ContextActor, "role" | "isLateralSpace">): ContextAbilities {
  const role = viewer.role;
  if (typeof role !== "string" || !COLLABORATOR_ROLES.includes(role)) return NOTHING;
  const lateralSpace = viewer.isLateralSpace === true;
  const reviewer = (PORTFOLIO_REVIEWER_ROLES as readonly string[]).includes(role);
  return {
    canOpen: true,
    seesLateralSpace: lateralSpace,
    canAddNotes: lateralSpace,
    canConfirm: lateralSpace,
    canEditMemory: lateralSpace,
    canAsk: true,
    canAddQuestion: true,
    canUploadDocuments: true,
    canSeeCompanyFigures: reviewer,
    canSeeReviewerSources: reviewer,
    canUseGranola: lateralSpace,
  };
}

/**
 * Il filtro di visibilità, uno solo: «Per tutti» lo vede chi apre la pagina, «Solo Lateral Space» solo Lateral Space.
 * Nelle query è `AND (${isLateralSpace} OR visibility = 'tutti')`.
 */
export function visibleTo(viewer: Pick<ContextActor, "isLateralSpace">, visibility: ContextVisibility): boolean {
  return visibility === "tutti" || viewer.isLateralSpace === true;
}

/** «Togli» su un documento: Lateral Space; chi gestisce il workspace; chi l'ha caricato. Mai chi segue solo un corso. */
export function canRemoveDocument(viewer: Pick<ContextActor, "userId" | "role" | "isLateralSpace">, doc: { uploadedByUserId: string | null }): boolean {
  const abilities = contextAbilities(viewer);
  if (!abilities.canOpen) return false;
  if (abilities.seesLateralSpace) return true;
  if (canManageWorkspaceSettings(viewer.role)) return true;
  return doc.uploadedByUserId !== null && doc.uploadedByUserId === viewer.userId;
}

/** La visibilità di una domanda aggiunta da «Chiedi al contesto»: `ls` se la aggiunge Lateral Space, `tutti` altrimenti. */
export function questionVisibilityFor(viewer: Pick<ContextActor, "isLateralSpace">): ContextVisibility {
  return viewer.isLateralSpace ? "ls" : "tutti";
}

/**
 * La visibilità con cui nasce un documento: `ls` se lo carica Lateral Space da «Aggiungi appunti»; `tutti` se lo carica
 * il cliente, o chiunque dalla chat di Discovery o di mappatura.
 */
export function documentVisibilityFor(viewer: Pick<ContextActor, "isLateralSpace">, origin: "appunti" | "chat"): ContextVisibility {
  return origin === "appunti" && viewer.isLateralSpace ? "ls" : "tutti";
}
