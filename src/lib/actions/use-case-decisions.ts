"use server";

/**
 * Server action delle decisioni dell'area «Use case» (docs/use-case/DESIGN.md §3.6, §3.7,
 * §6.4, §6.5, §8.6, §9.1; decisione D3; PIANO-LAVORI H3b):
 * - `decideUseCaseAction`: Approva, Rimanda, Serve info, Non avviare, Doppione di…, Archivia,
 *   Riapri, Segna come diffusa, Segna come realizzato;
 * - `setWhenAction`: «Quando» di uno use case approvato;
 * - `setHiddenFromSearchAction`: «Nascondi dalla ricerca» e «Mostra ai colleghi»;
 * - `markRealizationAction`: «Segna come in realizzazione» (solo Lateral Space, sezione Casi
 *   d'uso spenta per il workspace);
 * - `savePublicNoteAction`: la nota pubblica del capitolo «Decisione», salvata all'uscita dal
 *   campo (§6.4);
 * - `answerInfoRequestAction`: «Rispondi» su «Serve info» (D17), di chi ha proposto, dal
 *   pannello e dalla scheda.
 *
 * Ogni action è un endpoint raggiungibile con una POST diretta, quindi rifà da sé tutto:
 * ingresso validato (`decision-ui.ts`), sessione (`requireSession`), accesso al workspace
 * (`getCollaboratorAccess`, che esclude chi segue solo un corso), area accesa per il
 * workspace. Poi passa dal servizio unico (`service.ts`, canale `pagina`), che rilegge ruolo
 * e «Lateral Space» e applica le regole di §3.7 come per REST e MCP del team: decidono tutti
 * i revisori, anche del cliente (D3); «Segna come in realizzazione» solo Lateral Space.
 *
 * La risposta porta solo la nuova `version` e il toast di §14.3, oppure l'errore del servizio
 * (per `versione_superata` il testo esatto di §6.8: la pagina ricarica i dati e lascia il
 * testo nel campo). `revalidatePath` su `/use-cases` e `/use-cases/<id>` (§9.1) dopo una
 * scrittura e dopo ogni errore che dice che la pagina è vecchia (`rereadsPage`): anche una
 * decisione rifiutata perché il dossier, il ruolo o l'area sono cambiati senza toccare
 * `version`. Non per un ingresso sbagliato (`dati_non_validi`) né per `riprova`.
 *
 * «Quando» (anche nel dialogo «Approva») arriva con `pageToday`, il giorno con cui la pagina ha
 * scritto le etichette dei trimestri. Se adesso la stessa scelta dà un altro trimestre (la
 * pagina è stata letta prima dell'inizio di quello nuovo), non si salva niente: la pagina si
 * rilegge con le etichette nuove e si sceglie di nuovo (`checkWhenLabels`). Il servizio
 * calcola il trimestre con lo stesso istante del controllo (`now` del contesto).
 */
import { revalidatePath } from "next/cache";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import {
  INVALID_DECISION_INPUT,
  checkWhenLabels,
  decisionToast,
  isActionTarget,
  parseDecisionInput,
  parseWhenChoice,
  rereadsPage,
  staleWhenLabelsResult,
  toActionResult,
  visibilityToast,
  type DecisionActionResult,
} from "@/lib/use-cases/decision-ui";
import { romeToday } from "@/lib/use-cases/quarter";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { ANSWER_TEXT } from "@/lib/use-cases/answers";
import {
  SERVICE_MESSAGES,
  answerInfoRequest,
  decideUseCase,
  setHiddenFromSearch,
  setWhen,
  updateUseCase,
  type ServiceError,
  type WriteContext,
} from "@/lib/use-cases/service";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";

function failure(error: ServiceError, message: string = SERVICE_MESSAGES[error]): DecisionActionResult {
  return { ok: false, error, message };
}

/**
 * Il contesto di scrittura della persona in sessione, con l'accesso al workspace appena
 * riletto da chi chiama (`getCollaboratorAccess`, nel corpo di ogni action: la regola di
 * `workspace-isolation.test.ts`), per la pagina dell'area accesa.
 */
function pageContext(
  workspaceId: string,
  session: Session,
  access: WorkspaceAccess | null,
): { ok: true; ctx: WriteContext } | { ok: false; result: DecisionActionResult } {
  if (!access) return { ok: false, result: failure("permesso_mancante") };
  if (!isUseCaseHubWorkspace(workspaceId)) return { ok: false, result: failure("area_spenta") };
  const viewer = viewerFromSession(session.user, access.role);
  return {
    ok: true,
    ctx: {
      workspaceId,
      // Ruolo e «Lateral Space» li rilegge il servizio: qui non danno permessi.
      actor: { userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace, kind: "persona" },
      channel: "pagina",
    },
  };
}

function revalidatePages(workspaceId: string, useCaseId: string): void {
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
}

