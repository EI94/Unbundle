import type { ReactNode } from "react";
import { BRAND_TEXT, FOOTER_TEXT, stateCardText, type StateCardKind } from "./public-view-render";

/**
 * Il guscio della pagina `/rispondi/<token>` e le sue schede di servizio (SPEC §4.4), sul modello di
 * `src/components/uc/referente/link-card.tsx`: una colonna di lettura larga al massimo 40rem, con il
 * margine di 16 px al telefono, corpo a 16 px, «Lateral Space via Unbundle.» in fondo a ogni pagina.
 * Nessun componente con portale: la pagina vive in `.survey-light`.
 */

export function PublicShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[40rem] min-w-0 px-4 pt-5 pb-10 text-base sm:px-6 sm:pt-10">
      <p className="text-sm font-semibold tracking-wide">{BRAND_TEXT}</p>
      {children}
      <footer className="mt-10 space-y-2 border-t border-border pt-4 text-sm break-words text-muted-foreground">
        {footer}
        <p>{FOOTER_TEXT}</p>
      </footer>
    </main>
  );
}

/** Una scheda con titolo e testo: i link che non si possono usare, la fine, il ringraziamento. */
export function MessageCard({
  title,
  text,
  children,
  titleId,
  as: Heading = "h1",
}: {
  title: string;
  text?: ReactNode;
  children?: ReactNode;
  titleId?: string;
  as?: "h1" | "h2";
}) {
  return (
    <section className="mt-8 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10" aria-labelledby={titleId}>
      <Heading id={titleId} tabIndex={titleId ? -1 : undefined} className="text-xl font-semibold break-words outline-none">
        {title}
      </Heading>
      {text ? <div className="mt-3 space-y-2 text-base leading-7 break-words text-muted-foreground">{text}</div> : null}
      {children}
    </section>
  );
}

/** «Link non valido», «Link revocato», «Link scaduto», «Non disponibile»: senza dati della richiesta. */
export function StateCard({ kind }: { kind: StateCardKind }) {
  const t = stateCardText(kind);
  return <MessageCard title={t.title} text={<p>{t.text}</p>} />;
}

/** La pagina di un link che non si può usare: il guscio e la sua scheda. */
export function StateScreen({ kind }: { kind: StateCardKind }) {
  return (
    <PublicShell>
      <StateCard kind={kind} />
    </PublicShell>
  );
}
