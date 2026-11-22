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
import { PORTFOLIO_REVIEWER_ROLES, canManageWorkspaceSettings, isCollaboratorRole } from "../workspace-permissions.ts";
import { LEARNED_SOURCE_PREFIX, type ContextChannel, type ContextVisibility, type SourceKind, type SourceOrigin } from "./vocab.ts";

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

/**
 * (9b) La persona della CLI della fabbrica, canale «cli» (RILASCIO-9b-COSTRUZIONE.md §4.1): ruolo nel workspace e
 * Lateral Space riletti dalla rotta per la richiesta (`openCli`, l'e-mail verificata in `UC_LS_EMAIL_DOMAINS`).
 */
export function contextActorForCli(i: { workspaceId: string; userId: string; role: string | null; isLateralSpace: boolean }): ContextActor {
  return { workspaceId: i.workspaceId, userId: i.userId, role: i.role, isLateralSpace: i.isLateralSpace === true, channel: "cli" };
}

/**
 * (9b, D1) Chi guarda dagli agenti e dai prompt: la CLI, l'MCP del caso, il pacchetto (`CONTESTO.md`), la chat della
 * Discovery, i generatori. Vede solo i fatti «Per tutti», anche quando a chiedere è Lateral Space: i coding agent
 * scrivono in repository e PR che leggono anche chi costruisce da fuori e il cliente, e la chat è una stanza condivisa.
 */
export const AGENT_VIEWER: Readonly<Pick<ContextActor, "role" | "isLateralSpace">> = Object.freeze({ role: "contributor", isLateralSpace: false });

/** Che cosa può fare chi guarda: la tabella del §5.1. */
export function contextAbilities(viewer: Pick<ContextActor, "role" | "isLateralSpace">): ContextAbilities {
  const role = viewer.role;
  // I cinque ruoli da collaboratore (`COLLABORATOR_ROLES`): chi segue solo un corso, «Solo questo use case» (8.0d) e un
  // ruolo sconosciuto non aprono niente. «Solo questo use case» legge solo i fatti legati al suo caso, dal progetto e
  // dalla CLI (`loadAgentContext` con `caseOnly`), mai la pagina «Contesto».
  if (typeof role !== "string" || !isCollaboratorRole(role)) return NOTHING;
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

/**
 * La più stretta di due visibilità: «Solo Lateral Space» se una delle due lo è. Una conferma non allarga mai chi vede un
 * fatto: una versione nuova tiene la visibilità più stretta tra la proposta e il fatto di adesso. Allarga solo una
 * modifica esplicita del fatto («Per tutti / Solo Lateral Space»).
 */
export function stricterVisibility(a: ContextVisibility, b: ContextVisibility): ContextVisibility {
  return a === "ls" || b === "ls" ? "ls" : "tutti";
}

/**
 * Una fonte scritta dal cliente: un documento, tranne quelli che Lateral Space ha caricato come suoi appunti («Solo
 * Lateral Space» e caricati da una persona di Lateral Space). Gli appunti li aggiunge solo Lateral Space. La lettura di
 * una fonte del cliente non riceve i fatti, gli impegni e le domande «Solo Lateral Space», e le sue proposte non sono
 * mai preselezionate: un documento può contenere istruzioni scritte per il modello.
 * (9b) Una fonte `risposta` (le risposte di un referente) è sempre del cliente, anche se è «Solo Lateral Space».
 */
export function isClientSource(source: { kind: SourceKind; visibility: ContextVisibility; addedByLateralSpace: boolean }): boolean {
  if (source.kind === "risposta") return true;
  return source.kind === "documento" && !(source.visibility === "ls" && source.addedByLateralSpace);
}

/**
 * (9b) Una cosa imparata costruendo un caso (`unbundle impara`): origine `cli` e `external_id` che comincia con
 * «impara:». La scrive chi costruisce, anche da fuori Lateral Space: le sue proposte non sono mai preselezionate, e la
 * sua fonte si legge «Costruzione 14 nov».
 */
export function isLearnedSource(source: { origin: SourceOrigin | null; externalId: string | null | undefined }): boolean {
  return source.origin === "cli" && typeof source.externalId === "string" && source.externalId.startsWith(LEARNED_SOURCE_PREFIX);
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
