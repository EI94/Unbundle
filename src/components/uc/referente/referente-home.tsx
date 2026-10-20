"use client";

import type { ReactNode } from "react";
import { Check, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { expiryNotice, homeProgressText, referentHash, type HomePlan, type ListRow, type TopicPlan } from "@/lib/uc/views/referente-plan";
import { PrivacyFooter } from "./privacy-gate";
import { ClientLine, Notice, PRIMARY_CLASS, ScreenTitle } from "./screen";
import { ProgressBar } from "./step-bar";
import { formatCountIt } from "@/lib/uc/views/format";

/**
 * R1 · Home del referente (DESIGN §4.3): saluto, avanzamento «36 di 112
 * risposte» senza percentuale, UNA scheda primaria scelta dallo stato, gli
 * argomenti, gli elenchi secondari (solo quelli con qualcosa dentro) e in
 * fondo l'informativa e la scadenza del link. Con niente da fare, la scheda
 * calma di R9 «Hai finito».
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
          <span className="sr-only">Inviato</span>
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
        <span className="min-w-0 break-words">
          {title} ({formatCountIt(count)})
        </span>
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
  clientLabel: string;
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

export function ReferenteHome({ clientLabel, greetingName, plan, expiresAt, now, narrow, topicHref, notice, preview, paused }: ReferenteHomeProps) {
  const expiry = expiryNotice(expiresAt, now);
  const hello = greetingName ? `Ciao ${greetingName}` : "Ciao";
  const finished = !paused && plan.finished && plan.primary === null;
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-4 space-y-6">
      <div className="space-y-1">
        <ClientLine clientLabel={clientLabel} />
        <ScreenTitle>{finished ? `Hai finito. Grazie${greetingName ? `, ${greetingName}` : ""}!` : paused ? "Per ora non serve rispondere" : hello}</ScreenTitle>
      </div>

      {preview ? <Notice tone="info">Anteprima: così la vede il referente.</Notice> : null}
      {expiry?.soon && !paused ? <Notice tone="attenzione">{expiry.text}</Notice> : null}
      {notice}

      {paused ? (
        <p className="text-base leading-6">Il caso è in pausa. Ti scriviamo quando riparte. Quello che hai scritto resta salvato.</p>
      ) : finished ? (
        <p className="text-base leading-6">Lateral Space controlla le risposte e ti scrive solo se serve un chiarimento. Puoi chiudere questa pagina.</p>
      ) : (
        <>
          <p className="text-base leading-6">Ci servono alcune risposte sul vostro lavoro. Puoi farle a più riprese: salviamo tutto da solo.</p>
          {plan.progress.total > 0 ? (
            <div className="space-y-2">
              <p className="text-[15px] font-semibold tabular-nums">{homeProgressText(plan.progress.done, plan.progress.total)}</p>
              <ProgressBar done={plan.progress.done} total={plan.progress.total} label="Risposte date" />
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
          <h2 className="text-base font-semibold">Per argomento</h2>
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
            <ListDisclosure title="Lasciate per dopo" count={plan.skipped.length}>
              <PlainRows rows={plan.skipped} />
            </ListDisclosure>
          ) : null}
          {!paused && narrow && plan.computer.length > 0 ? (
            <ListDisclosure title="Meglio dal computer" count={plan.computer.length}>
              <p className="px-4 pb-2 text-base text-muted-foreground">Tabelle e file: apri questo stesso link dal computer e ritrovi tutto.</p>
              <PlainRows rows={plan.computer} />
            </ListDisclosure>
          ) : null}
          {plan.locked.length > 0 ? (
            <ListDisclosure title="Si apriranno più avanti" count={plan.locked.length}>
              <p className="flex items-start gap-2 px-4 pb-2 text-base text-muted-foreground">
                <Lock className="mt-1 size-4 shrink-0" aria-hidden />
                <span className="min-w-0">Riguardano dati personali: si aprono quando la tua azienda approva la scheda privacy.</span>
              </p>
              <PlainRows rows={plan.locked} />
            </ListDisclosure>
          ) : null}
          {plan.sent.length > 0 ? (
            <ListDisclosure title="Già inviate" count={plan.sent.length}>
              <ul className="divide-y divide-border">
                {plan.sent.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <p className="text-base break-words">{s.title}</p>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    {s.canUpdate && !paused && !preview ? (
                      <a href={referentHash({ screen: "voce", itemId: s.id })} className="inline-flex min-h-11 items-center text-base text-primary underline-offset-4 hover:underline">
                        {s.label === "A posto" ? "È cambiato qualcosa? Aggiorna la risposta" : "Rispondi ora"}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ListDisclosure>
          ) : null}
        </div>
      ) : null}

      <footer className="space-y-1 border-t border-border pt-4">
        <PrivacyFooter />
        <p className={cn("text-base text-muted-foreground")}>Il link è solo tuo: non inoltrarlo.</p>
        {expiry && !expiry.soon ? <p className="text-base text-muted-foreground">{expiry.text}</p> : null}
      </footer>
    </section>
  );
}
