"use client";

import { Button } from "@/components/ui/button";
import { referentHash } from "@/lib/uc/views/referente-plan";
import { BackLink, Notice, PRIMARY_CLASS, ScreenTitle, TEXT_BUTTON_CLASS } from "./screen";
import { ActionBar } from "./step-bar";

/**
 * R6 · «Controlla e invia» (DESIGN §4.3): le risposte pronte dell'argomento,
 * ognuna con il suo valore in parole («Confermato: …», «Non si applica: …»,
 * «… (stima)», «Non lo so · forse …») e «Modifica»; poi un tocco solo per
 * inviarle tutte. Un invio parziale lascia le righe non partite con il motivo e
 * «Sistema»; senza rete non parte niente e resta tutto sul telefono.
 */
export interface ReviewRow {
  id: string;
  title: string;
  summary: string;
  editHref: string;
  /** Perché non è partita, dopo un invio parziale. */
  failure?: string | null;
}

export function ModuleReview({
  backHref,
  backLabel,
  rows,
  later,
  sending,
  offline,
  partial,
  onSend,
}: {
  backHref: string;
  backLabel: string;
  rows: readonly ReviewRow[];
  /** Domande dell'argomento lasciate per dopo, con il link alla prima. */
  later: { count: number; href: string } | null;
  sending: boolean;
  offline: boolean;
  /** Esito di un invio parziale: «{k} inviate, {f} da sistemare.» */
  partial: { sent: number; failed: number } | null;
  onSend: () => void;
}) {
  const n = rows.length;
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-2 space-y-5">
      <BackLink href={backHref}>{backLabel}</BackLink>
      <div className="space-y-1">
        <ScreenTitle>Controlla e invia</ScreenTitle>
        <p className="text-base text-muted-foreground">{n === 0 ? "Non ci sono risposte pronte." : n === 1 ? "1 risposta pronta." : `${n} risposte pronte.`}</p>
      </div>
      {partial ? (
        <Notice tone="errore">
          {partial.sent} {partial.sent === 1 ? "inviata" : "inviate"}, {partial.failed} da sistemare.
        </Notice>
      ) : null}
      {offline ? <Notice tone="attenzione">Sei offline. Quello che hai scritto resta su questo telefono; per inviare serve la connessione.</Notice> : null}
      {n > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {rows.map((r) => (
            <li key={r.id} className="flex min-w-0 items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-base font-medium break-words">{r.title}</p>
                <p className="text-base break-words text-muted-foreground">{r.summary}</p>
                {r.failure ? <p className="text-base break-words text-uc-rosso">{r.failure}</p> : null}
              </div>
              <a href={r.editHref} className="inline-flex min-h-11 shrink-0 items-center text-base text-primary underline-offset-4 hover:underline">
                {r.failure ? "Sistema" : "Modifica"}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {later && later.count > 0 ? (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-base">
          <span className="text-muted-foreground">{later.count === 1 ? "1 lasciata per dopo" : `${later.count} lasciate per dopo`}</span>
          <a href={later.href} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
            Rispondi ora
          </a>
        </div>
      ) : null}
      <p className="text-base text-muted-foreground">Dopo l&apos;invio le controlla Lateral Space: nel frattempo non si modificano.</p>
      <ActionBar className="flex-col items-stretch gap-1 sm:flex-row sm:items-center">
        <Button type="button" className={PRIMARY_CLASS} disabled={sending || n === 0} onClick={onSend}>
          {sending ? "Invio in corso…" : n === 1 ? "Invia 1 risposta" : `Invia ${n} risposte`}
        </Button>
        <Button variant="ghost" className={TEXT_BUTTON_CLASS} render={<a href={referentHash({ screen: "home" })} />} nativeButton={false}>
          Continua più tardi
        </Button>
      </ActionBar>
    </section>
  );
}
