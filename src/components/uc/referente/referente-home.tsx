"use client";

import type { ReactNode } from "react";
import { Check, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferentNoticeText } from "@/lib/uc/public-view";
import { expiryNotice, homeProgressText, referentHash, type HomePlan, type ListRow, type TopicPlan } from "@/lib/uc/views/referente-plan";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { PrivacyFooter } from "./privacy-gate";
import { Notice, PRIMARY_CLASS, ScreenTitle } from "./screen";
import { ProgressBar } from "./step-bar";

/**
 * R1 · Home del referente (DESIGN §4.3): saluto, avanzamento «36 di 112
 * risposte» senza percentuale, UNA scheda primaria scelta dallo stato, gli
 * argomenti, gli elenchi secondari (solo quelli con qualcosa dentro) e in
 * fondo l'informativa e la scadenza del link. Con niente da fare, la scheda
 * calma di R9 «Hai finito».
 *
 * (Rilascio 10, §3.11) Un solo numero di avanzamento, quello in alto: le righe
 * degli argomenti dicono quanto resta. La riga del cliente sta nel guscio, in
 * alto; il piè di pagina («Come usiamo le tue risposte», il link solo tuo, la
 * scadenza) è `ReferenteHomeFooter`, che la pagina passa al guscio.
 */

/** Riga con l'azione a destra, area di tocco piena (come gli elenchi di Unbundle). */
function RowLink({ href, title, line, done, children }: { href: string; title: string; line?: string | null; done?: boolean; children?: ReactNode }) {
  return (
    <a href={href} className="flex min-h-14 min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium break-words">{title}</span>
        {line ? <span className="block text-sm break-words text-muted-foreground">{line}</span> : null}
        {children}
      </span>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 text-uc-verde">
          <Check className="size-5" aria-hidden />
          <span className="sr-only">{R_TEXT.home.sentMark}</span>
        </span>
      ) : null}
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

function ListDisclosure({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-medium select-none hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 break-words">{R_TEXT.home.list(title, count)}</span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}

function PlainRows({ rows }: { rows: readonly ListRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id}>{r.hash ? <RowLink href={r.hash} title={r.title} /> : <p className="px-4 py-3 text-base break-words">{r.title}</p>}</li>
      ))}
    </ul>
  );
}

export interface ReferenteHomeProps {
  greetingName: string | null;
  plan: HomePlan;
  expiresAt: string;
  now: Date;
  /** Sotto i 768 px: mostra «Meglio dal computer». */
  narrow: boolean;
  /** Indirizzo della riga di un argomento (inizio la prima volta, poi il primo passo aperto). */
  topicHref: (topic: TopicPlan) => string;
  /** Esito dell'ultima azione (delega, invio), in linea. */
  notice?: ReactNode;
  /** Anteprima di Lateral Space: nessuna scrittura. */
  preview?: boolean;
  /** Il caso è in pausa: R9 «Per ora non serve rispondere». */
  paused?: boolean;
}

export function ReferenteHome({ greetingName, plan, expiresAt, now, narrow, topicHref, notice, preview, paused }: ReferenteHomeProps) {
  const expiry = expiryNotice(expiresAt, now);
  const finished = !paused && plan.finished && plan.primary === null;
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-4 space-y-6">
      <ScreenTitle>{finished ? R_TEXT.home.finished(greetingName) : paused ? R_TEXT.home.pausedTitle : R_TEXT.home.hello(greetingName)}</ScreenTitle>

      {preview ? <Notice tone="info">{R_TEXT.home.preview}</Notice> : null}
      {expiry?.soon && !paused ? <Notice tone="attenzione">{expiry.text}</Notice> : null}
      {notice}

      {paused ? (
        <p className="text-base leading-6">{R_TEXT.home.pausedText}</p>
      ) : finished ? (
        <p className="text-base leading-6">{R_TEXT.home.finishedText}</p>
      ) : (
        <>
          <p className="text-base leading-6">{R_TEXT.home.intro}</p>
          {plan.progress.total > 0 ? (
            <div className="space-y-2">
              <p className="text-[15px] font-semibold tabular-nums">{homeProgressText(plan.progress.done, plan.progress.total)}</p>
              <ProgressBar done={plan.progress.done} total={plan.progress.total} label={R_TEXT.home.progressLabel} />
            </div>
          ) : null}
          {plan.primary ? (
            <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="space-y-1">
                <h2 className="text-lg leading-snug font-semibold break-words">{plan.primary.title}</h2>
                <p className="text-base break-words text-muted-foreground">{plan.primary.text}</p>
              </div>
              {preview ? null : (
                <Button className={PRIMARY_CLASS} render={<a href={plan.primary.hash} />} nativeButton={false}>
                  {plan.primary.button}
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}

      {!paused && plan.topics.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-base font-semibold">{R_TEXT.home.topics}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {plan.topics.map((t) => (
              <li key={t.id}>
                <RowLink href={preview || t.status === "inviato" ? referentHash({ screen: "home" }) : topicHref(t)} title={t.title} line={t.line} done={t.status === "inviato"} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.skipped.length > 0 || (narrow && plan.computer.length > 0) || plan.locked.length > 0 || plan.sent.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {!paused && plan.skipped.length > 0 ? (
            <ListDisclosure title={R_TEXT.home.skipped} count={plan.skipped.length}>
              <PlainRows rows={plan.skipped} />
            </ListDisclosure>
          ) : null}
          {!paused && narrow && plan.computer.length > 0 ? (
            <ListDisclosure title={R_TEXT.home.computer} count={plan.computer.length}>
              <p className="px-4 pb-2 text-base text-muted-foreground">{R_TEXT.home.computerText}</p>
              <PlainRows rows={plan.computer} />
            </ListDisclosure>
          ) : null}
          {plan.locked.length > 0 ? (
            <ListDisclosure title={R_TEXT.home.locked} count={plan.locked.length}>
              <p className="flex items-start gap-2 px-4 pb-2 text-base text-muted-foreground">
                <Lock className="mt-1 size-4 shrink-0" aria-hidden />
                <span className="min-w-0">{R_TEXT.home.lockedText}</span>
              </p>
              <PlainRows rows={plan.locked} />
            </ListDisclosure>
          ) : null}
          {plan.sent.length > 0 ? (
            <ListDisclosure title={R_TEXT.home.sent} count={plan.sent.length}>
              <ul className="divide-y divide-border">
                {plan.sent.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <p className="text-base break-words">{s.title}</p>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    {s.canUpdate && !paused && !preview ? (
                      <a href={referentHash({ screen: "voce", itemId: s.id })} className="inline-flex min-h-11 items-center text-base text-primary underline-offset-4 hover:underline">
                        {s.label === "A posto" ? R_TEXT.home.update : R_TEXT.home.answerNow}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ListDisclosure>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Il piè di pagina della Home, che la pagina passa al guscio (`footer`): «▸ Come usiamo le tue risposte» con il testo
 * accettato, «Il link è solo tuo» e la scadenza, quando non è già in alto perché vicina.
 */
export function ReferenteHomeFooter({ expiresAt, now, privacyNotice }: { expiresAt: string; now: Date; privacyNotice?: ReferentNoticeText }) {
  const expiry = expiryNotice(expiresAt, now);
  return (
    <>
      <PrivacyFooter notice={privacyNotice} />
      <p className="text-base text-muted-foreground">{R_TEXT.home.linkOnlyYours}</p>
      {expiry && !expiry.soon ? <p className="text-base text-muted-foreground">{expiry.text}</p> : null}
    </>
  );
}
