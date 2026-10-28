/**
 * Chi può fare e vedere cosa nell'area «Use case» (docs/use-case/DESIGN.md §4.10, §5.1,
 * §5.5, §6.7, §6.9, §9.1 passo 1, §11; decisioni D3, D4, D13, D16).
 *
 * - **Ruoli** da `src/lib/workspace-permissions.ts` (si importa e basta): revisori sono
 *   `exec_sponsor`, `transformation_lead`, `function_lead`, `analyst`; chi gestisce il
 *   workspace sono `exec_sponsor` e `transformation_lead`. «Lateral Space» è l'email
 *   verificata in un dominio di `UC_LS_EMAIL_DOMAINS`, calcolata fuori di qui
 *   (`isLateralSpaceEmail`) e passata in `viewer.isLateralSpace`. «AI Builder del cliente»
 *   è un revisore che non è di Lateral Space. Chi segue solo un corso (`learner`) non entra.
 * - **D3.** Decidono tutti i revisori, anche del cliente: Approva, Rimanda, Serve info,
 *   Non avviare, Quando, Doppione di…, Archivia, Riapri, Segna come diffusa, Segna come
 *   realizzato. «Avvia la realizzazione» e «Segna come in realizzazione» solo Lateral
 *   Space con ruolo da revisore.
 * - **D4 e D13.** I contributori vedono titolo, fase e «Quando»; delle **proprie** proposte
 *   anche codice e nota pubblica. Propria vuol dire `proposed_by` uguale all'id utente o
 *   all'email di chi guarda (l'email senza distinguere maiuscole, e solo se verificata):
 *   lo decide solo `isOwnProposal`. Le schede nascoste alla ricerca non le vedono, salvo
 *   le proprie.
 * - Il ruolo si rilegge a ogni chiamata (`getCollaboratorAccess`): qui arriva già letto,
 *   e nessun permesso si salva in un token o in una sessione.
 *
 * È l'unico modulo dell'area che legge `proposedBy` per decidere cosa è proprio
 * (`art15-4.source.test.ts`); restituisce solo vero o falso, mai chi ha proposto.
 * I nomi non iniziano con `use` più una maiuscola (D16).
 *
 * Modulo puro: solo import relativi `.ts`, nessun `server-only`.
 */
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "../workspace-permissions.ts";
import { PHASE_LABEL, phaseOfUseCase, type PhaseInput } from "./phase.ts";
import type { Phase, SubState, UseCaseSource } from "./types.ts";

/** Chi guarda, con il ruolo del workspace riletto in questa richiesta. */
export interface UseCaseViewer {
  userId: string | null;
  email: string | null;
  /**
   * `session.user.emailVerified`: Firebase attesta che chi guarda controlla la casella.
   * Senza, l'email non prova nulla (chiunque può registrarsi con un indirizzo altrui che
   * non ha ancora un account) e non rende proprie le proposte salvate con quell'email.
   */
  emailVerified: boolean;
  /** Ruolo nel workspace (`getCollaboratorAccess`); null senza accesso. */
  role: string | null;
  /** Email verificata in un dominio di Lateral Space (`isLateralSpaceEmail`). */
  isLateralSpace: boolean;
}

/** Le tre colonne di DESIGN §4.10, più chi non entra (`learner`, nessun ruolo, ruolo sconosciuto). */
export type ViewerKind = "lateral_space" | "ai_builder" | "contributore" | "escluso";

/** Cosa apre «Nuovo use case» (§5.1). */
export type NewUseCaseEntry = "pannello_rapido" | "modulo_completo";

/** Quale proiezione dei dati riceve chi guarda (§11): chi gestisce il workspace vede anche «Proposto da». */
export type UseCaseProjection = "gestore" | "revisore" | "contributore";

