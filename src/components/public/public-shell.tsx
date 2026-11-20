import type { ReactNode } from "react";
import { PUBLIC_TEXT, brandLine } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PUBLIC_LINK } from "./classes";

/**
 * Il guscio unico delle pagine fuori dalla dashboard (rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11,
 * dal modello di `/rispondi`). Sostituisce i sette gusci di oggi (audit Fuori §7.2): accesso, invito, pagine legali,
 * condivisione, corso, questionario e informativa, e (all'integrazione) `/rispondi` e `/r`.
 *
 * - **In alto** il marchio, piccolo e non cliccabile: chi risponde non esce per sbaglio. Con il cliente noto la riga dice
 *   «{Cliente} · con Lateral Space».
 * - **Tema chiaro.** `.survey-light` sta nel layout della rotta (`PublicRoot`), reso dal server: chiare anche le schede di
 *   servizio e l'errore.
 * - **In fondo** quello che la pagina passa (`footer`): «Come usiamo le tue risposte», con l'indirizzo della pagina, e il
 *   contatto. Niente piè di pagina se la pagina non ne dà uno.
 * - **Una colonna** larga al massimo 40rem, margini di 16 px al telefono, testo a 16 px. Il pulsante principale è a tutta
 *   larghezza e alto 48 px, tutto il resto almeno 44 px (`./classes.ts`).
 *
 * Nessun componente con portale (Select, Dialog, Popover, Tooltip, toast): uscirebbe dal contenitore chiaro. Senza stato:
 * si rende sul server.
 */
export function PublicShell({ children, footer, client }: { children: ReactNode; footer?: ReactNode; client?: string | null }) {
  return (
    <main data-slot="public-shell" className="mx-auto w-full max-w-[40rem] min-w-0 px-4 pt-5 pb-10 text-base sm:px-6 sm:pt-10">
      <PublicBrand client={client} />
      {children}
      {footer ? (
        <footer data-slot="public-footer" className="mt-10 space-y-2 border-t border-border pt-3 text-sm break-words text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </main>
  );
}

/** Il marchio: la «U» (solo grafica) e la riga, mai un link. */
export function PublicBrand({ client }: { client?: string | null }) {
  return (
    <p data-slot="public-brand" className="flex min-w-0 items-center gap-2 text-sm break-words text-muted-foreground">
      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-foreground text-[11px] leading-none font-bold text-background">
        U
      </span>
      <span className="min-w-0">{brandLine(client)}</span>
    </p>
  );
}

/**
 * La radice chiara dei layout delle rotte pubbliche: `.survey-light` reso dal server, così ogni stato (anche l'errore e la
 * scheda di un link che non vale) è chiaro. Niente scorrimento laterale a 375 px: `overflow-x: clip` e non `hidden`, che
 * farebbe della radice un contenitore che scorre e fermerebbe le barre `sticky` (l'avanzamento del questionario).
 */
export function PublicRoot({ children }: { children: ReactNode }) {
  return (
    <div data-slot="public-root" className="survey-light min-h-dvh w-full min-w-0 overflow-x-clip bg-background text-foreground">
      {children}
    </div>
  );
}

/** Una riga del piè di pagina. */
export function PublicFooterLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("min-h-11 py-2.5", className)}>{children}</p>;
}

/** Un link del piè di pagina (o di una riga di servizio), alto 44 px. `external`: apre una pagina fuori da Unbundle. */
export function PublicLink({ href, children, external = false, className }: { href: string; children: ReactNode; external?: boolean; className?: string }) {
  return (
    <a href={href} className={cn(PUBLIC_LINK, className)} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

/** «Come usiamo le tue risposte»: la pagina dà l'indirizzo dell'informativa. */
export function PublicNoticeLink({ href }: { href: string }) {
  return (
    <PublicFooterLine>
      <PublicLink href={href}>{PUBLIC_TEXT.notice}</PublicLink>
    </PublicFooterLine>
  );
}

/** Il contatto: «Serve aiuto? Scrivi a {indirizzo}». */
export function PublicContact({ label, href }: { label: string; href: string }) {
  return (
    <PublicFooterLine>
      {PUBLIC_TEXT.help} {PUBLIC_TEXT.writeTo}{" "}
      <PublicLink href={href} className="break-all">
        {label}
      </PublicLink>
    </PublicFooterLine>
  );
}
