/**
 * Una segnalazione è «intatta» finché nessuno l'ha ancora valutata: stato di
 * revisione `needs_inputs` e nessuna data di revisione. L'auto-ranking imposta
 * `in_review` e `reviewed_at`; una revisione di Lateral Space imposta almeno
 * `reviewed_at`. La stessa condizione, in SQL, protegge la scrittura del ranking
 * dal servizio di invio (updateUseCasePortfolioReviewAndCustomScores con
 * `onlyIfUntouched`). Modulo puro.
 */
import type { UseCase } from "@/lib/db/schema";

export function isUntouchedUseCase(useCase: Pick<UseCase, "portfolioReviewStatus" | "reviewedAt">) {
  return useCase.portfolioReviewStatus === "needs_inputs" && useCase.reviewedAt == null;
}