/**
 * La pagina e la scheda si rileggono dopo una scrittura, e dopo un errore che vuol dire
 * pagina vecchia (`rereadsPage`): versione superata, ma anche una fase, un dossier, un ruolo o
 * un'area cambiati senza alzare `version`, che lascerebbero a schermo un pulsante che fallisce
 * sempre.
 */
function revalidateUseCase(workspaceId: string, useCaseId: string, result: DecisionActionResult): DecisionActionResult {
  if (rereadsPage(result)) revalidatePages(workspaceId, useCaseId);
  return result;
}

/** Le etichette di «Quando» della pagina sono di un trimestre passato: si rilegge, non si salva. */
function staleWhenLabels(workspaceId: string, useCaseId: string, opts: { field: boolean }): DecisionActionResult {
  revalidatePages(workspaceId, useCaseId);
  return staleWhenLabelsResult(opts);
}

/**
 * Una decisione di §3.7 dalla pagina («Segna come in realizzazione» ha `markRealizationAction`).
 * `pageToday`: il giorno delle etichette di «Quando» del dialogo «Approva».
 */
export async function decideUseCaseAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  decision: unknown,
  pageToday?: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  const parsed = parseDecisionInput(decision);
  if (!parsed.ok) return failure("dati_non_validi", INVALID_DECISION_INPUT);
  // Lo schema della pagina ammette per «Approva» solo le tre scelte.
  const approveWhen = parsed.decision.type === "approva" ? parseWhenChoice(parsed.decision.quando) : null;
  if (approveWhen && checkWhenLabels(approveWhen, pageToday) === "non_valido") return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return revalidateUseCase(workspaceId, useCaseId, page.result);
  const now = new Date();
  if (approveWhen && checkWhenLabels(approveWhen, pageToday, now) === "superate") return staleWhenLabels(workspaceId, useCaseId, { field: true });
  const result = await decideUseCase({ ...page.ctx, now }, useCaseId, expectedVersion, parsed.decision);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, decisionToast(parsed.decision, romeToday(now))));
}

/**
 * «Quando» di uno use case approvato: questo trimestre, il prossimo o più avanti. `pageToday`:
 * il giorno delle etichette che la pagina ha mostrato.
 */
export async function setWhenAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  when: unknown,
  pageToday?: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  const choice = parseWhenChoice(when);
  if (!choice) return failure("dati_non_validi", INVALID_DECISION_INPUT);
  if (checkWhenLabels(choice, pageToday) === "non_valido") return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return revalidateUseCase(workspaceId, useCaseId, page.result);
  const now = new Date();
  if (checkWhenLabels(choice, pageToday, now) === "superate") return staleWhenLabels(workspaceId, useCaseId, { field: false });
  const result = await setWhen({ ...page.ctx, now }, useCaseId, expectedVersion, choice);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, null));
}

/** «Nascondi dalla ricerca» (`hidden` vero) e «Mostra ai colleghi» (`hidden` falso), §8.6. */
export async function setHiddenFromSearchAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  hidden: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  if (typeof hidden !== "boolean") return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return revalidateUseCase(workspaceId, useCaseId, page.result);
  const result = await setHiddenFromSearch(page.ctx, useCaseId, expectedVersion, hidden);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, visibilityToast(hidden)));
}

/** «Segna come in realizzazione» (§3.7, §6.5): solo Lateral Space, con la sezione Casi d'uso spenta. */
export async function markRealizationAction(workspaceId: string, useCaseId: string, expectedVersion: number): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return revalidateUseCase(workspaceId, useCaseId, page.result);
  const decision = { type: "segna_in_realizzazione" } as const;
  const result = await decideUseCase(page.ctx, useCaseId, expectedVersion, decision);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, decisionToast(decision, romeToday())));
}

/**
 * La nota pubblica del capitolo «Decisione» (§6.4), all'uscita dal campo: al massimo 1.000
 * caratteri; vuota toglie la nota. Una nota uguale a quella salvata non scrive niente.
 */
export async function savePublicNoteAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  publicNote: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  if (typeof publicNote !== "string") return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return revalidateUseCase(workspaceId, useCaseId, page.result);
  const result = await updateUseCase(page.ctx, useCaseId, expectedVersion, { publicNote });
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, null));
}

/**
 * «Rispondi» su «Serve info» (D17): la risposta di chi ha proposto alla domanda del team. Il
 * servizio controlla che la proposta sia di chi scrive, che sia in «Serve info» e che la domanda
 * sia ancora quella che la pagina mostrava (`question`, la nota pubblica letta; §6.8); la
 * risposta della action porta solo la nuova versione e il toast, niente della scheda.
 */
export async function answerInfoRequestAction(workspaceId: string, useCaseId: string, text: unknown, question: unknown): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, 0)) return failure("non_trovato");
  if (typeof text !== "string" || (question !== null && typeof question !== "string")) return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return revalidateUseCase(workspaceId, useCaseId, page.result);
  const result = await answerInfoRequest(page.ctx, useCaseId, text, question);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, ANSWER_TEXT.toast));
}
