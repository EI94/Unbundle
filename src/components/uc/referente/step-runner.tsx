"use client";

import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { initialForm, type ReferentForm, type ReferentIntent } from "@/lib/uc/views/referente-form";
import type { AttachmentRef } from "./attachment-field";
import { QuestionStep } from "./question-step";
import { StepBar } from "./step-bar";

/**
 * Il giro delle domande (DESIGN §4.3 R2): una per schermata, con la barra in
 * alto («‹ Argomenti», «Rispondi dopo», «Prezzi e sconti · 3 di 12»,
 * «Salvato») e un passaggio di 8 px con dissolvenza solo con
 * `prefers-reduced-motion: no-preference`. Sull'ultima domanda il primario
 * diventa «Rivedi e invia». La pagina decide dove si va dopo.
 */
export interface StepRunnerProps {
  steps: readonly ReferentItemView[];
  /** Passo corrente, da 1. */
  n: number;
  /** Nome dell'argomento della domanda («Prezzi e sconti»). */
  contextFor: (item: ReferentItemView) => string;
  backHref: string;
  backLabel?: string;
  token: string;
  forms: Readonly<Record<string, ReferentForm>>;
  attachments: Readonly<Record<string, AttachmentRef[]>>;
  issues: Readonly<Record<string, Issue[]>>;
  busy: boolean;
  narrow: boolean;
  /** «Salvato» dopo la prima modifica di questa visita. */
  savedFor: (item: ReferentItemView) => boolean;
  /** La risposta parte subito (dato personale, aggiornamento). */
  immediateFor: (item: ReferentItemView) => boolean;
  delegateHrefFor: (item: ReferentItemView) => string | null;
  /** Giro con «Rispondi dopo» e «Rivedi e invia» (argomento o percorso veloce); falso per una domanda sola. */
  inRound: boolean;
  onForm: (item: ReferentItemView, next: ReferentForm) => void;
  onAttachments: (item: ReferentItemView, next: AttachmentRef[]) => void;
  onNext: (item: ReferentItemView, intent: ReferentIntent) => void;
  onConfirm: (item: ReferentItemView) => void;
  onSkip: (item: ReferentItemView) => void;
  onPicked: (item: ReferentItemView) => void;
}

export function StepRunner(props: StepRunnerProps) {
  const { steps, n, contextFor, backHref, backLabel, token, forms, attachments, issues, busy, narrow, savedFor, immediateFor, delegateHrefFor, inRound } = props;
  const index = Math.min(Math.max(1, n), steps.length) - 1;
  const item = steps[index];
  if (!item) return null;
  const last = index === steps.length - 1;
  const immediate = immediateFor(item);
  const primaryLabel = immediate ? (item.can.newVersionOnly ? "Invia la nuova versione" : "Invia") : inRound && last ? "Rivedi e invia" : "Avanti →";
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-2 space-y-5">
      <StepBar
        backHref={backHref}
        backLabel={backLabel}
        context={contextFor(item)}
        n={index + 1}
        total={steps.length}
        saved={savedFor(item)}
        onSkip={inRound ? () => props.onSkip(item) : undefined}
      />
      <div key={item.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-150">
        <QuestionStep
          item={item}
          token={token}
          form={forms[item.id] ?? initialForm(item)}
          attachments={attachments[item.id] ?? []}
          issues={issues[item.id] ?? []}
          busy={busy}
          narrow={narrow}
          primaryLabel={primaryLabel}
          immediate={immediate}
          delegateHref={delegateHrefFor(item)}
          onForm={(next) => props.onForm(item, next)}
          onAttachments={(next) => props.onAttachments(item, next)}
          onNext={(intent) => props.onNext(item, intent)}
          onConfirm={() => props.onConfirm(item)}
          onSkip={inRound ? () => props.onSkip(item) : null}
          onPicked={() => props.onPicked(item)}
        />
      </div>
    </section>
  );
}
