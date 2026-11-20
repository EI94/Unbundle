import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PUBLIC_TEXT } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PUBLIC_PRIMARY } from "./classes";
import { PublicShell } from "./public-shell";

/**
 * Le schede delle pagine fuori dalla dashboard (rilascio 10, ondata 4, PROPOSTA-10 §3.11):
 * - `PublicCard`: una scheda con il titolo (H1 della pagina) e il suo contenuto;
 * - `PublicStateCard`: una scheda sola per ogni link che non si può usare («Questo link non vale più.» e «Rispondi
 *   all'email che hai ricevuto…», il testo si cambia dove non vale, per esempio un link avuto in chat) e una sola per
 *   l'errore, con il solo «Riprova» (`retry` di Next 16, che rilegge la pagina dal server).
 *
 * Senza stato e senza portali. La scheda d'errore riceve una funzione: la usano solo gli `error.tsx`, che sono del client.
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
      retry: () => void;
      /** Una frase sotto il titolo, facoltativa: per esempio che le risposte già inviate restano. */
      body?: ReactNode;
    };

export function PublicStateCard(props: PublicStateCardProps) {
  if (props.kind === "error") {
    return (
      <PublicCard title={PUBLIC_TEXT.error.title}>
        {props.body ? <PublicCardText>{props.body}</PublicCardText> : null}
        <Button type="button" className={cn("mt-5", PUBLIC_PRIMARY)} onClick={() => props.retry()}>
          {PUBLIC_TEXT.error.retry}
        </Button>
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

/** La pagina intera di un errore: il guscio e la sua scheda. Per gli `error.tsx`. */
export function PublicErrorScreen({ retry, body, client }: { retry: () => void; body?: ReactNode; client?: string | null }) {
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
