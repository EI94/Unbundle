"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { CommitmentView, QuestionView } from "@/lib/db/queries/context-memory";
import type { UseCaseContext } from "@/lib/db/queries/context-work";
import { FactRow, LsLock } from "./fact-row";
import { FactSheet } from "./fact-sheet";
import { Mark, type UseCaseOption } from "./fields";
import { dueText, noveltyTag, contextCommitmentGroups, contextFactGroups, contextFoldNovelties } from "./view-model";

const T = CONTEXT_TEXT;

/** Nella piega e nel dossier un fatto si legge e basta: nessuno use case da collegare. */
const NO_USE_CASE_OPTIONS: readonly UseCaseOption[] = Object.freeze([]);

/**
 * Il contesto di uno use case (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.1, §2.3): lo stesso nella piega
 * «Contesto» della scheda e nella sezione «Contesto» del progetto dell'agente. Dall'alto: «Novità» (al massimo 5, con
 * «Nuovo» o «Cambiato»), «Che cosa sappiamo» per sezione (la fonte a destra, i segni solo quando servono, «e altri …»
 * oltre i 40), «Impegni aperti» («Nostri» e «Del cliente», il ruolo, la scadenza), «Domande aperte», e in fondo «Apri il
 * contesto». I dati arrivano già filtrati per chi guarda (`loadUseCaseContext`): il cliente solo «Per tutti».
 *
 * Un tocco su un fatto apre il pannello in sola lettura (`canEdit` falso): fonte, ultima conferma, use case, e per
 * Lateral Space citazione e storia. Si modifica solo da «Contesto». Nessun pulsante: impegni e domande si chiudono là.
 */
export function UseCaseContextView({ workspaceId, today, context }: { workspaceId: string; today: string; context: UseCaseContext }) {
  const [openFact, setOpenFact] = useState<string | null>(null);
  const baseId = useId();
  const headingId = (part: string) => `${baseId}-${part}`;
  const novelties = contextFoldNovelties(context.facts);
  const groups = contextFactGroups(context.facts);
  const commitments = contextCommitmentGroups(context.commitments);

  return (
    <div data-slot="use-case-context" className="space-y-5">
      {novelties.length > 0 ? (
        <section aria-labelledby={headingId("novita")} className="space-y-1.5">
          <h3 id={headingId("novita")} className="text-sm font-semibold">
            {T.useCase.novelties}
          </h3>
          <ul className="space-y-0.5">
            {novelties.map((fact) => (
              <li key={fact.id}>
                <button
                  type="button"
                  onClick={() => setOpenFact(fact.id)}
                  className="flex min-h-11 w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Mark className="shrink-0">{noveltyTag(fact.tag)}</Mark>
                  <span className="min-w-0 break-words">{fact.statement}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section aria-labelledby={headingId("fatti")} className="space-y-2">
          <h3 id={headingId("fatti")} className="text-sm font-semibold">
            {T.useCase.known}
          </h3>
          {groups.map((group) => (
            <div key={group.section} className="space-y-1">
              <h4 className="px-3 text-xs font-medium text-muted-foreground">{group.label}</h4>
              <ul className="divide-y rounded-xl border">
                {group.facts.map((fact) => (
                  <FactRow key={fact.id} fact={fact} onOpen={setOpenFact} />
                ))}
              </ul>
            </div>
          ))}
          {context.more > 0 ? <p className="px-3 text-xs text-muted-foreground">{T.useCase.more(context.more)}</p> : null}
        </section>
      ) : null}

      {commitments.length > 0 ? (
        <section aria-labelledby={headingId("impegni")} className="space-y-2">
          <h3 id={headingId("impegni")} className="text-sm font-semibold">
            {T.useCase.commitments}
          </h3>
          {commitments.map((group) => (
            <div key={group.party} className="space-y-1">
              <h4 className="px-3 text-xs font-medium text-muted-foreground">{group.label}</h4>
              <ul className="divide-y rounded-xl border">
                {group.items.map((commitment) => (
                  <CommitmentLine key={commitment.id} commitment={commitment} today={today} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {context.questions.length > 0 ? (
        <section aria-labelledby={headingId("domande")} className="space-y-2">
          <h3 id={headingId("domande")} className="text-sm font-semibold">
            {T.useCase.questions}
          </h3>
          <ul className="divide-y rounded-xl border">
            {context.questions.map((question) => (
              <QuestionLine key={question.id} question={question} />
            ))}
          </ul>
        </section>
      ) : null}

      <Link
        href={`/dashboard/${workspaceId}/contesto`}
        className="inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
      >
        {T.useCase.open}
        <ChevronRight aria-hidden className="size-4" />
      </Link>

      <FactSheet workspaceId={workspaceId} factId={openFact} today={today} canEdit={false} useCaseOptions={NO_USE_CASE_OPTIONS} onClose={() => setOpenFact(null)} />
    </div>
  );
}

/** Un impegno aperto: la frase, il ruolo, «entro il 30 nov» («scaduto il …» se è passato), il lucchetto. Per ruolo, mai per persona. */
function CommitmentLine({ commitment, today }: { commitment: CommitmentView; today: string }) {
  const due = dueText(commitment, today);
  const lsOnly = commitment.visibility === "ls";
  return (
    <li className="space-y-0.5 px-3 py-2.5">
      <p className="text-sm leading-relaxed break-words">{commitment.statement}</p>
      {commitment.roleLabel || due || lsOnly ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {commitment.roleLabel ? <span>{commitment.roleLabel}</span> : null}
          {due ? <span className={commitment.overdue ? "font-medium text-foreground" : undefined}>{due}</span> : null}
          {lsOnly ? <LsLock /> : null}
        </p>
      ) : null}
    </li>
  );
}

/** Una domanda aperta: la domanda e «Da chiedere a: {ruolo}». */
function QuestionLine({ question }: { question: QuestionView }) {
  const lsOnly = question.visibility === "ls";
  return (
    <li className="space-y-0.5 px-3 py-2.5">
      <p className="text-sm leading-relaxed break-words">{question.question}</p>
      {question.askWhom || lsOnly ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {question.askWhom ? <span>{T.questions.askWhom(question.askWhom)}</span> : null}
          {lsOnly ? <LsLock /> : null}
        </p>
      ) : null}
    </li>
  );
}
