"use client";

import type { RefObject } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferentGate } from "@/lib/use-cases/referent/contract";
import type { ReferentRequestParts } from "@/lib/use-cases/referent/email";
import { REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { PREVIEW_FOOTER, PREVIEW_SENDER, previewBlocks } from "@/lib/use-cases/referent/preview";

const T = REFERENT_UI_TEXT.askDialog;

/**
 * «Controlla e invia» (rilascio 4, §9): l'email che riceve la persona, com'è (oggetto e blocchi di
 * `referentRequestParts`, con il link solo come etichetta), le domande che trova aprendo il link e
 * dove arrivano le risposte. Quando un motivo blocca l'invio lo dice qui, con il testo del riquadro
 * «Prossimo passo»; manca l'ok sui fornitori e chi guarda lo può dare: «Apri Impostazioni» pieno, in
 * una scheda nuova (la bozza resta). Con un motivo «Invia a …» non c'è.
 */
export function AskPreviewStep({
  headingId,
  headingRef,
  name,
  to,
  parts,
  questions,
  replyTo,
  gates,
  okNotice,
  error,
}: {
  headingId: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  name: string;
  /** «A»: «Mario Rossi · mario.rossi@…». */
  to: string;
  parts: ReferentRequestParts;
  /** I titoli delle domande spuntate, nell'ordine della scheda. */
  questions: readonly string[];
  /** L'email di chi chiede, dove arrivano le risposte all'email. */
  replyTo: string | null;
  gates: readonly ReferentGate[];
  /** «Ok di … dato.» dopo l'ok sui fornitori dato a finestra aperta. */
  okNotice: string | null;
  error: string | null;
}) {
  return (
    <div data-slot="ask-check" className="space-y-4">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="rounded-sm text-sm font-medium break-words outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {fillText(T.checkHeading, { Nome: name })}
      </h3>
      {okNotice ? (
        <p role="status" data-slot="ask-ok" className="text-sm break-words">
          {okNotice}
        </p>
      ) : null}
      {gates.length ? (
        <div role="status" data-slot="ask-gates" className="space-y-2 rounded-lg border border-dashed p-3 text-sm">
          {gates.map((gate) => (
            <div key={gate.code} className="space-y-2">
              <p data-gate={gate.code} className="break-words">
                {gate.message}
              </p>
              {gate.code === "sub_responsabili_mancanti" && gate.canDeclare ? (
                <Button render={<a href={gate.settingsHref} target="_blank" rel="noopener noreferrer" />} nativeButton={false} className="min-h-11 sm:min-h-8">
                  {gate.linkLabel}
                  <ExternalLink aria-hidden />
                  <span className="sr-only">{T.newTab}</span>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <EmailPreview to={to} parts={parts} />
      <div className="space-y-1.5">
        <p className="text-sm">{T.questionsOnLink}</p>
        <ol data-slot="ask-preview-questions" className="list-decimal space-y-0.5 pl-5 text-sm">
          {questions.map((title, index) => (
            <li key={`${index}-${title}`} className="break-words">
              {title}
            </li>
          ))}
        </ol>
      </div>
      {replyTo ? <p className="text-xs break-words text-muted-foreground">{fillText(T.replyNote, { tuaEmail: replyTo })}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** (Rilascio 5) L'email com'è: «Da», «A», «Oggetto» e i blocchi, con il link solo come etichetta. */
export function EmailPreview({ to, parts }: { to: string; parts: ReferentRequestParts }) {
  const blocks = previewBlocks(parts);
  return (
    <section aria-label={T.previewLabel} data-slot="ask-preview" className="rounded-lg border bg-card text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b px-3 py-2 text-xs">
        <dt className="text-muted-foreground">{T.from}</dt>
        <dd className="min-w-0 break-words">{PREVIEW_SENDER}</dd>
        <dt className="text-muted-foreground">{T.to}</dt>
        <dd data-slot="ask-preview-to" className="min-w-0 [overflow-wrap:anywhere]">
          {to}
        </dd>
        <dt className="text-muted-foreground">{T.subject}</dt>
        <dd data-slot="ask-preview-subject" className="min-w-0 break-words font-medium">
          {parts.subject}
        </dd>
      </dl>
      <div data-slot="ask-preview-body" className="space-y-3 px-3 py-3">
        {blocks.map((block, index) =>
          block.kind === "p" ? (
            <p key={index} className="break-words">
              {block.text}
            </p>
          ) : block.kind === "quote" ? (
            <blockquote key={index} className="border-l-2 pl-3 break-words whitespace-pre-line text-muted-foreground">
              {block.text}
            </blockquote>
          ) : block.kind === "link" ? (
            <p key={index}>
              <span data-slot="ask-preview-link" className="inline-flex rounded-md border px-3 py-1.5 font-medium">
                {block.label}
              </span>
            </p>
          ) : block.kind === "list" ? (
            <ul key={index} className="list-disc space-y-0.5 pl-5">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={index} className="text-xs break-words text-muted-foreground">
              {block.text}
            </p>
          ),
        )}
        <p className="text-xs text-muted-foreground">{PREVIEW_FOOTER}</p>
      </div>
    </section>
  );
}
