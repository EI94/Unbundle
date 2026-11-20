import type { ReactNode } from "react";
import { PUBLIC_TEXT } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PublicShell } from "./public-shell";
import { PublicRetryButton } from "./retry-button";

/**
 * Le schede delle pagine fuori dalla dashboard (rilascio 10, ondata 4, PROPOSTA-10 §3.11):
 * - `PublicCard`: una scheda con il titolo (H1 della pagina) e il suo contenuto;
 * - `PublicStateCard`: una scheda sola per ogni link che non si può usare («Questo link non vale più.» e «Rispondi
 *   all'email che hai ricevuto…», il testo si cambia dove non vale, per esempio un link avuto in chat) e una sola per
 *   l'errore, con il solo «Riprova»: `retry` di Next 16 negli `error.tsx`, che rilegge la pagina dal server; senza,
 *   in una scheda resa dal server, ricarica la pagina (`./retry-button.tsx`). Il testo sotto il titolo dell'errore è
 *   della pagina: «Le risposte che hai già inviato sono salve.» (`PUBLIC_TEXT.error.saved`) vale solo dove ci sono
 *   risposte (`/r`, `/rispondi`), non sull'accesso o sull'invito.
 *
 * Senza stato e senza portali: si rende sul server.
 */

export function PublicCard({
  title,
  children,
  titleId,
  as: Heading = "h1",
  titleClassName,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  titleId?: string;
  as?: "h1" | "h2";
  titleClassName?: string;
  className?: string;
}) {
  return (
    <section data-slot="public-card" className={cn("mt-6 rounded-xl bg-card p-5 text-card-foreground ring-1 ring-foreground/10 sm:p-6", className)} aria-labelledby={titleId}>
      <Heading id={titleId} tabIndex={titleId ? -1 : undefined} className={cn("text-xl font-semibold break-words outline-none", titleClassName)}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

/** Il testo di una scheda: 16 px, grigio leggibile. Una stringa diventa un paragrafo. */
export function PublicCardText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-3 space-y-2 text-base leading-7 break-words text-muted-foreground", className)}>{typeof children === "string" ? <p>{children}</p> : children}</div>
  );
}

export type PublicStateCardProps =
  | {
      /** Un link che non si può usare: scaduto, tolto, sbagliato. La stessa scheda per ogni motivo. */
      kind: "link";
      /** Il testo sotto il titolo, dove «Rispondi all'email che hai ricevuto» non vale. */
      body?: ReactNode;
      /** Un'azione dopo il testo (per esempio «Accedi a Unbundle»). */
      children?: ReactNode;
    }
  | {
      /** La pagina non si è caricata. */
      kind: "error";
      /** Il `retry` di Next negli `error.tsx`; senza, «Riprova» ricarica la pagina. */
      retry?: () => void;
      /** Una frase sotto il titolo, facoltativa: per esempio `PUBLIC_TEXT.error.saved` dove ci sono risposte inviate. */
      body?: ReactNode;
    };

export function PublicStateCard(props: PublicStateCardProps) {
  if (props.kind === "error") {
    return (
      <PublicCard title={PUBLIC_TEXT.error.title}>
        {props.body ? <PublicCardText>{props.body}</PublicCardText> : null}
        <PublicRetryButton retry={props.retry} className="mt-5" />
      </PublicCard>
    );
  }
  return (
    <PublicCard title={PUBLIC_TEXT.invalidLink.title}>
      <PublicCardText>{props.body ?? PUBLIC_TEXT.invalidLink.body}</PublicCardText>
      {props.children}
    </PublicCard>
  );
}

/** La pagina intera di un errore: il guscio e la sua scheda. Per gli `error.tsx` (con `retry`) e le schede del server. */
export function PublicErrorScreen({ retry, body, client }: { retry?: () => void; body?: ReactNode; client?: string | null }) {
  return (
    <PublicShell client={client}>
      <PublicStateCard kind="error" retry={retry} body={body} />
    </PublicShell>
  );
}

/** La pagina intera di un link che non vale: il guscio e la sua scheda. */
export function PublicInvalidScreen({ body, children, client, footer }: { body?: ReactNode; children?: ReactNode; client?: string | null; footer?: ReactNode }) {
  return (
    <PublicShell client={client} footer={footer}>
      <PublicStateCard kind="link" body={body}>
        {children}
      </PublicStateCard>
    </PublicShell>
  );
}
