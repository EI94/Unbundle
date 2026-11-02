"use client";

import type { RefObject } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { Disclosure } from "../../disclosure";
import type { AskQuestions } from "./ask-steps-state";
import { Field, NeedChecklist, describedBy } from "./fields";

const T = REFERENT_UI_TEXT.askDialog;

export interface AskQuestionsIds {
  heading: string;
  list: string;
  error: string;
  hint: string;
  prepare: string;
  message: string;
}

export interface AskPrepareProps {
  offer: { count: number; hint: string } | null;
  pending: boolean;
  /** L'esito di «Prepara le domande» al posto del pulsante («Aggiunte 4 domande a «Cosa serve».»). */
  done: string | null;
  error: string | null;
  onPrepare: () => void;
}

/**
 * Su «Cosa chiedi» senza domande da fare ma con domande standard da preparare (layout «empty»), il
 * passo dopo è «Prepara le domande»: pieno lui, non «Avanti · 0 domande» del piede.
 */
export function prepareIsNext(questions: AskQuestions, prepare: Pick<AskPrepareProps, "offer" | "done">): boolean {
  return questions.layout === "empty" && Boolean(prepare.offer) && prepare.done === null;
}

/**
 * «Cosa chiedi» (rilascio 4, §8): le domande proposte alla persona, spuntate; le altre della scheda
 * chiuse sotto «Altre domande di questo use case · n», con il loro «Chi»; nessuna per la persona:
 * tutte, aperte e non spuntate. Poi «Prepara le domande» quando mancano domande standard, e il
 * messaggio. Le domande già chieste, ferme o con risposta non ci sono.
 */
export function AskQuestionsStep({
  ids,
  headingRef,
  name,
  againLine,
  questions,
  selected,
  errors,
  prepare,
  prepareStatusRef,
  message,
  limits,
  onChange,
  onMessage,
}: {
  ids: AskQuestionsIds;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  /** Il nome della persona: «Cosa chiedi a {Nome}?». */
  name: string;
  /** «Chiedi di nuovo»: «A {Nome} · {email}» sopra il titolo. */
  againLine: string | null;
  questions: AskQuestions;
  selected: readonly string[];
  errors: Readonly<Record<string, string>>;
  prepare: AskPrepareProps;
  /** L'esito di «Prepara le domande» prende il fuoco al posto del pulsante. */
  prepareStatusRef?: RefObject<HTMLParagraphElement | null>;
  message: string;
  limits: UseCaseReferentPanel["limits"];
  onChange: (next: string[]) => void;
  onMessage: (value: string) => void;
}) {
  const error = errors.needIds || null;
  const listDescribed = [ids.hint, error ? ids.error : null].filter(Boolean).join(" ");
  const list = (items: Parameters<typeof NeedChecklist>[0]["items"]) => (
    <NeedChecklist labelledBy={ids.heading} describedBy={listDescribed} items={items} selected={selected} invalid={Boolean(error)} onChange={onChange} />
  );
  // Niente da chiedere ma domande standard da preparare: il passo dopo è «Prepara le domande», ed è
  // lui il pulsante pieno (il piede allora non lo è, `prepareIsNext` in ask-steps.tsx).
  const prepareFilled = prepareIsNext(questions, prepare);
  return (
    <div data-slot="ask-questions" className="space-y-3">
      {againLine ? <p className="text-sm break-words text-muted-foreground">{againLine}</p> : null}
      <h3 id={ids.heading} ref={headingRef} tabIndex={-1} className="rounded-sm text-sm font-medium break-words outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {fillText(T.whatHeading, { Nome: name })}
      </h3>
      <div id={ids.list} className="space-y-2">
        {questions.layout === "split" ? (
          <>
            {list(questions.proposed)}
            {questions.others.length ? (
              <Disclosure slot="ask-others" summary={fillText(T.questionsOthers, { n: questions.others.length })}>
                {list(questions.others)}
              </Disclosure>
            ) : null}
          </>
        ) : questions.layout === "all" ? (
          <>
            <p className="text-sm break-words text-muted-foreground">{fillText(T.questionsNone, { Nome: name })}</p>
            {list(questions.items)}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{T.questionsEmpty}</p>
        )}
        {error ? (
          <p id={ids.error} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {questions.layout !== "empty" ? (
          <p id={ids.hint} className="text-xs text-muted-foreground">
            {fillText(T.questionsFor, { Nome: name })}
          </p>
        ) : null}
      </div>
      {/* Dentro il <form> della finestra: type="button", o premerlo manderebbe il passo. */}
      {prepare.offer && prepare.done === null ? (
        <div data-slot="referent-ask-prepare" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Button
            type="button"
            variant={prepareFilled ? "default" : "outline"}
            className="min-h-11 sm:min-h-8"
            aria-describedby={ids.prepare}
            aria-busy={prepare.pending || undefined}
            onClick={() => {
              if (!prepare.pending) prepare.onPrepare();
            }}
          >
            <ListPlus aria-hidden />
            {REFERENT_UI_TEXT.prepare}
          </Button>
          <span id={ids.prepare} className="text-xs break-words text-muted-foreground">
            {prepare.offer.hint}
          </span>
        </div>
      ) : null}
      {prepare.done !== null ? (
        <p ref={prepareStatusRef} tabIndex={-1} role="status" data-slot="referent-ask-prepared" className="text-xs break-words text-muted-foreground outline-none">
          {prepare.done}
        </p>
      ) : null}
      {prepare.error ? (
        <p role="alert" className="text-xs text-destructive">
          {prepare.error}
        </p>
      ) : null}
      <Field id={ids.message} label={T.messageLabel} hint={T.messageHint} error={errors.message}>
        <Textarea
          id={ids.message}
          value={message}
          rows={3}
          maxLength={limits.messageMax}
          placeholder={T.messagePlaceholder}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={describedBy(ids.message, T.messageHint, errors.message)}
          onChange={(event) => onMessage(event.target.value)}
        />
      </Field>
    </div>
  );
}
