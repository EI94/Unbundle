import {
  DECISION_SECTION_TITLE,
  DIALOG_COMMON_TEXT,
  PUBLIC_NOTE_TEXT,
  decisionNote,
  toDecisionItem,
  toDuplicateCandidates,
  type DecisionItem,
  type DuplicateCandidate,
} from "@/lib/use-cases/decision-ui";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import { askedTitle, questionLabel, type InfoAnswer } from "@/lib/use-cases/answers";
import { cn } from "@/lib/utils";
import { AnswerForm } from "../answer-form";
import { DecisionButtons, PublicNoteDraftProvider } from "../decision-buttons";
import { OwnAnswer, ProposerAnswers } from "../proposer-answers";
import { WhenControl } from "../when-control";
import { PublicNoteField } from "./public-note-field";

export interface SectionDecisionProps {
  workspaceId: string;
  /** Lo use case come lo ricevono i revisori (`UseCaseDetail` di `getUseCaseDetail` va bene così). */
  item: DecisionItem;
  /** Oggi a Roma (`AAAA-MM-GG`, `UseCaseDetailResult.today`). */
  today: string;
  /** `abilitiesForUseCase(viewer).canDecide`. */
  canDecide: boolean;
  /** Gli use case dello stesso workspace, per «Doppione di…». */
  candidates?: readonly DuplicateCandidate[];
  /** Il giorno di «Non avviare», se la pagina lo legge dalla Storia: «Non avviato il 3 ott». */
  closedOn?: string | null;
  /** Le risposte di chi ha proposto a «Serve info» (D17, `intake.risposte`). */
  answers?: readonly InfoAnswer[];
  /** L'ancora del capitolo (`?capitolo=`). */
  id?: string;
  className?: string;
}

/**
 * Il capitolo «Decisione» della scheda per i revisori (docs/use-case/DESIGN.md §6.4, §6.7,
 * §14.3; D3, D17): sotto il titolo solo quello che la pillola della testata non dice già («In
 * attesa da 6 giorni»: la fase si mostra una volta sola), «Quando» solo in fase Approvato, la
 * nota pubblica con l'avviso (in «Serve info» è la domanda del team), dopo di lei le risposte
 * di chi ha proposto (prima la domanda, poi la risposta), i pulsanti per fase con un solo
 * pulsante pieno. Decidono tutti i revisori, anche del cliente (D3); «Avvia
 * la realizzazione» e «Segna come in realizzazione» stanno nel capitolo «Realizzazione».
 * Componente senza stato: lo monta la scheda (H4b), sul server.
 */
export function SectionDecision({ workspaceId, item: detail, today, canDecide, candidates, closedOn, answers = [], id = "decisione", className }: SectionDecisionProps) {
  // Al browser solo quello che serve alle decisioni, non la scheda intera; dei candidati di
  // «Doppione di…» solo id, codice e titolo.
  const item = toDecisionItem(detail);
  const duplicates = toDuplicateCandidates(candidates);
  const headingId = `${id}-titolo`;
  const whenId = `${id}-quando`;
  // La fase sta nella pillola della testata: qui solo quello che lei non dice.
  const note = decisionNote(item, today, { closedOn });
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-decision" className={cn("scroll-mt-24 space-y-4", className)}>
      <div className="space-y-0.5">
        <h2 id={headingId} className="text-base font-semibold">
          {DECISION_SECTION_TITLE}
        </h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {item.phase === "approvato" ? (
        <div className="space-y-1.5">
          <p id={whenId} className="text-sm font-medium">
            {DIALOG_COMMON_TEXT.when}
          </p>
          <WhenControl workspaceId={workspaceId} item={item} today={today} canDecide={canDecide} labelledBy={whenId} />
        </div>
      ) : null}
      {/* «Serve info» e «Non avviare» si aprono con il testo del campo «Nota pubblica». */}
      <PublicNoteDraftProvider>
        <PublicNoteField workspaceId={workspaceId} item={item} canEdit={canDecide} />
        <ProposerAnswers answers={answers} />
        <DecisionButtons workspaceId={workspaceId} item={item} today={today} canDecide={canDecide} candidates={duplicates} />
      </PublicNoteDraftProvider>
    </section>
  );
}

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
