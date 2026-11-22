/**
 * L'idea di un corso diventata use case (rilascio 10, ondata 7b; audit «Fuori» §6.7, riga 30 della sintesi): gli
 * stessi avvisi di ogni proposta nuova, come quelle che arrivano da «Claude per l'organizzazione», dal modulo della
 * dashboard o da Slack (`dispatchNewPortfolioNotifications`): la riga «Nuovo use case AI» in campanella a chi valuta
 * gli use case, il messaggio nel canale Slack del workspace se c'è, il webhook degli altri avvisi se c'è. Nessun
 * destinatario nuovo, nessun testo nuovo: chi li riceveva per le altre proposte li riceve anche per le idee dei corsi.
 *
 * Una volta sola per idea: se la proposta è già annunciata (`wasAnnounced`, la riga della campanella) non riparte.
 * Mai un errore per chi ha inviato l'idea: l'avviso parte dopo la risposta, e un errore finisce nel log.
 *
 * Modulo puro: le letture e gli invii arrivano da fuori (`ideas.ts`), così si prova con dipendenze finte.
 */
import type { UseCase } from "../db/schema.ts";

export interface IdeaAnnounceDeps {
  getUseCase(id: string): Promise<UseCase | null>;
  wasAnnounced(params: { workspaceId: string; useCaseId: string }): Promise<boolean>;
  notify(params: { useCase: UseCase; workspaceId: string; source: "web" }): Promise<void>;
  logError(event: string, error: unknown, extra: Record<string, string>): void;
}

export type IdeaAnnounceOutcome = "annunciata" | "gia_annunciata" | "assente" | "errore";

export async function announceLearningIdea(deps: IdeaAnnounceDeps, i: { workspaceId: string; useCaseId: string }): Promise<IdeaAnnounceOutcome> {
  try {
    const useCase = await deps.getUseCase(i.useCaseId);
    // Solo la proposta nata dal corso, in questo workspace.
    if (!useCase || useCase.workspaceId !== i.workspaceId || useCase.source !== "learning") return "assente";
    if (await deps.wasAnnounced({ workspaceId: i.workspaceId, useCaseId: useCase.id })) return "gia_annunciata";
    await deps.notify({ useCase, workspaceId: i.workspaceId, source: "web" });
    return "annunciata";
  } catch (error) {
    deps.logError("idea_notify_failed", error, { useCaseId: i.useCaseId });
    return "errore";
  }
}
