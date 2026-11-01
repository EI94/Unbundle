import { PUBLIC_NOTE_TEXT } from "@/lib/use-cases/decision-ui";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import { askedTitle, questionLabel, type InfoAnswer } from "@/lib/use-cases/answers";
import { cn } from "@/lib/utils";
import { AnswerForm } from "../answer-form";
import { OwnAnswer } from "../proposer-answers";

export interface ContributorDecisionSectionProps {
  workspaceId: string;
  /** La proiezione del contributore (`ContributorUseCase`): nient'altro arriva fin qui. */
  useCase: ContributorUseCase;
  /** La sua risposta a «Serve info» non ancora decisa (`UseCaseDetailResult.answer`, D17). */
  answer?: InfoAnswer | null;
  /** Il nome del team che valuta, da solo (§14.2). */
  teamName: string;
  id?: string;
  className?: string;
}

/**
 * Il capitolo «Decisione» per un contributore (docs/use-case/DESIGN.md §6.7, §6.9; D4, D13,
 * D17): di una **sua** proposta la nota pubblica, in sola lettura e solo se non è vuota; in
 * «Serve info» la nota è la domanda, con «Rispondi»; dopo la risposta, finché nessuno decide, la
 * domanda e sotto la sua risposta. «Quando» è già nella pillola della testata. Delle proposte
 * altrui niente.
 */
export function ContributorDecisionSection({ workspaceId, useCase, answer = null, teamName, id = "decisione", className }: ContributorDecisionSectionProps) {
  if (!useCase.own) return null;
  const headingId = `${id}-titolo`;
  if (useCase.phase === "da_valutare" && useCase.subState === "serve_info") {
    return (
      <section id={id} aria-labelledby={headingId} data-slot="section-decision" className={cn("scroll-mt-24 space-y-3", className)}>
        <h2 id={headingId} className="text-base font-semibold">
          {askedTitle(teamName)}
        </h2>
        <AnswerForm workspaceId={workspaceId} useCaseId={useCase.id} question={useCase.publicNote} teamName={teamName} />
      </section>
    );
  }
  if (answer) {
    return (
      <section id={id} aria-labelledby={headingId} data-slot="section-decision" className={cn("scroll-mt-24 space-y-3", className)}>
        <h2 id={headingId} className="text-base font-semibold">
          {questionLabel(teamName)}
        </h2>
        {useCase.publicNote ? <p className="text-sm whitespace-pre-line break-words">{useCase.publicNote}</p> : null}
        <OwnAnswer answer={answer} />
      </section>
    );
  }
  if (!useCase.publicNote?.trim()) return null;
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-decision" className={cn("scroll-mt-24 space-y-1.5", className)}>
      <h2 id={headingId} className="text-base font-semibold">
        {PUBLIC_NOTE_TEXT.label}
      </h2>
      <p className="text-sm whitespace-pre-line">{useCase.publicNote}</p>
    </section>
  );
}
