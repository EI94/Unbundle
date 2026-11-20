import type { ReactNode } from "react";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { ErrorCard } from "./screen";

/**
 * Il guscio e le schede di servizio della pagina `/r/[token]` (rilascio 10, §3.11: le stesse parole e lo stesso
 * comportamento del guscio unico delle pagine pubbliche, `src/components/public/`, con le stesse props):
 * - in alto il marchio, non cliccabile, con la riga «{Cliente} · con Lateral Space» quando il cliente si conosce;
 * - una scheda sola per il link che non si può usare (token sbagliato, scaduto, revocato, sezione spenta: sempre lo
 *   stesso testo, così non si capisce quale), senza dati del caso;
 * - una scheda sola per l'errore, con il solo «Riprova» (`ErrorCard`), anche quando il servizio non risponde.
 */

/**
 * Il guscio di ogni schermata del link: il marchio in alto e una colonna di lettura (`max-w-xl`, DESIGN §4.7), con il
 * margine di 16 px al telefono e lo spazio per la barra fissa in basso. Corpo a 16 px. `footer`: il piè di pagina che
 * dà la pagina («Come usiamo le tue risposte», la scadenza del link), solo dove serve.
 */
export function ReferentShell({ children, footer, client }: { children: ReactNode; footer?: ReactNode; client?: string | null }) {
  const name = client?.trim();
  return (
    <main className="mx-auto w-full max-w-xl min-w-0 px-4 pt-5 pb-10 text-base sm:px-6 sm:pt-10">
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-foreground text-[11px] leading-none font-bold text-background">
          U
        </span>
        {name ? (
          <span className="min-w-0 break-words text-muted-foreground">
            <span className="sr-only">{R_TEXT.shell.brand}: </span>
            {R_TEXT.shell.client(name)}
          </span>
        ) : (
          <span className="font-semibold tracking-wide">{R_TEXT.shell.brand}</span>
        )}
      </p>
      {children}
      {footer ? <footer className="mt-10 space-y-1 border-t border-border pt-4">{footer}</footer> : null}
    </main>
  );
}

export function LinkCard({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="mt-8 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10">
      <h1 className="text-xl font-semibold break-words">{title}</h1>
      <p className="mt-3 text-base leading-7 break-words text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}

/** «Questo link non vale più.» — per ogni link che non si può usare, con la sola azione possibile: rispondere all'email. */
export function InvalidLinkCard() {
  return <LinkCard title={R_TEXT.invalidLink.title} body={R_TEXT.invalidLink.body} />;
}

/** Il servizio non risponde (`non_disponibile`): la stessa scheda dell'errore, con «Riprova» che ricarica la pagina. */
export function UnavailableCard() {
  return <ErrorCard />;
}