export interface UseCaseAbilities {
  kind: ViewerKind;
  /** Ruolo da revisore (D3). */
  isReviewer: boolean;
  /** Email di Lateral Space, qualunque sia il ruolo. */
  isLateralSpace: boolean;
  /** `exec_sponsor` o `transformation_lead`, di Lateral Space o del cliente. */
  managesWorkspace: boolean;
  projection: UseCaseProjection | null;
  /** Voce «Use case» e pagine dell'area. */
  canOpenArea: boolean;
  /** Vista «Priorità» (matrice, lista, Da diffondere). */
  canSeePriority: boolean;
  /**
   * Valore, Costo, zone, euro, punteggi e cifre della Roadmap; anche «Benefici e costi»
   * (`value_model`) e le «Ipotesi di calcolo» in sola lettura. Solo i revisori: la proiezione
   * del contributore non li porta mai.
   */
  canSeeFigures: boolean;
  /** Codici e nota pubblica di tutte le schede (i contributori: solo delle proprie). */
  canSeeAllCodes: boolean;
  /** Schede nascoste alla ricerca anche se non proprie. */
  canSeeHidden: boolean;
  /** Origine, tipo e «Altri filtri» (i contributori: solo «Cerca per titolo»). */
  canUseAllFilters: boolean;
  /** «Esporta Excel» (la rotta risponde 403 agli altri). */
  canExport: boolean;
  /** «Proponi da Activity mapping» nel menu «⋯». */
  canProposeFromActivityMapping: boolean;
  newUseCase: NewUseCaseEntry | null;
  /** Approva, Rimanda, Serve info, Non avviare, Quando, Doppione di…, Archivia, Riapri, Segna come diffusa, Segna come realizzato. */
  canDecide: boolean;
  /** «Avvia la realizzazione»: solo Lateral Space (D3). */
  canStartRealization: boolean;
  /** «Segna come in realizzazione», con la sezione Casi d'uso spenta: solo Lateral Space (D3). */
  canMarkInProgress: boolean;
  /** «Cosa è»: legge e modifica. */
  canEditWhat: boolean;
  /** «Valutazione»: legge e modifica, «Chiedi un nuovo suggerimento». */
  canEditValuation: boolean;
  /** «Nascondi dalla ricerca» e «Mostra ai colleghi». */
  canSetHiddenFromSearch: boolean;
  /** «Storia». */
  canSeeHistory: boolean;
  /** «Proposto da» ed «Email indicata» in «Dettagli». */
  canSeeProposer: boolean;
  /** «Oscura testo»: Lateral Space con ruolo da revisore e chi gestisce il workspace (§1.2 punto 10). */
  canRedact: boolean;
  /** «Apri il dossier» anche senza esserne membro. */
  canOpenAnyDossier: boolean;
  /**
   * «Cosa serve» (`use_case_needs`: requisiti e prossimi passi) nella sua vista della pagina «Use
   * case», nel pannello e nella scheda. Solo i revisori: la pagina, la REST, il MCP e l'export non
   * li portano mai agli altri.
   */
  canSeeNeeds: boolean;
  /** Aggiunge, modifica, collega e archivia le esigenze di «Cosa serve»: tutti i revisori. */
  canEditNeeds: boolean;
  /** Impostazioni › Valutazione: nome del team, prefisso dei codici, soglie, fasce del costo, «Ipotesi di calcolo». */
  canEditSettings: boolean;
  /** Token personali del MCP del team (§1.2 punto 8). */
  canUseTeamMcp: boolean;
}

function noAbilities(isLateralSpace: boolean): UseCaseAbilities {
  return {
    kind: "escluso",
    isReviewer: false,
    isLateralSpace,
    managesWorkspace: false,
    projection: null,
    canOpenArea: false,
    canSeePriority: false,
    canSeeFigures: false,
    canSeeAllCodes: false,
    canSeeHidden: false,
    canUseAllFilters: false,
    canExport: false,
    canProposeFromActivityMapping: false,
    newUseCase: null,
    canDecide: false,
    canStartRealization: false,
    canMarkInProgress: false,
    canEditWhat: false,
    canEditValuation: false,
    canSetHiddenFromSearch: false,
    canSeeHistory: false,
    canSeeProposer: false,
    canRedact: false,
    canOpenAnyDossier: false,
    canSeeNeeds: false,
    canEditNeeds: false,
    canEditSettings: false,
    canUseTeamMcp: false,
  };
}

