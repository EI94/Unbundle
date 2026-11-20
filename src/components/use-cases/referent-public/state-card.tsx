import type { ReactNode } from "react";
import { PublicShell as SharedPublicShell, PublicStateCard } from "@/components/public";
import { ErrorCard } from "./error-card";
import { MessageCard } from "./message-card";
import type { StateCardKind } from "./public-view-render";

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

/** Il guscio è quello unico delle pagine pubbliche (`src/components/public/`): stesse props, stesso marchio. */
export function PublicShell({ children, footer, client = null }: { children: ReactNode; footer?: ReactNode; client?: string | null }) {
  return (
    <SharedPublicShell footer={footer} client={client}>
      {children}
    </SharedPublicShell>
  );
}

/**
 * (Rilascio 10, §3.11) Le due schede di servizio, senza dati della richiesta: «Questo link non vale più.» con «Rispondi
 * all'email che hai ricevuto: arriva a chi ti ha scritto.» per ogni link sbagliato, revocato o scaduto; «Questa pagina
 * non si è caricata.» con «Le risposte che hai già inviato sono salve.» e il solo «Riprova» quando la pagina non si apre.
 */
export function StateCard({ kind }: { kind: StateCardKind }) {
  if (kind === "error") return <ErrorCard />;
  return <PublicStateCard kind="link" />;
}

/** La pagina di un link che non si può usare: il guscio, senza il cliente, e la sua scheda. */
export function StateScreen({ kind }: { kind: StateCardKind }) {
  return (
    <PublicShell>
      <StateCard kind={kind} />
    </PublicShell>
  );
}
