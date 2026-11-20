import type { ReactNode } from "react";
import { kitClientLine } from "@/lib/use-cases/referent/kit";
import { REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";
import { ErrorCard } from "./error-card";
import { MessageCard } from "./message-card";
import { stateCardText, type StateCardKind } from "./public-view-render";

export { MessageCard };

/**
 * Il guscio della pagina `/rispondi/<token>` e le sue schede di servizio (SPEC §4.4). (Rilascio 10, §3.11) Il guscio del
 * kit del referente, lo stesso di tutte le pagine pubbliche (`PublicShell({ children, footer?, client? })`):
 * - in alto il marchio, non cliccabile: con il cliente noto «Rondine · con Lateral Space», altrimenti «Unbundle»;
 * - una colonna di lettura larga al massimo 40rem, con il margine di 16 px al telefono, corpo a 16 px;
 * - in fondo quello che la pagina gli passa («Come usiamo le tue risposte», «Riferimento XX-0024»): niente più
 *   «Lateral Space via Unbundle.», il marchio si dice una volta.
 * Nessun componente con portale: la pagina vive in `.survey-light`.
 */

const T = REFERENT_PUBLIC_TEXT;

export function PublicShell({ children, footer, client = null }: { children: ReactNode; footer?: ReactNode; client?: string | null }) {
  const line = kitClientLine(client);
  return (
    <main className="mx-auto w-full max-w-[40rem] min-w-0 px-4 pt-5 pb-10 text-base sm:px-6 sm:pt-10">
      <p data-slot="public-brand" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className="inline-grid size-5 shrink-0 place-items-center rounded-[5px] bg-foreground text-[11px] leading-none font-bold text-background">
          {T.brandMark}
        </span>
        <span className={line ? "min-w-0 break-words" : "min-w-0 font-semibold tracking-wide text-foreground"}>{line ?? T.brand}</span>
      </p>
      {children}
      {footer ? <footer className="mt-10 space-y-2 border-t border-border pt-4 text-sm break-words text-muted-foreground">{footer}</footer> : null}
    </main>
  );
}

/**
 * (Rilascio 10, §3.11) Le due schede di servizio, senza dati della richiesta: «Questo link non vale più.» con «Rispondi
 * all'email che hai ricevuto: arriva a chi ti ha scritto.» per ogni link sbagliato, revocato o scaduto; «Questa pagina
 * non si è caricata.» con «Le risposte che hai già inviato sono salve.» e il solo «Riprova» quando la pagina non si apre.
 */
export function StateCard({ kind }: { kind: StateCardKind }) {
  if (kind === "error") return <ErrorCard />;
  const t = stateCardText(kind);
  return <MessageCard title={t.title} text={<p>{t.text}</p>} />;
}

/** La pagina di un link che non si può usare: il guscio, senza il cliente, e la sua scheda. */
export function StateScreen({ kind }: { kind: StateCardKind }) {
  return (
    <PublicShell>
      <StateCard kind={kind} />
    </PublicShell>
  );
}