/** Cosa può fare e vedere chi guarda, in ogni pagina, server action, rotta REST e tool del MCP del team. */
export function abilitiesForUseCase(viewer: UseCaseViewer): UseCaseAbilities {
  const isLateralSpace = viewer.isLateralSpace === true;
  const role = viewer.role;
  const reviewer = canReviewWorkspacePortfolio(role);
  if (!reviewer) {
    if (role !== "contributor") return noAbilities(isLateralSpace);
    return { ...noAbilities(isLateralSpace), kind: "contributore", projection: "contributore", canOpenArea: true, newUseCase: "modulo_completo" };
  }
  const manages = canManageWorkspaceSettings(role);
  const lsReviewer = isLateralSpace;
  return {
    kind: lsReviewer ? "lateral_space" : "ai_builder",
    isReviewer: true,
    isLateralSpace,
    managesWorkspace: manages,
    projection: manages ? "gestore" : "revisore",
    canOpenArea: true,
    canSeePriority: true,
    canSeeFigures: true,
    canSeeAllCodes: true,
    canSeeHidden: true,
    canUseAllFilters: true,
    canExport: true,
    canProposeFromActivityMapping: true,
    newUseCase: lsReviewer ? "pannello_rapido" : "modulo_completo",
    canDecide: true,
    canStartRealization: lsReviewer,
    canMarkInProgress: lsReviewer,
    canEditWhat: true,
    canEditValuation: true,
    canSetHiddenFromSearch: true,
    canSeeHistory: true,
    canSeeProposer: manages,
    canRedact: lsReviewer || manages,
    canOpenAnyDossier: manages,
    canSeeNeeds: true,
    canEditNeeds: true,
    canEditSettings: manages,
    canUseTeamMcp: true,
  };
}

/** Chi decide, per `applyDecision`, `applyWhen` e `checkStartRealization` (decisions.ts). */
export function decisionActorFor(viewer: UseCaseViewer): { userId: string | null; isReviewer: boolean; isLateralSpace: boolean } {
  const abilities = abilitiesForUseCase(viewer);
  return { userId: viewer.userId, isReviewer: abilities.isReviewer, isLateralSpace: abilities.isLateralSpace };
}

// ─── Proposte proprie (D13) e ricevuta (§5.5) ────────────────────────

/** Le colonne che servono a dire se una scheda è di chi guarda. */
export interface ProposalRow {
  /** `use_cases.proposed_by`: email, id utente, id Slack o etichetta. */
  proposedBy: string | null | undefined;
}

/** Chi guarda, per dire se una proposta è sua: id, email e se l'email è verificata. */
export type ProposalOwner = Pick<UseCaseViewer, "userId" | "email" | "emailVerified">;

/**
 * Vero quando `proposed_by` è l'id utente di chi guarda, oppure la sua email verificata
 * (senza distinguere maiuscole). L'id vale sempre; l'email solo con `emailVerified`
 * vero. Falso con `proposed_by` nullo, con un id Slack, con un'etichetta («AI Readiness
 * respondent») e per chi non ha né id né email verificata.
 */
export function isOwnProposal(viewer: ProposalOwner, row: ProposalRow): boolean {
  const proposedBy = typeof row.proposedBy === "string" ? row.proposedBy.trim() : "";
  if (!proposedBy) return false;
  const userId = typeof viewer.userId === "string" ? viewer.userId.trim() : "";
  if (userId && proposedBy === userId) return true;
  if (viewer.emailVerified !== true) return false;
  const email = typeof viewer.email === "string" ? viewer.email.trim().toLowerCase() : "";
  return email.includes("@") && proposedBy.toLowerCase() === email;
}

/** I canali la cui ricevuta compare in cima alla pagina (`?thanks=1&created=<id>`). */
export const RECEIPT_SOURCES: readonly UseCaseSource[] = Object.freeze(["web_proposed", "learning"] as const);

/**
 * La ricevuta «Grazie! Use case inviato.» si mostra solo a chi ha appena proposto: canale
 * modulo web o corsi, e proposta propria, riconosciuta per id **e** per email (il modulo
 * web salva l'email, i corsi l'id). L'email conta solo se verificata, come in `isOwnProposal`.
 */
export function isOwnReceipt(
  viewer: ProposalOwner,
  row: ProposalRow & { source: string | null | undefined },
): boolean {
  return typeof row.source === "string" && (RECEIPT_SOURCES as readonly string[]).includes(row.source) && isOwnProposal(viewer, row);
}

// ─── Visibilità e proiezione del contributore (D4, D13, §11) ─────────

/** `intake.hiddenFromSearch` (§8.6). */
export function isHiddenFromSearch(intake: Record<string, unknown> | null | undefined): boolean {
  return intake?.hiddenFromSearch === true;
}

/**
 * Chi guarda vede la scheda? I revisori tutte; i contributori quelle non nascoste alla
 * ricerca e le proprie; gli altri nessuna.
 */
export function canSeeUseCase(viewer: UseCaseViewer, row: ProposalRow & { intake: Record<string, unknown> | null | undefined }): boolean {
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea) return false;
  if (abilities.canSeeHidden) return true;
  return !isHiddenFromSearch(row.intake) || isOwnProposal(viewer, row);
}

interface ContributorUseCaseBase {
  id: string;
  title: string;
  phase: Phase;
  /**
   * Il sotto-stato. Delle proposte altrui in «Da valutare» null: chi non ha proposto vede la
   * fase, non lo smistamento del team (Nuova, Possibile doppione, Serve info, Rimandata…). Delle
   * proprie, «Rimandata» e «Da rivedere» arrivano come «Valutata» (`contributorSubState`).
   */
  subState: SubState | null;
  /**
   * La pillola, mai con il codice di un'altra scheda (per un doppione «Chiuso · Doppione»).
   * Delle proposte altrui in «Da valutare» la sola fase.
   */
  phaseLabel: string;
  /** «T1 2027» o «Più avanti» se la fase è «Approvato»; altrimenti null. */
  quando: string | null;
}

/**
 * Uno use case come lo riceve un contributore (§11). Di una proposta altrui esattamente
 * `{id, title, phase, subState, phaseLabel, quando, own: false}`, con la sola fase se è in
 * «Da valutare» (`subState` null); di una propria in più solo `code` e `publicNote`
 * (`own: true`). `own` dice solo se la proposta è di chi guarda.
 */
export type ContributorUseCase =
  | (ContributorUseCaseBase & { own: false })
  | (ContributorUseCaseBase & { own: true; code: string | null; publicNote: string | null });

/** La riga da cui nasce la proiezione: le colonne della fase, più id, titolo, codice e proponente. */
export interface ContributorSourceRow extends PhaseInput, ProposalRow {
  id: string;
  title: string;
  code: string | null;
}

/**
 * Il sotto-stato che vede chi ha proposto: il parcheggio del team («Rimandata», «Da rivedere»)
 * è «Valutata», come la pillola («Valutata, da decidere») e come il connettore (VALUTATA). Così
 * né la data di revisione né il giallo di «Da rivedere» arrivano al contributore.
 */
function contributorSubState(subState: SubState): SubState {
  return subState === "rimandata" || subState === "da_rivedere" ? "valutata" : subState;
}

/**
 * La proiezione del contributore, oppure null se il contributore non la vede (scheda
 * nascosta alla ricerca e non sua). Nessun altro campo della riga esce di qui.
 */
export function projectForContributor(viewer: ProposalOwner, row: ContributorSourceRow): ContributorUseCase | null {
  const own = isOwnProposal(viewer, row);
  if (isHiddenFromSearch(row.intake) && !own) return null;
  const p = phaseOfUseCase(row);
  // Lo smistamento del team (sotto-stati di «Da valutare») solo sulle proprie proposte.
  const triage = p.phase === "da_valutare" && !own;
  const base: ContributorUseCaseBase = {
    id: row.id,
    title: row.title,
    phase: p.phase,
    subState: triage ? null : contributorSubState(p.subState),
    phaseLabel: triage ? PHASE_LABEL.da_valutare : p.contributorLabel,
    quando: p.phase === "approvato" ? p.subStateLabel : null,
  };
  if (!own) return { ...base, own: false };
  const note = typeof row.publicNote === "string" && row.publicNote.trim() !== "" ? row.publicNote : null;
  return { ...base, own: true, code: row.code ?? null, publicNote: note };
}

/** Le schede che un contributore vede, già proiettate; nessuna per chi non entra nell'area. */
export function contributorUseCases(viewer: UseCaseViewer, rows: readonly ContributorSourceRow[]): ContributorUseCase[] {
  if (!abilitiesForUseCase(viewer).canOpenArea) return [];
  const out: ContributorUseCase[] = [];
  for (const row of rows) {
    const item = projectForContributor(viewer, row);
    if (item) out.push(item);
  }
  return out;
}
